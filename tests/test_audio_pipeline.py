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


def _raise_ffmpeg_error(stderr: bytes):
    """Return a ``subprocess.run`` stub that fails the way ffmpeg does."""

    def fake_run(command, check, stdout, stderr_pipe=None, **kwargs):
        raise preprocessing.subprocess.CalledProcessError(
            returncode=1,
            cmd=command,
            stderr=stderr
        )

    return fake_run


@pytest.mark.parametrize(
    "stderr",
    [
        b"[matroska,webm @ 0x55] EBML header parsing failed\n"
        b"Error opening input files: Invalid data found when processing input",
        b"[mov,mp4 @ 0x55] moov atom not found",
        b"Output file #0 does not contain any stream",
    ]
)
def test_preprocess_audio_asset_rejects_undecodable_upload(monkeypatch, stderr):
    """A broken browser recording is the client's problem, so 400 not 500.

    These uploads are not empty — the two that 500'd in production were 22 KB
    and 114 KB — so a size check cannot catch them. Only ffmpeg's demux failure
    identifies them.
    """
    monkeypatch.setattr(
        preprocessing.subprocess,
        "run",
        _raise_ffmpeg_error(stderr)
    )

    audio = AudioAsset(
        audio_id="audio-1",
        original_path="uploads/broken.webm",
        size_bytes=22777
    )

    with pytest.raises(HTTPException) as exc_info:
        preprocess_audio_asset(audio)

    assert exc_info.value.status_code == 400
    assert "record again" in exc_info.value.detail.lower()


def test_preprocess_audio_asset_keeps_500_for_real_ffmpeg_failure(monkeypatch):
    """A genuine server fault must stay a 500 — don't blame the student."""
    monkeypatch.setattr(
        preprocessing.subprocess,
        "run",
        _raise_ffmpeg_error(b"Cannot open output file: No space left on device")
    )

    audio = AudioAsset(
        audio_id="audio-1",
        original_path="uploads/sample.webm"
    )

    with pytest.raises(HTTPException) as exc_info:
        preprocess_audio_asset(audio)

    assert exc_info.value.status_code == 500


def test_preprocess_audio_asset_rejects_silent_recording(monkeypatch):
    """ffmpeg can exit 0 on a muted mic, writing a header-only wav."""
    monkeypatch.setattr(
        preprocessing.subprocess,
        "run",
        lambda command, check, stdout, stderr: None
    )
    monkeypatch.setattr(
        preprocessing,
        "_read_audio_metadata",
        lambda audio_path: {
            "duration_seconds": 0.0,
            "sample_rate": 16000,
            "channels": 1,
            "format": "WAV"
        }
    )

    audio = AudioAsset(
        audio_id="audio-1",
        original_path="uploads/silent.webm"
    )

    with pytest.raises(HTTPException) as exc_info:
        preprocess_audio_asset(audio)

    assert exc_info.value.status_code == 400
    assert "microphone" in exc_info.value.detail.lower()
