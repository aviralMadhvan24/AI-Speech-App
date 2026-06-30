from datetime import datetime
from typing import List
from typing import Optional

from pydantic import BaseModel
from pydantic import Field


class AttemptSummary(BaseModel):

    analysis_id: str

    created_at: str

    expected_text: Optional[str] = None

    transcript: str

    language: str = "en"

    duration_seconds: Optional[float] = None

    pronunciation_provider: Optional[str] = None

    pronunciation_available: bool = False

    pronunciation_score: Optional[float] = None

    clarity_score: Optional[float] = None

    pace_wpm: Optional[float] = None

    mistakes_count: int = 0


class AttemptListResponse(BaseModel):

    attempts: List[AttemptSummary] = Field(default_factory=list)

    total: int = 0


def build_attempt_summary(
    analysis_id: str,
    response_data: dict
) -> AttemptSummary:
    pronunciation = response_data.get("pronunciation") or {}
    audio = response_data.get("audio") or {}
    fluency = response_data.get("fluency") or {}
    transcription = response_data.get("transcription") or {}
    debug = response_data.get("debug") or {}

    transcript_value = (
        transcription.get("text")
        or transcription.get("normalized_text")
        or ""
    )
    transcript_mistakes = debug.get("transcript_mistakes") or []

    return AttemptSummary(
        analysis_id=analysis_id,
        created_at=datetime.utcnow().isoformat() + "Z",
        expected_text=debug.get("expected_text"),
        transcript=transcript_value,
        language=transcription.get("language", "en"),
        duration_seconds=audio.get("duration_seconds"),
        pronunciation_provider=pronunciation.get("provider"),
        pronunciation_available=bool(pronunciation.get("available")),
        pronunciation_score=pronunciation.get("overall_score"),
        clarity_score=fluency.get("clarity_score"),
        pace_wpm=fluency.get("words_per_minute"),
        mistakes_count=len(transcript_mistakes),
    )
