import pytest
from fastapi import HTTPException

from app.audio import preprocessing
from app.audio.preprocessing import preprocess_audio_asset
from app.audio.schemas import AudioAsset
from app.audio.storage import _get_extension


def test_get_extension_defaults_when_filename_missing():
    assert _get_extension(None) == "audio"
    assert _get_extension("recording") == "audio"


def test_get_extension_returns_lowercase_suffix():
    assert _get_extension("Recording.WEBM") == "webm"


def test_preprocess_audio_asset_returns_processed_metadata(monkeypatch):
    calls = {}

    def fake_run(command, check, stdout, stderr):
        calls["command"] = command

    def fake_metadata(audio_path):
        return {
            "duration_seconds": 3.2,
            "sample_rate": 16000,
            "channels": 1,
            "format": "WAV"
        }

    monkeypatch.setattr(
        preprocessing.subprocess,
        "run",
        fake_run
    )
    monkeypatch.setattr(
        preprocessing,
        "_read_audio_metadata",
        fake_metadata
    )
    monkeypatch.setattr(
        preprocessing,
        "get_ffmpeg_command",
        lambda: "ffmpeg"
    )

    audio = AudioAsset(
        audio_id="audio-1",
        original_path="uploads/sample.webm"
    )

    processed = preprocess_audio_asset(audio)

    assert processed.processed_path == "temp\\processed_sample.wav"
    assert processed.duration_seconds == 3.2
    assert processed.sample_rate == 16000
    assert processed.channels == 1
    assert calls["command"][0] == "ffmpeg"


def test_preprocess_audio_asset_rejects_long_audio(monkeypatch):
    monkeypatch.setattr(
        preprocessing.subprocess,
        "run",
        lambda command, check, stdout, stderr: None
    )
    monkeypatch.setattr(
        preprocessing,
        "_read_audio_metadata",
        lambda audio_path: {
            "duration_seconds": preprocessing.MAX_DURATION_SECONDS + 1,
            "sample_rate": 16000,
            "channels": 1,
            "format": "WAV"
        }
    )

    audio = AudioAsset(
        audio_id="audio-1",
        original_path="uploads/sample.webm"
    )

    with pytest.raises(HTTPException) as exc_info:
        preprocess_audio_asset(audio)

    assert exc_info.value.status_code == 413
