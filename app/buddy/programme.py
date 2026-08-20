"""Whether the buddy programme, as a whole, is working.

Everything else in this package answers about one pair: is this pairing running,
did this mentee improve, is this student mentor material. Nobody could ask the
question a head of department actually asks before funding another semester —
did any of this help — because the answer only existed thirty rows at a time.

This aggregates it. Every number comes from a `CycleSummary` frozen at the
moment a teacher closed a cycle, so the rollup inherits that guarantee: a
finished period's contribution to the total cannot drift later as unrelated
work is scored. Nothing here is stored; it is derived per request from rows
that are themselves already frozen.

The honesty rule from `build_summary` carries through and is the reason this
module is shaped the way it is. A cycle where nothing was measured is NOT a
cycle where nothing happened, and folding the two together would let a
programme with poor measurement coverage report a flattering improvement rate.
So `improvement_rate` is computed over measured cycles only, and
`evidence_rate` is reported next to it saying how much of the programme that
actually was. A reader who sees "71% improved" is entitled to also see that it
was 71% of the third of cycles anyone could measure.
"""

from __future__ import annotations

import logging
from datetime import datetime
from datetime import timezone
from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.buddy import health
from app.storage.buddy import BuddyCycle
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store

logger = logging.getLogger("buddy.programme")

# The axes a cycle can be measured on, in the order a report reads best:
# what you said, how you said it, how you held up live.
AXES: tuple[tuple[str, str], ...] = (
    ("content", "Content"),
    ("pronunciation", "Pronunciation"),
    ("live_speaking", "Live speaking"),
)


class VerdictCounts(BaseModel):
    """How the closed cycles came out.

    `not_enough_evidence` is a first-class outcome here rather than a leftover.
    It is the programme's measurement coverage problem showing up in the one
    place someone might act on it.
    """

    improved: int = 0
    held: int = 0
    declined: int = 0
    not_enough_evidence: int = 0


class AxisMovement(BaseModel):
    """One axis, averaged across every closed cycle that could measure it.

    `cycles_measured` is the denominator and is always shown. An axis measured
    in three cycles out of forty says almost nothing, and the number is what
    lets a reader see that rather than trusting the mean.
    """

    key: str
    label: str
    cycles_measured: int = 0
    mean_baseline: Optional[float] = None
    mean_final: Optional[float] = None
    mean_delta: Optional[float] = None


class ProgrammeReport(BaseModel):
    """The buddy programme in one object, for a teacher or a department head."""

    generated_at: str

    # Reach — how much programme there is to judge.
    pairs_total: int = 0
    pairs_active: int = 0
    pairs_ended: int = 0
    mentors_approved: int = 0
    mentees_served: int = 0

    # Whether the pairings that exist are actually running. Keyed by the same
    # states `health.PairState` defines, counted across active pairs.
    health: dict[str, int] = Field(default_factory=dict)

    # Outcomes, from frozen summaries only.
    cycles_active: int = 0
    cycles_closed: int = 0
    verdicts: VerdictCounts = Field(default_factory=VerdictCounts)
    # Closed cycles where at least one axis moved between two known points.
    cycles_measured: int = 0
    # improved / cycles_measured. None when nothing was measurable, because a
    # rate over an empty denominator is not zero — it is unknown.
    improvement_rate: Optional[float] = None
    # cycles_measured / cycles_closed. The caveat that belongs next to the
    # rate above, and the reason both are sent.
    evidence_rate: Optional[float] = None
    axes: list[AxisMovement] = Field(default_factory=list)

    # Practice actually kept, across every cycle.
    sessions_planned: int = 0
    sessions_completed: int = 0
    sessions_missed: int = 0
    # completed / (completed + missed). None while nothing has come due.
    keep_rate: Optional[float] = None


def _rate(part: int, whole: int) -> Optional[float]:
    """A share of a whole, or None when the whole is empty.

    Deliberately not `0.0`: "none of nothing" is not a zero percent success
    rate, and returning one would put a red number in front of a teacher whose
    programme has simply not finished a cycle yet.
    """
    return round(part / whole, 4) if whole else None


def _axis_movements(summaries: list) -> list[AxisMovement]:
    """Mean baseline, final and delta per axis across the given summaries.

    Only axes with a delta contribute. An axis that was never sampled in a
    cycle is absent from that cycle's average rather than counted as no
    movement, which would drag every mean toward zero in proportion to how
    little the programme measured.
    """
    movements: list[AxisMovement] = []

    for key, label in AXES:
        deltas: list[float] = []
        baselines: list[float] = []
        finals: list[float] = []

        for summary in summaries:
            axis = next((a for a in summary.axes if a.key == key), None)
            if axis is None or axis.delta is None:
                continue
            deltas.append(float(axis.delta))
            if axis.baseline is not None:
                baselines.append(float(axis.baseline))
            if axis.final is not None:
                finals.append(float(axis.final))

        movements.append(
            AxisMovement(
                key=key,
                label=label,
                cycles_measured=len(deltas),
                mean_baseline=round(sum(baselines) / len(baselines), 2) if baselines else None,
                mean_final=round(sum(finals) / len(finals), 2) if finals else None,
                mean_delta=round(sum(deltas) / len(deltas), 2) if deltas else None,
            )
        )

    return movements


def build_report() -> ProgrammeReport:
    """Aggregate the whole programme. Derived per request, stored nowhere."""
    now = datetime.now(timezone.utc).isoformat()

    pairs = buddy_pairs_store.list_all()
    active_pairs = [p for p in pairs if p.status == "active"]

    # Health is derived per request and already handles its own edge cases;
    # counting it here rather than re-deriving keeps one definition of "quiet".
    states: dict[str, int] = {}
    try:
        index = health.build_index(active_pairs)
        for entry in index.values():
            states[entry.state] = states.get(entry.state, 0) + 1
    except Exception as exc:  # one broken pairing must not blank the rollup
        logger.warning("buddy_programme_health_failed err=%s", type(exc).__name__)

    cycles: list[BuddyCycle] = buddy_cycles_store.list_all()
    closed = [c for c in cycles if c.status == "closed" and c.summary is not None]

    verdicts = VerdictCounts()
    for cycle in closed:
        verdict = cycle.summary.verdict
        if hasattr(verdicts, verdict):
            setattr(verdicts, verdict, getattr(verdicts, verdict) + 1)

    summaries = [c.summary for c in closed]
    measured = [s for s in summaries if any(a.delta is not None for a in s.axes)]

    # Sessions are counted from the sessions store rather than summed out of
    # the summaries, so cycles still running are included. A programme's
    # practice habit is a live number, not something that waits for a close.
    sessions = buddy_sessions_store.list_all()
    completed = sum(1 for s in sessions if s.status == "completed")
    missed = sum(1 for s in sessions if s.status == "missed")
    planned = sum(1 for s in sessions if s.status == "planned")

    return ProgrammeReport(
        generated_at=now,
        pairs_total=len(pairs),
        pairs_active=len(active_pairs),
        pairs_ended=len(pairs) - len(active_pairs),
        mentors_approved=sum(1 for m in mentors_store.list_all() if m.status == "approved"),
        mentees_served=len({p.mentee_email.lower() for p in pairs}),
        health=states,
        cycles_active=sum(1 for c in cycles if c.status == "active"),
        cycles_closed=len(closed),
        verdicts=verdicts,
        cycles_measured=len(measured),
        improvement_rate=_rate(verdicts.improved, len(measured)),
        evidence_rate=_rate(len(measured), len(closed)),
        axes=_axis_movements(measured),
        sessions_planned=planned,
        sessions_completed=completed,
        sessions_missed=missed,
        keep_rate=_rate(completed, completed + missed),
    )
