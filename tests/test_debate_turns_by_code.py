"""Tests for ``list_turns_for_debate_by_code`` (Task 5.2).

The audio-serve path for completed/evicted rooms resolves a debate's turns by
room ``code``. Turns do not store the room code, so
``list_turns_for_debate_by_code`` resolves the owning ``debate_id`` from the
completed-debate store (matching ``DebateRecord.code``) and then reuses
``list_turns_for_debate(debate_id)``.

These tests point both stores' ``_PATH`` at ``tmp_path`` (via ``monkeypatch``),
seed a ``DebateRecord`` with a ``code`` plus its turns, and assert:

- ``list_turns_for_debate_by_code(code)`` returns exactly those turns ordered by
  ascending ``turn_index``.
- an unknown code returns ``[]``.

Validates: Requirements 2.3, 3.5.
"""

from __future__ import annotations

from pathlib import Path

from app.debate.schemas import DebateRecord, DebateTurn
from app.storage import debate_turns as turns_store
from app.storage import debates as debates_store


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _turn(debate_id: str, turn_id: str, turn_index: int) -> DebateTurn:
    return DebateTurn(
        turn_id=turn_id,
        debate_id=debate_id,
        participant_id=f"p-{turn_index}",
        turn_index=turn_index,
        audio_url=f"/debate/rooms/ABCDEF/audio/{turn_id}",
        audio_key=f"debate-audio/{debate_id}/{turn_id}.webm",
        audio_content_type="audio/webm",
        ai_score=50.0,
        submitted_at=float(turn_index),
    )


def _record(debate_id: str, code: str, turn_ids: list[str]) -> DebateRecord:
    return DebateRecord(
        debate_id=debate_id,
        code=code,
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        participants=[
            {
                "participant_id": "p-0",
                "user_id": "uid-0",
                "display_name": "User 0",
                "turn_index": 0,
                "is_forfeit": False,
            },
            {
                "participant_id": "p-1",
                "user_id": "uid-1",
                "display_name": "User 1",
                "turn_index": 1,
                "is_forfeit": False,
            },
        ],
        turn_ids=turn_ids,
        created_at=0.0,
        completed_at=2.0,
    )


def _point_stores_at_tmp(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        turns_store, "_PATH", tmp_path / "debate_turns.jsonl", raising=False
    )
    monkeypatch.setattr(
        debates_store, "_PATH", tmp_path / "debates.jsonl", raising=False
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_returns_turns_for_known_code_ordered_by_turn_index(monkeypatch, tmp_path) -> None:
    """A known code resolves the debate and returns its turns in turn_index order."""
    _point_stores_at_tmp(monkeypatch, tmp_path)

    debate_id = "deb-1"
    code = "ABCDEF"

    # Save turns out of order to prove sorting by turn_index.
    turns_store.save_turn(_turn(debate_id, "t-1", 1))
    turns_store.save_turn(_turn(debate_id, "t-0", 0))
    debates_store.save_debate(_record(debate_id, code, ["t-0", "t-1"]))

    result = turns_store.list_turns_for_debate_by_code(code)

    assert [t.turn_id for t in result] == ["t-0", "t-1"]
    assert [t.turn_index for t in result] == [0, 1]
    assert all(t.debate_id == debate_id for t in result)


def test_unknown_code_returns_empty(monkeypatch, tmp_path) -> None:
    """A code that matches no persisted debate returns an empty list."""
    _point_stores_at_tmp(monkeypatch, tmp_path)

    debate_id = "deb-1"
    turns_store.save_turn(_turn(debate_id, "t-0", 0))
    debates_store.save_debate(_record(debate_id, "ABCDEF", ["t-0"]))

    assert turns_store.list_turns_for_debate_by_code("ZZZZZZ") == []


def test_only_returns_turns_for_matching_debate(monkeypatch, tmp_path) -> None:
    """Turns from other debates are not returned for the resolved code."""
    _point_stores_at_tmp(monkeypatch, tmp_path)

    turns_store.save_turn(_turn("deb-1", "t-0", 0))
    turns_store.save_turn(_turn("deb-2", "other-0", 0))
    debates_store.save_debate(_record("deb-1", "ABCDEF", ["t-0"]))
    debates_store.save_debate(_record("deb-2", "GHIJKL", ["other-0"]))

    result = turns_store.list_turns_for_debate_by_code("ABCDEF")

    assert [t.turn_id for t in result] == ["t-0"]
    assert all(t.debate_id == "deb-1" for t in result)
