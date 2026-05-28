import torch
import whisper

from app.core.logger import logger
from app.utils.ffmpeg_utils import ensure_ffmpeg_on_path

MODEL_NAME = "small"

ensure_ffmpeg_on_path()

device = "cuda" if torch.cuda.is_available() else "cpu"

logger.info(f"Whisper using device: {device}")

model = whisper.load_model(MODEL_NAME)

model = model.to(device)

logger.info("Whisper model loaded successfully")


def transcribe_audio(audio_path: str):

    logger.info(f"Starting transcription: {audio_path}")

    result = model.transcribe(
        audio_path,
        language="en",
        fp16=torch.cuda.is_available(),
        word_timestamps=True
    )

    logger.info("Transcription complete")

    return result
