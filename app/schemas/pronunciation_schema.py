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


class PhonemeTiming(BaseModel):

    phoneme: str

    start: float

    end: float


class ExpectedWordPhonemes(BaseModel):

    word: str

    phonemes: List[str] = Field(default_factory=list)


class WordPronunciationScore(BaseModel):

    word: str

    heard_word: Optional[str] = None

    score: float

    word_match_score: float

    confidence_score: float

    phoneme_score: Optional[float] = None

    expected_phonemes: List[str] = Field(default_factory=list)

    heard_phonemes: List[str] = Field(default_factory=list)

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

    expected_phonemes: List[ExpectedWordPhonemes] = Field(default_factory=list)

    phoneme_timeline: List[PhonemeTiming] = Field(default_factory=list)

    word_scores: List[WordPronunciationScore] = Field(default_factory=list)

    mfa_available: bool = False

    mfa_error: Optional[str] = None
