"""Buddy mentorship domain logic: who is a strong speaker, and who may talk to whom.

Mentor selection is score-suggested and teacher-approved. This module owns the
"suggested" half — ranking students by demonstrated speaking ability — while the
approval itself is a teacher action recorded in ``MentorsStore``.

Scoring source: interview submissions are the only per-student store that
carries an email directly alongside a speaking score, so they are what this
module reads today.

Two other sources *can* be attributed, they simply are not wired up yet:
completed debates and GD sessions persist ``participants[].user_id`` (the
Firebase uid), which joins to ``firebase_uid`` in ``users_store``. Only
pronunciation attempts (``outputs/attempts.jsonl``) are genuinely anonymous —
those rows carry no user field at all and would need capture at write time.
Extending ``_speaking_signals`` is the intended place to add the joinable ones.
"""

from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel

from app.storage import submissions_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import mentors_store

logger = logging.getLogger("buddy.service")


# A mentor should have shown consistency, not one good day. Below this many
# scored submissions a student is not suggested at all.
MIN_SAMPLE_SIZE = 2

# Out of 100. Chosen to sit above "mostly clear" pronunciation feedback (70)
# without demanding near-perfect scores, which no student reaches in practice.
SUGGESTION_THRESHOLD = 65.0


class SpeakerRanking(BaseModel):
    """One student's demonstrated speaking ability, aggregated across attempts."""

    email: str
    name: Optional[str] = None
    speaking_score: float
    sample_size: int
    content_avg: Optional[float] = None
    pronunciation_avg: Optional[float] = None
    status: str = "none"  # none | suggested | approved | rejected
    active_mentees: int = 0


def _mean(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def _speaking_signals(email: str) -> tuple[list[float], list[float]]:
    """Return (content scores, pronunciation scores) for one student, 0-100 each.

    Only submissions that actually produced a score count. An unavailable
    content result or a pending pronunciation pass is skipped rather than
    counted as zero, which would punish a student for an outage.
    """
    content: list[float] = []
    pronunciation: list[float] = []

    for submission in submissions_store.list_for_student(email):
        result = submission.content_result
        if result is None:
            continue
        if result.available and result.total:
            content.append(float(result.total))
        snapshot = result.pronunciation
        if snapshot is not None and snapshot.available and snapshot.score is not None:
            pronunciation.append(float(snapshot.score))

    return content, pronunciation


def rank_speakers() -> list[SpeakerRanking]:
    """Rank every student who has scored speaking work, best first.

    The combined score weights content and pronunciation equally when both are
    present, and falls back to whichever exists otherwise — a student with no
    pronunciation pass yet is still rankable on content alone.
    """
    from app.storage import users_store

    rankings: list[SpeakerRanking] = []
    active_pairs = buddy_pairs_store.list_active()

    for user in users_store.list_all():
        if user.role != "student":
            continue

        content, pronunciation = _speaking_signals(user.email)
        sample_size = max(len(content), len(pronunciation))
        if sample_size == 0:
            continue

        content_avg = _mean(content)
        pronunciation_avg = _mean(pronunciation)
        parts = [v for v in (content_avg, pronunciation_avg) if v is not None]
        if not parts:
            continue

        mentor = mentors_store.get(user.email)
        rankings.append(
            SpeakerRanking(
                email=user.email,
                name=user.display_name,
                speaking_score=round(sum(parts) / len(parts), 2),
                sample_size=sample_size,
                content_avg=content_avg,
                pronunciation_avg=pronunciation_avg,
                status=mentor.status if mentor else "none",
                active_mentees=sum(
                    1
                    for p in active_pairs
                    if p.mentor_email.lower() == user.email.lower()
                ),
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
