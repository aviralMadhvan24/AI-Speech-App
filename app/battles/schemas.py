"""Pydantic schemas for the 1v1 battle feature.

We keep the wire format flat and snake_case so the frontend can consume
the room state directly without an adapter layer (mirroring the shape used
by the existing pronunciation endpoints).

A small `BattleRoomState` carries internal-only fields (player ids,
background task handles) that we explicitly strip before broadcasting. The
public projection is `PublicBattleRoomState`.
"""

from __future__ import annotations

from typing import Any
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field


BattleStatus = Literal[
    "waiting",
    "ready",
    "countdown",
    "recording",
    "scoring",
    "complete",
    "abandoned",
]

PlayerRole = Literal["host", "opponent"]
Verdict = Literal["host", "opponent", "tie"]
WinnerVerdict = Literal["host", "opponent", "draw"]


class PlayerScore(BaseModel):
    """A single player's submitted analysis result for the battle round."""

    pronunciation_score: float = Field(ge=0, le=100)
    clarity_score: float = Field(ge=0, le=100)
    pace_wpm: float = Field(ge=0)
    analysis_id: str


class BattleScores(BaseModel):
    host: Optional[PlayerScore] = None
    opponent: Optional[PlayerScore] = None


class StarVerdict(BaseModel):
    pronunciation: Verdict
    clarity: Verdict
    pace: Verdict
    winner: WinnerVerdict
    host_stars: int = Field(ge=0, le=3)
    opponent_stars: int = Field(ge=0, le=3)


class BattlePrompt(BaseModel):
    """The single prompt assigned to both players in a room."""

    id: str
    text: str
    difficulty: str
    focus_word: Optional[str] = None
    hint: Optional[str] = None


class PublicBattleRoomState(BaseModel):
    """The room state shape that gets broadcast to clients.

    Internal-only fields (player ids, task handles) are not present here.
    """

    room_code: str
    status: BattleStatus
    host_name: str
    opponent_name: Optional[str] = None
    prompt: Optional[BattlePrompt] = None
    host_ready: bool = False
    opponent_ready: bool = False
    scores: Optional[BattleScores] = None
    verdict: Optional[StarVerdict] = None
    error: Optional[str] = None
    # When a timed phase is active, the server-side deadline (unix seconds)
    # so the client can render a synced countdown without trusting wall time.
    phase_deadline: Optional[float] = None


class BattleRoomState(BaseModel):
    """Authoritative server-side state.

    Carries player ids and bookkeeping data. Use `to_public()` before
    sending to clients.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    room_code: str
    status: BattleStatus = "waiting"
    host_name: str
    opponent_name: Optional[str] = None
    host_player_id: str
    opponent_player_id: Optional[str] = None
    prompt: Optional[BattlePrompt] = None
    host_ready: bool = False
    opponent_ready: bool = False
    scores: BattleScores = Field(default_factory=BattleScores)
    verdict: Optional[StarVerdict] = None
    error: Optional[str] = None
    phase_deadline: Optional[float] = None
    # Set when `complete` or `abandoned` so the GC can sweep stale rooms.
    closed_at: Optional[float] = None

    def to_public(self) -> PublicBattleRoomState:
        scores = self.scores if (self.scores.host or self.scores.opponent) else None
        return PublicBattleRoomState(
            room_code=self.room_code,
            status=self.status,
            host_name=self.host_name,
            opponent_name=self.opponent_name,
            prompt=self.prompt,
            host_ready=self.host_ready,
            opponent_ready=self.opponent_ready,
            scores=scores,
            verdict=self.verdict,
            error=self.error,
            phase_deadline=self.phase_deadline,
        )


# ---------------------------------------------------------------------------
# HTTP request/response shapes
# ---------------------------------------------------------------------------


class CreateRoomRequest(BaseModel):
    host_name: str = Field(min_length=1, max_length=40)


class CreateRoomResponse(BaseModel):
    room_code: str
    player_id: str
    role: PlayerRole
    state: PublicBattleRoomState


class JoinRoomRequest(BaseModel):
    opponent_name: str = Field(min_length=1, max_length=40)


class JoinRoomResponse(BaseModel):
    room_code: str
    player_id: str
    role: PlayerRole
    state: PublicBattleRoomState


# ---------------------------------------------------------------------------
# WebSocket envelopes
# ---------------------------------------------------------------------------


class WSInbound(BaseModel):
    """Message sent from a client over the WebSocket."""

    type: Literal["ready", "score_submitted", "ping"]
    score: Optional[PlayerScore] = None


class WSOutbound(BaseModel):
    """Message sent from the server to a client over the WebSocket."""

    type: Literal["state", "error", "pong"]
    state: Optional[PublicBattleRoomState] = None
    detail: Optional[str] = None

    @classmethod
    def state_msg(cls, state: PublicBattleRoomState) -> "WSOutbound":
        return cls(type="state", state=state)

    @classmethod
    def error_msg(cls, detail: str) -> "WSOutbound":
        return cls(type="error", detail=detail)

    @classmethod
    def pong_msg(cls) -> "WSOutbound":
        return cls(type="pong")


# Helper so callers can serialize without importing model_dump everywhere.
def serialize(message: WSOutbound) -> dict[str, Any]:
    return message.model_dump(exclude_none=True)
