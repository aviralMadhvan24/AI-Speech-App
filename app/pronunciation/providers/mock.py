from app.pronunciation.phoneme_service import get_expected_word_phonemes
from app.asr.schemas import TranscriptionResult
from app.schemas.pronunciation_schema import PronunciationResult
from app.schemas.pronunciation_schema import WordPronunciationResult


class MockPronunciationProvider:

    provider_name = "mock"

    def assess(
        self,
        audio_path: str,
        expected_text: str | None,
        transcription: TranscriptionResult | None = None
    ) -> PronunciationResult:
        if not expected_text:
            return PronunciationResult(
                available=True,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message="Expected text is required for pronunciation assessment."
            )

        words = [
            WordPronunciationResult(
                word=item["word"],
                score=None,
                expected_phonemes=item["phonemes"],
                observed_phonemes=[],
                errors=[],
                feedback="Mock provider does not evaluate acoustic pronunciation."
            )
            for item in get_expected_word_phonemes(expected_text)
        ]

        return PronunciationResult(
            available=True,
            provider=self.provider_name,
            overall_score=None,
            words=words,
            phoneme_errors=[],
            message=(
                "Mock pronunciation provider is enabled for development only. "
                "It does not score pronunciation."
            ),
            raw={
                "audio_path": audio_path,
                "expected_text": expected_text
            }
        )
