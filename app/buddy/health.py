"""Whether a pairing is actually running, from a teacher's side of the desk.

Sessions gave the programme something countable; this is what makes the count
visible to the person who created the pairing. A teacher does not need another
score here — they need to know which of thirty pairings has quietly stopped,
which is a question about *activity*, not ability.

Nothing is stored. Everything is derived per request from the messages,
sessions, and cycle the pair already has, so a pairing's state can never drift
out of date with the rows behind it.

The rule is deliberately blunt and stated in one place (`_state`): a pairing is
judged on time since anything last happened, and on whether sessions are being
kept or missed. It says nothing about how well the mentee is doing — that is
`growth.build_report`'s job, and conflating the two would let a strong student
mask a pairing that has not met in a month.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from datetime import timezone
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.buddy.growth import SessionConsistency
from app.storage.buddy import BuddyCycle
from app.storage.buddy import BuddyMessage
from app.storage.buddy import BuddyPair
from app.storage.buddy import BuddySession
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store

# Chosen against how the programme is meant to run: pairings work in weekly-ish
# rhythms, so one silent week is worth a teacher's glance and two means the
# pairing has stopped on its own.
QUIET_AFTER_DAYS = 7
STALLED_AFTER_DAYS = 14

PairState = Literal["ended", "no_cycle", "not_started", "on_track", "quiet", "stalled"]


class PairHealth(BaseModel):
    """Whether one pairing is running — activity only, never ability.

    ``days_quiet`` counts from the last thing that happened, or from when the
    cycle opened if nothing ever has. It is None only when there is no cycle to
    measure inside, which is a different problem and says so via ``state``.
    """

    pair_id: str
    state: PairState = "no_cycle"
    has_cycle: bool = False
    cycle_ends_at: Optional[str] = None
    sessions: SessionConsistency = Field(default_factory=SessionConsistency)
    message_count: int = 0
    last_activity_at: Optional[str] = None
    days_quiet: Optional[int] = None


def _parse(iso: Optional[str]) -> Optional[datetime]:
    """Parse a stored ISO timestamp, treating a naive one as UTC.

    Rows written by older code may carry no offset. Assuming UTC matches how
    every store writes today (`datetime.now(timezone.utc)`), and is far better
    than letting one legacy row raise and blank the whole teacher view.
    """
    if not iso:
        return None
    try:
        parsed = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _state(
    is_active: bool,
    has_cycle: bool,
    days_quiet: Optional[int],
    ever_active: bool,
    sessions: SessionConsistency,
) -> PairState:
    """Reduce a pairing's activity to one word a teacher can scan a list by.

    Order matters: an ended pairing and then a missing cycle both outrank
    silence, because neither is failing — one is finished, and the other has no
    period to run in yet, which is the teacher's own next move rather than the
    students'.
    """
    if not is_active:
        # Deliberately quiet: a closed pairing going silent is the point of
        # closing it, and flagging it would bury the ones that still matter.
        return "ended"
    if not has_cycle:
        return "no_cycle"
    if days_quiet is None:
        return "on_track"
    # Two missed sessions is a pairing that is failing while still being
    # nominally in touch, which silence alone would never surface.
    if days_quiet >= STALLED_AFTER_DAYS or sessions.missed >= 2:
        return "stalled"
    if days_quiet >= QUIET_AFTER_DAYS:
        return "quiet"
    if not ever_active:
        # Nothing has happened yet, but the cycle is young enough that this is
        # a nudge rather than a failure. Checked last on purpose: a pairing
        # that never got going is the worst case once it has aged, not the
        # mildest, so silence from the start still ages into "stalled".
        return "not_started"
    return "on_track"


def build_index(pairs: Optional[list[BuddyPair]] = None) -> dict[str, PairHealth]:
    """Health for every pair, keyed by ``pair_id``.

    Built as one pass over each store rather than per pair: a teacher's list is
    the one place that asks about every pairing at once, and doing it the naive
    way re-reads all three files once per row.
    """
    if pairs is None:
        pairs = buddy_pairs_store.list_all()

    messages_by_pair: dict[str, list[BuddyMessage]] = defaultdict(list)
    for message in buddy_messages_store.list_all():
        messages_by_pair[message.pair_id].append(message)

    # Keyed by cycle, not pair: sessions belong to a period, and last cycle's
    # misses are not this one's to answer for.
    sessions_by_cycle: dict[str, list[BuddySession]] = defaultdict(list)
    for session in buddy_sessions_store.list_all():
        sessions_by_cycle[session.cycle_id].append(session)

    active_cycle_by_pair: dict[str, BuddyCycle] = {}
    for cycle in buddy_cycles_store.list_all():
        if cycle.status == "active":
            active_cycle_by_pair[cycle.pair_id] = cycle

    now = datetime.now(timezone.utc)
    index: dict[str, PairHealth] = {}

    for pair in pairs:
        cycle = active_cycle_by_pair.get(pair.pair_id)
        messages = messages_by_pair.get(pair.pair_id, [])
        sessions = sessions_by_cycle.get(cycle.cycle_id, []) if cycle else []

        consistency = SessionConsistency(
            planned=sum(1 for s in sessions if s.status == "planned"),
            completed=sum(1 for s in sessions if s.status == "completed"),
            missed=sum(1 for s in sessions if s.status == "missed"),
        )

        # A planned session is an intention, not an event — only things that
        # actually happened count as activity.
        stamps = [_parse(m.sent_at) for m in messages]
        stamps += [_parse(s.completed_at) for s in sessions if s.status == "completed"]
        happened = [s for s in stamps if s is not None]
        last_activity = max(happened) if happened else None

        # With nothing to point at, silence is measured from the cycle opening,
        # so a pairing that never started still ages into view. Outside a cycle
        # there is no window to measure in, and `state` says so instead.
        since = None
        if cycle is not None:
            since = last_activity or _parse(cycle.starts_at)
        days_quiet = max(0, (now - since).days) if since is not None else None

        index[pair.pair_id] = PairHealth(
            pair_id=pair.pair_id,
            state=_state(
                is_active=pair.status == "active",
                has_cycle=cycle is not None,
                days_quiet=days_quiet,
                ever_active=last_activity is not None,
                sessions=consistency,
            ),
            has_cycle=cycle is not None,
            cycle_ends_at=cycle.ends_at if cycle else None,
            sessions=consistency,
            message_count=len(messages),
            last_activity_at=last_activity.isoformat() if last_activity else None,
            days_quiet=days_quiet,
        )

    return index
