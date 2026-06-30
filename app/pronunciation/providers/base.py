from typing import Protocol

from app.asr.schemas import TranscriptionResult
from app.schemas.pronunciation_schema import PronunciationResult


class PronunciationProvider(Protocol):

    provider_name: str

    def assess(
        self,
        audio_path: str,
        expected_text: str | None,
        transcription: TranscriptionResult | None = None
    ) -> PronunciationResult:
        ...
