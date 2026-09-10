import asyncio
import threading
from pathlib import Path

import torch
import whisper

from app.asr.groq_whisper import is_groq_configured, transcribe_with_groq
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

# Guards the lazy load below. Without it two threads can both see `model is
# None` and each pull ~1 GB of weights into memory — on a 2 vCPU / 8 GB box
# that is an OOM, not a slow start.
_MODEL_LOAD_LOCK = threading.Lock()

# Serialises inference. `model` is a single shared PyTorch module and
# `.transcribe()` mutates state on it, so concurrent calls are not safe. It
# would not buy anything anyway: transcription is CPU-bound and this host has
# two cores. Requests queue here instead of corrupting each other, and — because
# callers now reach this from a worker thread — the event loop keeps serving
# everything else while they wait.
_LOCAL_INFER_LOCK = threading.Lock()


def get_model():
    global model

    if model is None:
        with _MODEL_LOAD_LOCK:
            # Re-check: another thread may have loaded it while we waited.
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


def _transcribe_local(audio_path: str) -> TranscriptionResult:
    """Local Whisper transcription (fallback when Groq unavailable)."""
    logger.info(f"Local Whisper transcribing: {audio_path}")

    active_model = get_model()

    with _LOCAL_INFER_LOCK:
        raw_result = active_model.transcribe(
            audio_path,
            language="en",
            fp16=torch.cuda.is_available(),
            word_timestamps=True
        )

    text = raw_result.get("text", "")
    segments = raw_result.get("segments", [])

    result = TranscriptionResult(
        text=text,
        normalized_text=normalize_transcript(text),
        language=raw_result.get("language", "en"),
        provider=PROVIDER_NAME,
        model=MODEL_NAME,
        words=_extract_words(segments),
        segments=segments
    )
    logger.info("Local transcription complete")
    return result


def transcribe_audio(audio_path: str):
    """Transcribe audio - tries Groq API first, falls back to local Whisper.
    
    Groq is 5-10x faster than local CPU inference and free (20K seconds/day).
    """
    # Try Groq first if configured
    if is_groq_configured():
        try:
            # Handle both sync and async contexts
            import asyncio as _asyncio
            try:
                loop = _asyncio.get_running_loop()
                # We're inside an async context (FastAPI) - can't use run_until_complete
                # Use a thread-based approach instead
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(
                        _asyncio.run, transcribe_with_groq(Path(audio_path))
                    )
                    result = future.result(timeout=45)
            except RuntimeError:
                # No running loop - safe to create one
                result = _asyncio.run(transcribe_with_groq(Path(audio_path)))
            
            if result is not None:
                return result
            logger.info("Groq unavailable, falling back to local Whisper")
        except Exception as exc:
            logger.warning(
                f"Groq transcription error: {type(exc).__name__}, using local"
            )
    
    # Fallback to local Whisper
    return _transcribe_local(audio_path)
