"""Nudges for the people who are not going to open the app.

`health` detects a pairing going quiet and the inbox shows a nudge — but only
to whoever opens the buddy tab. The pairings that need chasing are exactly the
ones nobody is opening, so the nudge that matters is the one nobody sees. That
irony is load-bearing: an async mentorship programme dies of silence, and the
silence is what suppresses the warning about it.

This turns the same derived states into an outbound worklist: who needs
chasing, why, and how urgently. Nothing here sends anything — there is no mail
transport in this codebase and no scheduler — but the worklist is addressed,
and `for_recipient` hands one person their own share of it. That is what
`GET /buddy/my-nudges` serves, so the student on a stalled pairing is told so
by the app rather than only their teacher being told about them. A delivery
job can serialise the same value later without any of this logic moving.

Three judgements are worth stating because they are not obvious:

- A nudge goes to whoever can actually act on it. `no_cycle` means the pairing
  has no open period, which only a teacher can fix — telling the student to
  "ask your teacher" routes the work to the person without the power, and is
  the kind of nudge people learn to ignore.

- On a quiet pairing both sides are listed, but the mentor's message is the
  firmer one. The mentor holds the job; a mentee waiting to be contacted is
  behaving exactly as the programme told them to.

- An `overdue` cycle silences the nudges about silence. A pairing whose period
  ended a fortnight ago does not need chasing towards a deadline that has
  already passed; it needs closing, which writes the verdict the whole cycle
  existed to produce. So that state routes one nudge to the teacher and none
  to the pair.
"""

from __future__ import annotations

import logging
from datetime import datetime
from datetime import timezone
from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.buddy import health
from app.buddy import identity
from app.buddy.identity import Person
from app.storage.buddy import buddy_concerns_store
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store

logger = logging.getLogger("buddy.digest")

# Lower sorts first. A stalled pairing has already failed and is the only item
# here that is genuinely urgent; a pairing with no cycle is administrative.
PRIORITY = {
    "stalled": 0,
    "not_started": 1,
    "quiet": 2,
    "overdue": 3,
    "no_cycle": 4,
}

# What to say, per state and per side. The mentor's copy asks for an action;
# the mentee's invites one. See the module docstring for why they differ.
MENTOR_MESSAGE = {
    "stalled": "This pairing has had nothing for two weeks. Send a voice note today or tell your teacher it is not working.",
    "not_started": "You have not spoken to your mentee yet. A 30-second hello is what starts a pairing.",
    "quiet": "It has been a quiet week with your mentee. Plan a session rather than waiting to be messaged.",
}

MENTEE_MESSAGE = {
    "stalled": "Your pairing has stalled. Message your mentor, or tell your teacher if it is not working.",
    "not_started": "Your mentor is expecting you. Send a first voice note.",
    "quiet": "It has been a quiet week. Send your mentor something to react to.",
}

TEACHER_MESSAGE = {
    "no_cycle": "This pairing has no open cycle, so nothing it does can be measured. Open one or end the pairing.",
    "overdue": "This cycle has run past its end date. Close it to record what it achieved, then renew or end the pairing.",
}


class Nudge(BaseModel):
    """One person who should hear something about one pairing."""

    user_id: str
    # Resolved for display, so a teacher reading the digest sees a name rather
    # than an opaque id. Derived per call — nothing here is stored.
    person: Person
    role: str  # mentor | mentee | teacher
    pair_id: str
    partner: Optional[Person] = None
    state: str
    days_quiet: Optional[int] = None
    # Days past the cycle's end date, on an `overdue` nudge only.
    days_overdue: Optional[int] = None
    message: str
    priority: int = 9
    # Carried so a reader can tell a pairing that never started from one that
    # has done real work and then stopped. They need different conversations.
    sessions_kept: int = 0
    next_session_at: Optional[str] = None


class DigestCounts(BaseModel):
    stalled: int = 0
    not_started: int = 0
    quiet: int = 0
    overdue: int = 0
    no_cycle: int = 0


class BuddyDigest(BaseModel):
    """Everyone who needs chasing, most urgent first."""

    generated_at: str
    nudges: list[Nudge] = Field(default_factory=list)
    total: int = 0
    counts: DigestCounts = Field(default_factory=DigestCounts)
    # Raised hands are a separate queue, but a teacher reading the digest
    # should know it is not empty — chasing a pairing somebody already
    # reported as broken is the wrong action.
    open_concerns: int = 0


def _nudges_for_pair(pair, entry, sessions, people: dict[str, Person]) -> list[Nudge]:
    """The people to tell about one pairing, or nothing if it is fine.

    ``people`` is the resolved identity map for the whole cohort, passed in
    rather than looked up per nudge — see `build_digest`.
    """
    state = entry.state
    if state not in PRIORITY:
        return []

    kept = sum(1 for s in sessions if s.status == "completed")
    upcoming = [s for s in sessions if s.status == "planned"]
    next_at = upcoming[0].scheduled_at if upcoming else None

    def who(user_id: str) -> Person:
        return people.get(user_id) or Person(user_id=user_id)

    common = {
        "pair_id": pair.pair_id,
        "state": state,
        "days_quiet": entry.days_quiet,
        "days_overdue": entry.days_overdue,
        "priority": PRIORITY[state],
        "sessions_kept": kept,
        "next_session_at": next_at,
    }

    if state in TEACHER_MESSAGE:
        # Only a teacher can open or close a cycle, so only a teacher is told.
        # Routing this to the students would send them after work they have no
        # power to do, which is how people learn to ignore nudges.
        return [
            Nudge(
                user_id=pair.created_by_id,
                person=who(pair.created_by_id),
                role="teacher",
                partner=None,
                message=TEACHER_MESSAGE[state],
                **common,
            )
        ]

    return [
        Nudge(
            user_id=pair.mentor_id,
            person=who(pair.mentor_id),
            role="mentor",
            partner=who(pair.mentee_id),
            message=MENTOR_MESSAGE[state],
            **common,
        ),
        Nudge(
            user_id=pair.mentee_id,
            person=who(pair.mentee_id),
            role="mentee",
            partner=who(pair.mentor_id),
            message=MENTEE_MESSAGE[state],
            **common,
        ),
    ]


def build_digest() -> BuddyDigest:
    """Every outstanding nudge across the cohort. Derived per call, stored nowhere."""
    now = datetime.now(timezone.utc).isoformat()

    active = [p for p in buddy_pairs_store.list_all() if p.status == "active"]

    try:
        index = health.build_index(active)
    except Exception as exc:  # one bad pairing must not suppress every nudge
        logger.warning("buddy_digest_health_failed err=%s", type(exc).__name__)
        return BuddyDigest(generated_at=now)

    # Sessions in one pass. Per pair this would re-read the whole store once
    # per pairing, which is the same mistake `_mentoring_records` avoids.
    by_cycle: dict[str, list] = {}
    for session in buddy_sessions_store.list_all():
        by_cycle.setdefault(session.cycle_id, []).append(session)

    # One identity pass for every participant and every pairing teacher on
    # screen. Resolving per nudge would re-read the users log twice per pair.
    people = identity.resolve_many(
        [p.mentor_id for p in active]
        + [p.mentee_id for p in active]
        + [p.created_by_id for p in active]
    )

    nudges: list[Nudge] = []
    counts = DigestCounts()

    for pair in active:
        entry = index.get(pair.pair_id)
        if entry is None:
            continue

        cycle = buddy_cycles_store.active_for_pair(pair.pair_id)
        sessions = by_cycle.get(cycle.cycle_id, []) if cycle else []

        produced = _nudges_for_pair(pair, entry, sessions, people)
        if produced and hasattr(counts, entry.state):
            setattr(counts, entry.state, getattr(counts, entry.state) + 1)
        nudges.extend(produced)

    # Most urgent first, then the longest-silent within a state — that is the
    # order someone would work down the list in.
    nudges.sort(key=lambda n: (n.priority, -(n.days_quiet or 0), n.person.label))

    return BuddyDigest(
        generated_at=now,
        nudges=nudges,
        total=len(nudges),
        counts=counts,
        open_concerns=len(buddy_concerns_store.list_open()),
    )


def for_recipient(user_id: str) -> list[Nudge]:
    """One person's own nudges — what `GET /buddy/my-nudges` returns.

    The programme detects a stalled pairing and used to tell only the teacher
    about it, which left the two people who could actually restart it as the
    last to know. Delivery still has no transport, but a nudge the app shows
    the person it is about is delivery enough to close that loop.

    Whatever sends mail later should call this rather than re-deciding who is
    quiet, so that adding a transport stays a delivery change.
    """
    if not user_id:
        return []
    return [n for n in build_digest().nudges if n.user_id == user_id]
