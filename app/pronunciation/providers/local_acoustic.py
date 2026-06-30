from pathlib import Path

from app.asr.schemas import TranscriptionResult
from app.pronunciation.acoustic import GoptAdapter
from app.pronunciation.acoustic import GoptNotReady
from app.pronunciation.phoneme_service import get_expected_word_phonemes
from app.schemas.pronunciation_schema import PronunciationResult
from app.schemas.pronunciation_schema import WordPronunciationResult


MODEL_DIR = Path("models/pronunciation")


class LocalAcousticPronunciationProvider:

    provider_name = "local_acoustic"

    def assess(
        self,
        audio_path: str,
        expected_text: str | None,
        transcription: TranscriptionResult | None = None
    ) -> PronunciationResult:
        if not expected_text:
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message="Expected text is required for acoustic pronunciation assessment."
            )

        if not MODEL_DIR.exists():
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message=(
                    "Local acoustic pronunciation model is not installed. "
                    "Install a free GOPT/GOP/phoneme model under "
                    f"{MODEL_DIR.as_posix()} or use PRONUNCIATION_PROVIDER=local."
                )
            )

        analysis_key = Path(audio_path).stem

        try:
            prediction = GoptAdapter().predict(
                analysis_id=analysis_key
            )
        except GoptNotReady as error:
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message=str(error)
            )

        words = self._build_word_results(
            expected_text=expected_text,
            word_scores=prediction.word_scores
        )

        return PronunciationResult(
            available=True,
            provider=self.provider_name,
            overall_score=prediction.utterance_scores["total"],
            words=words,
            phoneme_errors=[],
            message=(
                "Local acoustic assessment used GOPT/GOP features. "
                "Scores should be calibrated with local labeled recordings "
                "before production use."
            ),
            raw={
                "audio_path": audio_path,
                "analysis_key": analysis_key,
                "utterance_scores": prediction.utterance_scores,
                "phone_scores": prediction.phone_scores
            }
        )

    def _build_word_results(self, expected_text: str, word_scores: list[float]):
        expected_words = get_expected_word_phonemes(expected_text)
        results = []

        for index, item in enumerate(expected_words):
            score = (
                word_scores[index]
                if index < len(word_scores)
                else None
            )
            results.append(
                WordPronunciationResult(
                    word=item["word"],
                    score=score,
                    expected_phonemes=item["phonemes"],
                    observed_phonemes=[],
                    errors=[],
                    feedback=self._feedback_for_score(score)
                )
            )

        return results

    def _feedback_for_score(self, score: float | None):
        if score is None:
            return "No acoustic score returned for this word."

        if score >= 80:
            return "Acoustic pronunciation score is strong."

        if score >= 60:
            return "Pronunciation is understandable, but this word needs practice."

        return "Pronunciation appears weak for this word. Practice slowly."
