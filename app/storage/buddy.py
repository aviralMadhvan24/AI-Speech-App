"""Buddy mentorship storage — mentor approvals, pairs, and 1:1 messages.

Three JSONL files, following the same store protocol as the rest of this
package (see the package docstring for the migration note):

- ``outputs/buddy_mentors.jsonl``  — one row per student considered as a mentor
- ``outputs/buddy_pairs.jsonl``    — one row per mentor/mentee pairing
- ``outputs/buddy_messages.jsonl`` — one row per chat message or voice note

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


class MentorRecord(BaseModel):
    """A student put forward as a speaking mentor.

    ``speaking_score`` and ``sample_size`` are a snapshot taken when the row was
    written, so the admin list stays stable between refreshes and a teacher can
    see what they approved on. The live score is recomputed on demand by
    ``app.buddy.service.rank_speakers``.
    """

    email: str
    name: Optional[str] = None
    status: MentorStatus = "suggested"
    speaking_score: float = 0.0
    sample_size: int = 0
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    created_at: str


class BuddyPair(BaseModel):
    """One mentor/mentee relationship, created by a teacher."""

    pair_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    mentor_email: str
    mentee_email: str
    mentor_name: Optional[str] = None
    mentee_name: Optional[str] = None
    created_by: str
    created_at: str
    status: PairStatus = "active"
    ended_at: Optional[str] = None

    def involves(self, email: str) -> bool:
        normalized = email.lower()
        return normalized in (self.mentor_email.lower(), self.mentee_email.lower())

    def partner_of(self, email: str) -> Optional[str]:
        """The other participant's email, or None if `email` is not a member."""
        normalized = email.lower()
        if normalized == self.mentor_email.lower():
            return self.mentee_email
        if normalized == self.mentee_email.lower():
            return self.mentor_email
        return None


class BuddyMessage(BaseModel):
    """A single chat message. Voice notes carry an audio asset id instead of text."""

    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pair_id: str
    sender_email: str
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
    mentee_email: str
    goal: str = ""
    focus_area: Optional[str] = None
    starts_at: str
    ends_at: str
    baseline: CycleBaseline = Field(default_factory=CycleBaseline)
    status: CycleStatus = "active"
    created_by: str
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
    # The mentee's rating of this session, 1-5. The only signal the platform
    # has about whether a mentor is any good AT MENTORING, as opposed to being
    # a strong speaker — which is what got them selected.
    mentee_rating: Optional[int] = None
    created_by: str
    created_at: str


_MENTORS_PATH = Path("outputs/buddy_mentors.jsonl")
_PAIRS_PATH = Path("outputs/buddy_pairs.jsonl")
_MESSAGES_PATH = Path("outputs/buddy_messages.jsonl")
_CYCLES_PATH = Path("outputs/buddy_cycles.jsonl")
_SESSIONS_PATH = Path("outputs/buddy_sessions.jsonl")


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

    def get(self, email: str) -> Optional[MentorRecord]:
        normalized = email.lower()
        for mentor in self.list_all():
            if mentor.email.lower() == normalized:
                return mentor
        return None

    def is_approved(self, email: str) -> bool:
        record = self.get(email)
        return record is not None and record.status == "approved"

    # --- Write ---

    def set_status(
        self,
        email: str,
        status: MentorStatus,
        decided_by: str,
        speaking_score: float = 0.0,
        sample_size: int = 0,
        name: Optional[str] = None,
    ) -> MentorRecord:
        """Approve or reject a mentor, creating the row if it is new."""
        mentors = self.list_all()
        normalized = email.lower()
        now = _now()

        for index, mentor in enumerate(mentors):
            if mentor.email.lower() == normalized:
                updated = mentor.model_copy(
                    update={
                        "status": status,
                        "decided_by": decided_by,
                        "decided_at": now,
                        "speaking_score": speaking_score or mentor.speaking_score,
                        "sample_size": sample_size or mentor.sample_size,
                        "name": name or mentor.name,
                    }
                )
                mentors[index] = updated
                overwrite_jsonl(self.path, [m.model_dump() for m in mentors])
                return updated

        record = MentorRecord(
            email=normalized,
            name=name,
            status=status,
            speaking_score=speaking_score,
            sample_size=sample_size,
            decided_by=decided_by,
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

    def list_for_user(self, email: str) -> list[BuddyPair]:
        return [p for p in self.list_all() if p.involves(email)]

    def get(self, pair_id: str) -> Optional[BuddyPair]:
        for pair in self.list_all():
            if pair.pair_id == pair_id:
                return pair
        return None

    def find_active_between(self, mentor_email: str, mentee_email: str) -> Optional[BuddyPair]:
        mentor = mentor_email.lower()
        mentee = mentee_email.lower()
        for pair in self.list_active():
            if pair.mentor_email.lower() == mentor and pair.mentee_email.lower() == mentee:
                return pair
        return None

    # --- Write ---

    def create(
        self,
        mentor_email: str,
        mentee_email: str,
        created_by: str,
        mentor_name: Optional[str] = None,
        mentee_name: Optional[str] = None,
    ) -> BuddyPair:
        record = BuddyPair(
            mentor_email=mentor_email.lower(),
            mentee_email=mentee_email.lower(),
            mentor_name=mentor_name,
            mentee_name=mentee_name,
            created_by=created_by,
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

    def unread_count(self, pair_id: str, for_email: str) -> int:
        """Messages in this pair the given user has not read yet."""
        normalized = for_email.lower()
        return sum(
            1
            for m in self.list_for_pair(pair_id)
            if m.sender_email.lower() != normalized and m.read_at is None
        )

    # --- Write ---

    def create(
        self,
        pair_id: str,
        sender_email: str,
        kind: MessageKind = "text",
        body: str = "",
        audio_id: Optional[str] = None,
        audio_path: Optional[str] = None,
        duration_seconds: Optional[float] = None,
    ) -> BuddyMessage:
        record = BuddyMessage(
            pair_id=pair_id,
            sender_email=sender_email.lower(),
            kind=kind,
            body=body,
            audio_id=audio_id,
            audio_path=audio_path,
            duration_seconds=duration_seconds,
            sent_at=_now(),
        )
        append_jsonl(self.path, record.model_dump())
        return record

    def mark_read(self, pair_id: str, reader_email: str) -> int:
        """Mark every message the reader did NOT send as read. Returns the count."""
        rows = self.list_all()
        normalized = reader_email.lower()
        now = _now()
        changed = 0
        out: list[dict] = []
        for message in rows:
            if (
                message.pair_id == pair_id
                and message.sender_email.lower() != normalized
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

    # --- Write ---

    def create(
        self,
        pair_id: str,
        mentee_email: str,
        starts_at: str,
        ends_at: str,
        created_by: str,
        goal: str = "",
        focus_area: Optional[str] = None,
        baseline: Optional[CycleBaseline] = None,
    ) -> BuddyCycle:
        """Open a cycle. Raises ValueError if one is already open on this pair."""
        if self.active_for_pair(pair_id) is not None:
            raise ValueError("cycle_already_active")

        record = BuddyCycle(
            pair_id=pair_id,
            mentee_email=mentee_email.lower(),
            goal=goal,
            focus_area=focus_area,
            starts_at=starts_at,
            ends_at=ends_at,
            baseline=baseline or CycleBaseline(),
            created_by=created_by,
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
        created_by: str,
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
            created_by=created_by.lower(),
            created_at=_now(),
        )
        append_jsonl(self.path, record.model_dump())
        return record

    def rate(self, session_id: str, rating: int) -> Optional[BuddySession]:
        """Record the mentee's 1-5 rating of a session."""
        return self._update(session_id, {"mentee_rating": max(1, min(5, int(rating)))})

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
mentors_store = MentorsStore()
buddy_pairs_store = BuddyPairsStore()
buddy_messages_store = BuddyMessagesStore()
buddy_cycles_store = BuddyCyclesStore()
buddy_sessions_store = BuddySessionsStore()
