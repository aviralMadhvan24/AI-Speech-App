from pydantic import BaseModel
from pydantic import Field
from typing import List
from typing import Optional

from app.audio.schemas import AudioAsset
from app.asr.schemas import TranscriptionResult
from app.fluency.schemas import FluencyResult


class PhonemeError(BaseModel):

    type: str

    word: Optional[str] = None

    expected: Optional[str] = None

    observed: Optional[str] = None

    message: str


class WordPronunciationResult(BaseModel):

    word: str

    score: Optional[float] = None

    expected_phonemes: List[str] = Field(default_factory=list)

    observed_phonemes: List[str] = Field(default_factory=list)

    errors: List[PhonemeError] = Field(default_factory=list)

    feedback: Optional[str] = None


class PronunciationResult(BaseModel):

    available: bool

    provider: Optional[str] = None

    overall_score: Optional[float] = None

    words: List[WordPronunciationResult] = Field(default_factory=list)

    phoneme_errors: List[PhonemeError] = Field(default_factory=list)

    message: Optional[str] = None

    raw: Optional[dict] = None


class AnalyzeResponse(BaseModel):

    analysis_id: str

    audio: AudioAsset

    transcription: TranscriptionResult

    pronunciation: PronunciationResult

    fluency: FluencyResult

    communication: dict = Field(default_factory=dict)

    debug: dict = Field(default_factory=dict)
