"""Full group-discussion run: 4 participants, multiple PTT speeches, real scoring."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from app.auth.models import User
from app.core.llm_client import llm
from app.gd.room_manager import gd_room_manager as mgr
from app.gd.schemas import GDParticipantScore, GDSessionRecord, GDSpeechRecord
from app.gd.scoring import compute_final_scores
from app.storage import gd_sessions as gd_sessions_store
from app.storage import gd_speeches as gd_speeches_store

from .corpus import GD_MODERATE, GD_OFF_TOPIC, GD_SHORT, GD_STRONG, GD_TOPIC, Sample
from .harness import Report, Section, bar, count_jsonl

# (sample, speech durations in seconds) — speech count and speak time are the
# inputs to the participation and leadership scores.
LINEUP: tuple[tuple[Sample, tuple[float, ...]], ...] = (
    (GD_STRONG, (45.0, 40.0, 35.0)),    # 3 speeches, 120s — first speaker
    (GD_MODERATE, (40.0, 30.0)),        # 2 speeches, 70s
    (GD_OFF_TOPIC, (50.0, 40.0)),       # 2 speeches, 90s
    (GD_SHORT, (10.0,)),                # 1 speech, 10s — and it interrupts
)


def _user(index: int, label: str) -> User:
    return User(
        uid=f"ft-gd-{index}",
        email=f"ft.gd{index}@kiet.edu",
        name=f"P{index} ({label})",
        email_verified=True,
        role="student",
    )


def _chunks(text: str, count: int) -> list[str]:
    """Split a transcript into `count` roughly equal pieces (one per PTT press)."""
    words = text.split()
    if count <= 1:
        return [text]
    size = max(1, len(words) // count)
    pieces = [" ".join(words[i * size:(i + 1) * size]) for i in range(count - 1)]
    pieces.append(" ".join(words[(count - 1) * size:]))
    return [p for p in pieces if p]


def _force_discussion(code: str) -> None:
    """Skip the 20s grace + 120s prep timers; keep discussion open."""
    mgr._cancel_all_timers(code)
    room = mgr._rooms[code]
    room.state = "discussion"
    room.prep_deadline = None
    room.auto_start_deadline = None
    room.discussion_deadline = time.time() + 3600


async def _speak(
    code: str,
    user: User,
    sample: Sample,
    transcript: str,
    duration: float,
    *,
    interrupt_holder: User | None = None,
) -> GDSpeechRecord:
    """One PTT press: start, (optionally overlap another speaker), end, persist.

    ``interrupt_holder`` opens a speech for another user first so this speech
    registers as an interruption, exercising the etiquette penalty.
    """
    room = mgr._rooms[code]
    holder_speech = None
    if interrupt_holder is not None:
        holder_speech, _ = await mgr.start_speech(code, interrupt_holder)

    speech, _ = await mgr.start_speech(code, user)
    # Back-date the start so the recorded duration is realistic without waiting.
    speech.started_at = time.time() - duration

    ended = await mgr.end_speech(
        code=code,
        user=user,
        speech_id=speech.speech_id,
        audio_ref=f"ft-audio-{speech.speech_id[:8]}",
        transcript=transcript,
        analysis_id=f"ft-analysis-{speech.speech_id[:8]}",
    )

    if holder_speech is not None and interrupt_holder is not None:
        holder_speech.started_at = time.time() - 5.0
        await mgr.end_speech(
            code=code,
            user=interrupt_holder,
            speech_id=holder_speech.speech_id,
            audio_ref=None,
            transcript="",
            analysis_id=None,
        )

    record = GDSpeechRecord(
        speech_id=speech.speech_id,
        session_id=room.session_id,
        participant_id=speech.participant_id,
        display_name=speech.display_name,
        started_at=speech.started_at,
        ended_at=ended.ended_at if ended else time.time(),
        duration_seconds=ended.duration_seconds if ended else duration,
        audio_ref=speech.audio_ref,
        transcript=transcript,
        analysis_id=speech.analysis_id,
        pronunciation_score=sample.clarity - 4.0,
        fluency_score=sample.clarity,
        is_interruption=speech.is_interruption,
    )
    gd_speeches_store.save_speech(record)
    return record


async def run(
    report: Report, sandbox: Path, *, strict: bool = False, pace: float = 5.0
) -> None:
    section = report.section("GROUP DISCUSSION - full 4-participant run (real scoring)")
    section.note(f"topic: {GD_TOPIC.title}")
    section.note(
        "speakers: "
        + ", ".join(
            f"P{i + 1}={s.key}({len(d)} speeches/{sum(d):.0f}s)"
            for i, (s, d) in enumerate(LINEUP)
        )
    )

    users = [_user(i + 1, s.key) for i, (s, _) in enumerate(LINEUP)]
    code: str | None = None

    try:
        room = await mgr.create_room(users[0])
        code = room.code
        section.record("create_room returns a 6-char code", len(code) == 6, code)

        room.topic_id = GD_TOPIC.id
        room.topic_title = GD_TOPIC.title
        room.topic_text = GD_TOPIC.text

        for user in users[1:]:
            await mgr.join_room(code, user)
        section.record(
            "all 4 participants joined",
            len(mgr._rooms[code].participants) == 4,
            f"{len(mgr._rooms[code].participants)} in room",
        )

        for user in users:
            await mgr.flip_ready(code, user)
        _force_discussion(code)
        section.record(
            "room enters discussion state",
            mgr._rooms[code].state == "discussion",
            mgr._rooms[code].state,
        )

        # --- speeches ------------------------------------------------------
        expected_counts: dict[str, int] = {}
        for position, (user, (sample, durations)) in enumerate(zip(users, LINEUP)):
            pieces = _chunks(sample.text, len(durations))
            for turn_number, (piece, duration) in enumerate(zip(pieces, durations)):
                # The last speaker interrupts the first one, once.
                holder = users[0] if (position == 3 and turn_number == 0) else None
                await _speak(
                    code, user, sample, piece, duration, interrupt_holder=holder
                )
            expected_counts[sample.key] = len(durations)

        participant_by_key = {
            sample.key: mgr._rooms[code].participants[i]
            for i, (sample, _) in enumerate(LINEUP)
        }

        section.record(
            "first speaker flagged",
            participant_by_key["gd_strong"].is_first_speaker,
            f"gd_strong.is_first_speaker={participant_by_key['gd_strong'].is_first_speaker}",
        )
        section.record(
            "interruption recorded for the interrupting speaker",
            participant_by_key["gd_short"].interruption_count == 1,
            f"interruption_count={participant_by_key['gd_short'].interruption_count}",
        )
        section.record(
            "interrupted speaker's was_interrupted counter incremented",
            participant_by_key["gd_strong"].was_interrupted_count >= 1,
            f"was_interrupted_count={participant_by_key['gd_strong'].was_interrupted_count}",
        )

        # --- host permissions ----------------------------------------------
        section.record(
            "room creator is marked host",
            participant_by_key["gd_strong"].is_host,
            f"is_host={participant_by_key['gd_strong'].is_host}",
        )
        section.record(
            "joiners are not hosts",
            not any(
                participant_by_key[key].is_host
                for key in ("gd_moderate", "gd_off_topic", "gd_short")
            ),
            "only one host in the room",
        )
        await _assert_end_is_host_only(section, code, users)

        # --- end + score (mirrors the route's background scoring task) ------
        await mgr.end_discussion(code)
        section.record(
            "discussion moves to scoring",
            mgr._rooms[code].state == "scoring",
            mgr._rooms[code].state,
        )

        current = mgr._rooms[code]
        persisted = gd_speeches_store.list_speeches_for_session(current.session_id)
        expected_total = sum(len(d) for _, d in LINEUP)
        section.record(
            "all speeches persisted",
            len(persisted) == expected_total,
            f"{len(persisted)} of {expected_total}",
        )

        if pace:
            # compute_final_scores fires two large prompts (content + listening).
            await asyncio.sleep(pace)

        scores = await compute_final_scores(current, persisted)
        session_record = GDSessionRecord(
            session_id=current.session_id,
            code=current.code,
            topic_id=current.topic_id,
            topic_title=current.topic_title,
            topic_text=current.topic_text,
            participants=[
                {
                    "participant_id": p.participant_id,
                    "user_id": p.user_id,
                    "display_name": p.display_name,
                    "speech_count": p.speech_count,
                    "total_speak_seconds": p.total_speak_seconds,
                }
                for p in current.participants
            ],
            speech_ids=[s.speech_id for s in persisted],
            scores=scores,
            created_at=current.created_at,
            completed_at=time.time(),
        )
        gd_sessions_store.save_session(session_record)
        await mgr.finalize_scores(code, scores)

        section.record(
            "room reached complete",
            mgr._rooms[code].state == "complete",
            mgr._rooms[code].state,
        )
        section.record(
            "1 session persisted",
            count_jsonl(sandbox / "gd_sessions.jsonl") == 1,
            f"{count_jsonl(sandbox / 'gd_sessions.jsonl')} rows",
        )

        by_key = {
            sample.key: next(
                s for s in scores
                if s.participant_id == participant_by_key[sample.key].participant_id
            )
            for sample, _ in LINEUP
        }

        _print_table(section, by_key)
        _assert_gd_scores(section, by_key, scores, expected_counts, strict=strict)

    except Exception as exc:  # noqa: BLE001 - report instead of crashing the run
        section.error = f"{type(exc).__name__}: {exc}"
    finally:
        if code:
            mgr._cancel_all_timers(code)
            mgr._rooms.pop(code, None)


async def _assert_end_is_host_only(
    section: Section, code: str, users: list[User]
) -> None:
    """A non-host calling the end-discussion route must be rejected.

    The route guard is called directly because AUTH_BYPASS collapses every HTTP
    request onto one dev user, so distinct callers cannot be simulated over
    HTTP. The host path is deliberately not exercised here: it would spawn the
    real background scoring task and race this test's own scoring.
    """
    from fastapi import HTTPException

    from app.gd.routes import end_discussion_manually

    try:
        await end_discussion_manually(code, current_user=users[1])
    except HTTPException as exc:
        section.record(
            "non-host cannot end the discussion",
            exc.status_code == 403 and exc.detail == "host_only",
            f"{exc.status_code} {exc.detail}",
        )
    else:
        section.record(
            "non-host cannot end the discussion",
            False,
            "call succeeded for a non-host",
        )

    section.record(
        "rejected call left the discussion running",
        mgr._rooms[code].state == "discussion",
        mgr._rooms[code].state,
    )


def _print_table(section: Section, by_key: dict[str, GDParticipantScore]) -> None:
    section.note("")
    section.note("component scores (content/30 comm/20 part/20 listen/15 lead/15):")
    for key, score in by_key.items():
        section.note(
            f"  {key:<13} content={score.content_quality:>5.1f} "
            f"comm={score.communication:>5.1f} part={score.participation:>5.1f} "
            f"listen={score.listening:>4.1f} lead={score.leadership:>4.1f} "
            f"=> total={score.total_score:>6.2f} {bar(score.total_score, 100)} rank #{score.rank}"
        )


def _assert_gd_scores(
    section: Section,
    by_key: dict[str, GDParticipantScore],
    scores: list[GDParticipantScore],
    expected_counts: dict[str, int],
    *,
    strict: bool,
) -> None:
    # Hard: bounds and bookkeeping.
    section.record("4 participants scored", len(scores) == 4, f"{len(scores)} scores")
    ranks = sorted(s.rank for s in scores)
    section.record("ranks are 1..4 and unique", ranks == [1, 2, 3, 4], str(ranks))

    for key, score in by_key.items():
        section.record(
            f"{key}: components within their maxima",
            (
                0 <= score.content_quality <= 30
                and 0 <= score.communication <= 20
                and 0 <= score.participation <= 20
                and 0 <= score.listening <= 15
                and 0 <= score.leadership <= 15
                and 0 <= score.total_score <= 100
            ),
            f"total={score.total_score}",
        )
        section.record(
            f"{key}: speech_count matches speeches submitted",
            score.speech_count == expected_counts[key],
            f"{score.speech_count} vs {expected_counts[key]} expected",
        )

    # Hard: participation is a deterministic function of time + count.
    section.record(
        "participation ranks by speak time and speech count",
        by_key["gd_strong"].participation
        >= by_key["gd_off_topic"].participation
        >= by_key["gd_moderate"].participation
        > by_key["gd_short"].participation,
        (
            f"strong={by_key['gd_strong'].participation} "
            f"off_topic={by_key['gd_off_topic'].participation} "
            f"moderate={by_key['gd_moderate'].participation} "
            f"short={by_key['gd_short'].participation}"
        ),
    )

    # Hard: first-speaker bonus is a fixed 5 points.
    section.record(
        "first speaker gets the leadership bonus",
        by_key["gd_strong"].leadership >= 5.0,
        f"leadership={by_key['gd_strong'].leadership}",
    )

    # Hard: the interrupting speaker loses the etiquette points.
    section.record(
        "interrupting speaker scores lower on leadership than the first speaker",
        by_key["gd_short"].leadership < by_key["gd_strong"].leadership,
        f"short={by_key['gd_short'].leadership} vs strong={by_key['gd_strong'].leadership}",
    )

    # Hard: the content gate. Delivery and speak time must not carry a speaker
    # who never engaged with the topic.
    off_topic = by_key["gd_off_topic"]
    if off_topic.content_quality <= 0:
        section.record(
            "zero-content speaker is gated to 25/100 or below",
            off_topic.total_score <= 25.0,
            (
                f"total={off_topic.total_score} "
                f"(comm={off_topic.communication}, part={off_topic.participation})"
            ),
        )
    elif off_topic.content_quality <= 5:
        section.record(
            "very-low-content speaker is gated to 40/100 or below",
            off_topic.total_score <= 40.0,
            f"total={off_topic.total_score}, content={off_topic.content_quality}",
        )

    # Soft: LLM judgement. Without a provider the scorer returns a flat
    # fallback for everyone, so these comparisons carry no signal.
    if not llm.is_available:
        section.skip("content and listening comparisons", "no LLM provider configured")
        return

    section.record(
        "on-topic speaker beats off-topic speaker on content quality",
        by_key["gd_strong"].content_quality > by_key["gd_off_topic"].content_quality,
        f"strong={by_key['gd_strong'].content_quality} vs off_topic={by_key['gd_off_topic'].content_quality}",
        soft=True,
        strict=strict,
    )
    section.record(
        "speaker who references others scores higher on listening",
        by_key["gd_strong"].listening >= by_key["gd_off_topic"].listening,
        f"strong={by_key['gd_strong'].listening} vs off_topic={by_key['gd_off_topic'].listening}",
        soft=True,
        strict=strict,
    )
    section.record(
        "strong speaker takes rank 1",
        by_key["gd_strong"].rank == 1,
        f"rank={by_key['gd_strong'].rank}",
        soft=True,
        strict=strict,
    )
