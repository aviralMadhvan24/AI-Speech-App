from app.asr.schemas import TranscriptionResult
from app.pronunciation.providers.local_acoustic import LocalAcousticPronunciationProvider
from app.pronunciation.providers.local import LocalPronunciationProvider
from app.pronunciation.providers.mock import MockPronunciationProvider
from app.pronunciation.providers.unavailable import UnavailablePronunciationProvider


def test_unavailable_provider_does_not_score_pronunciation():
    result = UnavailablePronunciationProvider().assess(
        audio_path="temp/sample.wav",
        expected_text="The design is subtle"
    )

    assert result.available is False
    assert result.provider is None
    assert result.overall_score is None
    assert result.words == []
    assert "Transcript matching is not used" in result.message


def test_mock_provider_returns_expected_word_contract_without_score():
    result = MockPronunciationProvider().assess(
        audio_path="temp/sample.wav",
        expected_text="The design is subtle"
    )

    assert result.available is True
    assert result.provider == "mock"
    assert result.overall_score is None
    assert [word.word for word in result.words] == [
        "the",
        "design",
        "is",
        "subtle"
    ]
    assert result.words[1].expected_phonemes
    assert result.words[1].observed_phonemes == []


def test_local_provider_scores_matching_transcript():
    result = LocalPronunciationProvider().assess(
        audio_path="temp/sample.wav",
        expected_text="The design is subtle",
        transcription=TranscriptionResult(
            text="The design is subtle",
            normalized_text="the design is subtle",
            provider="whisper",
            model="small"
        )
    )

    assert result.available is True
    assert result.provider == "local"
    assert result.overall_score > 80
    assert [word.word for word in result.words] == [
        "the",
        "design",
        "is",
        "subtle"
    ]


def test_local_provider_flags_known_variant():
    result = LocalPronunciationProvider().assess(
        audio_path="temp/sample.wav",
        expected_text="The design is subtle",
        transcription=TranscriptionResult(
            text="The degien is subtle",
            normalized_text="the degien is subtle",
            provider="whisper",
            model="small"
        )
    )

    design = result.words[1]

    assert result.overall_score < 85
    assert design.word == "design"
    assert design.score == 35
    assert design.errors[0].type == "substitution"
    assert "design" in design.feedback


def test_local_acoustic_provider_fails_cleanly_without_model_dir(monkeypatch):
    class MissingModelDir:
        def exists(self):
            return False

        def as_posix(self):
            return "models/pronunciation"

    monkeypatch.setattr(
        "app.pronunciation.providers.local_acoustic.MODEL_DIR",
        MissingModelDir()
    )

    result = LocalAcousticPronunciationProvider().assess(
        audio_path="temp/sample.wav",
        expected_text="The design is subtle",
        transcription=TranscriptionResult(
            text="The design is subtle",
            normalized_text="the design is subtle",
            provider="whisper",
            model="small"
        )
    )

    assert result.available is False
    assert result.provider == "local_acoustic"
    assert "not installed" in result.message


def test_local_acoustic_provider_maps_gopt_prediction(monkeypatch):
    class ExistingModelDir:
        def exists(self):
            return True

    class FakePrediction:
        utterance_scores = {
            "accuracy": 82,
            "completeness": 80,
            "fluency": 78,
            "prosody": 76,
            "total": 81
        }
        phone_scores = [88, 72]
        word_scores = [90, 65, 82, 58]

    class FakeGoptAdapter:
        def predict(self, analysis_id):
            assert analysis_id == "processed_sample"
            return FakePrediction()

    monkeypatch.setattr(
        "app.pronunciation.providers.local_acoustic.MODEL_DIR",
        ExistingModelDir()
    )
    monkeypatch.setattr(
        "app.pronunciation.providers.local_acoustic.GoptAdapter",
        FakeGoptAdapter
    )

    result = LocalAcousticPronunciationProvider().assess(
        audio_path="temp/processed_sample.wav",
        expected_text="The design is subtle",
        transcription=TranscriptionResult(
            text="The design is subtle",
            normalized_text="the design is subtle",
            provider="whisper",
            model="small"
        )
    )

    assert result.available is True
    assert result.provider == "local_acoustic"
    assert result.overall_score == 81
    assert result.words[0].score == 90
    assert result.words[1].score == 65
    assert result.raw["phone_scores"] == [88, 72]
