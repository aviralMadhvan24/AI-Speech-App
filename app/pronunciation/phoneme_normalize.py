"""
Phoneme normalization between IPA (espeak/HuggingFace output) and ARPAbet (CMU dict output).

HuggingFace phoneme models like `facebook/wav2vec2-lv-60-espeak-cv-ft` output
IPA tokens with stress markers and language artifacts. CMU dict gives ARPAbet.

To compare them we normalize both to ARPAbet. Mapping is intentionally
conservative: ambiguous IPA symbols map to the closest ARPAbet equivalent.

This is not perfect for scoring research, but is good enough for catching
clearly wrong pronunciations like `design -> degien`, `world -> word`, etc.
"""

from __future__ import annotations

import re
from typing import Iterable, List


# IPA -> ARPAbet mapping.
# Multi-character IPA sequences must be listed before their single-char prefixes.
IPA_TO_ARPABET_RAW = [
    # Affricates (must come before single-char prefixes t, d)
    ("tʃ", "CH"),
    ("dʒ", "JH"),
    ("ts", "T S"),
    ("dz", "D Z"),
    # Diphthongs and long vowels (multi-char first)
    ("aɪ", "AY"),
    ("eɪ", "EY"),
    ("ɔɪ", "OY"),
    ("aʊ", "AW"),
    ("oʊ", "OW"),
    ("əʊ", "OW"),
    ("iː", "IY"),
    ("uː", "UW"),
    ("ɔː", "AO"),
    ("ɑː", "AA"),
    ("ɜː", "ER"),
    ("ɝ", "ER"),
    ("ɚ", "ER"),
    # Consonants
    ("ʃ", "SH"),
    ("ʒ", "ZH"),
    ("θ", "TH"),
    ("ð", "DH"),
    ("ŋ", "NG"),
    ("ɹ", "R"),
    ("ɾ", "T"),  # alveolar tap, often heard as T in American English
    ("ʔ", "T"),  # glottal stop, often replaces T
    ("p", "P"),
    ("b", "B"),
    ("t", "T"),
    ("d", "D"),
    ("k", "K"),
    ("g", "G"),
    ("ɡ", "G"),
    ("f", "F"),
    ("v", "V"),
    ("s", "S"),
    ("z", "Z"),
    ("h", "HH"),
    ("m", "M"),
    ("n", "N"),
    ("l", "L"),
    ("r", "R"),
    ("j", "Y"),
    ("w", "W"),
    # Vowels (single-char)
    ("i", "IY"),
    ("ɪ", "IH"),
    ("e", "EH"),
    ("ɛ", "EH"),
    ("æ", "AE"),
    ("a", "AA"),
    ("ɑ", "AA"),
    ("ɒ", "AA"),
    ("ɔ", "AO"),
    ("o", "OW"),
    ("ʊ", "UH"),
    ("u", "UW"),
    ("ʌ", "AH"),
    ("ə", "AH"),
    ("ɐ", "AH"),
    ("ɨ", "IH"),
    ("ʉ", "UW"),
    ("y", "IY"),
]


# Characters to strip before mapping: stress markers, length marks, etc.
STRIP_CHARS = "ˈˌːˑ‿͡‖|"


def _strip_stress_and_markers(token: str) -> str:
    cleaned = "".join(ch for ch in token if ch not in STRIP_CHARS)
    cleaned = cleaned.strip()
    return cleaned


def ipa_token_to_arpabet(ipa_token: str) -> List[str]:
    """
    Convert a single IPA token (may be one or more IPA chars) to one or more
    ARPAbet phonemes. Unknown characters are dropped.
    """

    token = _strip_stress_and_markers(ipa_token)
    if not token:
        return []

    result: List[str] = []
    index = 0
    while index < len(token):
        matched = False
        for ipa_seq, arpa in IPA_TO_ARPABET_RAW:
            if token.startswith(ipa_seq, index):
                result.extend(arpa.split())
                index += len(ipa_seq)
                matched = True
                break

        if not matched:
            index += 1

    return result


def ipa_text_to_arpabet(ipa_text: str) -> List[str]:
    """
    Convert a full IPA decoded string (whitespace-separated tokens) into a
    flat list of ARPAbet phonemes. Word boundaries are lost — caller is
    responsible for alignment.
    """

    if not ipa_text:
        return []

    tokens = re.split(r"\s+", ipa_text.strip())
    arpa: List[str] = []
    for token in tokens:
        arpa.extend(ipa_token_to_arpabet(token))

    return arpa


def normalize_arpabet(phonemes: Iterable[str]) -> List[str]:
    """
    Normalize a sequence of ARPAbet phonemes:
    - uppercase
    - strip stress digits (CMU dict appends 0/1/2)
    - drop empties
    """

    out: List[str] = []
    for phoneme in phonemes:
        if not phoneme:
            continue
        token = "".join(ch for ch in str(phoneme).upper() if not ch.isdigit())
        if token:
            out.append(token)

    return out


def edit_distance_similarity(expected: List[str], observed: List[str]) -> float:
    """
    Levenshtein similarity in [0, 1]. 1.0 means perfect match.
    Works on phoneme lists.
    """

    if not expected and not observed:
        return 1.0
    if not expected or not observed:
        return 0.0

    rows = len(expected) + 1
    cols = len(observed) + 1
    distance = [[0] * cols for _ in range(rows)]
    for row in range(rows):
        distance[row][0] = row
    for col in range(cols):
        distance[0][col] = col

    for row in range(1, rows):
        for col in range(1, cols):
            cost = 0 if expected[row - 1] == observed[col - 1] else 1
            distance[row][col] = min(
                distance[row - 1][col] + 1,
                distance[row][col - 1] + 1,
                distance[row - 1][col - 1] + cost,
            )

    max_len = max(len(expected), len(observed))
    return 1.0 - (distance[-1][-1] / max_len)


def align_sequences(expected: List[str], observed: List[str]):
    """
    Needleman-Wunsch alignment of two phoneme sequences.

    Returns a list of (expected_index, observed_index) tuples representing
    the optimal alignment. Either index can be None for an indel:
      - (i, None): expected phoneme i was deleted (not heard)
      - (None, j): observed phoneme j was inserted (extra sound)
      - (i, j):    expected i aligned to observed j (match or substitution)

    Tuples are in left-to-right alignment order.
    """

    rows = len(expected) + 1
    cols = len(observed) + 1
    dp = [[0] * cols for _ in range(rows)]
    back = [[""] * cols for _ in range(rows)]

    for row in range(rows):
        dp[row][0] = row
        back[row][0] = "up"
    for col in range(cols):
        dp[0][col] = col
        back[0][col] = "left"
    back[0][0] = ""

    for row in range(1, rows):
        for col in range(1, cols):
            cost = 0 if expected[row - 1] == observed[col - 1] else 1
            diag = dp[row - 1][col - 1] + cost
            up = dp[row - 1][col] + 1
            left = dp[row][col - 1] + 1
            best = min(diag, up, left)
            dp[row][col] = best
            if best == diag:
                back[row][col] = "diag"
            elif best == up:
                back[row][col] = "up"
            else:
                back[row][col] = "left"

    alignment = []
    row, col = rows - 1, cols - 1
    while row > 0 or col > 0:
        direction = back[row][col]
        if direction == "diag":
            alignment.append((row - 1, col - 1))
            row -= 1
            col -= 1
        elif direction == "up":
            alignment.append((row - 1, None))
            row -= 1
        elif direction == "left":
            alignment.append((None, col - 1))
            col -= 1
        else:
            break

    alignment.reverse()
    return alignment
