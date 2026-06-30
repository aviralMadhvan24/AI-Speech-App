"""Phase 1 contract tests — the new sectioned AnalyzeResponse shape."""

from app.api.analysis_routes import (
    build_debug_section,
    unavailable_communication_section,
)
from app.asr.schemas import TranscribedWord, TranscriptionResult
from app.audio.schemas import AudioAsset
from app.fluency.service import build_fluency_section
from app.pronunciation.service import assess_pronunciation
from app.schemas.pronunciation_schema import AnalyzeResponse


def _make_audio(duration_seconds: float = 5.0) -> AudioAsset:
    return AudioAsset(
        audio_id="audio-1",
        original_path="uploads/input.webm",
        processed_path="temp/output.wav",
        duration_seconds=duration_seconds,
        sample_rate=16000,
        channels=1,
        format="WAV",
    )


def _make_transcription(words=None) -> TranscriptionResult:
    return TranscriptionResult(
        text="hello world",
        normalized_text="hello world",
        provider="whisper",
        model="small",
        words=words
        or [
            TranscribedWord(word="hello", start=0.5, end=1.0, confidence=0.9),
            TranscribedWord(word="world", start=1.5, end=2.0, confidence=0.8),
        ],
    )


def test_unavailable_communication_section_returns_documented_shape():
    section = unavailable_communication_section()

    assert section["available"] is False
    assert section["provider"] is None
    assert section["overall_score"] is None
    assert section["rubric_version"] is None
    assert "Communication" in section["message"]


def test_build_debug_section_returns_empty_when_no_expected_text():
    transcription = _make_transcription()
    debug = build_debug_section(expected_text=None, transcription=transcription)

    assert debug["expected_text_provided"] is False
    assert debug["expected_text"] is None
    assert debug["transcript_match_score"] is None
    assert debug["transcript_mistakes"] == []


def test_build_debug_section_returns_plain_dicts_for_mistakes():
    transcription = TranscriptionResult(
        text="The topic is simple",
        normalized_text="the topic is simple",
        provider="whisper",
        model="small",
        words=[],
    )

    debug = build_debug_section(
        expected_text="the design is subtle",
        transcription=transcription,
    )

    assert debug["expected_text_provided"] is True
    assert debug["expected_text"] == "the design is subtle"
    assert isinstance(debug["transcript_match_score"], (int, float))
    assert debug["transcript_match_score"] < 100
    assert isinstance(debug["transcript_mistakes"], list)
    assert debug["transcript_mistakes"], "expected at least one mistake"

    first = debug["transcript_mistakes"][0]
    # Plain dict, not a pydantic model.
    assert isinstance(first, dict)
    assert {"expected_word", "heard_word", "feedback"} <= set(first.keys())


def test_build_fluency_section_computes_wpm_from_word_span():
    audio = _make_audio(duration_seconds=5.0)
    transcription = _make_transcription()

    fluency = build_fluency_section(transcription=transcription, audio_asset=audio)

    # span = end(2.0) - start(0.5) = 1.5 s; wpm = 2 / (1.5 / 60) = 80
    assert fluency.words_per_minute == 80.0
    assert fluency.speech_duration_seconds == 1.5
    assert fluency.total_duration_seconds == 5.0
    # Stub values per Phase 1 contract.
    assert fluency.silence_ratio is None
    assert fluency.long_pause_count == 0
    assert fluency.filler_word_count == 0
    assert fluency.repetition_count == 0
    # Clarity is the mean confidence times 100.
    assert fluency.clarity_score == 85.0


def test_build_fluency_section_handles_empty_words():
    audio = _make_audio(duration_seconds=3.0)
    transcription = TranscriptionResult(
        text="",
        normalized_text="",
        provider="whisper",
        model="small",
        words=[],
    )

    fluency = build_fluency_section(transcription=transcription, audio_asset=audio)

    assert fluency.words_per_minute == 0
    assert fluency.speech_duration_seconds == 0
    assert fluency.total_duration_seconds == 3.0
    assert fluency.clarity_score == 0


def test_assess_pronunciation_without_expected_text_is_unavailable():
    pronunciation = assess_pronunciation(
        audio_path="temp/output.wav",
        expected_text=None,
    )

    assert pronunciation.available is False
    assert pronunciation.overall_score is None
    assert pronunciation.words == []
    assert pronunciation.phoneme_errors == []


def test_analyze_response_has_exactly_seven_sectioned_top_level_keys():
    audio = _make_audio()
    transcription = _make_transcription()
    pronunciation = assess_pronunciation(
        audio_path="temp/output.wav",
        expected_text=None,
    )
    fluency = build_fluency_section(
        transcription=transcription, audio_asset=audio
    )

    response = AnalyzeResponse(
        analysis_id="analysis-1",
        audio=audio,
        transcription=transcription,
        pronunciation=pronunciation,
        fluency=fluency,
        communication=unavailable_communication_section(),
        debug=build_debug_section(expected_text=None, transcription=transcription),
    )

    payload = response.model_dump()
    expected_keys = {
        "analysis_id",
        "audio",
        "transcription",
        "pronunciation",
        "fluency",
        "communication",
        "debug",
    }
    assert set(payload.keys()) == expected_keys
    assert payload["analysis_id"] == "analysis-1"
    assert payload["transcription"]["normalized_text"] == "hello world"
    assert payload["fluency"]["words_per_minute"] == 80.0
