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
    "audio/ogg"
}

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _get_extension(filename: str | None):
    if not filename or "." not in filename:
        return "audio"

    return filename.rsplit(".", 1)[-1].lower()


async def save_uploaded_audio(file: UploadFile):
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

            if size_bytes > MAX_UPLOAD_BYTES:
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
