"""Groq Whisper API integration - 10x faster than local CPU inference.

Free tier: 20,000 audio seconds/day (5-6 hours of audio).
Model: whisper-large-v3-turbo (best quality + fast).
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from pathlib import Path
from typing import Optional

import httpx

from app.asr.schemas import TranscribedWord, TranscriptionResult
from app.core.config import settings
from app.pronunciation.transcript_cleaner import normalize_transcript

logger = logging.getLogger("groq_whisper")

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"

# A 429 here is expensive in a way the status code hides: the fallback is local
# Whisper, which is CPU-bound on a 2-core box and an order of magnitude slower.
# During a class the bursts are short — students submit at the same moment and
# then think — so a brief wait usually clears far cheaper than transcribing
# locally. Only retry what can actually succeed on a retry (429, 5xx); a 400 or
# 401 will fail identically the second time.
GROQ_MAX_ATTEMPTS = 3
GROQ_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
GROQ_BACKOFF_BASE_SECONDS = 0.5
GROQ_BACKOFF_CAP_SECONDS = 4.0


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


def _retry_delay(attempt: int, response: Optional[httpx.Response]) -> float:
    """Seconds to wait before the next attempt.

    Groq sends `Retry-After` on a 429 and it is authoritative — prefer it over
    guessing. Otherwise back off exponentially. The jitter matters more than it
    looks: a class submits in lockstep, so a fixed delay would just reassemble
    the same thundering herd one beat later.
    """
    if response is not None:
        header = response.headers.get("Retry-After")
        if header:
            try:
                return min(float(header), GROQ_BACKOFF_CAP_SECONDS)
            except ValueError:
                pass

    backoff = min(
        GROQ_BACKOFF_BASE_SECONDS * (2 ** attempt),
        GROQ_BACKOFF_CAP_SECONDS,
    )
    return backoff * (0.5 + random.random() / 2)


async def _post_with_retry(audio_path: Path, api_key: str) -> Optional[dict]:
    """POST the audio to Groq, retrying transient failures.

    Returns the decoded JSON body, or None if the caller should fall back to
    local Whisper. The file is reopened per attempt because the request body
    consumes the handle.
    """
    headers = {"Authorization": f"Bearer {api_key}"}
    data = {
        "model": GROQ_MODEL,
        "response_format": "verbose_json",
        "language": "en",
        "timestamp_granularities[]": "word",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(GROQ_MAX_ATTEMPTS):
            last_attempt = attempt == GROQ_MAX_ATTEMPTS - 1

            with open(audio_path, "rb") as audio_file:
                files = {"file": (audio_path.name, audio_file, "audio/wav")}
                response = await client.post(
                    GROQ_API_URL,
                    headers=headers,
                    files=files,
                    data=data,
                )

            if response.status_code < 400:
                return response.json()

            if response.status_code not in GROQ_RETRY_STATUSES or last_attempt:
                logger.warning(
                    f"Groq API error {response.status_code}"
                    f"{' after ' + str(GROQ_MAX_ATTEMPTS) + ' attempts' if last_attempt else ''}"
                    ": falling back to local"
                )
                return None

            delay = _retry_delay(attempt, response)
            logger.info(
                f"Groq {response.status_code}, retrying in {delay:.1f}s "
                f"(attempt {attempt + 2}/{GROQ_MAX_ATTEMPTS})"
            )
            await asyncio.sleep(delay)

    return None


async def transcribe_with_groq(audio_path: Path) -> Optional[TranscriptionResult]:
    """Transcribe audio using Groq's Whisper API.
    
    Returns None if API fails - caller should fall back to local Whisper.
    """
    api_key = _groq_api_key()
    if not api_key:
        return None
    
    try:
        result = await _post_with_retry(audio_path, api_key)
        if result is None:
            return None

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
    except Exception as e:
        logger.warning(f"Groq transcription failed: {type(e).__name__}: {e}")
        return None
