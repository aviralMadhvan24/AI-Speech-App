"""Full debate run: 4 participants, real state machine, real scoring."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from app.auth.models import User
from app.core.llm_client import llm
from app.debate.room_manager import debate_room_manager as mgr

from .corpus import DEBATE_LINEUP, DEBATE_MOTION
from .harness import Report, Section, bar, count_jsonl
from .synth import build_analysis, register_artifact


def _user(index: int, sample_label: str) -> User:
    return User(
        uid=f"ft-debate-{index}",
        email=f"ft.debate{index}@kiet.edu",
        name=f"P{index} ({sample_label})",
        email_verified=True,
        role="student",
    )


def _force_speaking(code: str) -> None:
    """Skip the 20s auto-start grace and 60s prep timers.

    Replicates exactly what ``_delayed_auto_start`` + ``_run_prep_timer`` do
    on transition, minus the sleeps, so the run takes seconds instead of
    minutes. The turn deadline is pushed far out so no turn is forfeited
    while the LLM is scoring.
    """
    mgr._cancel_all_timers(code)
    room = mgr._rooms[code]
    for index, participant in enumerate(room.participants):
        participant.turn_index = index
    room.state = "speaking"
    room.active_turn_index = 0
    room.prep_deadline = None
    room.auto_start_deadline = None
    room.turn_deadline = time.time() + 3600


async def run(
    report: Report, sandbox: Path, *, strict: bool = False, pace: float = 5.0
) -> None:
    section = report.section("DEBATE - full 4-participant run (real scoring)")
    section.note(f"motion: {DEBATE_MOTION.title}")
    section.note(
        "speakers: " + ", ".join(f"P{i + 1}={s.key}" for i, s in enumerate(DEBATE_LINEUP))
    )

    users = [_user(i + 1, s.key) for i, s in enumerate(DEBATE_LINEUP)]
    code: str | None = None

    try:
        # --- lobby ---------------------------------------------------------
        room = await mgr.create_room(users[0])
        code = room.code
        section.record("create_room returns a 6-char code", len(code) == 6, code)

        # Pin the motion so the on/off-topic corpus is meaningful.
        room.motion_id = DEBATE_MOTION.id
        room.motion_title = DEBATE_MOTION.title
        room.motion_text = DEBATE_MOTION.text

        for user in users[1:]:
            await mgr.join_room(code, user)
        section.record(
            "all 4 participants joined",
            len(mgr._rooms[code].participants) == 4,
            f"{len(mgr._rooms[code].participants)} in room",
        )

        # Idempotent rejoin must not duplicate a participant.
        await mgr.join_room(code, users[1])
        section.record(
            "re-join is idempotent",
            len(mgr._rooms[code].participants) == 4,
            f"{len(mgr._rooms[code].participants)} after rejoin",
        )

        for user in users:
            await mgr.flip_ready(code, user)
        ready = sum(1 for p in mgr._rooms[code].participants if p.is_ready)
        section.record("all participants ready", ready == 4, f"{ready}/4 ready")

        _force_speaking(code)
        section.record(
            "room enters speaking state",
            mgr._rooms[code].state == "speaking",
            mgr._rooms[code].state,
        )

        # --- turns ---------------------------------------------------------
        results: dict[str, dict] = {}
        for index, (user, sample) in enumerate(zip(users, DEBATE_LINEUP)):
            active = mgr._rooms[code].active_turn_index
            if active != index:
                section.record(
                    f"turn {index + 1} is active before submit",
                    False,
                    f"active_turn_index={active}, expected {index}",
                )
                break

            if index and pace:
                # Each turn triggers one large LLM prompt; stay under the
                # provider's tokens-per-minute ceiling.
                await asyncio.sleep(pace)

            audio, transcription, pronunciation, fluency, analysis_id = build_analysis(sample)
            turn, _ = await mgr.submit_turn(
                code=code,
                user=user,
                audio_asset=audio,
                transcription=transcription,
                pronunciation=pronunciation,
                fluency=fluency,
                analysis_id=analysis_id,
            )
            # submit_turn copies the audio to uploads/<turn_id>.webm for playback.
            register_artifact(f"uploads/{turn.turn_id}.webm")

            results[sample.key] = {
                "ai_score": turn.ai_score,
                "content_score": turn.content_score,
                "feedback": turn.content_feedback or "",
                "words": sample.word_count,
                "participant_id": turn.participant_id,
            }
            section.record(
                f"turn accepted: P{index + 1} ({sample.key})",
                turn.turn_id is not None and not turn.scoring_unavailable,
                f"ai={turn.ai_score}, content={turn.content_score}",
            )

        # --- completion ----------------------------------------------------
        final_room = mgr._rooms[code]
        section.record(
            "room reached complete after last turn",
            final_room.state == "complete",
            final_room.state,
        )
        section.record(
            "winner was selected",
            final_room.winner_participant_id is not None,
            str(final_room.winner_participant_id),
        )
        section.record(
            "final standings cover all 4 speakers",
            len(final_room.final_standings) == 4,
            f"{len(final_room.final_standings)} standings",
        )

        # --- persistence ---------------------------------------------------
        turns_written = count_jsonl(sandbox / "debate_turns.jsonl")
        debates_written = count_jsonl(sandbox / "debates.jsonl")
        section.record("4 turns persisted", turns_written == 4, f"{turns_written} rows")
        section.record("1 debate record persisted", debates_written == 1, f"{debates_written} rows")

        # --- score table ---------------------------------------------------
        if results:
            section.note("")
            section.note("content score (of 50) and final AI score (of 100):")
            for key, data in results.items():
                content = data["content_score"]
                content_text = "n/a" if content is None else f"{content:>2.0f}/50"
                section.note(
                    f"  {key:<10} words={data['words']:>3}  "
                    f"content={content_text} {bar(content or 0, 50)}  "
                    f"final={data['ai_score']:>6.2f}/100"
                )

        # --- scoring behaviour ---------------------------------------------
        _assert_score_behaviour(section, results, strict=strict)

        # --- feedback quality ----------------------------------------------
        if llm.is_available and len(results) == 4:
            off_topic_feedback = results["off_topic"]["feedback"]
            section.record(
                "off-topic turn is flagged in feedback",
                "OFF-TOPIC" in off_topic_feedback.upper(),
                (off_topic_feedback[:90] or "no feedback"),
                soft=True,
                strict=strict,
            )
            short_feedback = results["short"]["feedback"]
            section.record(
                "short turn feedback mentions length",
                "short" in short_feedback.lower(),
                (short_feedback[:90] or "no feedback"),
                soft=True,
                strict=strict,
            )

    except Exception as exc:  # noqa: BLE001 - report instead of crashing the run
        section.error = f"{type(exc).__name__}: {exc}"
    finally:
        if code:
            mgr._cancel_all_timers(code)
            mgr._discard(code)


def _assert_score_behaviour(section: Section, results: dict[str, dict], *, strict: bool) -> None:
    """Check the score relationships the product promises."""
    if len(results) < 4:
        section.skip("score relationships", "not all turns completed")
        return

    if not llm.is_available:
        for key, data in results.items():
            section.record(
                f"{key}: final score within 0-100 (fluency only)",
                0.0 <= data["ai_score"] <= 100.0,
                str(data["ai_score"]),
            )
        section.skip(
            "content score relationships", "no LLM provider configured"
        )
        return

    strong = results["strong"]
    moderate = results["moderate"]
    off_topic = results["off_topic"]
    short = results["short"]

    # Hard: structural guarantees that must hold regardless of LLM wording.
    for key, data in results.items():
        section.record(
            f"{key}: final score within 0-100",
            0.0 <= data["ai_score"] <= 100.0,
            str(data["ai_score"]),
        )
        content = data["content_score"]
        section.record(
            f"{key}: content score within 0-50",
            content is not None and 0 <= content <= 50,
            str(content),
        )

    # Hard: the length penalty is programmatic, not LLM judgement.
    section.record(
        "short turn scores below the strong turn (length penalty)",
        short["content_score"] < strong["content_score"],
        f"short={short['content_score']} vs strong={strong['content_score']}",
    )

    # Soft: these depend on LLM judgement.
    section.record(
        "strong beats moderate on content",
        strong["content_score"] > moderate["content_score"],
        f"strong={strong['content_score']} vs moderate={moderate['content_score']}",
        soft=True,
        strict=strict,
    )
    section.record(
        "strong beats off-topic on content",
        strong["content_score"] > off_topic["content_score"],
        f"strong={strong['content_score']} vs off_topic={off_topic['content_score']}",
        soft=True,
        strict=strict,
    )
    section.record(
        "fluent-but-off-topic is capped below 50/100 final",
        off_topic["ai_score"] < 50.0,
        f"off_topic final={off_topic['ai_score']} (clarity was the highest of all speakers)",
        soft=True,
        strict=strict,
    )
    section.record(
        "strong speech wins the debate",
        strong["ai_score"] == max(d["ai_score"] for d in results.values()),
        f"strong={strong['ai_score']}, max={max(d['ai_score'] for d in results.values())}",
        soft=True,
        strict=strict,
    )
