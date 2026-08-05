"""Per-turn records for the group-debate feature.

One JSONL row per `DebateTurn`. Rows are appended as each speaker
finishes their turn (or forfeits it), and updated in place when a
teacher submits a rubric override via the admin panel.

The store deliberately mirrors the append-only + read-all patterns
used by `submissions.py` / `reviews.py`. Rewrite-in-place only happens
on the teacher-review path.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.logger import logger
from app.debate.schemas import DebateTurn
from app.storage._jsonl import append_jsonl, overwrite_jsonl, read_jsonl


_PATH = Path("outputs/debate_turns.jsonl")


def save_turn(turn: DebateTurn) -> None:
    """Append the turn as a single JSONL row."""
    append_jsonl(_PATH, turn.model_dump())


def load_turn(turn_id: str) -> Optional[DebateTurn]:
    """Return the turn with matching turn_id, or None."""
    for row in read_jsonl(_PATH):
        try:
            turn = DebateTurn.model_validate(row)
        except Exception as exc:
            logger.warning("Skipping malformed debate_turn row: %s", exc)
            continue
        if turn.turn_id == turn_id:
            return turn
    return None


def list_turns_for_debate(debate_id: str) -> list[DebateTurn]:
    """Return every turn for the given debate_id, ordered by turn_index ASC."""
    out: list[DebateTurn] = []
    for row in read_jsonl(_PATH):
        try:
            turn = DebateTurn.model_validate(row)
        except Exception as exc:
            logger.warning("Skipping malformed debate_turn row: %s", exc)
            continue
        if turn.debate_id == debate_id:
            out.append(turn)
    out.sort(key=lambda t: t.turn_index)
    return out


def list_turns_for_debate_by_code(room_code: str) -> list[DebateTurn]:
    """Return every turn for the debate identified by `room_code`, ordered by
    turn_index ASC.

    Turns do not store the room code, so resolve the owning `debate_id` from
    the completed-debate store by matching `code`, then reuse
    `list_turns_for_debate(debate_id)`. This lets the audio-serve path resolve
    turns for completed/evicted rooms without adding `room_code` to every turn
    row. Returns `[]` when the code matches no persisted debate.

    The import is done lazily to mirror the cross-store access pattern in
    `debates.py` (which lazily imports this module) and avoid an import cycle.
    """
    from app.storage import debates as debates_store

    for record in debates_store._iter_records():
        if record.code == room_code:
            return list_turns_for_debate(record.debate_id)
    return []


def list_turns_for_debate_by_turn_id(turn_id: str) -> list[DebateTurn]:
    """Return the turn with matching turn_id as a list (for consistency)."""
    turn = load_turn(turn_id)
    return [turn] if turn else []


def apply_teacher_review(
    turn_id: str,
    score: int,
    comment: Optional[str],
) -> Optional[DebateTurn]:
    """Rewrite the file with the target turn's teacher_override_score and
    teacher_comment updated in place. Return the updated DebateTurn or
    None if turn_id is unknown.
    """
    rows = read_jsonl(_PATH)
    updated: Optional[DebateTurn] = None
    out_rows: list[dict] = []
    for row in rows:
        try:
            turn = DebateTurn.model_validate(row)
        except Exception as exc:
            logger.warning("Preserving malformed debate_turn row as-is: %s", exc)
            out_rows.append(row)
            continue
        if turn.turn_id == turn_id:
            turn = turn.model_copy(
                update={
                    "teacher_override_score": int(score),
                    "teacher_comment": comment,
                }
            )
            updated = turn
        out_rows.append(turn.model_dump())

    if updated is None:
        return None

    overwrite_jsonl(_PATH, out_rows)
    return updated


def update_turn_full_score(
    turn_id: str,
    full_ai_score: float,
    full_score_ready: bool = True,
    score_breakdown: Optional[dict] = None,
) -> Optional[DebateTurn]:
    """Rewrite the file with the target turn's full_ai_score and
    full_score_ready updated in place. Return the updated DebateTurn or
    None if turn_id is unknown.

    When ``score_breakdown`` is supplied it replaces the stored breakdown, so
    the detailed pass's pronunciation-inclusive components are what the result
    screen ends up showing.
    """
    rows = read_jsonl(_PATH)
    updated: Optional[DebateTurn] = None
    out_rows: list[dict] = []
    for row in rows:
        try:
            turn = DebateTurn.model_validate(row)
        except Exception as exc:
            logger.warning("Preserving malformed debate_turn row as-is: %s", exc)
            out_rows.append(row)
            continue
        if turn.turn_id == turn_id:
            changes: dict = {
                "full_ai_score": full_ai_score,
                "full_score_ready": full_score_ready,
            }
            if score_breakdown is not None:
                changes["score_breakdown"] = score_breakdown
            turn = turn.model_copy(update=changes)
            updated = turn
        out_rows.append(turn.model_dump())

    if updated is None:
        return None

    overwrite_jsonl(_PATH, out_rows)
    return updated
