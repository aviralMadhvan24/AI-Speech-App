"""Pydantic schemas for Group Discussion feature."""

from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, PrivateAttr

# ---------------------------------------------------------------------------
# State literal
# ---------------------------------------------------------------------------

GDState = Literal[
    "waiting",      # Lobby, waiting for participants and ready
    "prep",         # 120s prep after all ready, topic revealed
    "discussion",   # 15 min free discussion with PTT
    "scoring",      # Post-discussion, batch processing
    "complete",     # Results shown
    "abandoned",    # Not enough participants
]


# ---------------------------------------------------------------------------
# Topic
# ---------------------------------------------------------------------------

class GDTopic(BaseModel):
    """GD topic loaded from gd_topics.json."""
    id: str
    title: str
    text: str
    category: str = "general"


# ---------------------------------------------------------------------------
# Internal (server-only) models
# ---------------------------------------------------------------------------

class GDParticipantInternal(BaseModel):
    """Server-side view of a participant."""
    participant_id: str
    user_id: str
    user_email: str
    display_name: str
    joined_at: float
    is_ready: bool = False
    speech_count: int = 0
    total_speak_seconds: float = 0.0
    interruption_count: int = 0  # Times they interrupted others
    was_interrupted_count: int = 0  # Times others interrupted them
    is_first_speaker: bool = False
    ws_connected_since: Optional[float] = None
    disconnected_at: Optional[float] = None


class GDSpeechInternal(BaseModel):
    """Server-side speech record (in-memory during session)."""
    speech_id: str
    participant_id: str
    display_name: str
    started_at: float  # unix timestamp
    ended_at: Optional[float] = None
    duration_seconds: Optional[float] = None
    audio_ref: Optional[str] = None  # Path to audio file
    transcript: Optional[str] = None
    analysis_id: Optional[str] = None
    is_interruption: bool = False  # Started while another was speaking
    concurrent_speakers: list[str] = Field(default_factory=list)  # Who else was speaking


class GDRoom(BaseModel):
    """In-memory GD room state."""
    session_id: str
    code: str
    topic_id: str
    topic_title: str
    topic_text: str
    topic_category: str
    state: GDState = "waiting"
    participants: list[GDParticipantInternal] = Field(default_factory=list)
    speeches: list[GDSpeechInternal] = Field(default_factory=list)
    active_speakers: list[str] = Field(default_factory=list)  # participant_ids currently speaking
    prep_deadline: Optional[float] = None
    discussion_deadline: Optional[float] = None
    auto_start_deadline: Optional[float] = None  # Dev mode: countdown to auto-start
    created_at: float
    completed_at: Optional[float] = None
    scoring_started_at: Optional[float] = None

    _pause_started_at: Optional[float] = PrivateAttr(default=None)


# ---------------------------------------------------------------------------
# Public (broadcast) models
# ---------------------------------------------------------------------------

class GDParticipantPublic(BaseModel):
    """Public view of participant (no PII)."""
    participant_id: str
    display_name: str
    is_ready: bool
    is_currently_speaking: bool = False
    speech_count: int = 0
    total_speak_seconds: float = 0.0


class GDTopicPublic(BaseModel):
    """Public topic info."""
    id: str
    title: str
    text: str
    category: str


class GDActiveSpeaker(BaseModel):
    """Someone currently speaking."""
    participant_id: str
    display_name: str
    started_at: float


class PublicGDRoom(BaseModel):
    """Broadcast shape - no PII."""
    code: str
    state: GDState
    topic: Optional[GDTopicPublic] = None
    participants: list[GDParticipantPublic] = Field(default_factory=list)
    active_speakers: list[GDActiveSpeaker] = Field(default_factory=list)
    prep_deadline: Optional[float] = None
    discussion_deadline: Optional[float] = None
    auto_start_deadline: Optional[float] = None  # Dev mode: countdown to auto-start
    scoring_started_at: Optional[float] = None
    total_speeches: int = 0


def to_public(room: GDRoom) -> PublicGDRoom:
    """Project internal room to public shape."""
    # Build map of currently speaking
    speaking_map = {sp: True for sp in room.active_speakers}
    
    # Build active speakers list
    active = []
    for speech in room.speeches:
        if speech.ended_at is None and speech.participant_id in speaking_map:
            active.append(GDActiveSpeaker(
                participant_id=speech.participant_id,
                display_name=speech.display_name,
                started_at=speech.started_at,
            ))
    
    return PublicGDRoom(
        code=room.code,
        state=room.state,
        topic=GDTopicPublic(
            id=room.topic_id,
            title=room.topic_title,
            text=room.topic_text,
            category=room.topic_category,
        ) if room.state != "waiting" else None,  # Hide topic in waiting
        participants=[
            GDParticipantPublic(
                participant_id=p.participant_id,
                display_name=p.display_name,
                is_ready=p.is_ready,
                is_currently_speaking=p.participant_id in speaking_map,
                speech_count=p.speech_count,
                total_speak_seconds=p.total_speak_seconds,
            )
            for p in room.participants
        ],
        active_speakers=active,
        prep_deadline=room.prep_deadline,
        discussion_deadline=room.discussion_deadline,
        auto_start_deadline=room.auto_start_deadline,
        scoring_started_at=room.scoring_started_at,
        total_speeches=len(room.speeches),
    )


# ---------------------------------------------------------------------------
# Persisted models
# ---------------------------------------------------------------------------

class GDSpeechRecord(BaseModel):
    """Persisted speech record."""
    speech_id: str
    session_id: str
    participant_id: str
    display_name: str
    started_at: float
    ended_at: float
    duration_seconds: float
    audio_ref: Optional[str] = None
    transcript: Optional[str] = None
    analysis_id: Optional[str] = None
    pronunciation_score: Optional[float] = None
    fluency_score: Optional[float] = None
    content_score: Optional[float] = None  # 0-30
    content_feedback: Optional[str] = None
    is_interruption: bool = False


class GDParticipantScore(BaseModel):
    """Per-participant final score."""
    participant_id: str
    display_name: str
    total_score: float  # 0-100
    content_quality: float  # 0-30
    communication: float  # 0-20
    participation: float  # 0-20
    listening: float  # 0-15
    leadership: float  # 0-15
    speech_count: int
    total_speak_seconds: float
    interruption_count: int
    was_interrupted_count: int
    feedback: Optional[str] = None
    rank: int = 0


class GDSessionRecord(BaseModel):
    """Complete GD session record."""
    session_id: str
    code: str
    topic_id: str
    topic_title: str
    topic_text: str
    participants: list[dict]  # Snapshots
    speech_ids: list[str]
    scores: list[GDParticipantScore]
    created_at: float
    completed_at: float


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class CreateGDRoomResponse(BaseModel):
    room_code: str
    participant_id: str
    state: PublicGDRoom


class JoinGDRoomResponse(BaseModel):
    room_code: str
    participant_id: str
    state: PublicGDRoom


class ReadyGDResponse(BaseModel):
    state: PublicGDRoom


class StartSpeechRequest(BaseModel):
    """Client notifies backend they started speaking (no audio yet)."""
    pass


class StartSpeechResponse(BaseModel):
    speech_id: str
    started_at: float
    is_interruption: bool
    concurrent_speakers: list[str]  # Who else is speaking


class EndSpeechResponse(BaseModel):
    speech_id: str
    duration_seconds: float
    audio_uploaded: bool
    state: PublicGDRoom


class EndDiscussionResponse(BaseModel):
    state: PublicGDRoom
    total_speeches: int


class GDResultsResponse(BaseModel):
    session_id: str
    code: str
    topic: GDTopicPublic
    scores: list[GDParticipantScore]
    total_speeches: int
    duration_seconds: float
