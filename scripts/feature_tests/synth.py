"""Synthetic analysis objects.

The debate/GD scoring pipeline normally receives its inputs from Whisper +
the fluency analyser. Those steps are slow (CPU Whisper on a two-minute clip)
and non-deterministic, which makes them useless for verifying *scoring*
behaviour. Here we build the same objects directly from a known transcript,
so every run feeds the scorer identical text.

Consequence, stated plainly: these tests cover the scoring and state-machine
layers, not ASR accuracy.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from app.asr.schemas import TranscribedWord, TranscriptionResult
from app.audio.schemas import AudioAsset
from app.fluency.schemas import FluencyResult
from app.schemas.pronunciation_schema import PronunciationResult

from .corpus import Sample

_PLACEHOLDER_BYTES = b"\x1a\x45\xdf\xa3softskills-feature-test-placeholder"

# Every file the harness drops into uploads/, so the run can clean up after
# itself instead of leaving stub audio behind.
_created: list[Path] = []


def register_artifact(path: str | Path) -> None:
    """Track a file the pipeline created on our behalf, for later cleanup."""
    _created.append(Path(path))


def cleanup_artifacts() -> int:
    """Delete every tracked file. Returns how many were removed."""
    removed = 0
    for path in _created:
        try:
            if path.is_file():
                path.unlink()
                removed += 1
        except OSError:
            pass
    _created.clear()
    return removed


def placeholder_audio(audio_id: str, uploads_dir: str = "uploads") -> str:
    """Write a tiny stand-in audio file so file-copy paths are exercised."""
    directory = Path(uploads_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{audio_id}.webm"
    path.write_bytes(_PLACEHOLDER_BYTES)
    register_artifact(path)
    return str(path)


def build_transcription(text: str, duration_seconds: float) -> TranscriptionResult:
    words = text.split()
    per_word = (duration_seconds / len(words)) if words else 0.0
    transcribed = [
        TranscribedWord(
            word=word,
            start=round(index * per_word, 3),
            end=round((index + 1) * per_word, 3),
            confidence=0.95,
        )
        for index, word in enumerate(words)
    ]
    return TranscriptionResult(
        text=text,
        normalized_text=text.lower(),
        language="en",
        provider="feature-test-stub",
        model="stub",
        words=transcribed,
    )


def build_analysis(
    sample: Sample,
    *,
    duration_seconds: float | None = None,
) -> tuple[AudioAsset, TranscriptionResult, PronunciationResult, FluencyResult, str]:
    """Produce the 5-tuple that ``submit_turn`` expects.

    Mirrors ``app.debate.service.analyze_turn_audio``: pronunciation is marked
    unavailable exactly as the real debate path does (phoneme scoring is
    skipped for debate turns), so the 0-100 rescaling logic is exercised.
    """
    duration = duration_seconds if duration_seconds is not None else sample.duration_seconds
    audio_id = uuid.uuid4().hex
    processed = placeholder_audio(audio_id)

    audio_asset = AudioAsset(
        audio_id=audio_id,
        original_path=processed,
        processed_path=processed,
        duration_seconds=duration,
        sample_rate=16000,
        channels=1,
        format="webm",
        content_type="audio/webm",
        original_filename="feature-test.webm",
        size_bytes=len(_PLACEHOLDER_BYTES),
    )

    transcription = build_transcription(sample.text, duration)

    pronunciation = PronunciationResult(
        available=False,
        provider="skipped_for_debate",
        overall_score=None,
        words=[],
        phoneme_errors=[],
        message="Phoneme pronunciation is not scored for debate turns.",
    )

    fluency = FluencyResult(
        words_per_minute=sample.wpm,
        speech_duration_seconds=duration,
        total_duration_seconds=duration,
        silence_ratio=0.12,
        long_pause_count=1,
        filler_word_count=sample.text.lower().count(" um ") + sample.text.lower().count(" like "),
        repetition_count=0,
        clarity_score=sample.clarity,
    )

    return audio_asset, transcription, pronunciation, fluency, uuid.uuid4().hex
