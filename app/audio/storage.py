import os
import uuid

import aiofiles
from fastapi import HTTPException
from fastapi import UploadFile

from app.audio.schemas import AudioAsset


SUPPORTED_AUDIO_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/webm",
    "audio/ogg",
    # Video containers that carry an audio track. The Interview Studio
    # records video+audio with MediaRecorder and reuses that same webm blob
    # for content scoring (see `scoreInterviewAnswer` in api.ts). ffmpeg in
    # `preprocessing` extracts the audio track regardless of container, so
    # we accept these here rather than force the frontend to strip video.
    "video/webm",
    "video/mp4",
}

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _get_extension(filename: str | None):
    if not filename or "." not in filename:
        return "audio"

    return filename.rsplit(".", 1)[-1].lower()


async def save_uploaded_audio(
    file: UploadFile,
    max_bytes: int | None = None,
):
    """Persist an uploaded audio/video container to ``uploads/`` and return metadata.

    ``max_bytes`` lets a caller raise the cap above the default
    ``MAX_UPLOAD_BYTES`` (25 MB). The Interview Studio reuses the same
    MediaRecorder blob for content scoring that ``/interview/analyze``
    already accepts at 100 MB — passing that cap here keeps the two
    endpoints consistent so a longer 720p answer doesn't hit 413 on
    ``/interview/score-answer`` while ``/interview/analyze`` succeeds.
    """
    if max_bytes is None:
        max_bytes = MAX_UPLOAD_BYTES

    if file.content_type not in SUPPORTED_AUDIO_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio format: {file.content_type}"
        )

    audio_id = str(uuid.uuid4())
    extension = _get_extension(file.filename)
    filename = f"{audio_id}.{extension}"
    file_path = os.path.join("uploads", filename)

    size_bytes = 0

    async with aiofiles.open(file_path, "wb") as out_file:
        while True:
            chunk = await file.read(1024 * 1024)

            if not chunk:
                break

            size_bytes += len(chunk)

            if size_bytes > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail="Audio file is too large"
                )

            await out_file.write(chunk)

    return AudioAsset(
        audio_id=audio_id,
        original_path=file_path,
        content_type=file.content_type,
        original_filename=file.filename,
        size_bytes=size_bytes
    )
