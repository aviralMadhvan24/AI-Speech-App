from functools import lru_cache

import cmudict

from app.pronunciation.transcript_cleaner import normalize_transcript


FALLBACK_PHONEMES = {
    "subtle": ["S", "AH", "T", "AH", "L"],
    "debt": ["D", "EH", "T"],
    "doubt": ["D", "AW", "T"],
    "receipt": ["R", "IH", "S", "IY", "T"],
    "island": ["AY", "L", "AH", "N", "D"],
    "honest": ["AA", "N", "AH", "S", "T"],
    "hour": ["AW", "ER"],
    "colonel": ["K", "ER", "N", "AH", "L"],
}


def strip_stress(phoneme: str):
    return "".join(
        character
        for character in phoneme
        if not character.isdigit()
    )


@lru_cache(maxsize=1)
def load_cmudict():

    return cmudict.dict()


def get_word_phonemes(word: str):

    normalized_word = normalize_transcript(word)

    if not normalized_word:
        return []

    dictionary = load_cmudict()

    if normalized_word in dictionary:

        pronunciation = dictionary[normalized_word][0]

        return [
            strip_stress(phoneme)
            for phoneme in pronunciation
        ]

    return FALLBACK_PHONEMES.get(
        normalized_word,
        []
    )


def get_expected_word_phonemes(expected_text: str):

    phoneme_words = []

    for word in normalize_transcript(expected_text).split():

        phonemes = get_word_phonemes(word)

        phoneme_words.append({
            "word": word,
            "phonemes": phonemes
        })

    return phoneme_words