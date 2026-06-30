"""Structured logging helpers for the `/analyze` request flow.

This module provides a single-line, key=value formatter used at each stage of
the analysis pipeline so logs are greppable and machine-friendly without
introducing a new logging dependency.

Stages used in the request flow (see `design.md`):
    analyze_received, audio_saved, audio_preprocessed, asr_done,
    pronunciation_done, fluency_done, attempt_saved.

Example:
    >>> stage_log("asr_done", "abc-123", provider="whisper", model="base")
    'stage=asr_done analysis_id=abc-123 provider=whisper model=base'
"""

from app.core.logger import logger

__all__ = ["stage_log", "logger"]


def stage_log(stage: str, analysis_id: str, **fields) -> str:
    """Format a structured log line for a pipeline stage.

    Returns a single space-separated string of `key=value` pairs, with
    `stage` and `analysis_id` always first, followed by any caller-supplied
    fields in insertion order.

    Args:
        stage: Short stage identifier, e.g. ``"asr_done"``.
        analysis_id: Per-request UUID generated at the top of ``analyze_audio``.
        **fields: Additional key/value pairs to append. Values are converted
            via ``str()`` (through f-string formatting).

    Returns:
        A string of the form ``"stage=<s> analysis_id=<id> k=v ..."``.
    """
    parts = [f"stage={stage}", f"analysis_id={analysis_id}"]
    parts.extend(f"{k}={v}" for k, v in fields.items())
    return " ".join(parts)
