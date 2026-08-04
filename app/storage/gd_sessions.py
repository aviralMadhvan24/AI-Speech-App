"""Session records for the Group Discussion feature."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.logger import logger
from app.gd.schemas import GDSessionRecord
from app.storage._jsonl import append_jsonl, overwrite_jsonl, read_jsonl


_PATH = Path("outputs/gd_sessions.jsonl")


def save_session(record: GDSessionRecord) -> None:
    append_jsonl(_PATH, record.model_dump())


def upsert_session(record: GDSessionRecord) -> None:
    """Replace an existing session row in place, or append when new.

    `save_session` is append-only and `get_session` returns the first match,
    so re-saving an updated record with `save_session` would silently have no
    effect. The detailed-scoring background task needs this to make the
    pronunciation-adjusted scores readable.
    """
    rows = read_jsonl(_PATH)
    found = False
    out_rows: list[dict] = []
    for row in rows:
        try:
            existing = GDSessionRecord.model_validate(row)
        except Exception as exc:
            logger.warning("Preserving malformed gd_session row as-is: %s", exc)
            out_rows.append(row)
            continue
        if existing.session_id == record.session_id:
            out_rows.append(record.model_dump())
            found = True
            continue
        out_rows.append(existing.model_dump())

    if not found:
        append_jsonl(_PATH, record.model_dump())
        return

    overwrite_jsonl(_PATH, out_rows)


def list_sessions_for_user(user_id: str) -> list[GDSessionRecord]:
    out: list[GDSessionRecord] = []
    for row in read_jsonl(_PATH):
        try:
            session = GDSessionRecord.model_validate(row)
        except Exception as exc:
            logger.warning("Skipping malformed gd_session row: %s", exc)
            continue
        for p in session.participants:
            if isinstance(p, dict) and p.get("user_id") == user_id:
                out.append(session)
                break
    out.sort(key=lambda s: s.completed_at, reverse=True)
    return out


def get_session(session_id: str) -> Optional[GDSessionRecord]:
    for row in read_jsonl(_PATH):
        try:
            session = GDSessionRecord.model_validate(row)
        except Exception:
            continue
        if session.session_id == session_id:
            return session
    return None
