"""Buddy mentorship storage — mentor approvals, pairs, and 1:1 messages.

Every row identifies a person by ``user_id`` — the platform's own user id
(``User.uid``), never by email. See ``app.buddy.identity`` for why, and for the
resolution of an id back into a name and address for display. Nothing here
stores a name or an address: a denormalised copy is a copy that goes stale.

JSONL files, following the same store protocol as the rest of this package
(see the package docstring for the migration note):

- ``outputs/buddy_mentors.jsonl``  — one row per student considered as a mentor
- ``outputs/buddy_pairs.jsonl``    — one row per mentor/mentee pairing
- ``outputs/buddy_messages.jsonl`` — one row per chat message or voice note
- ``outputs/buddy_concerns.jsonl`` — one row per raised concern (teacher-only)
- ``outputs/buddy_requests.jsonl`` — one row per student asking for a mentor

Messages are append-only on the hot path; only ``mark_read`` rewrites, and it
touches a single pair's rows. Fine at classroom scale, revisit with a real DB.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from datetime import timezone
from pathlib import Path
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from ._jsonl import append_jsonl
from ._jsonl import overwrite_jsonl
from ._jsonl import read_jsonl


MentorStatus = Literal["suggested", "approved", "rejected"]
PairStatus = Literal["active", "ended"]
MessageKind = Literal["text", "voice"]
CycleStatus = Literal["active", "closed"]
SessionStatus = Literal["planned", "completed", "missed"]
# Async is the default on purpose: an exchange of voice notes across two days
# is a real session here, not a failed live call.
SessionMode = Literal["async_voice", "live_call", "in_person"]
# Which of the platform's own catalogs a session's practice material came from.
PromptKind = Literal["pronunciation", "debate", "gd"]
# Which live feature hosts a session. Only debate today, and deliberately so:
# a debate room is exactly two people, which is exactly a buddy pair. A GD room
# needs five to start, so a pair cannot hold one and the session stays
# self-reported rather than being offered a room it can never fill.
RoomKind = Literal["debate"]
# Where a mentee stands in the queue for a mentor. `paired` is terminal and
# carries the pair it produced, so the request log doubles as the record of
# how long students actually wait.
RequestStatus = Literal["open", "paired", "declined"]
# Why a pairing was flagged. A closed list rather than free text so a
# teacher can triage thirty of them without reading thirty paragraphs.
ConcernReason = Literal["mismatch", "unresponsive", "schedule", "uncomfortable", "other"]
ConcernStatus = Literal["open", "resolved"]
# What a mentee can say about a session beyond a number. Closed vocabulary,
# both praise and criticism, because a bare 2/5 tells a mentor to feel bad
# and nothing about what to do differently next week.
RatingAspect = Literal[
    "prepared", "specific", "encouraging", "punctual",
    "unprepared", "vague", "harsh", "no_show",
]


class MentorRecord(BaseModel):
    """A student put forward as a speaking mentor.

    ``speaking_score`` and ``sample_size`` are a snapshot taken when the row was
    written, so the admin list stays stable between refreshes and a teacher can
    see what they approved on. The live score is recomputed on demand by
    ``app.buddy.service.rank_speakers``.
    """

    user_id: str
    status: MentorStatus = "suggested"
    speaking_score: float = 0.0
    sample_size: int = 0
    decided_by_id: Optional[str] = None
    decided_at: Optional[str] = None
    created_at: str


class BuddyPair(BaseModel):
    """One mentor/mentee relationship, created by a teacher."""

    pair_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    mentor_id: str
    mentee_id: str
    created_by_id: str
    created_at: str
    status: PairStatus = "active"
    ended_at: Optional[str] = None

    def involves(self, user_id: str) -> bool:
        return user_id in (self.mentor_id, self.mentee_id)

    def partner_of(self, user_id: str) -> Optional[str]:
        """The other participant's id, or None if `user_id` is not a member."""
        if user_id == self.mentor_id:
            return self.mentee_id
        if user_id == self.mentee_id:
            return self.mentor_id
        return None


class BuddyMessage(BaseModel):
    """A single chat message. Voice notes carry an audio asset id instead of text."""

    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pair_id: str
    sender_id: str
    kind: MessageKind = "text"
    body: str = ""
    audio_id: Optional[str] = None
    audio_path: Optional[str] = None
    duration_seconds: Optional[float] = None
    sent_at: str
    read_at: Optional[str] = None


class CycleBaseline(BaseModel):
    """The mentee's standing when a cycle opened, in points out of 100.

    Captured once at creation rather than recomputed, so the delta a student is
    shown never silently shifts under them as older work is rescored. A ``None``
    axis means there was nothing to measure yet — not a zero.
    """

    content: Optional[float] = None
    pronunciation: Optional[float] = None
    live_speaking: Optional[float] = None


class CycleAxisResult(BaseModel):
    """One axis, from where the cycle opened to where it ended."""

    key: str
    label: str
    baseline: Optional[float] = None
    final: Optional[float] = None
    delta: Optional[float] = None
    sample_size: int = 0


class CycleSummary(BaseModel):
    """What a cycle actually achieved, frozen at the moment it closed.

    Computed once and stored rather than derived on read, for the same reason
    the baseline is: the answer a student is given about a finished period must
    not drift later as unrelated work is scored. This is the payoff the whole
    cycle model exists for — without it, closing a cycle only flips a status
    and nobody ever learns whether it worked.
    """

    axes: list[CycleAxisResult] = Field(default_factory=list)
    sessions_completed: int = 0
    sessions_missed: int = 0
    sessions_planned: int = 0
    activity_count: int = 0
    goal: str = ""
    # improved | held | declined | not_enough_evidence — deliberately blunt,
    # and never dressed up: with nothing measured, say so rather than imply
    # a flat line was a result.
    verdict: str = "not_enough_evidence"
    generated_at: str


class BuddyCycle(BaseModel):
    """One time-boxed mentorship period inside a pair.

    A pair can run several cycles in sequence, which is what lets a teacher
    renew a pairing without flattening the history of the previous period.
    Only one may be active at a time — ``BuddyCyclesStore.create`` enforces it.
    """

    cycle_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pair_id: str
    mentee_id: str
    goal: str = ""
    focus_area: Optional[str] = None
    starts_at: str
    ends_at: str
    baseline: CycleBaseline = Field(default_factory=CycleBaseline)
    status: CycleStatus = "active"
    created_by_id: str
    created_at: str
    closed_at: Optional[str] = None
    # Written once, when the cycle closes. See `CycleSummary`.
    summary: Optional[CycleSummary] = None

    def covers(self, when: str) -> bool:
        """Whether an ISO timestamp falls inside this cycle's window.

        The window is what scopes a mentor's view of their mentee: work from
        before the cycle opened, or after it closed, is not theirs to see.
        """
        return self.starts_at <= when <= self.ends_at


class BuddySession(BaseModel):
    """One planned unit of practice inside a cycle.

    Without this, twenty messages might be one good coaching conversation or
    twenty days of "hi" — there is nothing to count, schedule, or miss. Notes
    are kept per side: the mentor writes what they observed, the mentee writes
    what they took away, and neither overwrites the other.
    """

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pair_id: str
    cycle_id: str
    topic: str = ""
    mode: SessionMode = "async_voice"
    scheduled_at: str
    status: SessionStatus = "planned"
    completed_at: Optional[str] = None
    duration_minutes: Optional[int] = None
    mentor_notes: str = ""
    mentee_reflection: str = ""
    # What the pair will actually work on, drawn from the platform's own
    # catalogs. Without it `topic` is a free-text string and "practice" means
    # whatever the pair decides on the day — which is nothing to measure.
    prompt_kind: Optional[PromptKind] = None
    prompt_id: Optional[str] = None
    prompt_title: Optional[str] = None
    # The real room this session was held in, once someone opened one. A
    # `live_call` used to be a mode with no call behind it: the pair arranged
    # something off-platform and came back to tick a box, so the only record
    # of the practice was their own word for it. With a room code here the
    # session is held in the platform's own debate room, and the scoring that
    # room already does lands in the debate store — which is where
    # `growth._live_events` reads from, so the work counts towards the cycle
    # without anyone reporting it.
    room_kind: Optional[RoomKind] = None
    room_code: Optional[str] = None
    room_opened_at: Optional[str] = None
    # The mentee's rating of this session, 1-5. The only signal the platform
    # has about whether a mentor is any good AT MENTORING, as opposed to being
    # a strong speaker — which is what got them selected.
    mentee_rating: Optional[int] = None
    # Why. Visible to the mentor along with the number — this is feedback
    # to them, not a report about them. The private channel for "this
    # pairing is wrong" is `BuddyConcern`, which the mentor never sees.
    mentee_rating_aspects: list[str] = Field(default_factory=list)
    mentee_rating_note: str = ""
    created_by_id: str
    created_at: str


_MENTORS_PATH = Path("outputs/buddy_mentors.jsonl")
_PAIRS_PATH = Path("outputs/buddy_pairs.jsonl")
_MESSAGES_PATH = Path("outputs/buddy_messages.jsonl")
_CYCLES_PATH = Path("outputs/buddy_cycles.jsonl")
_SESSIONS_PATH = Path("outputs/buddy_sessions.jsonl")
_CONCERNS_PATH = Path("outputs/buddy_concerns.jsonl")
_REQUESTS_PATH = Path("outputs/buddy_requests.jsonl")
_MAIL_PREFS_PATH = Path("outputs/buddy_mail_prefs.jsonl")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(path: Path, model: type[BaseModel]) -> list:
    """Parse every row, skipping any that no longer match the model."""
    out = []
    for row in read_jsonl(path):
        try:
            out.append(model(**row))
        except Exception:
            continue
    return out


class MentorsStore:
    path: Path

    def __init__(self, path: Path = _MENTORS_PATH):
        self.path = path

    # --- Read ---

    def list_all(self) -> list[MentorRecord]:
        return _load(self.path, MentorRecord)

    def list_by_status(self, status: MentorStatus) -> list[MentorRecord]:
        return [m for m in self.list_all() if m.status == status]

    def get(self, user_id: str) -> Optional[MentorRecord]:
        for mentor in self.list_all():
            if mentor.user_id == user_id:
                return mentor
        return None

    def is_approved(self, user_id: str) -> bool:
        record = self.get(user_id)
        return record is not None and record.status == "approved"

    # --- Write ---

    def set_status(
        self,
        user_id: str,
        status: MentorStatus,
        decided_by_id: str,
        speaking_score: float = 0.0,
        sample_size: int = 0,
    ) -> MentorRecord:
        """Approve or reject a mentor, creating the row if it is new."""
        mentors = self.list_all()
        now = _now()

        for index, mentor in enumerate(mentors):
            if mentor.user_id == user_id:
                updated = mentor.model_copy(
                    update={
                        "status": status,
                        "decided_by_id": decided_by_id,
                        "decided_at": now,
                        "speaking_score": speaking_score or mentor.speaking_score,
                        "sample_size": sample_size or mentor.sample_size,
                    }
                )
                mentors[index] = updated
                overwrite_jsonl(self.path, [m.model_dump() for m in mentors])
                return updated

        record = MentorRecord(
            user_id=user_id,
            status=status,
            speaking_score=speaking_score,
            sample_size=sample_size,
            decided_by_id=decided_by_id,
            decided_at=now,
            created_at=now,
        )
        append_jsonl(self.path, record.model_dump())
        return record


class BuddyPairsStore:
    path: Path

    def __init__(self, path: Path = _PAIRS_PATH):
        self.path = path

    # --- Read ---

    def list_all(self) -> list[BuddyPair]:
        return _load(self.path, BuddyPair)

    def list_active(self) -> list[BuddyPair]:
        return [p for p in self.list_all() if p.status == "active"]

    def list_for_user(self, user_id: str) -> list[BuddyPair]:
        return [p for p in self.list_all() if p.involves(user_id)]

    def get(self, pair_id: str) -> Optional[BuddyPair]:
        for pair in self.list_all():
            if pair.pair_id == pair_id:
                return pair
        return None

    def find_active_between(self, mentor_id: str, mentee_id: str) -> Optional[BuddyPair]:
        for pair in self.list_active():
            if pair.mentor_id == mentor_id and pair.mentee_id == mentee_id:
                return pair
        return None

    def active_for_mentee(self, mentee_id: str) -> Optional[BuddyPair]:
        """The mentee's current pairing, whoever mentors it.

        A student has at most one mentor at a time — two people coaching the
        same person to different plans is worse than one — and this is what
        the pairing picker checks before offering someone as unpaired.
        """
        for pair in self.list_active():
            if pair.mentee_id == mentee_id:
                return pair
        return None

    # --- Write ---

    def create(
        self,
        mentor_id: str,
        mentee_id: str,
        created_by_id: str,
    ) -> BuddyPair:
        record = BuddyPair(
            mentor_id=mentor_id,
            mentee_id=mentee_id,
            created_by_id=created_by_id,
            created_at=_now(),
            status="active",
        )
        append_jsonl(self.path, record.model_dump())
        return record

    def end(self, pair_id: str) -> Optional[BuddyPair]:
        pairs = self.list_all()
        ended: Optional[BuddyPair] = None
        for index, pair in enumerate(pairs):
            if pair.pair_id == pair_id:
                ended = pair.model_copy(
                    update={"status": "ended", "ended_at": _now()}
                )
                pairs[index] = ended
                break
        if ended is not None:
            overwrite_jsonl(self.path, [p.model_dump() for p in pairs])
        return ended


class BuddyMessagesStore:
    path: Path

    def __init__(self, path: Path = _MESSAGES_PATH):
        self.path = path

    # --- Read ---

    def list_all(self) -> list[BuddyMessage]:
        return _load(self.path, BuddyMessage)

    def list_for_pair(self, pair_id: str) -> list[BuddyMessage]:
        messages = [m for m in self.list_all() if m.pair_id == pair_id]
        messages.sort(key=lambda m: m.sent_at)
        return messages

    def get(self, message_id: str) -> Optional[BuddyMessage]:
        for message in self.list_all():
            if message.message_id == message_id:
                return message
        return None

    def unread_count(self, pair_id: str, for_user_id: str) -> int:
        """Messages in this pair the given user has not read yet."""
        return sum(
            1
            for m in self.list_for_pair(pair_id)
            if m.sender_id != for_user_id and m.read_at is None
        )

    def unread_total(self, user_id: str, pair_ids: set[str]) -> int:
        """Unread messages across all of this user's pairs, in ONE pass.

        The main menu asks this on every render, for a user who may be in
        several pairings; counting per pair would re-read the whole message
        log once per pairing to answer a single badge.
        """
        if not pair_ids:
            return 0
        return sum(
            1
            for m in self.list_all()
            if m.pair_id in pair_ids and m.sender_id != user_id and m.read_at is None
        )

    # --- Write ---

    def create(
        self,
        pair_id: str,
        sender_id: str,
        kind: MessageKind = "text",
        body: str = "",
        audio_id: Optional[str] = None,
        audio_path: Optional[str] = None,
        duration_seconds: Optional[float] = None,
    ) -> BuddyMessage:
        record = BuddyMessage(
            pair_id=pair_id,
            sender_id=sender_id,
            kind=kind,
            body=body,
            audio_id=audio_id,
            audio_path=audio_path,
            duration_seconds=duration_seconds,
            sent_at=_now(),
        )
        append_jsonl(self.path, record.model_dump())
        return record

    def mark_read(self, pair_id: str, reader_id: str) -> int:
        """Mark every message the reader did NOT send as read. Returns the count."""
        rows = self.list_all()
        now = _now()
        changed = 0
        out: list[dict] = []
        for message in rows:
            if (
                message.pair_id == pair_id
                and message.sender_id != reader_id
                and message.read_at is None
            ):
                message = message.model_copy(update={"read_at": now})
                changed += 1
            out.append(message.model_dump())
        if changed:
            overwrite_jsonl(self.path, out)
        return changed


class BuddyCyclesStore:
    path: Path

    def __init__(self, path: Path = _CYCLES_PATH):
        self.path = path

    # --- Read ---

    def list_all(self) -> list[BuddyCycle]:
        return _load(self.path, BuddyCycle)

    def list_for_pair(self, pair_id: str) -> list[BuddyCycle]:
        cycles = [c for c in self.list_all() if c.pair_id == pair_id]
        cycles.sort(key=lambda c: c.starts_at, reverse=True)
        return cycles

    def get(self, cycle_id: str) -> Optional[BuddyCycle]:
        for cycle in self.list_all():
            if cycle.cycle_id == cycle_id:
                return cycle
        return None

    def active_for_pair(self, pair_id: str) -> Optional[BuddyCycle]:
        """The pair's open cycle, or None if it is between cycles."""
        for cycle in self.list_for_pair(pair_id):
            if cycle.status == "active":
                return cycle
        return None

    def list_active(self) -> list[BuddyCycle]:
        return [c for c in self.list_all() if c.status == "active"]

    def list_expired(self, now: Optional[str] = None) -> list[BuddyCycle]:
        """Cycles still open past their own end date, oldest first.

        Nothing used to read `ends_at` at all: it was written when the cycle
        opened and then only ever displayed. So a cycle ran past its end
        forever, the frozen summary that closing writes was never written, and
        the `improved` verdict that feeds the growth path back into mentor
        selection never fired. A cycle that cannot end cannot conclude
        anything, which makes the whole period unmeasurable.
        """
        cutoff = now or _now()
        expired = [c for c in self.list_active() if c.ends_at <= cutoff]
        expired.sort(key=lambda c: c.ends_at)
        return expired

    # --- Write ---

    def create(
        self,
        pair_id: str,
        mentee_id: str,
        starts_at: str,
        ends_at: str,
        created_by_id: str,
        goal: str = "",
        focus_area: Optional[str] = None,
        baseline: Optional[CycleBaseline] = None,
    ) -> BuddyCycle:
        """Open a cycle. Raises ValueError if one is already open on this pair."""
        if self.active_for_pair(pair_id) is not None:
            raise ValueError("cycle_already_active")

        record = BuddyCycle(
            pair_id=pair_id,
            mentee_id=mentee_id,
            goal=goal,
            focus_area=focus_area,
            starts_at=starts_at,
            ends_at=ends_at,
            baseline=baseline or CycleBaseline(),
            created_by_id=created_by_id,
            created_at=_now(),
        )
        append_jsonl(self.path, record.model_dump())
        return record

    def close(
        self, cycle_id: str, summary: Optional[CycleSummary] = None
    ) -> Optional[BuddyCycle]:
        """Close a cycle, freezing its outcome alongside its baseline."""
        cycles = self.list_all()
        closed: Optional[BuddyCycle] = None
        for index, cycle in enumerate(cycles):
            if cycle.cycle_id == cycle_id:
                closed = cycle.model_copy(
                    update={
                        "status": "closed",
                        "closed_at": _now(),
                        "summary": summary or cycle.summary,
                    }
                )
                cycles[index] = closed
                break
        if closed is not None:
            overwrite_jsonl(self.path, [c.model_dump() for c in cycles])
        return closed


class BuddySessionsStore:
    path: Path

    def __init__(self, path: Path = _SESSIONS_PATH):
        self.path = path

    # --- Read ---

    def list_all(self) -> list[BuddySession]:
        return _load(self.path, BuddySession)

    def list_for_cycle(self, cycle_id: str) -> list[BuddySession]:
        sessions = [s for s in self.list_all() if s.cycle_id == cycle_id]
        sessions.sort(key=lambda s: s.scheduled_at)
        return sessions

    def get(self, session_id: str) -> Optional[BuddySession]:
        for session in self.list_all():
            if session.session_id == session_id:
                return session
        return None

    # --- Write ---

    def list_for_pair(self, pair_id: str) -> list[BuddySession]:
        """Every session across every cycle of a pair — the mentor's record."""
        sessions = [s for s in self.list_all() if s.pair_id == pair_id]
        sessions.sort(key=lambda s: s.scheduled_at)
        return sessions

    def create(
        self,
        pair_id: str,
        cycle_id: str,
        scheduled_at: str,
        created_by_id: str,
        topic: str = "",
        mode: SessionMode = "async_voice",
        prompt_kind: Optional[PromptKind] = None,
        prompt_id: Optional[str] = None,
        prompt_title: Optional[str] = None,
    ) -> BuddySession:
        record = BuddySession(
            pair_id=pair_id,
            cycle_id=cycle_id,
            scheduled_at=scheduled_at,
            topic=topic,
            mode=mode,
            prompt_kind=prompt_kind,
            prompt_id=prompt_id,
            prompt_title=prompt_title,
            created_by_id=created_by_id,
            created_at=_now(),
        )
        append_jsonl(self.path, record.model_dump())
        return record

    def rate(
        self,
        session_id: str,
        rating: int,
        aspects: Optional[list[str]] = None,
        note: str = "",
    ) -> Optional[BuddySession]:
        """Record the mentee's 1-5 rating of a session, and why.

        `aspects` and `note` are written even when empty, so re-rating cannot
        leave last time's reasons attached to this time's number.
        """
        return self._update(
            session_id,
            {
                "mentee_rating": max(1, min(5, int(rating))),
                "mentee_rating_aspects": list(aspects or []),
                "mentee_rating_note": note.strip(),
            },
        )

    def _update(self, session_id: str, changes: dict) -> Optional[BuddySession]:
        sessions = self.list_all()
        updated: Optional[BuddySession] = None
        for index, session in enumerate(sessions):
            if session.session_id == session_id:
                updated = session.model_copy(update=changes)
                sessions[index] = updated
                break
        if updated is not None:
            overwrite_jsonl(self.path, [s.model_dump() for s in sessions])
        return updated

    def complete(
        self,
        session_id: str,
        note: str = "",
        is_mentor: bool = False,
        duration_minutes: Optional[int] = None,
    ) -> Optional[BuddySession]:
        """Mark a session done and record the caller's own note.

        Deliberately idempotent: both sides complete the same session, each
        writing into their own field, so whoever gets there second adds their
        reflection without clobbering the first.
        """
        session = self.get(session_id)
        if session is None:
            return None

        changes: dict = {
            "status": "completed",
            "completed_at": session.completed_at or _now(),
        }
        if note:
            changes["mentor_notes" if is_mentor else "mentee_reflection"] = note
        if duration_minutes is not None:
            changes["duration_minutes"] = duration_minutes
        return self._update(session_id, changes)

    def attach_room(
        self, session_id: str, room_kind: RoomKind, room_code: str
    ) -> Optional[BuddySession]:
        """Point a session at the live room it is being held in.

        Overwrites any code already there rather than refusing. Rooms are
        process-local and swept when they go stale, so a session planned last
        week can outlive the room someone opened for it; refusing to re-open
        one would strand the pair with a code that leads nowhere.
        """
        return self._update(
            session_id,
            {
                "room_kind": room_kind,
                "room_code": room_code,
                "room_opened_at": _now(),
            },
        )

    def mark_missed(self, session_id: str) -> Optional[BuddySession]:
        return self._update(session_id, {"status": "missed"})

    def delete(self, session_id: str) -> bool:
        """Drop a planned session outright — used to cancel one, not to hide it."""
        sessions = self.list_all()
        remaining = [s for s in sessions if s.session_id != session_id]
        if len(remaining) == len(sessions):
            return False
        overwrite_jsonl(self.path, [s.model_dump() for s in remaining])
        return True


# Module-level singletons — most callers just need the default file locations.

class BuddyConcern(BaseModel):
    """Someone in a pairing saying, privately, that it is not working.

    Read by teachers only — never by the other participant, and the routes
    enforce it. A mentee who has to weigh "will my mentor see this" before
    flagging an unresponsive mentor will not flag anything, and the programme
    goes back to inferring trouble from silence. Silence is exactly what it
    cannot interpret: `health` cannot tell a wrong pairing from exam week.

    Resolution is a teacher's note, not an outcome the system computes. The
    fix might be a new pairing, a conversation, or nothing at all.
    """

    concern_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pair_id: str
    raised_by_id: str
    # Which side raised it. A mentor reporting a mentee who never replies is a
    # different problem from a mentee reporting the same, and the count of each
    # is what tells a teacher whether their pairing rule is wrong.
    role: Literal["mentor", "mentee"]
    reason: ConcernReason = "other"
    detail: str = ""
    status: ConcernStatus = "open"
    raised_at: str
    resolved_at: Optional[str] = None
    resolved_by_id: Optional[str] = None
    resolution: str = ""


class BuddyConcernsStore:
    path: Path

    def __init__(self, path: Path = _CONCERNS_PATH):
        self.path = path

    def list_all(self) -> list[BuddyConcern]:
        return _load(self.path, BuddyConcern)

    def list_open(self) -> list[BuddyConcern]:
        """Every unresolved concern, oldest first — a queue, not a feed.

        Oldest first because this is a worklist: the pairing that has been
        waiting three weeks is the one that needs a teacher, and newest-first
        would bury it under every fresh flag.
        """
        concerns = [c for c in self.list_all() if c.status == "open"]
        concerns.sort(key=lambda c: c.raised_at)
        return concerns

    def get(self, concern_id: str) -> Optional[BuddyConcern]:
        for concern in self.list_all():
            if concern.concern_id == concern_id:
                return concern
        return None

    def open_for(self, pair_id: str, user_id: str) -> Optional[BuddyConcern]:
        """This person's own unresolved concern on this pair, if any."""
        for concern in self.list_all():
            if (
                concern.pair_id == pair_id
                and concern.raised_by_id == user_id
                and concern.status == "open"
            ):
                return concern
        return None

    def open_count_by_pair(self) -> dict[str, int]:
        """Open concerns per pair, in one pass for the admin list."""
        counts: dict[str, int] = {}
        for concern in self.list_open():
            counts[concern.pair_id] = counts.get(concern.pair_id, 0) + 1
        return counts

    def raise_concern(
        self,
        pair_id: str,
        raised_by_id: str,
        role: str,
        reason: str = "other",
        detail: str = "",
    ) -> BuddyConcern:
        """Record a concern. Raises ValueError if this person already has one open.

        One open concern per person per pair: re-flagging changes nothing a
        teacher can act on, and a queue with the same pairing five times in it
        is a worse queue.
        """
        if self.open_for(pair_id, raised_by_id) is not None:
            raise ValueError("concern_already_open")

        concern = BuddyConcern(
            pair_id=pair_id,
            raised_by_id=raised_by_id,
            role=role,
            reason=reason,
            detail=detail.strip(),
            raised_at=_now(),
        )
        append_jsonl(self.path, concern.model_dump())
        return concern

    def resolve(
        self, concern_id: str, resolved_by_id: str, resolution: str = ""
    ) -> Optional[BuddyConcern]:
        """Close a concern with the teacher's note on what they did about it."""
        concerns = self.list_all()
        resolved: Optional[BuddyConcern] = None
        for index, concern in enumerate(concerns):
            if concern.concern_id == concern_id:
                resolved = concern.model_copy(
                    update={
                        "status": "resolved",
                        "resolved_at": _now(),
                        "resolved_by_id": resolved_by_id,
                        "resolution": resolution.strip(),
                    }
                )
                concerns[index] = resolved
                break
        if resolved is not None:
            overwrite_jsonl(self.path, [c.model_dump() for c in concerns])
        return resolved


class BuddyRequest(BaseModel):
    """A student asking to be given a mentor.

    Everything else in this programme is teacher-push: a teacher decides who
    is mentored and pairs them. That is the right default — a student who
    most needs coaching is often the last to ask — but it left no way in at
    all for the student who *does* ask. Their only route was to be noticed.

    Not a complaint and not a concern: `BuddyConcern` is for a pairing that
    exists and is not working, is private to teachers, and reads as a
    grievance. Asking for a mentor in the first place should cost nothing.
    """

    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    # What they want out of it, in their words. Optional: requiring a student
    # to articulate their weakness before they can ask for help is a bar in
    # front of the exact people this exists for.
    note: str = ""
    focus_area: Optional[str] = None
    status: RequestStatus = "open"
    created_at: str
    resolved_at: Optional[str] = None
    resolved_by_id: Optional[str] = None
    # Set when the request produced a pairing, so a teacher can see that the
    # queue actually cleared rather than that the row merely changed state.
    pair_id: Optional[str] = None


class BuddyRequestsStore:
    path: Path

    def __init__(self, path: Path = _REQUESTS_PATH):
        self.path = path

    # --- Read ---

    def list_all(self) -> list[BuddyRequest]:
        return _load(self.path, BuddyRequest)

    def list_open(self) -> list[BuddyRequest]:
        """The queue, oldest first — the student who has waited longest is
        the one a teacher should reach next."""
        pending = [r for r in self.list_all() if r.status == "open"]
        pending.sort(key=lambda r: r.created_at)
        return pending

    def get(self, request_id: str) -> Optional[BuddyRequest]:
        for request in self.list_all():
            if request.request_id == request_id:
                return request
        return None

    def open_for(self, user_id: str) -> Optional[BuddyRequest]:
        """This student's own outstanding request, if they have one."""
        for request in self.list_all():
            if request.user_id == user_id and request.status == "open":
                return request
        return None

    # --- Write ---

    def create(
        self, user_id: str, note: str = "", focus_area: Optional[str] = None
    ) -> BuddyRequest:
        """Raise a request. Raises ValueError if one is already outstanding.

        One open request per student: asking twice does not move anyone up a
        queue, and a queue with the same name in it three times is a worse
        queue for the teacher working down it.
        """
        if self.open_for(user_id) is not None:
            raise ValueError("request_already_open")

        record = BuddyRequest(
            user_id=user_id,
            note=note.strip()[:500],
            focus_area=focus_area,
            created_at=_now(),
        )
        append_jsonl(self.path, record.model_dump())
        return record

    def resolve(
        self,
        request_id: str,
        status: RequestStatus,
        resolved_by_id: str,
        pair_id: Optional[str] = None,
    ) -> Optional[BuddyRequest]:
        """Close a request as paired or declined."""
        requests = self.list_all()
        resolved: Optional[BuddyRequest] = None
        for index, request in enumerate(requests):
            if request.request_id == request_id:
                resolved = request.model_copy(
                    update={
                        "status": status,
                        "resolved_at": _now(),
                        "resolved_by_id": resolved_by_id,
                        "pair_id": pair_id,
                    }
                )
                requests[index] = resolved
                break
        if resolved is not None:
            overwrite_jsonl(self.path, [r.model_dump() for r in requests])
        return resolved

    def resolve_for_user(
        self, user_id: str, resolved_by_id: str, pair_id: str
    ) -> Optional[BuddyRequest]:
        """Close whatever this student had outstanding, because they are now
        paired. Called when a pairing is created so the queue clears itself —
        a teacher who pairs someone should not also have to remember to tick
        off the request that asked for it."""
        pending = self.open_for(user_id)
        if pending is None:
            return None
        return self.resolve(
            pending.request_id, "paired", resolved_by_id, pair_id=pair_id
        )


class MailPreference(BaseModel):
    """Whether one person wants the digest emailed to them.

    Absence means yes. Storing only the people who have expressed a preference
    keeps this file the size of the dissent rather than the size of the cohort,
    and means a new student is never waiting on a row being written before the
    programme can reach them.

    ``unsubscribe_token`` is an opaque random id, not a signature over the user
    id. That choice avoids a signing secret to configure, rotate and leak, and
    it makes revocation trivial — issue a new token and every link in every
    previously sent email is dead. It is a bearer credential, but the only
    thing bearing it can do is stop that person's own mail.
    """

    user_id: str
    # True means "do not email me". The name states the exception, which is
    # what is actually stored.
    digest_opted_out: bool = False
    unsubscribe_token: str = Field(default_factory=lambda: uuid.uuid4().hex)
    updated_at: str


class BuddyMailPrefsStore:
    """One row per person who has expressed a mail preference.

    Rewrites rather than appends on every change: this file has at most one row
    per person and is read on every digest run, so an append-only log of
    toggles would grow without bound and make "what is their setting now" a
    scan rather than a lookup.
    """

    path: Path

    def __init__(self, path: Path = _MAIL_PREFS_PATH):
        self.path = path

    # --- Read ---

    def list_all(self) -> list[MailPreference]:
        return _load(self.path, MailPreference)

    def get(self, user_id: str) -> Optional[MailPreference]:
        for pref in self.list_all():
            if pref.user_id == user_id:
                return pref
        return None

    def is_opted_out(self, user_id: str) -> bool:
        """No row means they have never said, and never said means yes."""
        pref = self.get(user_id)
        return bool(pref and pref.digest_opted_out)

    def opted_out_ids(self) -> set[str]:
        """Every id to skip, in one pass — for the digest, which asks about all
        of them at once and would otherwise re-read this file per recipient."""
        return {p.user_id for p in self.list_all() if p.digest_opted_out}

    def by_token(self, token: str) -> Optional[MailPreference]:
        if not token:
            return None
        for pref in self.list_all():
            if pref.unsubscribe_token == token:
                return pref
        return None

    # --- Write ---

    def ensure(self, user_id: str) -> MailPreference:
        """This person's row, created opted-in if they have none.

        Called before sending, because the link in the email needs a token and
        a token has to exist somewhere first.
        """
        existing = self.get(user_id)
        if existing is not None:
            return existing
        record = MailPreference(user_id=user_id, updated_at=_now())
        append_jsonl(self.path, record.model_dump())
        return record

    def set_opted_out(self, user_id: str, opted_out: bool) -> MailPreference:
        """Set the preference, creating the row if this is their first word."""
        prefs = self.list_all()
        for index, pref in enumerate(prefs):
            if pref.user_id == user_id:
                updated = pref.model_copy(
                    update={"digest_opted_out": opted_out, "updated_at": _now()}
                )
                prefs[index] = updated
                overwrite_jsonl(self.path, [p.model_dump() for p in prefs])
                return updated

        record = MailPreference(
            user_id=user_id, digest_opted_out=opted_out, updated_at=_now()
        )
        append_jsonl(self.path, record.model_dump())
        return record


mentors_store = MentorsStore()
buddy_pairs_store = BuddyPairsStore()
buddy_messages_store = BuddyMessagesStore()
buddy_cycles_store = BuddyCyclesStore()
buddy_sessions_store = BuddySessionsStore()
buddy_concerns_store = BuddyConcernsStore()
buddy_requests_store = BuddyRequestsStore()
buddy_mail_prefs_store = BuddyMailPrefsStore()
