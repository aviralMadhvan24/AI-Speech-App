"""Tests for the debate LiveKit room lifecycle (Task 3.4).

Covers ``DebateRoomManager._create_livekit_room``:

- Property 7 (Idempotent room naming): repeated calls produce a stable
  ``debate-{code}-{debate_id[:8]}`` name that is never overwritten.
  Validates: Requirements 1.11.
- Property 6 (Graceful degradation): when LiveKit is not configured, the
  manager sets no ``livekit_room`` and raises no error, so the debate proceeds.
  Validates: Requirements 1.3.

``app.debate.room_manager.livekit`` is monkeypatched to a fake exposing
``is_available`` (and ``url``) so no real LiveKit configuration is needed.
"""

from __future__ import annotations

import asyncio

import pytest

from app.debate import room_manager as rm_module
from app.debate.room_manager import DebateRoomManager
from app.debate.schemas import DebateRoom, ParticipantInternal


CODE = "ABCDEF"
DEBATE_ID = "1a2b3c4d5e6f7890"


class _FakeLiveKit:
    """Minimal stand-in for ``app.core.livekit_client.livekit``."""

    def __init__(self, available: bool) -> None:
        self.is_available = available
        self.url = "wss://livekit.example"


def _manager_with_room() -> tuple[DebateRoomManager, DebateRoom]:
    mgr = DebateRoomManager()
    room = DebateRoom(
        debate_id=DEBATE_ID,
        code=CODE,
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        state="prep",
        participants=[
            ParticipantInternal(
                participant_id="p-0",
                user_id="uid-0",
                user_email="a@example.com",
                display_name="Alice",
                joined_at=1.0,
                turn_index=0,
            ),
        ],
        created_at=0.0,
    )
    mgr._rooms[CODE] = room
    return mgr, room


def test_create_livekit_room_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two calls yield a stable name; the second never overwrites the first.

    Property 7: Idempotent room naming.
    Validates: Requirements 1.11.
    """
    monkeypatch.setattr(rm_module, "livekit", _FakeLiveKit(available=True))
    mgr, room = _manager_with_room()

    async def scenario() -> tuple[str | None, str | None]:
        await mgr._create_livekit_room(CODE)
        first = room.livekit_room
        await mgr._create_livekit_room(CODE)
        return first, room.livekit_room

    first, second = asyncio.run(scenario())

    assert first == f"debate-{CODE.lower()}-{DEBATE_ID[:8]}"
    assert first  # non-empty
    assert second == first  # unchanged after the second call


def test_create_livekit_room_noop_when_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When LiveKit is not configured, no name is set and nothing raises.

    Property 6: Graceful degradation.
    Validates: Requirements 1.3.
    """
    monkeypatch.setattr(rm_module, "livekit", _FakeLiveKit(available=False))
    mgr, room = _manager_with_room()

    # Must not raise.
    asyncio.run(mgr._create_livekit_room(CODE))

    assert room.livekit_room is None
