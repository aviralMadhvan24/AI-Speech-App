"""Tests for the debate ``AudioBlobStore`` abstraction.

Covers the local-disk backend round-trip (Task 2.2):

- ``key_for`` produces the ``debate-audio/{debate_id}/{turn_id}.{ext}`` scheme.
- ``put`` -> ``exists`` -> ``open`` yields identical bytes and the recorded
  content type.
- ``signed_url`` returns ``None`` for the local backend.

Also exercises the module-level content-type helper, the path-traversal guard,
and ``get_audio_store`` backend selection.

Validates: Requirements 2.1, 2.10, 5.2.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.debate.audio_store import AudioBlobStore
from app.debate.audio_store import LocalDiskAudioStore
from app.debate.audio_store import _content_type_for_ext
from app.debate.audio_store import get_audio_store


DEBATE_ID = "debate-1234abcd"
TURN_ID = "turn-5678efgh"


def test_key_for_format() -> None:
    store = LocalDiskAudioStore(root=Path("uploads/debate-audio"))
    assert store.key_for(DEBATE_ID, TURN_ID, "webm") == (
        f"debate-audio/{DEBATE_ID}/{TURN_ID}.webm"
    )
    # Leading dot and case are normalized.
    assert store.key_for(DEBATE_ID, TURN_ID, ".WAV") == (
        f"debate-audio/{DEBATE_ID}/{TURN_ID}.wav"
    )


def test_local_disk_round_trip(tmp_path: Path) -> None:
    store = LocalDiskAudioStore(root=tmp_path / "debate-audio")

    # Write a temp source file with known bytes.
    payload = b"\x1a\x45\xdf\xa3fake-webm-audio-bytes\x00\x01\x02"
    src = tmp_path / "source.webm"
    src.write_bytes(payload)

    key = store.key_for(DEBATE_ID, TURN_ID, "webm")
    assert store.exists(key) is False

    store.put(key, str(src))
    assert store.exists(key) is True

    stream, content_type = store.open(key)
    try:
        assert stream.read() == payload
    finally:
        stream.close()
    assert content_type == "audio/webm"

    # Local backend serves via the app route, not a signed URL.
    assert store.signed_url(key) is None
    assert store.signed_url(key, ttl_seconds=60) is None


def test_delete_removes_blob(tmp_path: Path) -> None:
    store = LocalDiskAudioStore(root=tmp_path / "debate-audio")
    src = tmp_path / "source.wav"
    src.write_bytes(b"riff-wav-bytes")
    key = store.key_for(DEBATE_ID, TURN_ID, "wav")

    store.put(key, str(src))
    assert store.exists(key) is True

    store.delete(key)
    assert store.exists(key) is False

    # Deleting an absent blob is a no-op.
    store.delete(key)


@pytest.mark.parametrize(
    "ext,expected",
    [
        ("webm", "audio/webm"),
        ("wav", "audio/wav"),
        ("mp3", "audio/mpeg"),
        ("ogg", "audio/ogg"),
        ("WEBM", "audio/webm"),
        (".mp3", "audio/mpeg"),
        ("flac", "application/octet-stream"),
        ("", "application/octet-stream"),
    ],
)
def test_content_type_for_ext(ext: str, expected: str) -> None:
    assert _content_type_for_ext(ext) == expected


def test_path_traversal_is_rejected(tmp_path: Path) -> None:
    store = LocalDiskAudioStore(root=tmp_path / "debate-audio")

    # Keys that escape the store root must not resolve to a real path.
    assert store.exists("debate-audio/../../etc/passwd") is False
    assert store.exists("/etc/passwd") is False

    with pytest.raises(ValueError):
        store.put("debate-audio/../escape.webm", str(tmp_path / "x"))


def test_get_audio_store_defaults_to_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEBATE_AUDIO_BACKEND", raising=False)
    store = get_audio_store()
    assert isinstance(store, LocalDiskAudioStore)
    assert isinstance(store, AudioBlobStore)


def test_get_audio_store_r2_falls_back_to_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # R2 is out of scope; selecting it degrades to the local disk backend.
    monkeypatch.setenv("DEBATE_AUDIO_BACKEND", "r2")
    store = get_audio_store()
    assert isinstance(store, LocalDiskAudioStore)
