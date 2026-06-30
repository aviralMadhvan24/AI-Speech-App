"""
HuggingFace phoneme recognition provider.

Uses a Wav2Vec2-based phoneme recognizer (default
`facebook/wav2vec2-lv-60-espeak-cv-ft`) to extract observed phonemes
directly from audio. Compared against expected phonemes from CMU dict
(via app.pronunciation.phoneme_service).

Both sides are normalized to ARPAbet using
`app.pronunciation.phoneme_normalize` before scoring with
Levenshtein-based similarity.

Notes:
- Model is loaded once per process (module-level cache).
- First call downloads the model (~370MB) and may take a minute.
- CPU inference: a few seconds per audio clip.
- Per-word alignment is naive (proportional split by expected phoneme
  counts). Good enough to flag clearly wrong words; not research-grade.
"""

from __future__ import annotations

import logging
from typing import List, Optional, Tuple

import librosa

from app.core.config import settings
from app.pronunciation.phoneme_normalize import (
    align_sequences,
    edit_distance_similarity,
    ipa_text_to_arpabet,
    normalize_arpabet,
)
from app.pronunciation.phoneme_service import get_expected_word_phonemes
from app.schemas.pronunciation_schema import (
    PhonemeError,
    PronunciationResult,
    WordPronunciationResult,
)


logger = logging.getLogger(__name__)


try:
    from transformers import AutoModelForCTC, AutoProcessor
    import torch
    HF_AVAILABLE = True
except Exception as exc:
    logger.warning("transformers/torch not available: %s", exc)
    HF_AVAILABLE = False


# Module-level model cache so we load weights once per process.
_MODEL_CACHE: dict = {}


def _load_model(model_name: str):
    if model_name in _MODEL_CACHE:
        return _MODEL_CACHE[model_name]

    logger.info("Loading HF phoneme model: %s", model_name)

    # do_phonemize=False asks the tokenizer to skip espeak/phonemizer backend
    # initialization. We only decode model output, we never re-phonemize text,
    # so this lets us run on systems without espeak-ng / phonemizer installed.
    try:
        processor = AutoProcessor.from_pretrained(model_name, do_phonemize=False)
    except TypeError:
        # Older/newer transformers versions may not accept do_phonemize on
        # AutoProcessor — fall back to plain load.
        processor = AutoProcessor.from_pretrained(model_name)

    model = AutoModelForCTC.from_pretrained(model_name)
    model.eval()

    _MODEL_CACHE[model_name] = (processor, model)
    logger.info("HF phoneme model loaded")
    return processor, model


def _transcribe_phonemes(audio_path: str, model_name: str) -> str:
    processor, model = _load_model(model_name)

    audio, sample_rate = librosa.load(audio_path, sr=16000)
    inputs = processor(audio, sampling_rate=sample_rate, return_tensors="pt", padding=True)

    with torch.no_grad():
        logits = model(inputs.input_values).logits

    predicted_ids = torch.argmax(logits, dim=-1)
    decoded = processor.batch_decode(predicted_ids)
    return decoded[0] if decoded else ""


def _split_observed_per_word(
    observed_arpabet: List[str],
    expected_per_word: List[List[str]],
) -> List[List[str]]:
    """
    Assign observed phonemes to expected words using Needleman-Wunsch
    sequence alignment. This correctly handles insertions and deletions
    (e.g., if the model misses one phoneme or hears an extra one, words
    do not shift in a domino effect).

    For each expected phoneme, alignment tells us which observed phoneme
    (if any) it maps to. We group observed phonemes by the word that owns
    the aligned expected phoneme. "Insertion" observed phonemes (extra
    sounds not matching any expected) are attached to the previous
    word, or to the first word if they precede everything.
    """

    if not expected_per_word:
        return []

    expected_flat: List[str] = []
    expected_word_index: List[int] = []
    for word_index, word in enumerate(expected_per_word):
        for phoneme in word:
            expected_flat.append(phoneme)
            expected_word_index.append(word_index)

    if not expected_flat:
        return [[] for _ in expected_per_word]

    if not observed_arpabet:
        return [[] for _ in expected_per_word]

    alignment = align_sequences(expected_flat, observed_arpabet)

    out: List[List[str]] = [[] for _ in expected_per_word]
    last_word_index = 0

    for expected_idx, observed_idx in alignment:
        if expected_idx is not None and observed_idx is not None:
            word_index = expected_word_index[expected_idx]
            out[word_index].append(observed_arpabet[observed_idx])
            last_word_index = word_index
        elif expected_idx is not None and observed_idx is None:
            # Phoneme missed by the model. Nothing to add to observed.
            last_word_index = expected_word_index[expected_idx]
        elif expected_idx is None and observed_idx is not None:
            # Extra phoneme heard. Attach to the current word in scope.
            out[last_word_index].append(observed_arpabet[observed_idx])

    return out


def _weighted_word_similarity(expected: List[str], observed: List[str]) -> float:
    """
    Per-word similarity that penalizes deletions and substitutions
    more than insertions. Insertions are common when the alignment
    pulls extra "between-word" sounds into a word, and they should
    not punish a correctly spoken word as harshly as a missing
    phoneme.

    Insertion cost = 0.5, deletion = 1.0, substitution = 1.0.
    Result is in [0, 1].
    """

    if not expected and not observed:
        return 1.0
    if not expected:
        return 0.0

    rows = len(expected) + 1
    cols = len(observed) + 1
    distance = [[0.0] * cols for _ in range(rows)]
    for row in range(rows):
        distance[row][0] = float(row)  # deletions: 1.0 each
    for col in range(cols):
        distance[0][col] = col * 0.5  # insertions: 0.5 each

    for row in range(1, rows):
        for col in range(1, cols):
            cost = 0.0 if expected[row - 1] == observed[col - 1] else 1.0
            distance[row][col] = min(
                distance[row - 1][col] + 1.0,      # deletion
                distance[row][col - 1] + 0.5,      # insertion
                distance[row - 1][col - 1] + cost, # match or sub
            )

    return max(0.0, 1.0 - distance[-1][-1] / len(expected))


def _score_word(
    expected: List[str], observed: List[str]
) -> Tuple[Optional[float], List[PhonemeError], str]:
    if not expected:
        return None, [], "No expected phonemes available for this word."

    similarity = _weighted_word_similarity(expected, observed)
    score = round(similarity * 100, 2)

    errors: List[PhonemeError] = []
    if score < 70 and observed:
        errors.append(
            PhonemeError(
                type="phoneme_mismatch",
                word=None,
                expected=" ".join(expected),
                observed=" ".join(observed),
                message=(
                    f"Expected sounds {expected} but heard {observed}."
                ),
            )
        )

    if score >= 85:
        feedback = "Good pronunciation."
    elif score >= 70:
        feedback = "Understandable. Practice for clarity."
    elif score >= 40:
        feedback = "Several sounds unclear. Slow down and repeat."
    else:
        feedback = "Sounds very different from the expected word."

    return score, errors, feedback


class HFPhonemePronunciationProvider:

    provider_name = "hf_phoneme"

    def assess(
        self,
        audio_path: str,
        expected_text: Optional[str],
        transcription=None,
    ) -> PronunciationResult:

        if not expected_text:
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message="Expected text is required for phoneme-based assessment.",
            )

        model_name = getattr(settings, "HF_PHONEME_MODEL_NAME", None)

        if not HF_AVAILABLE:
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message=(
                    "transformers or torch could not be imported. "
                    "Install them and retry."
                ),
            )

        if not model_name:
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message=(
                    "HF_PHONEME_MODEL_NAME is not set. "
                    "Set it in .env (e.g., facebook/wav2vec2-lv-60-espeak-cv-ft)."
                ),
            )

        try:
            observed_ipa = _transcribe_phonemes(audio_path, model_name)
        except Exception as exc:
            logger.exception("HF phoneme inference failed")
            return PronunciationResult(
                available=False,
                provider=self.provider_name,
                overall_score=None,
                words=[],
                phoneme_errors=[],
                message=f"Phoneme inference failed: {exc}",
            )

        observed_arpabet = ipa_text_to_arpabet(observed_ipa)

        expected_per_word_raw = get_expected_word_phonemes(expected_text)
        expected_per_word = [
            {
                "word": item["word"],
                "phonemes": normalize_arpabet(item["phonemes"]),
            }
            for item in expected_per_word_raw
        ]

        observed_per_word = _split_observed_per_word(
            observed_arpabet=observed_arpabet,
            expected_per_word=[w["phonemes"] for w in expected_per_word],
        )

        word_results: List[WordPronunciationResult] = []
        phoneme_errors: List[PhonemeError] = []
        scored_values: List[float] = []

        for index, word_data in enumerate(expected_per_word):
            obs = observed_per_word[index] if index < len(observed_per_word) else []
            score, errors, feedback = _score_word(
                expected=word_data["phonemes"], observed=obs
            )

            for error in errors:
                error.word = word_data["word"]
                phoneme_errors.append(error)

            word_results.append(
                WordPronunciationResult(
                    word=word_data["word"],
                    score=score,
                    expected_phonemes=word_data["phonemes"],
                    observed_phonemes=obs,
                    errors=errors,
                    feedback=feedback,
                )
            )

            if score is not None:
                scored_values.append(score)

        expected_flat: List[str] = []
        for word_data in expected_per_word:
            expected_flat.extend(word_data["phonemes"])

        overall_similarity = edit_distance_similarity(expected_flat, observed_arpabet)
        overall_score = round(overall_similarity * 100, 2) if expected_flat else None

        return PronunciationResult(
            available=True,
            provider=self.provider_name,
            overall_score=overall_score,
            words=word_results,
            phoneme_errors=phoneme_errors,
            message=(
                "HuggingFace phoneme provider. Acoustic phonemes compared "
                "against CMU dict expected phonemes via Levenshtein similarity. "
                "Per-word alignment is approximate."
            ),
            raw={
                "model": model_name,
                "observed_ipa": observed_ipa,
                "observed_arpabet": observed_arpabet,
                "expected_flat_arpabet": expected_flat,
            },
        )
