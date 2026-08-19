"""Buddy mentorship domain logic: who is a strong speaker, and who may talk to whom.

Mentor selection is score-suggested and teacher-approved. This module owns the
"suggested" half — ranking students by demonstrated speaking ability — while the
approval itself is a teacher action recorded in ``MentorsStore``.

Scoring sources — all four the platform can attribute to a student:

- interview submissions carry ``student_email`` directly;
- completed debates and GD sessions carry ``participants[].user_id`` (the
  Firebase uid), joined to ``firebase_uid`` via ``users_store``;
- pronunciation attempts carry ``student_email`` on rows written after that
  field was added. Older rows have no owner and never can — they are skipped
  rather than guessed at.

Reading only interviews, as this module once did, meant the strongest debater
in a cohort was invisible to mentor selection: the two features where students
actually speak competitively counted for nothing. ``_speaking_signals`` is the
one place that decides what evidence counts, so it is the place to extend.
"""

from __future__ import annotations

import logging
from typing import NamedTuple
from typing import Optional

from pydantic import BaseModel

from app.attempts import storage as attempts_storage
from app.storage import submissions_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store

logger = logging.getLogger("buddy.service")


# A mentor should have shown consistency, not one good day. Below this many
# scored submissions a student is not suggested at all.
MIN_SAMPLE_SIZE = 2

# Out of 100. Chosen to sit above "mostly clear" pronunciation feedback (70)
# without demanding near-perfect scores, which no student reaches in practice.
SUGGESTION_THRESHOLD = 65.0


class SpeakerSignals(NamedTuple):
    """Every scored signal the platform can attribute to one student.

    ``work_count`` counts pieces of WORK, not scores. One interview that
    produced both a content and a pronunciation score is a single piece of
    evidence about a speaker, so counting the axes would let one submission
    look like two — and `MIN_SAMPLE_SIZE` exists precisely to demand that a
    mentor has shown consistency rather than had one good day.
    """

    content: list[float]
    pronunciation: list[float]
    live_speaking: list[float]
    work_count: int


class SpeakerRanking(BaseModel):
    """One student's demonstrated speaking ability, aggregated across attempts."""

    email: str
    name: Optional[str] = None
    speaking_score: float
    sample_size: int
    content_avg: Optional[float] = None
    pronunciation_avg: Optional[float] = None
    # Debates and GD sessions — "speaking with an audience", which is the
    # closest thing the platform has to what a buddy mentor actually does.
    live_speaking_avg: Optional[float] = None
    status: str = "none"  # none | suggested | approved | rejected
    active_mentees: int = 0
    # Mentoring track record, for a teacher deciding whether to keep using
    # someone. None until their mentees have rated a session.
    mentor_rating: Optional[float] = None
    sessions_mentored: int = 0


def _mean(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def _speaking_signals(email: str) -> SpeakerSignals:
    """Collect every attributable 0-100 score for one student.

    Only work that actually produced a score counts. An unavailable content
    result or a pending pronunciation pass is skipped rather than counted as
    zero, which would punish a student for an outage.
    """
    content: list[float] = []
    pronunciation: list[float] = []
    live_speaking: list[float] = []
    works = 0

    for submission in submissions_store.list_for_student(email):
        result = submission.content_result
        if result is None:
            continue
        scored = False
        if result.available and result.total:
            content.append(float(result.total))
            scored = True
        snapshot = result.pronunciation
        if snapshot is not None and snapshot.available and snapshot.score is not None:
            pronunciation.append(float(snapshot.score))
            scored = True
        # One submission is one piece of work however many axes it scored on.
        if scored:
            works += 1

    # Standalone pronunciation practice. Attributable only on rows written
    # since `student_email` was added to AttemptSummary.
    try:
        for attempt in attempts_storage.list_for_student(email):
            if attempt.pronunciation_available and attempt.pronunciation_score is not None:
                pronunciation.append(float(attempt.pronunciation_score))
                works += 1
    except Exception as exc:  # a malformed store must not blank the ranking
        logger.warning("buddy_rank_attempts_failed err=%s", type(exc).__name__)

    # Debates and GD. `growth._live_events` already owns the uid join and
    # swallows a broken store per-source, so reuse it rather than repeat it.
    try:
        from app.buddy.growth import _live_events

        live_speaking.extend(score for _at, _title, score, _kind in _live_events(email))
        works += len(live_speaking)
    except Exception as exc:
        logger.warning("buddy_rank_live_failed err=%s", type(exc).__name__)

    return SpeakerSignals(
        content=content,
        pronunciation=pronunciation,
        live_speaking=live_speaking,
        work_count=works,
    )


class MentoringRecord(NamedTuple):
    """How someone has performed AS A MENTOR, across every pair they hold."""

    sessions_mentored: int
    rating: Optional[float]


def _mentoring_records() -> dict[str, MentoringRecord]:
    """Sessions kept and mean mentee rating, per mentor email.

    Built in one pass for the whole cohort — the ranking asks about every
    student at once, and doing this per mentor would re-read both stores once
    per row.
    """
    sessions_by_pair: dict[str, list] = {}
    for session in buddy_sessions_store.list_all():
        sessions_by_pair.setdefault(session.pair_id, []).append(session)

    kept: dict[str, int] = {}
    ratings: dict[str, list[float]] = {}
    for pair in buddy_pairs_store.list_all():
        mentor = pair.mentor_email.lower()
        for session in sessions_by_pair.get(pair.pair_id, []):
            if session.status != "completed":
                continue
            kept[mentor] = kept.get(mentor, 0) + 1
            if session.mentee_rating is not None:
                ratings.setdefault(mentor, []).append(float(session.mentee_rating))

    return {
        email: MentoringRecord(
            sessions_mentored=count,
            rating=_mean(ratings.get(email, [])),
        )
        for email, count in kept.items()
    }


def rank_speakers() -> list[SpeakerRanking]:
    """Rank every student who has scored speaking work, best first.

    The combined score is the mean of whichever axis averages exist — content,
    pronunciation, live speaking. Averaging the axes rather than every raw
    score keeps one prolific source from drowning out the others: a student
    with thirty pronunciation drills and one debate should not be ranked as
    though pronunciation were the whole picture.

    A student is rankable on any single axis. Someone who only ever debates is
    still a demonstrated speaker.
    """
    from app.storage import users_store

    rankings: list[SpeakerRanking] = []
    active_pairs = buddy_pairs_store.list_active()
    mentoring = _mentoring_records()

    for user in users_store.list_all():
        if user.role != "student":
            continue

        signals = _speaking_signals(user.email)
        sample_size = signals.work_count
        if sample_size == 0:
            continue

        content_avg = _mean(signals.content)
        pronunciation_avg = _mean(signals.pronunciation)
        live_avg = _mean(signals.live_speaking)
        parts = [v for v in (content_avg, pronunciation_avg, live_avg) if v is not None]
        if not parts:
            continue

        mentor = mentors_store.get(user.email)
        record = mentoring.get(user.email.lower())
        rankings.append(
            SpeakerRanking(
                email=user.email,
                name=user.display_name,
                speaking_score=round(sum(parts) / len(parts), 2),
                sample_size=sample_size,
                content_avg=content_avg,
                pronunciation_avg=pronunciation_avg,
                live_speaking_avg=live_avg,
                status=mentor.status if mentor else "none",
                active_mentees=sum(
                    1
                    for p in active_pairs
                    if p.mentor_email.lower() == user.email.lower()
                ),
                mentor_rating=record.rating if record else None,
                sessions_mentored=record.sessions_mentored if record else 0,
            )
        )

    rankings.sort(key=lambda r: r.speaking_score, reverse=True)
    return rankings


def suggested_mentors() -> list[SpeakerRanking]:
    """Students the system puts forward for a teacher to approve.

    Anyone already decided on (approved or rejected) is filtered out — the
    teacher has answered for them, and re-suggesting a rejected student every
    time the list refreshes would be noise.
    """
    return [
        r
        for r in rank_speakers()
        if r.sample_size >= MIN_SAMPLE_SIZE
        and r.speaking_score >= SUGGESTION_THRESHOLD
        and r.status in ("none", "suggested")
    ]


def can_access_pair(pair_id: str, email: str, is_teacher: bool = False) -> bool:
    """Whether this user may read or post in the conversation.

    Teachers can read any pair — this is a classroom tool and the pairing is
    their doing — but membership is what lets a student in.
    """
    pair = buddy_pairs_store.get(pair_id)
    if pair is None:
        return False
    return is_teacher or pair.involves(email)
