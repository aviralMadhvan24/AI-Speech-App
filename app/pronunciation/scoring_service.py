from difflib import SequenceMatcher

from app.pronunciation.transcript_cleaner import normalize_transcript


SPECIAL_FEEDBACK = {
    "subtle": "The word 'subtle' is often pronounced like 'suh-tl'; the b is silent.",
    "debt": "The b is silent in 'debt'. Say it like 'det'.",
    "doubt": "The b is silent in 'doubt'. Say it like 'dowt'.",
    "receipt": "The p is silent in 'receipt'. Keep the middle sound clean.",
    "island": "The s is silent in 'island'. Say it like 'eye-land'.",
    "honest": "The h is silent in 'honest'. Start with the vowel sound.",
    "hour": "The h is silent in 'hour'. Start with the vowel sound.",
    "could": "The l is silent in 'could'.",
    "would": "The l is silent in 'would'.",
    "should": "The l is silent in 'should'."
}

MIN_PHONEME_DURATION_SECONDS = 0.04

SHORT_DURATION_PHONEME_PENALTY = 25

PHONEME_TIMING_SCORE_CAP = 70

VOWEL_PHONEMES = {
    "AA",
    "AE",
    "AH",
    "AO",
    "AW",
    "AY",
    "EH",
    "ER",
    "EY",
    "IH",
    "IY",
    "OW",
    "OY",
    "UH",
    "UW"
}


def calculate_phoneme_score(expected_phonemes, heard_phonemes):
    if not expected_phonemes:
        return None

    matcher = SequenceMatcher(
        None,
        expected_phonemes,
        heard_phonemes
    )

    matched = sum(
        block.size
        for block in matcher.get_matching_blocks()
    )

    score = (matched / len(expected_phonemes)) * 100

    return round(score, 2)


def find_short_phonemes(phoneme_timings):
    short_phonemes = []

    for phoneme_timing in phoneme_timings:
        phoneme = phoneme_timing["phoneme"]

        if phoneme in VOWEL_PHONEMES:
            continue

        if phoneme_timing["duration"] < MIN_PHONEME_DURATION_SECONDS:
            short_phonemes.append(phoneme)

    return short_phonemes


def apply_phoneme_timing_penalty(phoneme_score, short_phonemes):
    if phoneme_score is None:
        return None

    penalty = len(short_phonemes) * SHORT_DURATION_PHONEME_PENALTY

    return max(
        0,
        round(phoneme_score - penalty, 2)
    )






def calculate_clarity_score(words):
    if not words:
        return 0

    average_probability = sum(
        word.probability for word in words
    ) / len(words)

    return round(average_probability * 100, 2)


def calculate_pace_wpm(words):
    if not words:
        return 0

    start = min(word.start for word in words)
    end = max(word.end for word in words)
    duration_minutes = (end - start) / 60

    if duration_minutes <= 0:
        return 0

    return round(len(words) / duration_minutes, 2)


def build_feedback(expected_word, heard_word):
    special_feedback = SPECIAL_FEEDBACK.get(expected_word)

    if special_feedback:
        return special_feedback

    if heard_word:
        return (
            f"Expected '{expected_word}', but heard '{heard_word}'. "
            "Practice this word slowly and clearly."
        )

    return f"The word '{expected_word}' was missing or unclear."


def compare_expected_to_transcript(expected_text, transcript):
    expected_words = normalize_transcript(expected_text).split()
    heard_words = normalize_transcript(transcript).split()

    if not expected_words:
        return None, []

    matcher = SequenceMatcher(
        None,
        expected_words,
        heard_words
    )

    mistakes = []
    matched_words = 0

    for tag, expected_start, expected_end, heard_start, heard_end in matcher.get_opcodes():
        expected_chunk = expected_words[expected_start:expected_end]
        heard_chunk = heard_words[heard_start:heard_end]

        if tag == "equal":
            matched_words += len(expected_chunk)
            continue

        chunk_size = max(
            len(expected_chunk),
            len(heard_chunk)
        )

        for index in range(chunk_size):
            expected_word = (
                expected_chunk[index]
                if index < len(expected_chunk)
                else ""
            )
            heard_word = (
                heard_chunk[index]
                if index < len(heard_chunk)
                else ""
            )

            if not expected_word:
                continue

            mistakes.append({
                "expected_word": expected_word,
                "heard_word": heard_word or None,
                "feedback": build_feedback(
                    expected_word,
                    heard_word
                )
            })

    score = round(
        (matched_words / len(expected_words)) * 100,
        2
    )

    return score, mistakes



def get_heard_word_for_expected(expected_word, heard_words):

    normalized_expected = normalize_transcript(expected_word)

    best_match = None
    best_score = 0

    for heard_word in heard_words:

        score = SequenceMatcher(
            None,
            normalized_expected,
            heard_word
        ).ratio()

        if score > best_score:
            best_score = score
            best_match = heard_word

    return best_match


def find_word_probability(expected_word, words):
    normalized_expected = normalize_transcript(expected_word)

    for word in words:
        if normalize_transcript(word.word) == normalized_expected:
            return word.probability

    return 0


def build_word_scores(
    expected_text,
    transcript,
    words,
    phoneme_words,
    word_phoneme_data,
    mfa_available
):
    heard_words = normalize_transcript(
        transcript
    ).split()

    word_scores = []

    for phoneme_word in phoneme_words:

        expected_word = phoneme_word["word"]

        heard_word = get_heard_word_for_expected(
            expected_word,
            heard_words
        )

        word_probability = find_word_probability(
            expected_word,
            words
        )

        similarity = SequenceMatcher(
            None,
            expected_word,
            heard_word or ""
        ).ratio()

        word_match_score = round(
            similarity * 100,
            2
        )

        word_matches = similarity >= 0.8

        confidence_score = round(
            word_probability * 100,
            2
        )

        phoneme_score = None
        short_phonemes = []

        if (
            mfa_available
            and phoneme_word["phonemes"]
        ):

            heard_phonemes = []

            for aligned_word in word_phoneme_data:

                if (
                    normalize_transcript(
                        aligned_word["word"]
                    )
                    ==
                    normalize_transcript(
                        expected_word
                    )
                ):

                    heard_phonemes = (
                        aligned_word["phonemes"]
                    )
                    short_phonemes = find_short_phonemes(
                        aligned_word.get(
                            "phoneme_timings",
                            []
                        )
                    )

                    break

            if heard_phonemes:

                phoneme_score = (
                    calculate_phoneme_score(
                        phoneme_word["phonemes"],
                        heard_phonemes
                    )
                )
                phoneme_score = apply_phoneme_timing_penalty(
                    phoneme_score,
                    short_phonemes
                )

        if phoneme_score is None:

            score = round(
                (
                    word_match_score * 0.7
                ) +
                (
                    confidence_score * 0.3
                ),
                2
            )

        else:

            score = round(
                (
                    word_match_score * 0.45
                ) +
                (
                    confidence_score * 0.25
                ) +
                (
                    phoneme_score * 0.30
                ),
                2
            )

            if short_phonemes:
                score = min(
                    score,
                    PHONEME_TIMING_SCORE_CAP
                )

        feedback = "Good match."

        if not word_matches:

            feedback = build_feedback(
                expected_word,
                heard_word
            )

        elif expected_word in SPECIAL_FEEDBACK:

            feedback = SPECIAL_FEEDBACK[
                expected_word
            ]

        elif short_phonemes:

            feedback = (
                "Word matched in the transcript, but the sound "
                f"{', '.join(short_phonemes)} was too short or unclear."
            )

        elif not mfa_available:

            feedback = (
                "Word matched. "
                "Phoneme alignment is not available yet."
            )

        word_scores.append({
            "word": expected_word,
            "heard_word": heard_word,
            "score": score,
            "word_match_score": word_match_score,
            "confidence_score": confidence_score,
            "phoneme_score": phoneme_score,
            "expected_phonemes": phoneme_word["phonemes"],
            "heard_phonemes": heard_phonemes if phoneme_score is not None else [],
            "feedback": feedback
        })

    return word_scores


def calculate_pronunciation_score(word_match_score, word_scores):
    if not word_scores:
        return word_match_score

    return round(
        sum(word_score["score"] for word_score in word_scores) / len(word_scores),
        2
    )
