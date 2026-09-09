"""Request/response models for the buddy mentorship API.

Identity convention, applied throughout: a client sends a ``user_id`` and
never an email. Responses carry ``Person`` objects, which pair that id with a
name and address resolved at read time — see ``app.buddy.identity``. Where a
response contains ids buried inside stored rows (a pair's ``mentor_id``, a
concern's ``raised_by_id``), it also carries a ``people`` map from id to
``Person`` so a client can render names without a second round trip and
without the server denormalising anything into storage.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.buddy.digest import Nudge
from app.buddy.health import PairHealth
from app.buddy.identity import Person
from app.buddy.service import SpeakerRanking
from app.storage.buddy import BuddyConcern
from app.storage.buddy import BuddyCycle
from app.storage.buddy import BuddyMessage
from app.storage.buddy import BuddyPair
from app.storage.buddy import BuddyRequest
from app.storage.buddy import BuddySession
from app.storage.buddy import MentorRecord


class ConversationSummary(BaseModel):
    """One of the current user's buddy conversations, for the inbox list."""

    pair_id: str
    partner: Person
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
    # Who the server thinks is asking. Sent so a client can tell its own
    # messages from its partner's by id, without having to know its own uid
    # from the auth layer — the server already resolved the token.
    me: Person
    conversations: list[ConversationSummary] = Field(default_factory=list)
    total: int = 0


class MessagesResponse(BaseModel):
    pair_id: str
    partner: Person
    me: Person
    messages: list[BuddyMessage] = Field(default_factory=list)
    total: int = 0


class SendMessageRequest(BaseModel):
    body: str


class MarkReadResponse(BaseModel):
    marked: int = 0


# --- Nudges the student themselves receives ---


class MyNudgesResponse(BaseModel):
    """The caller's own share of the digest.

    The programme has always detected a stalled pairing; until this endpoint
    the detection went only to a teacher's admin panel, so the two people who
    could actually restart the pairing were the last to hear about it — and a
    stalled pairing is precisely one nobody is opening the app to look at.
    """

    nudges: list[Nudge] = Field(default_factory=list)
    total: int = 0


class BuddyBadge(BaseModel):
    """The one number the main menu needs to show a dot on the buddy tile.

    Separate from `/me` because the menu asks on every render and does not
    need the conversation list to answer; `/me` reads every message in every
    pairing to build previews, which is far too much work for a badge.
    """

    unread: int = 0
    # Nudges are counted, not sent, so the badge can say "something needs you"
    # without the menu having to render the reasons.
    nudges: int = 0
    # A student with no pairing and no request pending is shown the way in
    # rather than a badge — the menu needs to know which of the two to do.
    has_pairing: bool = False
    can_request: bool = False


# --- Mail preferences ---


class MailPreferenceResponse(BaseModel):
    """Whether the caller wants the digest emailed to them.

    Phrased as opt-*out* because that is what is stored: the default is to be
    reachable, and only dissent is recorded. A client rendering a checkbox
    should invert it rather than the server pretending the default is a row.
    """

    digest_opted_out: bool = False


class SetMailPreferenceRequest(BaseModel):
    digest_opted_out: bool


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
    people: dict[str, Person] = Field(default_factory=dict)


class CreatePairRequest(BaseModel):
    mentor_id: str
    mentee_id: str
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
    # Every participant and pairing teacher in `pairs`, keyed by user id.
    people: dict[str, Person] = Field(default_factory=dict)


# --- The pairing picker ---


class StudentRow(BaseModel):
    """One student as the pairing screen sees them.

    Pairing used to be two email addresses typed into a form, which meant a
    teacher could only pair someone whose address they already had in mind —
    and never had a way to see who was left out. This is the other half: the
    cohort, with each student's standing and whether anyone is currently
    mentoring them.
    """

    person: Person
    has_mentor: bool = False
    mentor: Optional[Person] = None
    # Their own standing as a speaker, from the same ranking the mentor
    # candidate list uses. None when they have no scored work at all.
    speaking_score: Optional[float] = None
    sample_size: int = 0
    # Their weakest measured axis, which is what a mentor would be picked to
    # address. None when nothing has been measured.
    weakest_axis: Optional[str] = None
    weakest_score: Optional[float] = None
    is_approved_mentor: bool = False
    active_mentees: int = 0
    # Set when this student has asked for a mentor and nobody has answered.
    open_request: Optional[BuddyRequest] = None


class SuggestedPairing(BaseModel):
    """A mentee, and the approved mentor best placed to help them.

    Suggested, never applied: the teacher still makes every pairing. The
    ranking exists because "who has no mentor" and "who is free to mentor"
    are two lists a person has to hold in their head at once, and holding
    thirty of each is what stops a teacher pairing anyone at all.
    """

    mentee: Person
    mentor: Person
    # Why this mentor for this mentee, in the same vocabulary the panel uses.
    reason: str = ""
    mentee_weakest_axis: Optional[str] = None
    mentor_axis_score: Optional[float] = None
    mentor_active_mentees: int = 0


class StudentsResponse(BaseModel):
    students: list[StudentRow] = Field(default_factory=list)
    total: int = 0
    # How many students have no mentor. The headline number of the screen:
    # a programme is judged on who it did not reach.
    unpaired: int = 0
    suggestions: list[SuggestedPairing] = Field(default_factory=list)


# --- Asking for a mentor ---


class RequestBuddyRequest(BaseModel):
    """A student asking to be given a mentor."""

    note: str = ""
    focus_area: Optional[str] = None


class MyRequestResponse(BaseModel):
    """The caller's own outstanding request, and whether they may make one."""

    request: Optional[BuddyRequest] = None
    # False when they already have a mentor, or already have a request open.
    can_request: bool = False
    # Which of those it is, so the UI states the reason rather than showing a
    # disabled button with no explanation.
    reason: Optional[str] = None


class RequestsResponse(BaseModel):
    """The teacher's queue of students who have asked for a mentor."""

    requests: list[BuddyRequest] = Field(default_factory=list)
    total: int = 0
    people: dict[str, Person] = Field(default_factory=dict)


class DeclineRequestRequest(BaseModel):
    resolution: str = ""


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
    # Cycles open past their own end date, newest first. Sent alongside rather
    # than left for the client to work out from `ends_at`, so "overdue" means
    # the same thing here as it does in the digest and on the pair list.
    overdue: list[BuddyCycle] = Field(default_factory=list)
    people: dict[str, Person] = Field(default_factory=dict)


class SweepCyclesResponse(BaseModel):
    """What closing every expired cycle actually did.

    Returns the closed cycles rather than a count: each one now carries a
    frozen verdict, and that verdict is the reason the sweep exists.
    """

    closed: list[BuddyCycle] = Field(default_factory=list)
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


class OpenRoomResponse(BaseModel):
    """A live session that now has a real room behind it.

    `live_call` used to be a mode with nothing behind it: the pair met
    somewhere off the platform and came back to tick a box, so the only record
    was their own word for it. The room here is the platform's own debate
    room, which scores what happens in it — and that score lands in the store
    the cycle report already reads, so the practice counts without anyone
    reporting it.
    """

    session: BuddySession
    room_kind: str
    room_code: str
    # True when this call created the room, false when it returned the one
    # already on the session. The mentee joining second gets `false`.
    created: bool = False


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
    people: dict[str, Person] = Field(default_factory=dict)


class ResolveConcernRequest(BaseModel):
    resolution: str = ""
