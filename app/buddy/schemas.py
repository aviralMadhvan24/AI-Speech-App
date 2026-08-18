"""Request/response models for the buddy mentorship API."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.buddy.service import SpeakerRanking
from app.storage.buddy import BuddyMessage
from app.storage.buddy import BuddyPair
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


class PairsResponse(BaseModel):
    pairs: list[BuddyPair] = Field(default_factory=list)
    total: int = 0
