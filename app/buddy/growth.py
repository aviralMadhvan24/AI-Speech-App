"""Cycle-scoped measurement: what a mentee did, and whether it moved.

Everything here is derived on demand — nothing in this module is stored. A
report is always bounded by a cycle's window, which is what keeps a mentor's
view of their mentee narrower than a teacher's: work from before the cycle
opened, or after it closed, is never returned.

Attribution
-----------
Four sources feed a report, and they identify a student differently:

- interview submissions carry ``student_email`` directly;
- completed debates and GD sessions carry ``participants[].user_id``, the
  Firebase uid, which joins to ``firebase_uid`` in ``users_store``;
- pronunciation attempts (``outputs/attempts.jsonl``) carry ``student_email``
  on every row written since that field was added. Rows from before it have no
  owner and never can — they are unattributable by construction, and are
  skipped rather than handed to whoever asks.

Debates and GD sessions timestamp with a unix float while interviews use an ISO
string, so everything is normalised to ISO here before any window comparison.
"""

from __future__ import annotations

import logging
from datetime import datetime
from datetime import timezone
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.storage import submissions_store
from app.storage import users_store
from app.storage.buddy import BuddyCycle
from app.storage.buddy import CycleAxisResult
from app.storage.buddy import CycleBaseline
from app.storage.buddy import CycleSummary
from app.storage.buddy import buddy_sessions_store

logger = logging.getLogger("buddy.growth")


# A line through two points implies a trajectory the data cannot support, so
# the client is told when to show numbers instead of a chart.
MIN_TREND_POINTS = 3

# Points out of 100. Below this a cycle "held" rather than improved or
# declined — scores wobble by a point or two for reasons that have nothing to
# do with a mentor, and calling that progress would cheapen the times it is.
MEANINGFUL_DELTA = 2.0

ActivityKind = Literal["interview", "debate", "gd", "practice"]


class ActivityItem(BaseModel):
    """One piece of scored work a mentee did inside the cycle."""

    kind: ActivityKind
    at: str
    title: str
    score: Optional[float] = None


class GrowthAxis(BaseModel):
    """One measure, from where the cycle started to where it stands now."""

    key: str
    label: str
    baseline: Optional[float] = None
    latest: Optional[float] = None
    delta: Optional[float] = None
    sample_size: int = 0


class TrendPoint(BaseModel):
    """Scores on one date. Axes a date has no work for stay None, not zero."""

    at: str
    content: Optional[float] = None
    pronunciation: Optional[float] = None
    live_speaking: Optional[float] = None


class SessionConsistency(BaseModel):
    """Did the pairing actually happen, separately from how it scored.

    A flat score with every session kept is a different story from a flat score
    with none, so this is reported alongside the axes rather than folded in.
    """

    planned: int = 0
    completed: int = 0
    missed: int = 0

    @property
    def total(self) -> int:
        return self.planned + self.completed + self.missed


class CycleReport(BaseModel):
    """Everything the cycle panel renders, for one pair."""

    cycle: Optional[BuddyCycle] = None
    axes: list[GrowthAxis] = Field(default_factory=list)
    trend: list[TrendPoint] = Field(default_factory=list)
    activity: list[ActivityItem] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    sessions: SessionConsistency = Field(default_factory=SessionConsistency)
    # False when there is too little scored work to draw a line through.
    enough_for_trend: bool = False
    # The verdict on the pair's most recently closed cycle, so the people who
    # did the work find out how it went. Frozen at close; never recomputed.
    last_summary: Optional[CycleSummary] = None


def _iso(unix_ts: Optional[float]) -> Optional[str]:
    """Normalise a unix timestamp to ISO-8601 UTC, matching the other stores."""
    if not unix_ts:
        return None
    try:
        return datetime.fromtimestamp(float(unix_ts), tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _mean(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def _uid_for(email: str) -> Optional[str]:
    record = users_store.get_by_email(email)
    return record.firebase_uid if record else None


def _interview_events(email: str) -> list[tuple[str, str, Optional[float], Optional[float]]]:
    """(iso, title, content, pronunciation) for every scored interview."""
    out: list[tuple[str, str, Optional[float], Optional[float]]] = []
    for submission in submissions_store.list_for_student(email):
        result = submission.content_result
        if result is None or not result.available:
            continue
        content = float(result.total) if result.total else None
        snapshot = result.pronunciation
        pronunciation = (
            float(snapshot.score)
            if snapshot is not None and snapshot.available and snapshot.score is not None
            else None
        )
        if content is None and pronunciation is None:
            continue
        out.append((submission.submitted_at, "Interview", content, pronunciation))
    return out


def _debate_events(uid: str) -> list[tuple[str, str, float]]:
    """(iso, motion, score) for every completed debate this uid took part in."""
    from app.storage import debates as debates_store

    out: list[tuple[str, str, float]] = []
    for record in debates_store.list_debates_for_user(uid):
        at = _iso(record.completed_at)
        if at is None:
            continue
        participant_id = next(
            (
                p.get("participant_id")
                for p in record.participants
                if isinstance(p, dict) and p.get("user_id") == uid
            ),
            None,
        )
        if participant_id is None:
            continue
        score = next(
            (
                e.effective_score
                for e in record.effective_scores
                if e.participant_id == participant_id
            ),
            None,
        )
        if score is None:
            continue
        out.append((at, record.motion_title, float(score)))
    return out


def _gd_events(uid: str) -> list[tuple[str, str, float]]:
    """(iso, topic, score) for every completed GD session this uid was in."""
    from app.storage import gd_sessions as gd_sessions_store

    out: list[tuple[str, str, float]] = []
    for session in gd_sessions_store.list_sessions_for_user(uid):
        at = _iso(session.completed_at)
        if at is None:
            continue
        participant_id = next(
            (
                p.get("participant_id")
                for p in session.participants
                if isinstance(p, dict) and p.get("user_id") == uid
            ),
            None,
        )
        if participant_id is None:
            continue
        score = next(
            (s.total_score for s in session.scores if s.participant_id == participant_id),
            None,
        )
        if score is None:
            continue
        out.append((at, session.topic_title, float(score)))
    return out


def _attempt_events(email: str) -> list[tuple[str, str, float]]:
    """(iso, title, pronunciation) for every attributed pronunciation drill.

    Drills are the one thing a mentee can do alone, on demand, as many times as
    they like — leaving them out meant the work a mentor most often sets showed
    up nowhere in the cycle it was set for.
    """
    from app.attempts import storage as attempts_storage

    out: list[tuple[str, str, float]] = []
    try:
        attempts = attempts_storage.list_for_student(email)
    except Exception as exc:  # a malformed store must not blank the whole panel
        logger.warning("buddy_growth_attempts_failed err=%s", type(exc).__name__)
        return out

    for attempt in attempts:
        if not attempt.pronunciation_available or attempt.pronunciation_score is None:
            continue
        title = (attempt.expected_text or attempt.transcript or "").strip()
        out.append(
            (
                attempt.created_at,
                title[:80] or "Pronunciation drill",
                float(attempt.pronunciation_score),
            )
        )
    return out


def _live_events(email: str) -> list[tuple[str, str, float, ActivityKind]]:
    """Debates and GDs together — both are 'speaking with an audience'."""
    uid = _uid_for(email)
    if uid is None:
        return []

    events: list[tuple[str, str, float, ActivityKind]] = []
    try:
        events += [(at, title, score, "debate") for at, title, score in _debate_events(uid)]
    except Exception as exc:  # a malformed store must not blank the whole panel
        logger.warning("buddy_growth_debates_failed err=%s", type(exc).__name__)
    try:
        events += [(at, title, score, "gd") for at, title, score in _gd_events(uid)]
    except Exception as exc:
        logger.warning("buddy_growth_gd_failed err=%s", type(exc).__name__)
    return events


def baseline_for(email: str, before: str) -> CycleBaseline:
    """Average every scored result from before a cycle opened.

    This is the line a cycle's progress is read against, so it deliberately
    looks at the student's whole history up to that moment rather than a single
    most-recent attempt, which would make the baseline hostage to one bad day.
    """
    content = [c for at, _, c, _ in _interview_events(email) if at < before and c is not None]
    # Interviews and standalone drills both score pronunciation, so both set
    # the line the cycle is read against — otherwise a mentee who practises
    # only by drilling starts every cycle with no baseline at all.
    pronunciation = [
        p for at, _, _, p in _interview_events(email) if at < before and p is not None
    ] + [score for at, _, score in _attempt_events(email) if at < before]
    live = [score for at, _, score, _ in _live_events(email) if at < before]

    return CycleBaseline(
        content=_mean(content),
        pronunciation=_mean(pronunciation),
        live_speaking=_mean(live),
    )


def build_summary(cycle: BuddyCycle, mentee_email: str) -> CycleSummary:
    """Freeze what a cycle achieved, for storing at the moment it closes.

    Derived from the same report the pair saw all along, so the closing verdict
    can never contradict what was on screen the day before. Stored rather than
    recomputed for the same reason the baseline is: a finished period's result
    must not drift as unrelated later work is scored.
    """
    report = build_report(cycle, mentee_email)

    axes = [
        CycleAxisResult(
            key=axis.key,
            label=axis.label,
            baseline=axis.baseline,
            final=axis.latest,
            delta=axis.delta,
            sample_size=axis.sample_size,
        )
        for axis in report.axes
    ]

    # Only axes that actually moved between two known points can vote. An axis
    # with no baseline, or no work inside the window, says nothing either way.
    deltas = [a.delta for a in axes if a.delta is not None]
    if not deltas:
        verdict = "not_enough_evidence"
    else:
        average = sum(deltas) / len(deltas)
        if average >= MEANINGFUL_DELTA:
            verdict = "improved"
        elif average <= -MEANINGFUL_DELTA:
            verdict = "declined"
        else:
            verdict = "held"

    return CycleSummary(
        axes=axes,
        sessions_completed=report.sessions.completed,
        sessions_missed=report.sessions.missed,
        sessions_planned=report.sessions.planned,
        activity_count=len(report.activity),
        goal=cycle.goal,
        verdict=verdict,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def build_report(cycle: Optional[BuddyCycle], mentee_email: str) -> CycleReport:
    """Assemble the cycle panel for one mentee.

    With no open cycle there is no window, and therefore nothing a mentor is
    entitled to see — an empty report is the correct answer, not an error.
    """
    if cycle is None:
        return CycleReport()

    activity: list[ActivityItem] = []
    by_date: dict[str, TrendPoint] = {}

    def _slot(at: str) -> TrendPoint:
        day = at[:10]
        if day not in by_date:
            by_date[day] = TrendPoint(at=day)
        return by_date[day]

    content_scores: list[tuple[str, float]] = []
    pronunciation_scores: list[tuple[str, float]] = []
    live_scores: list[tuple[str, float]] = []

    for at, title, content, pronunciation in _interview_events(mentee_email):
        if not cycle.covers(at):
            continue
        activity.append(
            ActivityItem(kind="interview", at=at, title=title, score=content)
        )
        point = _slot(at)
        if content is not None:
            content_scores.append((at, content))
            point.content = content
        if pronunciation is not None:
            pronunciation_scores.append((at, pronunciation))
            point.pronunciation = pronunciation

    for at, title, score in _attempt_events(mentee_email):
        if not cycle.covers(at):
            continue
        activity.append(ActivityItem(kind="practice", at=at, title=title, score=score))
        pronunciation_scores.append((at, score))
        _slot(at).pronunciation = score

    for at, title, score, kind in _live_events(mentee_email):
        if not cycle.covers(at):
            continue
        activity.append(ActivityItem(kind=kind, at=at, title=title, score=score))
        live_scores.append((at, score))
        _slot(at).live_speaking = score

    def _latest(scored: list[tuple[str, float]]) -> Optional[float]:
        return max(scored, key=lambda pair: pair[0])[1] if scored else None

    def _axis(key: str, label: str, scored: list[tuple[str, float]], base: Optional[float]) -> GrowthAxis:
        latest = _latest(scored)
        return GrowthAxis(
            key=key,
            label=label,
            baseline=base,
            latest=latest,
            delta=(
                round(latest - base, 2)
                if latest is not None and base is not None
                else None
            ),
            sample_size=len(scored),
        )

    axes = [
        _axis("content", "Content", content_scores, cycle.baseline.content),
        _axis(
            "pronunciation",
            "Pronunciation",
            pronunciation_scores,
            cycle.baseline.pronunciation,
        ),
        _axis("live_speaking", "Live speaking", live_scores, cycle.baseline.live_speaking),
    ]

    activity.sort(key=lambda item: item.at, reverse=True)
    trend = sorted(by_date.values(), key=lambda point: point.at)

    sessions = buddy_sessions_store.list_for_cycle(cycle.cycle_id)

    return CycleReport(
        cycle=cycle,
        axes=axes,
        trend=trend,
        activity=activity,
        counts={
            "interview": sum(1 for a in activity if a.kind == "interview"),
            "debate": sum(1 for a in activity if a.kind == "debate"),
            "gd": sum(1 for a in activity if a.kind == "gd"),
            "practice": sum(1 for a in activity if a.kind == "practice"),
        },
        sessions=SessionConsistency(
            planned=sum(1 for s in sessions if s.status == "planned"),
            completed=sum(1 for s in sessions if s.status == "completed"),
            missed=sum(1 for s in sessions if s.status == "missed"),
        ),
        enough_for_trend=len(trend) >= MIN_TREND_POINTS,
    )
