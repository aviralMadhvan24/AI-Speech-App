from app.core.config import settings
from app.core.logger import logger
from app.core.logging_helpers import stage_log
from app.asr.schemas import TranscriptionResult
from app.pronunciation.providers import LocalAcousticPronunciationProvider
from app.pronunciation.providers import LocalPronunciationProvider
from app.pronunciation.providers import MockPronunciationProvider
from app.pronunciation.providers import PronunciationProvider
from app.pronunciation.providers import UnavailablePronunciationProvider
from app.schemas.pronunciation_schema import PronunciationResult


def get_pronunciation_provider() -> PronunciationProvider:
    provider_name = settings.PRONUNCIATION_PROVIDER.lower()

    if provider_name == "local":
        return LocalPronunciationProvider()

    if provider_name == "local_acoustic":
        return LocalAcousticPronunciationProvider()

    if provider_name == "hf_phoneme":
        from app.pronunciation.providers.hf_phoneme import HFPhonemePronunciationProvider

        return HFPhonemePronunciationProvider()

    if provider_name == "mock":
        return MockPronunciationProvider()

    return UnavailablePronunciationProvider()


def assess_pronunciation(
    audio_path: str,
    expected_text: str | None,
    transcription: TranscriptionResult | None = None,
    analysis_id: str | None = None,
) -> PronunciationResult:
    provider = get_pronunciation_provider()

    try:
        result = provider.assess(
            audio_path=audio_path,
            expected_text=expected_text,
            transcription=transcription,
        )
    except Exception as exc:
        logger.error(
            stage_log(
                "pronunciation_error",
                analysis_id or "",
                provider=getattr(provider, "provider_name", None),
                exc=type(exc).__name__,
            ),
            exc_info=True,
        )
        return PronunciationResult(
            available=False,
            provider=getattr(provider, "provider_name", None),
            overall_score=None,
            words=[],
            phoneme_errors=[],
            message=f"Pronunciation provider failed: {type(exc).__name__}",
        )

    if (
        getattr(provider, "provider_name", None) == "hf_phoneme"
        and not result.available
    ):
        fallback_provider = LocalPronunciationProvider()
        try:
            fallback_result = fallback_provider.assess(
                audio_path=audio_path,
                expected_text=expected_text,
                transcription=transcription,
            )
        except Exception as fallback_exc:
            logger.warning(
                "Pronunciation fallback provider %s failed: %s",
                fallback_provider.provider_name,
                fallback_exc,
                exc_info=True,
            )
        else:
            if fallback_result.available:
                logger.warning(
                    "Falling back from hf_phoneme pronunciation provider to %s",
                    fallback_provider.provider_name,
                )
                return fallback_result

    return result
