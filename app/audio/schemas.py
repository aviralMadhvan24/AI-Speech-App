from pydantic import BaseModel
from typing import Optional


class AudioAsset(BaseModel):

    audio_id: str

    original_path: str

    processed_path: Optional[str] = None

    duration_seconds: Optional[float] = None

    sample_rate: Optional[int] = None

    channels: Optional[int] = None

    format: Optional[str] = None

    content_type: Optional[str] = None

    original_filename: Optional[str] = None

    size_bytes: Optional[int] = None
