"""Per-speech records for the Group Discussion feature."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.logger import logger
from app.gd.schemas import GDSpeechRecord
from app.storage._jsonl import append_jsonl, read_jsonl


_PATH = Path("outputs/gd_speeches.jsonl")


def save_speech(record: GDSpeechRecord) -> None:
    append_jsonl(_PATH, record.model_dump())


def list_speeches_for_session(session_id: str) -> list[GDSpeechRecord]:
    out: list[GDSpeechRecord] = []
    for row in read_jsonl(_PATH):
        try:
            speech = GDSpeechRecord.model_validate(row)
        except Exception as exc:
            logger.warning("Skipping malformed gd_speech row: %s", exc)
            continue
        if speech.session_id == session_id:
            out.append(speech)
    out.sort(key=lambda s: s.started_at)
    return out


def get_speech(speech_id: str) -> Optional[GDSpeechRecord]:
    for row in read_jsonl(_PATH):
        try:
            speech = GDSpeechRecord.model_validate(row)
        except Exception:
            continue
        if speech.speech_id == speech_id:
            return speech
    return None


def list_speeches_for_participant(session_id: str, participant_id: str) -> list[GDSpeechRecord]:
    """Get all speeches for a specific participant in a session."""
    out: list[GDSpeechRecord] = []
    for row in read_jsonl(_PATH):
        try:
            speech = GDSpeechRecord.model_validate(row)
        except Exception:
            continue
        if speech.session_id == session_id and speech.participant_id == participant_id:
            out.append(speech)
    out.sort(key=lambda s: s.started_at)
    return out
