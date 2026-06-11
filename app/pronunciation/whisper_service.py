from functools import lru_cache

from app.core.config import settings
from app.core.logger import logger
from app.utils.ffmpeg_utils import ensure_ffmpeg_on_path

ensure_ffmpeg_on_path()


@lru_cache(maxsize=1)
def load_model():
    import torch
    import whisper

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Loading Whisper model '%s' on %s", settings.WHISPER_MODEL, device)

    model = whisper.load_model(settings.WHISPER_MODEL)
    model = model.to(device)

    logger.info("Whisper model loaded successfully")
    return model, torch


def transcribe_audio(audio_path: str):

    logger.info(f"Starting transcription: {audio_path}")
    model, torch = load_model()

    result = model.transcribe(
        audio_path,
        language="en",
        fp16=torch.cuda.is_available(),
        word_timestamps=True
    )

    logger.info("Transcription complete")

    return result
