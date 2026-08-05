"""Pydantic schemas for the group-debate feature.

This module is built up additively across tasks 2.1 – 2.4:

- 2.1 (this task): Internal server-only models (`ParticipantInternal`, `DebateRoom`).
- 2.2: Public / broadcast projection models and `to_public` helper.
- 2.3: Persisted (JSONL row) models.
- 2.4: Request / response and WebSocket envelope models.

All models are Pydantic v2 (matching the rest of the codebase). The wire
format is flat and snake_case so the frontend can consume the room state
directly without an adapter layer.

Internal models MAY carry email, uid, and connection bookkeeping.
Public projections MUST strip those fields — see Section 11 of
`requirements.md` and Section 4 of `design.md`.
"""

from __future__ import annotations

from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import Field
from pydantic import PrivateAttr


# ---------------------------------------------------------------------------
# Room state literal (single source of truth for the 6 primary states)
# ---------------------------------------------------------------------------

DebateState = Literal[
    "waiting",
    "prep",
    "speaking",
    "scoring",
    "complete",
    "abandoned",
]


# ---------------------------------------------------------------------------
# Internal (server-only) models
# ---------------------------------------------------------------------------


class ParticipantInternal(BaseModel):
    """Authoritative server-side view of a single participant.

    Carries email, firebase uid, and WebSocket bookkeeping. These fields
    MUST NOT appear in the broadcast projection (`ParticipantPublic`).
    """

    participant_id: str  # uuid4 hex[:16]
    user_id: str  # firebase uid
    user_email: str  # NOT included in public projection
    display_name: str
    avatar_url: Optional[str] = None  # Profile photo, captured at join
    joined_at: float  # unix seconds
    is_ready: bool = False
    # Assigned in join order on entry into `speaking`; stable thereafter.
    turn_index: int
    is_forfeit: bool = False
    ws_connected_since: Optional[float] = None
    # Set when the participant's WS closes; None while connected.
    disconnected_at: Optional[float] = None


class DebateRoom(BaseModel):
    """Authoritative in-memory server state for one debate room."""

    debate_id: str  # uuid4
    code: str  # 6-char room code
    motion_id: str
    motion_title: str
    motion_text: str
    # True when the creator picked this motion explicitly. A chosen motion is
    # shown in the lobby (they already know it), while a randomly assigned one
    # stays hidden until prep so nobody can prepare early.
    motion_chosen: bool = False
    state: DebateState = "waiting"
    paused: bool = False
    scoring_mode: Literal["instant", "detailed"] = "instant"
    # LiveKit room name for live audio; set around prep/speaking. Idempotent
    # once assigned (see room_manager `_create_livekit_room`).
    livekit_room: Optional[str] = None
    participants: list[ParticipantInternal] = Field(default_factory=list)
    active_turn_index: Optional[int] = None
    prep_deadline: Optional[float] = None
    turn_deadline: Optional[float] = None
    reconnect_deadline: Optional[float] = None
    # Auto-start grace deadline (20s countdown after all ready, before prep).
    auto_start_deadline: Optional[float] = None
    created_at: float
    completed_at: Optional[float] = None
    winner_participant_id: Optional[str] = None
    # Ranked results, filled in at completion (see room_manager finalize).
    final_standings: list["FinalStanding"] = Field(default_factory=list)
    # Cache of completed turns for audio playback broadcast
    completed_turns_cache: list["CompletedTurnPublic"] = Field(default_factory=list)

    # Cumulative pause offset for the currently active turn. Used when
    # resuming after a paused overlay so the turn deadline is extended by
    # the paused duration.
    #
    # Modelled as a Pydantic v2 PrivateAttr because leading-underscore
    # names cannot be regular model fields. It is intentionally excluded
    # from `model_dump()` / `model_dump_json()` output — the public
    # projection never leaks pause bookkeeping.
    _pause_started_at: Optional[float] = PrivateAttr(default=None)


# ---------------------------------------------------------------------------
# Public / broadcast projection models
# ---------------------------------------------------------------------------
#
# These are the shapes actually sent to the frontend (via HTTP responses and
# WebSocket broadcasts). They MUST NOT carry any of the internal bookkeeping
# fields — no `user_email`, no `user_id`, no `ws_connected_since`, no
# `disconnected_at`, and no `_pause_started_at`. See Requirement 11.1 / 11.5
# and Section 4 of `design.md` for the exact allow-list.


class ParticipantPublic(BaseModel):
    """Broadcast-safe view of a participant. Strips email / uid / WS state."""

    participant_id: str
    display_name: str
    avatar_url: Optional[str] = None  # Profile photo (safe to expose)
    is_ready: bool
    turn_index: int
    is_forfeit: bool


class MotionPublic(BaseModel):
    """Broadcast-safe view of the room's motion."""

    id: str
    title: str
    text: str


class FinalStanding(BaseModel):
    """Per-participant result shown on the completion screen.

    Broadcast-safe: carries no email / uid. Populated only when the room
    reaches `complete` so players can see *why* the winner won (ranked
    scores + content feedback), not just a name.
    """

    participant_id: str
    display_name: str
    rank: int  # 1-based; ties share the sort order established by compute_winner
    ai_score: float
    content_score: Optional[float] = None  # 0-50 from the LLM, if scored
    content_feedback: Optional[str] = None
    effective_score: float
    is_forfeit: bool = False
    is_winner: bool = False
    full_ai_score: Optional[float] = None  # Detailed score with pronunciation
    full_score_ready: bool = False
    # Per-component breakdown ({pronunciation, fluency, content, ...}) copied
    # from the participant's turn so the result screen can show where the
    # score came from instead of just a single number.
    score_breakdown: Optional[dict] = None


class CompletedTurnPublic(BaseModel):
    """Broadcast-safe view of a completed turn for audio playback.
    
    Includes only the fields needed for other participants to play back
    the turn's audio and see who spoke.
    """
    turn_index: int
    participant_id: str
    display_name: str
    audio_url: Optional[str] = None
    ai_score: float
    is_forfeit: bool = False


class PublicDebateRoom(BaseModel):
    """Broadcast shape — NEVER exposes emails, WS handles, or uids.

    The field set here is the complete allow-list from `design.md` Section 4.
    Adding a field must be done deliberately and reviewed against
    Requirement 11's PII constraints.
    """

    code: str
    state: DebateState
    paused: bool = False
    scoring_mode: Literal["instant", "detailed"] = "instant"
    # LiveKit room name, exposed ONLY while the room state is `prep` or
    # `speaking`. `to_public` gates this so the name never leaks outside
    # active audio phases (Requirement 1.1).
    livekit_room: Optional[str] = None
    motion: Optional[MotionPublic] = None
    # Lets the client reveal a creator-chosen motion in the lobby while keeping
    # a randomly assigned one hidden until prep.
    motion_chosen: bool = False
    participants: list[ParticipantPublic] = Field(default_factory=list)
    active_turn_index: Optional[int] = None
    prep_deadline: Optional[float] = None
    turn_deadline: Optional[float] = None
    reconnect_deadline: Optional[float] = None
    # Auto-start grace deadline (20s countdown shown in waiting phase).
    auto_start_deadline: Optional[float] = None
    winner_participant_id: Optional[str] = None
    # Completed turns with audio URLs for playback by other participants.
    completed_turns: list[CompletedTurnPublic] = Field(default_factory=list)
    # Populated only at completion so the results screen can explain the
    # outcome with ranked scores. Empty during the live debate.
    final_standings: list[FinalStanding] = Field(default_factory=list)


def to_public(room: DebateRoom) -> PublicDebateRoom:
    """Project an internal `DebateRoom` to its broadcast shape.

    Callers (room_manager, HTTP handlers, WS broadcast) MUST use this
    helper rather than hand-rolling projections — it is the single point
    that guarantees `user_email`, `user_id`, `ws_connected_since`,
    `disconnected_at`, and `_pause_started_at` never leak to clients.
    """
    return PublicDebateRoom(
        code=room.code,
        state=room.state,
        paused=room.paused,
        scoring_mode=room.scoring_mode,
        # Hidden while waiting so nobody prepares early — unless the creator
        # chose the motion deliberately, in which case it is theirs to share.
        # Previously this was always sent and only hidden by the client, so the
        # motion was readable on the wire before prep.
        motion=(
            MotionPublic(
                id=room.motion_id,
                title=room.motion_title,
                text=room.motion_text,
            )
            if (room.state != "waiting" or room.motion_chosen)
            else None
        ),
        motion_chosen=room.motion_chosen,
        participants=[
            ParticipantPublic(
                participant_id=p.participant_id,
                display_name=p.display_name,
                avatar_url=p.avatar_url,
                is_ready=p.is_ready,
                turn_index=p.turn_index,
                is_forfeit=p.is_forfeit,
            )
            for p in room.participants
        ],
        active_turn_index=room.active_turn_index,
        prep_deadline=room.prep_deadline,
        turn_deadline=room.turn_deadline,
        reconnect_deadline=room.reconnect_deadline,
        auto_start_deadline=room.auto_start_deadline,
        winner_participant_id=room.winner_participant_id,
        completed_turns=room.completed_turns_cache,
        final_standings=room.final_standings,
        # Phase-gated: the LiveKit room name is exposed only during the
        # active audio phases (prep/speaking); None otherwise so it never
        # leaks in waiting/scoring/complete/abandoned states.
        livekit_room=(
            room.livekit_room if room.state in ("prep", "speaking") else None
        ),
    )


# ---------------------------------------------------------------------------
# Persisted (JSONL row) models
# ---------------------------------------------------------------------------
#
# These are the shapes written to `outputs/debate_turns.jsonl` and
# `outputs/debates.jsonl`. They are the durable record of a completed
# debate and its individual turns; the room manager and admin routes
# read/write them through `app.storage.debate_turns` and
# `app.storage.debates`. See Section 4 (Persisted) of `design.md`.


class DebateTurn(BaseModel):
    """One participant's turn within a debate.

    Persisted as a single JSONL row in `outputs/debate_turns.jsonl`.

    Invariants (enforced by the room manager / scoring code, not this
    schema alone):
      - `ai_score` is clamped to `[0.0, 100.0]` by `compute_ai_score`
        before construction (see design "AI Score Computation").
      - Forfeit turns (`forfeit_reason is not None`) MUST have
        `ai_score == 0.0` and `scoring_unavailable is False`
        (Property 6, Requirements 5.6 / 8.3).
      - `teacher_override_score`, if set, is a bounded integer in
        `[0, 100]` — the constraint is enforced here so an invalid
        override raises a Pydantic validation error rather than a
        silent write.
    """

    turn_id: str  # uuid4
    debate_id: str
    participant_id: str
    turn_index: int
    analysis_id: Optional[str] = None  # links to /analyze pipeline output
    audio_url: Optional[str] = None  # URL to play back this turn's audio
    # Storage-abstraction key (new source of truth for locating the blob).
    # Format: debate-audio/{debate_id}/{turn_id}.{ext}
    audio_key: Optional[str] = None
    # MIME type so the serve route sets the correct Content-Type.
    audio_content_type: Optional[str] = None
    ai_score: float  # 0..100, clamped upstream by compute_ai_score
    scoring_unavailable: bool = False
    teacher_override_score: Optional[int] = Field(default=None, ge=0, le=100)
    teacher_comment: Optional[str] = None
    
    # Content scoring breakdown (LLM-based)
    content_score: Optional[float] = None  # 0-50, from LLM content analysis
    content_feedback: Optional[str] = None  # One-line feedback from LLM
    score_breakdown: Optional[dict] = None  # Full breakdown: {pronunciation, fluency, content}
    # ASR transcript for this turn. Persisted so the detailed (background)
    # pronunciation pass can re-score content and align phonemes instead of
    # starting from an empty string, which previously collapsed the detailed
    # score down to pronunciation alone.
    transcript: Optional[str] = None
    submitted_at: float  # unix seconds
    forfeit_reason: Optional[Literal["timeout", "reconnect_timeout"]] = None
    
    # Full detailed score (with pronunciation) — populated by background task
    full_ai_score: Optional[float] = None
    full_score_ready: bool = False


class EffectiveScoreEntry(BaseModel):
    """Per-participant scoring breakdown embedded in `DebateRecord`.

    `effective_score` follows the priority documented in the design's
    "Winner Selection" section: `teacher_override_score` when present,
    otherwise `ai_score`. See `app.debate.scoring.compute_effective_score`.
    """

    participant_id: str
    ai_score: float
    teacher_override_score: Optional[int] = Field(default=None, ge=0, le=100)
    effective_score: float


class DebateTurnAudioRef(BaseModel):
    """Self-contained per-turn audio reference for post-debate playback.

    Carries a display label (speaker name) so the personal panel and
    results screen can render a per-speaker player list without
    re-joining participant data. Broadcast / response-safe: no email /
    uid (see Requirement 3.1 / 4.4).
    """

    turn_index: int
    participant_id: str
    display_name: str
    audio_url: Optional[str] = None  # app route URL (or None for forfeit)
    is_forfeit: bool = False


class DebateRecord(BaseModel):
    """Final durable record of a completed debate.

    Persisted as a single JSONL row in `outputs/debates.jsonl` on
    transition into `complete`. Abandoned rooms are NOT persisted
    (Req 7.5). `participants` is a snapshot (not the live
    `ParticipantInternal` list) so the record is self-contained even if
    the room's in-memory state is later evicted; each element carries
    `participant_id`, `user_id`, `display_name`, `turn_index`, and
    `is_forfeit`.
    """

    debate_id: str
    code: str
    motion_id: str
    motion_title: str
    motion_text: str
    scoring_mode: Literal["instant", "detailed"] = "instant"
    # snapshot: participant_id, user_id, display_name, turn_index, is_forfeit
    participants: list[dict]
    turn_ids: list[str]  # ordered by turn_index
    winner_participant_id: Optional[str] = None
    effective_scores: list[EffectiveScoreEntry] = Field(default_factory=list)
    # Ranked results snapshot so the My Performance detail view can render the
    # full outcome after the in-memory room has been evicted. In detailed mode
    # these rows are re-saved once pronunciation scoring finishes.
    final_standings: list["FinalStanding"] = Field(default_factory=list)
    # Ordered by turn_index; self-contained audio index for the completed
    # debate so playback survives room eviction. Empty entries allowed for
    # forfeits. Populated at finalize (see room_manager).
    turn_audio: list[DebateTurnAudioRef] = Field(default_factory=list)
    created_at: float
    completed_at: float


# ---------------------------------------------------------------------------
# Motion catalog
# ---------------------------------------------------------------------------


class Motion(BaseModel):
    """One motion loaded from `app/data/debate_motions.json`."""

    id: str
    title: str
    text: str


class DebateDetailResponse(BaseModel):
    """Response body for `GET /debate/debates/{debate_id}` (detail endpoint).

    Response-safe: carries no email / uid. Surfaces the ordered per-turn
    audio references for post-debate playback (Requirement 3.4).
    """

    debate_id: str
    code: str
    motion: Motion
    completed_at: float
    scoring_mode: Literal["instant", "detailed"] = "instant"
    winner_participant_id: Optional[str] = None
    final_standings: list[FinalStanding] = Field(default_factory=list)
    turn_audio: list[DebateTurnAudioRef] = []

# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------
#
# These wrap the public projection for HTTP responses. Handlers in
# `app.debate.routes` return these shapes verbatim; the frontend types
# in `frontend/src/debateApi.ts` mirror them field-for-field. See
# Section 4 (Request / response shapes) of `design.md`.


class CreateRoomResponse(BaseModel):
    """Response body for `POST /debate/rooms` (room creation)."""

    room_code: str
    participant_id: str
    state: PublicDebateRoom


class JoinRoomResponse(BaseModel):
    """Response body for `POST /debate/rooms/{code}/join`."""

    room_code: str
    participant_id: str
    state: PublicDebateRoom


class ReadyResponse(BaseModel):
    """Response body for `POST /debate/rooms/{code}/ready` (ready toggle)."""

    state: PublicDebateRoom


class TurnUploadResponse(BaseModel):
    """Response body for `POST /debate/rooms/{code}/turn` (turn upload).

    Mirrors the outputs of `compute_ai_score` (`ai_score`,
    `scoring_unavailable`) plus the newly-persisted `turn_id` and, when
    the inline `/analyze` reuse succeeded, the `analysis_id` linking to
    the analyze pipeline output.
    """

    turn_id: str
    ai_score: float
    scoring_unavailable: bool
    analysis_id: Optional[str] = None
    audio_url: Optional[str] = None  # URL to play back this turn's audio
    content_score: Optional[float] = None  # 0-50 from LLM content analysis
    content_feedback: Optional[str] = None  # One-line feedback
    score_breakdown: Optional[dict] = None  # Full scoring breakdown
    state: PublicDebateRoom


class TeacherReviewRequest(BaseModel):
    """Request body for `POST /admin/debates/{id}/turns/{tid}/review`.

    `score` is a bounded integer in `[0, 100]`. Out-of-range values raise
    a Pydantic `ValidationError`, which the admin route translates to
    an HTTP 422 with detail `invalid_score` (Req 10.6).
    """

    score: int = Field(ge=0, le=100)
    comment: Optional[str] = None


# ---------------------------------------------------------------------------
# WebSocket envelopes
# ---------------------------------------------------------------------------
#
# All server → client messages wrap `PublicDebateRoom` in a discriminated
# envelope. Clients do not drive state — the room manager is the sole
# authority — so the inbound envelope only carries `ping` for keepalive.
# See Section 4 (WebSocket envelopes) of `design.md`.


class DebateWSOutbound(BaseModel):
    """Server → client envelope.

    - `type == "state"`: `state` carries the latest `PublicDebateRoom`.
    - `type == "error"`: `detail` carries a short machine-readable code.
    - `type == "pong"`: keepalive reply to a client `ping`.
    """

    type: Literal["state", "error", "pong"]
    state: Optional[PublicDebateRoom] = None
    detail: Optional[str] = None


class DebateWSInbound(BaseModel):
    """Client → server envelope. Only `ping` is accepted."""

    type: Literal["ping"]
