from difflib import SequenceMatcher

from app.pronunciation.transcript_cleaner import normalize_transcript


SPECIAL_FEEDBACK = {
    "subtle": "The word 'subtle' is often pronounced like 'suh-tl'; the b is silent."
}


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
