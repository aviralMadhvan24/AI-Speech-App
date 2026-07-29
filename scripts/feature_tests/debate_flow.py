"""Debate runs: head-to-head (2 speakers), real state machine, real scoring.

Debate is capped at two participants, so the four content types are covered
across two matches rather than one multi-way room.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from app.auth.models import User
from app.core.llm_client import llm
from app.debate.room_manager import MAX_PARTICIPANTS, debate_room_manager as mgr

from .corpus import DEBATE_MATCHES, DEBATE_MOTION, Sample
from .harness import Report, Section, bar, count_jsonl
from .synth import build_analysis, register_artifact


def _user(tag: str, label: str) -> User:
    return User(
        uid=f"ft-debate-{tag}",
        email=f"ft.debate.{tag}@kiet.edu",
        name=f"{tag} ({label})",
        email_verified=True,
        role="student",
    )


def _force_speaking(code: str) -> None:
    """Skip the auto-start grace and prep timers.

    Replicates the transitions ``_delayed_auto_start`` + ``_run_prep_timer``
    perform, minus the sleeps, so a run takes seconds instead of minutes. The
    turn deadline is pushed far out so no turn is forfeited mid-scoring.
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
    section = report.section("DEBATE - head-to-head runs (real scoring)")
    section.note(f"motion: {DEBATE_MOTION.title}")
    section.note(f"participant cap: {MAX_PARTICIPANTS}")
    section.note(
        "matches: "
        + "; ".join(f"{a.key} vs {b.key}" for a, b in DEBATE_MATCHES)
    )

    results: dict[str, dict] = {}
    codes: list[str] = []

    try:
        section.record(
            "debate is capped at two participants",
            MAX_PARTICIPANTS == 2,
            f"MAX_PARTICIPANTS={MAX_PARTICIPANTS}",
        )

        for match_index, (left, right) in enumerate(DEBATE_MATCHES, start=1):
            code = await _run_match(
                section,
                match_index,
                left,
                right,
                results,
                pace=pace,
                check_room_full=(match_index == 1),
            )
            if code:
                codes.append(code)

        # --- persistence across both matches -------------------------------
        turns_written = count_jsonl(sandbox / "debate_turns.jsonl")
        debates_written = count_jsonl(sandbox / "debates.jsonl")
        section.record(
            "every turn persisted",
            turns_written == 2 * len(DEBATE_MATCHES),
            f"{turns_written} rows, expected {2 * len(DEBATE_MATCHES)}",
        )
        section.record(
            "one debate record per match",
            debates_written == len(DEBATE_MATCHES),
            f"{debates_written} rows, expected {len(DEBATE_MATCHES)}",
        )

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

        _assert_score_behaviour(section, results, strict=strict)
        _assert_feedback(section, results, strict=strict)

    except Exception as exc:  # noqa: BLE001 - report instead of crashing the run
        section.error = f"{type(exc).__name__}: {exc}"
    finally:
        for code in codes:
            mgr._cancel_all_timers(code)
            mgr._discard(code)


async def _run_match(
    section: Section,
    match_index: int,
    left: Sample,
    right: Sample,
    results: dict[str, dict],
    *,
    pace: float,
    check_room_full: bool,
) -> str | None:
    """Drive one two-speaker debate to completion."""
    users = [_user(f"m{match_index}a", left.key), _user(f"m{match_index}b", right.key)]
    lineup = (left, right)

    room = await mgr.create_room(users[0])
    code = room.code

    # Pin the motion so the on/off-topic corpus is meaningful.
    room.motion_id = DEBATE_MOTION.id
    room.motion_title = DEBATE_MOTION.title
    room.motion_text = DEBATE_MOTION.text

    await mgr.join_room(code, users[1])
    section.record(
        f"match {match_index}: both speakers joined",
        len(mgr._rooms[code].participants) == 2,
        f"{len(mgr._rooms[code].participants)} in room",
    )

    # Re-join must not duplicate a participant.
    await mgr.join_room(code, users[1])
    section.record(
        f"match {match_index}: re-join is idempotent",
        len(mgr._rooms[code].participants) == 2,
        f"{len(mgr._rooms[code].participants)} after rejoin",
    )

    if check_room_full:
        gatecrasher = _user("gatecrasher", "extra")
        try:
            await mgr.join_room(code, gatecrasher)
            section.record(
                "third participant is rejected",
                False,
                f"join succeeded, room now has {len(mgr._rooms[code].participants)}",
            )
        except Exception as exc:  # noqa: BLE001 - HTTPException expected
            detail = getattr(exc, "detail", str(exc))
            section.record(
                "third participant is rejected",
                detail == "room_full",
                f"detail={detail}",
            )

    for user in users:
        await mgr.flip_ready(code, user)

    _force_speaking(code)
    section.record(
        f"match {match_index}: room enters speaking state",
        mgr._rooms[code].state == "speaking",
        mgr._rooms[code].state,
    )

    for index, (user, sample) in enumerate(zip(users, lineup)):
        active = mgr._rooms[code].active_turn_index
        if active != index:
            section.record(
                f"match {match_index}: turn {index + 1} active before submit",
                False,
                f"active_turn_index={active}, expected {index}",
            )
            return code

        if pace:
            # Each turn fires one large LLM prompt; stay under the
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
            "match": match_index,
        }
        section.record(
            f"match {match_index}: turn accepted ({sample.key})",
            turn.turn_id is not None and not turn.scoring_unavailable,
            f"ai={turn.ai_score}, content={turn.content_score}",
        )

    final_room = mgr._rooms[code]
    section.record(
        f"match {match_index}: reached complete",
        final_room.state == "complete",
        final_room.state,
    )
    section.record(
        f"match {match_index}: winner selected",
        final_room.winner_participant_id is not None,
        str(final_room.winner_participant_id),
    )
    section.record(
        f"match {match_index}: standings cover both speakers",
        len(final_room.final_standings) == 2,
        f"{len(final_room.final_standings)} standings",
    )
    return code


def _assert_score_behaviour(
    section: Section, results: dict[str, dict], *, strict: bool
) -> None:
    """Check the score relationships the product promises."""
    expected = {s.key for match in DEBATE_MATCHES for s in match}
    if not expected <= results.keys():
        section.skip("score relationships", "not all turns completed")
        return

    if not llm.is_available:
        for key, data in results.items():
            section.record(
                f"{key}: final score within 0-100 (delivery only)",
                0.0 <= data["ai_score"] <= 100.0,
                str(data["ai_score"]),
            )
        section.record(
            "delivery-only scores cannot exceed 50",
            all(d["ai_score"] <= 50.0 for d in results.values()),
            "content is half the rubric, so it is scored out of 50 when missing",
        )
        section.skip("content score relationships", "no LLM provider configured")
        return

    strong = results["strong"]
    moderate = results["moderate"]
    off_topic = results["off_topic"]
    short = results["short"]

    # Hard: structural guarantees that hold regardless of LLM wording.
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

    # Hard: the off-topic gate is programmatic once the judge flags it.
    section.record(
        "off-topic turn is gated to 20/100 or below",
        off_topic["ai_score"] <= 20.0,
        f"off_topic final={off_topic['ai_score']} (its clarity was the highest of all samples)",
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
        "strong speech wins its match",
        strong["ai_score"] > off_topic["ai_score"],
        f"strong={strong['ai_score']} vs off_topic={off_topic['ai_score']}",
        soft=True,
        strict=strict,
    )


def _assert_feedback(section: Section, results: dict[str, dict], *, strict: bool) -> None:
    if not llm.is_available or "off_topic" not in results or "short" not in results:
        return

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
