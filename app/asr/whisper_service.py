import torch
import whisper

from app.asr.schemas import TranscribedWord
from app.asr.schemas import TranscriptionResult
from app.core.logger import logger
from app.pronunciation.transcript_cleaner import normalize_transcript
from app.utils.ffmpeg_utils import ensure_ffmpeg_on_path


MODEL_NAME = "small"

PROVIDER_NAME = "whisper"

ensure_ffmpeg_on_path()

device = "cuda" if torch.cuda.is_available() else "cpu"

model = None


def get_model():
    global model

    if model is None:
        logger.info(f"Whisper using device: {device}")

        loaded_model = whisper.load_model(MODEL_NAME)
        model = loaded_model.to(device)

        logger.info("Whisper model loaded successfully")

    return model


def _extract_words(segments):
    transcribed_words = []

    for segment in segments:
        for word in segment.get("words", []):
            transcribed_words.append(
                TranscribedWord(
                    word=word.get("word", "").strip(),
                    start=word.get("start", 0),
                    end=word.get("end", 0),
                    confidence=word.get("probability", 0)
                )
            )

    return transcribed_words


def transcribe_audio(audio_path: str):
    logger.info(f"Starting transcription: {audio_path}")

    raw_result = get_model().transcribe(
        audio_path,
        language="en",
        fp16=torch.cuda.is_available(),
        word_timestamps=True
    )

    text = raw_result.get(
        "text",
        ""
    )

    segments = raw_result.get(
        "segments",
        []
    )

    result = TranscriptionResult(
        text=text,
        normalized_text=normalize_transcript(text),
        language=raw_result.get(
            "language",
            "en"
        ),
        provider=PROVIDER_NAME,
        model=MODEL_NAME,
        words=_extract_words(segments),
        segments=segments
    )

    logger.info("Transcription complete")

    return result
