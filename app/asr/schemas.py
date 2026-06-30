from pydantic import BaseModel
from pydantic import Field
from typing import Any
from typing import List


class TranscribedWord(BaseModel):

    word: str

    start: float

    end: float

    confidence: float = 0


class TranscriptionResult(BaseModel):

    text: str

    normalized_text: str

    language: str = "en"

    provider: str

    model: str

    words: List[TranscribedWord] = Field(default_factory=list)

    segments: List[dict[str, Any]] = Field(default_factory=list)
