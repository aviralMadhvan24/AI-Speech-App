from pydantic import BaseModel
from pydantic import Field
from typing import List
from typing import Optional


class WordTimestamp(BaseModel):

    word: str

    start: float

    end: float

    probability: float


class PronunciationMistake(BaseModel):

    expected_word: str

    heard_word: Optional[str] = None

    feedback: str


class AnalyzeResponse(BaseModel):

    transcript: str

    expected_text: Optional[str] = None

    language: str

    processed_audio_path: str

    words: List[WordTimestamp]

    pronunciation_score: Optional[float] = None

    clarity_score: float

    pace_wpm: float

    mistakes: List[PronunciationMistake] = Field(default_factory=list)
