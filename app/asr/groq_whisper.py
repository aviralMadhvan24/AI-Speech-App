"""Groq Whisper API integration - 10x faster than local CPU inference.

Free tier: 20,000 audio seconds/day (5-6 hours of audio).
Model: whisper-large-v3-turbo (best quality + fast).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

import httpx

from app.asr.schemas import TranscribedWord, TranscriptionResult
from app.core.config import settings
from app.pronunciation.transcript_cleaner import normalize_transcript

logger = logging.getLogger("groq_whisper")

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"


def _groq_api_key() -> Optional[str]:
    """Resolve the Groq key from Settings, falling back to the process env.

    Reading `os.getenv` alone missed keys defined in `.env`, because nothing in
    `app/` exports that file into the environment - which silently downgraded
    every transcription to the slower local Whisper model.
    """
    return settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")


def is_groq_configured() -> bool:
    """Check if Groq Whisper is available."""
    return bool(_groq_api_key())


async def transcribe_with_groq(audio_path: Path) -> Optional[TranscriptionResult]:
    """Transcribe audio using Groq's Whisper API.
    
    Returns None if API fails - caller should fall back to local Whisper.
    """
    api_key = _groq_api_key()
    if not api_key:
        return None
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(audio_path, "rb") as audio_file:
                files = {
                    "file": (audio_path.name, audio_file, "audio/wav"),
                }
                data = {
                    "model": GROQ_MODEL,
                    "response_format": "verbose_json",
                    "language": "en",
                    "timestamp_granularities[]": "word",
                }
                headers = {
                    "Authorization": f"Bearer {api_key}",
                }
                
                response = await client.post(
                    GROQ_API_URL,
                    headers=headers,
                    files=files,
                    data=data,
                )
                response.raise_for_status()
                result = response.json()
        
        # Extract words with timestamps
        words = []
        for word_data in result.get("words", []):
            words.append(TranscribedWord(
                word=word_data.get("word", "").strip(),
                start=word_data.get("start", 0.0),
                end=word_data.get("end", 0.0),
                confidence=1.0,  # Groq doesn't provide confidence
            ))
        
        raw_text = result.get("text", "").strip()
        clean_text = normalize_transcript(raw_text)
        
        logger.info(
            f"Groq transcription: {len(words)} words, "
            f"duration: {result.get('duration', 0):.1f}s"
        )
        
        return TranscriptionResult(
            text=raw_text,
            normalized_text=clean_text,
            language=result.get("language", "en"),
            provider="groq",
            model=GROQ_MODEL,
            words=words,
        )
    except httpx.HTTPStatusError as e:
        logger.warning(
            f"Groq API error {e.response.status_code}: falling back to local"
        )
        return None
    except Exception as e:
        logger.warning(f"Groq transcription failed: {type(e).__name__}: {e}")
        return None
