from pydantic import BaseModel
from typing import Optional


class FluencyResult(BaseModel):

    words_per_minute: float = 0

    speech_duration_seconds: float = 0

    total_duration_seconds: float = 0

    silence_ratio: Optional[float] = None

    long_pause_count: int = 0

    filler_word_count: int = 0

    repetition_count: int = 0

    clarity_score: float = 0
