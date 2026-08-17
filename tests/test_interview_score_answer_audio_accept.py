"""Tests for the Interview Studio content-scoring upload path.

``/interview/score-answer`` reuses the same webm blob captured by
MediaRecorder for the gesture-analysis step. That blob is either
``video/webm`` (Chrome / Edge / Firefox) or ``video/mp4`` (Safari) —
neither was accepted by ``save_uploaded_audio`` originally — and the
25 MB default cap was too tight for the same recording that
``/interview/analyze`` accepts at 100 MB.

These tests cover the fix in ``app/audio/storage.py``:

* ``video/webm`` and ``video/mp4`` content types are accepted (not 415).
* ``save_uploaded_audio(max_bytes=...)`` overrides the default cap so the
  interview score-answer path can match ``/interview/analyze``'s 100 MB.
* The default ``MAX_UPLOAD_BYTES`` (25 MB) cap is still enforced for the
  other audio callers (pronunciation, debate, group discussion) that
  pass smaller uploads.
"""

from __future__ import annotations

import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException
from fastapi import UploadFile
from starlette.datastructures import Headers

from app.audio import storage


@pytest.fixture
def upload_path_dir(tmp_path, monkeypatch):
    """Isolate ``save_uploaded_audio``'s relative ``uploads/`` write target."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.chdir(tmp_path)
    return uploads


def _file(content_type: str, *, payload: bytes, filename: str) -> UploadFile:
    # Newer Starlette UploadFile no longer takes `content_type=` as a kwarg;
    # the property is derived from the `headers` map.
    return UploadFile(
        filename=filename,
        file=BytesIO(payload),
        headers=Headers({"content-type": content_type}),
    )


@pytest.mark.parametrize("content_type", ["video/webm", "video/mp4"])
def test_save_uploaded_audio_accepts_video_containers(
    upload_path_dir, content_type
):
    # Same shape the React client emits: filename "answer.webm" sent together
    # with the MediaRecorder container MIME type. ffmpeg extracts the audio
    # track regardless of container, so we accept these here too.
    payload = b"\x1a\x45\xdf\xa3fake-webm-bytes"
    upload = _file(content_type, payload=payload, filename="answer.webm")

    asset = asyncio.run(storage.save_uploaded_audio(upload))

    assert asset.content_type == content_type
    assert asset.original_filename == "answer.webm"
    assert asset.size_bytes == len(payload)
    # Original container bytes were persisted verbatim to <uploads>/<uuid>.webm
    # so the downstream ffmpeg/loudnorm pass can read them.
    saved_path = upload_path_dir.parent / asset.original_path
    assert saved_path.is_file()
    assert saved_path.read_bytes() == payload


def test_save_uploaded_audio_max_bytes_override_admits_oversized(
    upload_path_dir,
):
    # A 30 MB webm upload (well over the default 25 MB cap) succeeds when the
    # caller requests the 100 MB cap that /interview/analyze already allows.
    payload = b"a" * (30 * 1024 * 1024)
    upload = _file("video/webm", payload=payload, filename="answer.webm")

    asset = asyncio.run(
        storage.save_uploaded_audio(upload, max_bytes=100 * 1024 * 1024)
    )

    assert asset.size_bytes == len(payload)


def test_save_uploaded_audio_default_cap_rejects_oversized(
    upload_path_dir, monkeypatch
):
    # No max_bytes override → the module-level MAX_UPLOAD_BYTES is consulted at
    # call time so the test shrinks it instead of allocating 25+ MB in memory.
    monkeypatch.setattr(storage, "MAX_UPLOAD_BYTES", 10)

    upload = _file("video/webm", payload=b"a" * 11, filename="answer.webm")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(storage.save_uploaded_audio(upload))

    assert exc_info.value.status_code == 413


def test_save_uploaded_audio_override_cap_rejects_oversized(
    upload_path_dir,
):
    upload = _file(
        "video/webm",
        payload=b"a" * 11,
        filename="answer.webm",
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(storage.save_uploaded_audio(upload, max_bytes=10))

    assert exc_info.value.status_code == 413


def test_save_uploaded_audio_rejects_unsupported_type(
    upload_path_dir,
):
    upload = _file("text/plain", payload=b"hi", filename="answer.txt")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(storage.save_uploaded_audio(upload))

    assert exc_info.value.status_code == 415
