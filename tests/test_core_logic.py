import unittest
from pathlib import Path

from app.pronunciation.scoring_service import compare_expected_to_transcript
from app.utils.file_utils import generate_filename


class FilenameTests(unittest.TestCase):
    def test_generate_filename_preserves_only_suffix(self):
        generated = generate_filename("../../unsafe/VOICE.WAV")

        self.assertEqual(Path(generated).suffix, ".wav")
        self.assertNotIn("unsafe", generated)

    def test_generate_filename_handles_missing_name(self):
        generated = generate_filename(None)

        self.assertEqual(Path(generated).suffix, "")


class ScoringTests(unittest.TestCase):
    def test_exact_transcript_scores_one_hundred(self):
        score, mistakes = compare_expected_to_transcript(
            "The cat sat.",
            "the cat sat"
        )

        self.assertEqual(score, 100)
        self.assertEqual(mistakes, [])

    def test_replacement_is_reported(self):
        score, mistakes = compare_expected_to_transcript(
            "the cat sat",
            "the dog sat"
        )

        self.assertEqual(score, 66.67)
        self.assertEqual(mistakes[0]["expected_word"], "cat")
        self.assertEqual(mistakes[0]["heard_word"], "dog")


if __name__ == "__main__":
    unittest.main()
