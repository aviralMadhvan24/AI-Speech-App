from app.asr.schemas import TranscriptionResult
from app.schemas.pronunciation_schema import PronunciationResult


class UnavailablePronunciationProvider:

    provider_name = "unavailable"

    def assess(
        self,
        audio_path: str,
        expected_text: str | None,
        transcription: TranscriptionResult | None = None
    ) -> PronunciationResult:
        return PronunciationResult(
            available=False,
            provider=None,
            overall_score=None,
            words=[],
            phoneme_errors=[],
            message=(
                "Pronunciation assessment provider is not configured. "
                "Transcript matching is not used as pronunciation scoring."
            )
        )
