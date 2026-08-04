"""Completed debate records for the group-debate feature.

One JSONL row per `DebateRecord`, written when a room transitions into
`complete`. Abandoned rooms are never persisted here (Req 7.5).

The pending-review listing joins against `app.storage.debate_turns` to
find rows whose turns still lack a `teacher_override_score`. That
cross-store join is done locally so callers only have to touch one
module.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.logger import logger
from app.debate.schemas import DebateRecord
from app.storage._jsonl import append_jsonl, overwrite_jsonl, read_jsonl


_PATH = Path("outputs/debates.jsonl")


def save_debate(record: DebateRecord) -> None:
    """Append the final debate record on transition to `complete`."""
    append_jsonl(_PATH, record.model_dump())


def _iter_records() -> list[DebateRecord]:
    out: list[DebateRecord] = []
    for row in read_jsonl(_PATH):
        try:
            out.append(DebateRecord.model_validate(row))
        except Exception as exc:
            logger.warning("Skipping malformed debate row: %s", exc)
            continue
    return out


def load_debate(debate_id: str) -> Optional[DebateRecord]:
    """Return the record with the matching debate_id, or None."""
    for record in _iter_records():
        if record.debate_id == debate_id:
            return record
    return None


def list_debates_for_user(user_id: str) -> list[DebateRecord]:
    """Return every record where user_id appears in participants[*].user_id.

    Ordered by completed_at DESC (Req 13.3).
    """
    matches: list[DebateRecord] = []
    for record in _iter_records():
        for participant in record.participants:
            if isinstance(participant, dict) and participant.get("user_id") == user_id:
                matches.append(record)
                break
    matches.sort(key=lambda r: r.completed_at, reverse=True)
    return matches


def list_pending_review_debates() -> list[DebateRecord]:
    """Return complete debates that have at least one Turn without a
    teacher_override_score.

    Ordered by completed_at DESC.
    """
    # Local import to keep the module-load graph loop-free — `debate_turns`
    # does not import from here, but importing lazily inside the function
    # keeps things symmetric with the design note.
    from app.storage.debate_turns import list_turns_for_debate

    pending: list[DebateRecord] = []
    for record in _iter_records():
        turns = list_turns_for_debate(record.debate_id)
        if any(t.teacher_override_score is None for t in turns):
            pending.append(record)
    pending.sort(key=lambda r: r.completed_at, reverse=True)
    return pending


def update_winner(debate_id: str, winner_id: Optional[str]) -> None:
    """Rewrite the file with the target debate's winner_participant_id
    updated in place. No-op if debate_id not found.
    """
    rows = read_jsonl(_PATH)
    found = False
    out_rows: list[dict] = []
    for row in rows:
        try:
            record = DebateRecord.model_validate(row)
        except Exception as exc:
            logger.warning("Preserving malformed debate row as-is: %s", exc)
            out_rows.append(row)
            continue
        if record.debate_id == debate_id:
            record = record.model_copy(update={"winner_participant_id": winner_id})
            found = True
        out_rows.append(record.model_dump())

    if not found:
        return

    overwrite_jsonl(_PATH, out_rows)


def update_standings(debate_id: str, standings: list) -> None:
    """Rewrite the target debate's `final_standings` in place.

    Used by the detailed-scoring background task once pronunciation has been
    assessed, so the My Performance detail view reflects the adjusted scores.
    Appending via `save_debate` would not work here: rows are append-only and
    `load_debate` returns the first match, so a second row would be ignored.

    No-op if debate_id is not found.
    """
    rows = read_jsonl(_PATH)
    found = False
    out_rows: list[dict] = []
    for row in rows:
        try:
            record = DebateRecord.model_validate(row)
        except Exception as exc:
            logger.warning("Preserving malformed debate row as-is: %s", exc)
            out_rows.append(row)
            continue
        if record.debate_id == debate_id:
            record = record.model_copy(update={"final_standings": standings})
            found = True
        out_rows.append(record.model_dump())

    if not found:
        return

    overwrite_jsonl(_PATH, out_rows)
