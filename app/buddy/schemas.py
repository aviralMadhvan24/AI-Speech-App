"""Request/response models for the buddy mentorship API."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.buddy.health import PairHealth
from app.buddy.service import SpeakerRanking
from app.storage.buddy import BuddyConcern
from app.storage.buddy import BuddyCycle
from app.storage.buddy import BuddyMessage
from app.storage.buddy import BuddyPair
from app.storage.buddy import BuddySession
from app.storage.buddy import MentorRecord


class ConversationSummary(BaseModel):
    """One of the current user's buddy conversations, for the inbox list."""

    pair_id: str
    partner_email: str
    partner_name: Optional[str] = None
    # "mentor" means the current user mentors the partner.
    my_role: str
    status: str
    unread_count: int = 0
    last_message_at: Optional[str] = None
    last_message_preview: str = ""
    # A pairing going quiet is what kills an async programme, and the health
    # states already detect it. Derived on read rather than pushed: there is
    # no scheduler here, and a nudge nobody is around to send is worse than
    # one that appears the moment they next look.
    nudge: Optional[str] = None
    days_quiet: Optional[int] = None
    # The next thing actually in the diary, so the inbox answers "what now?"
    next_session_at: Optional[str] = None
    sessions_kept: int = 0


class MyBuddiesResponse(BaseModel):
    conversations: list[ConversationSummary] = Field(default_factory=list)
    total: int = 0


class MessagesResponse(BaseModel):
    pair_id: str
    partner_email: str
    partner_name: Optional[str] = None
    messages: list[BuddyMessage] = Field(default_factory=list)
    total: int = 0


class SendMessageRequest(BaseModel):
    body: str


class MarkReadResponse(BaseModel):
    marked: int = 0


# --- Teacher-facing ---


class MentorCandidatesResponse(BaseModel):
    """Score-suggested mentors awaiting a teacher decision, plus the full ranking."""

    suggested: list[SpeakerRanking] = Field(default_factory=list)
    ranking: list[SpeakerRanking] = Field(default_factory=list)
    threshold: float = 0.0
    min_sample_size: int = 0
    # The second way in. Sent so the UI can state the bar it applied rather
    # than hardcoding numbers that would drift out of step with the service.
    growth_min_gain: float = 0.0
    growth_min_final: float = 0.0


class MentorDecisionRequest(BaseModel):
    # "approved" or "rejected" — validated in the route so a bad value is a 400
    # with a readable message rather than a schema error.
    status: str


class MentorsResponse(BaseModel):
    mentors: list[MentorRecord] = Field(default_factory=list)
    total: int = 0


class CreatePairRequest(BaseModel):
    mentor_email: str
    mentee_email: str
    # Pairing and opening the first cycle are one action for a teacher, so the
    # cycle fields ride along here. `cycle_weeks=0` pairs without starting one.
    cycle_weeks: int = 4
    goal: str = ""
    focus_area: Optional[str] = None


class PairsResponse(BaseModel):
    pairs: list[BuddyPair] = Field(default_factory=list)
    total: int = 0
    # Keyed by pair_id. Carried alongside the pairs rather than folded into
    # them: `BuddyPair` is what is stored, and health is derived per request.
    health: dict[str, PairHealth] = Field(default_factory=dict)
    # Open concern count per pair_id, absent when zero. Kept out of PairHealth
    # on purpose: health judges activity, and a raised hand is not activity —
    # a pairing can be perfectly busy and still be the wrong pairing.
    open_concerns: dict[str, int] = Field(default_factory=dict)


# --- Cycles ---


class CreateCycleRequest(BaseModel):
    """Open a fresh cycle on an existing pair — a renewal, or a first period."""

    pair_id: str
    weeks: int = 4
    goal: str = ""
    focus_area: Optional[str] = None


class CyclesResponse(BaseModel):
    cycles: list[BuddyCycle] = Field(default_factory=list)
    total: int = 0


# --- Sessions ---


class PlanSessionRequest(BaseModel):
    """Plan a unit of practice inside the pair's open cycle."""

    scheduled_at: str
    topic: str = ""
    # async_voice | live_call | in_person — validated in the route so a bad
    # value reads as a 400 rather than a schema error.
    mode: str = "async_voice"
    # Optional practice material from the platform's own catalogs. Validated
    # against the catalog in the route, so a session can never point at a
    # prompt that does not exist.
    prompt_kind: Optional[str] = None
    prompt_id: Optional[str] = None


class CompleteSessionRequest(BaseModel):
    """Close out a session. The note lands on whichever side is calling."""

    note: str = ""
    duration_minutes: Optional[int] = None


class RateSessionRequest(BaseModel):
    """The mentee's 1-5 verdict on a session, and why. Mentees only, by design.

    `aspects` is validated in the route against `RatingAspect` so a bad value
    is a readable 400 rather than a schema error.
    """

    rating: int
    aspects: list[str] = Field(default_factory=list)
    note: str = ""


class SessionsResponse(BaseModel):
    sessions: list[BuddySession] = Field(default_factory=list)
    total: int = 0


# --- Practice material ---


class PracticePrompt(BaseModel):
    """One item a session can be built around, from an existing catalog."""

    kind: str  # pronunciation | debate | gd
    id: str
    title: str
    detail: str = ""


class PracticePromptsResponse(BaseModel):
    prompts: list[PracticePrompt] = Field(default_factory=list)
    total: int = 0


# --- Mentor's own record ---


class MentorDashboard(BaseModel):
    """What mentoring has amounted to, shown to the mentor themselves.

    Mentoring is unpaid work that until now accrued nothing to the person
    doing it. This is the ledger.
    """

    is_mentor: bool = False
    active_mentees: int = 0
    total_mentees: int = 0
    sessions_mentored: int = 0
    average_rating: Optional[float] = None
    cycles_completed: int = 0
    mentees_improved: int = 0


# --- Concerns ---


class RaiseConcernRequest(BaseModel):
    """Either side saying the pairing is not working.

    `reason` is validated in the route against `ConcernReason` so a bad value
    is a readable 400 rather than a schema error.
    """

    reason: str = "other"
    detail: str = ""


class MyConcernResponse(BaseModel):
    """The caller's own open concern on a pair, or none.

    Deliberately scoped to the caller. There is no endpoint that returns the
    other participant's concerns to a participant — see `BuddyConcern`.
    """

    concern: Optional[BuddyConcern] = None


class ConcernsResponse(BaseModel):
    """The teacher's triage queue."""

    concerns: list[BuddyConcern] = Field(default_factory=list)
    total: int = 0


class ResolveConcernRequest(BaseModel):
    resolution: str = ""
