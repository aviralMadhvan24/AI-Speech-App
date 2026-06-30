from difflib import SequenceMatcher

from app.asr.schemas import TranscriptionResult
from app.pronunciation.phoneme_service import get_expected_word_phonemes
from app.pronunciation.transcript_cleaner import normalize_transcript
from app.schemas.pronunciation_schema import PhonemeError
from app.schemas.pronunciation_schema import PronunciationResult
from app.schemas.pronunciation_schema import WordPronunciationResult


COMMON_VARIANTS = {
    ("design", "degien"): (
        "substitution",
        "Z / AY",
        "JH / IY",
        "The /z/ and long /ai/ sounds in 'design' were not clear."
    ),
    ("specific", "pacific"): (
        "omission",
        "S",
        None,
        "The starting /s/ sound in 'specific' appears to be missing."
    ),
    ("thought", "taught"): (
        "substitution",
        "TH",
        "T",
        "Use the tongue-between-teeth /th/ sound for 'thought'."
    ),
    ("world", "word"): (
        "omission",
        "L",
        None,
        "The /l/ sound in 'world' appears to be missing."
    )
}

SILENT_LETTER_FEEDBACK = {
    "subtle": "The b in 'subtle' is silent. Say it like 'suh-tl'.",
    "debt": "The b in 'debt' is silent. Say it like 'det'.",
    "doubt": "The b in 'doubt' is silent. Say it like 'dowt'.",
    "receipt": "The p in 'receipt' is silent.",
    "island": "The s in 'island' is silent.",
    "honest": "The h in 'honest' is silent.",
    "hour": "The h in 'hour' is silent."
}


class LocalPronunciationProvider:

    provider_name = "local"

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
                message="Expected text is required for local pronunciation assessment."
            )

        if transcription is None:
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message="ASR transcription is required for local pronunciation assessment."
            )

        expected_words = get_expected_word_phonemes(expected_text)
        heard_words = normalize_transcript(transcription.normalized_text).split()
        word_results, phoneme_errors = self._score_words(
            expected_words=expected_words,
            heard_words=heard_words
        )

        scored_words = [
            word.score
            for word in word_results
            if word.score is not None
        ]
        overall_score = (
            round(sum(scored_words) / len(scored_words), 2)
            if scored_words
            else None
        )

        return PronunciationResult(
            available=True,
            provider=self.provider_name,
            overall_score=overall_score,
            words=word_results,
            phoneme_errors=phoneme_errors,
            message=(
                "Local free assessment uses Whisper transcript matching, "
                "dictionary phonemes, and known-error rules. It is not a "
                "full acoustic pronunciation model."
            ),
            raw={
                "audio_path": audio_path,
                "heard_text": transcription.normalized_text
            }
        )

    def _score_words(self, expected_words, heard_words):
        expected_tokens = [
            item["word"]
            for item in expected_words
        ]
        matcher = SequenceMatcher(
            None,
            expected_tokens,
            heard_words
        )

        results = []
        phoneme_errors = []

        for tag, expected_start, expected_end, heard_start, heard_end in matcher.get_opcodes():
            expected_chunk = expected_words[expected_start:expected_end]
            heard_chunk = heard_words[heard_start:heard_end]

            if tag == "equal":
                for item in expected_chunk:
                    results.append(
                        self._build_word_result(
                            item=item,
                            heard_word=item["word"],
                            score=self._score_exact_match(item["word"]),
                            feedback=self._feedback_for_match(item["word"])
                        )
                    )
                continue

            chunk_size = max(
                len(expected_chunk),
                len(heard_chunk)
            )

            for index in range(chunk_size):
                if index >= len(expected_chunk):
                    continue

                item = expected_chunk[index]
                heard_word = (
                    heard_chunk[index]
                    if index < len(heard_chunk)
                    else None
                )
                score, errors, feedback = self._score_mismatch(
                    expected_word=item["word"],
                    heard_word=heard_word
                )
                phoneme_errors.extend(errors)
                results.append(
                    self._build_word_result(
                        item=item,
                        heard_word=heard_word,
                        score=score,
                        feedback=feedback,
                        errors=errors
                    )
                )

        return results, phoneme_errors

    def _build_word_result(
        self,
        item,
        heard_word,
        score,
        feedback,
        errors=None
    ):
        return WordPronunciationResult(
            word=item["word"],
            score=score,
            expected_phonemes=item["phonemes"],
            observed_phonemes=[],
            errors=errors or [],
            feedback=(
                f"Heard as '{heard_word}'. {feedback}"
                if heard_word and heard_word != item["word"]
                else feedback
            )
        )

    def _score_exact_match(self, word):
        if word in SILENT_LETTER_FEEDBACK:
            return 88

        return 95

    def _feedback_for_match(self, word):
        if word in SILENT_LETTER_FEEDBACK:
            return (
                "Transcript matched. "
                f"{SILENT_LETTER_FEEDBACK[word]}"
            )

        return "Transcript matched the expected word."

    def _score_mismatch(self, expected_word, heard_word):
        if not heard_word:
            error = PhonemeError(
                type="omission",
                word=expected_word,
                expected=expected_word,
                observed=None,
                message=f"The word '{expected_word}' was missing or unclear."
            )
            return 20, [error], error.message

        known_error = COMMON_VARIANTS.get(
            (
                expected_word,
                heard_word
            )
        )

        if known_error:
            error_type, expected, observed, message = known_error
            error = PhonemeError(
                type=error_type,
                word=expected_word,
                expected=expected,
                observed=observed,
                message=message
            )
            return 35, [error], message

        similarity = SequenceMatcher(
            None,
            expected_word,
            heard_word
        ).ratio()
        score = round(
            max(25, similarity * 70),
            2
        )
        error = PhonemeError(
            type="word_mismatch",
            word=expected_word,
            expected=expected_word,
            observed=heard_word,
            message=(
                f"Expected '{expected_word}', but the transcript heard "
                f"'{heard_word}'. Practice this word slowly."
            )
        )

        return score, [error], error.message
