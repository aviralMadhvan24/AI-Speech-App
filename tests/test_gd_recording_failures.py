"""Tests for how a failed GD recording is reported.

Two group discussions (DWWZWX and 8ZZV3V, two students each) were recorded as
nothing at all while LiveKit was down, and every log line on the way through
said INFO or WARNING — ending with "GD scoring complete". The failure was only
visible by reading the log line by line and noticing that "found 0
participants" was not normal.

These tests pin the distinction that was missing:

- LiveKit not answering raises ``LiveKitUnreachableError`` rather than
  reporting an empty room, so the caller can tell an outage from a quiet
  discussion.
- LiveKit answering with an empty room still fails the recording, but is not
  an outage.
- Either way the room carries a human-readable ``recording_failed`` reason,
  which is what stops scoring from reporting a clean completion.
"""

from __future__ import annotations

import asyncio

import pytest

from app.core.egress_client import EgressClient, LiveKitUnreachableError


class _FakeRoomService:
    """Stands in for ``LiveKitAPI.room``."""

    def __init__(self, error=None, participants=None):
        self._error = error
        self._participants = participants or []

    async def list_participants(self, _request):
        if self._error is not None:
            raise self._error

        class _Response:
            participants = self._participants

        return _Response()


class _FakeAPI:
    def __init__(self, room_service):
        self.room = room_service

    async def aclose(self):
        return None


def _client(room_service) -> EgressClient:
    client = EgressClient()
    client.api_key = "key"
    client.api_secret = "secret"
    client.url = "ws://livekit.example"
    client._get_api = lambda: _FakeAPI(room_service)
    return client


def test_unreachable_livekit_raises_rather_than_reporting_an_empty_room():
    """A connection failure must not look like "nobody is in the room"."""
    client = _client(
        _FakeRoomService(error=ConnectionRefusedError("connection refused"))
    )

    with pytest.raises(LiveKitUnreachableError) as excinfo:
        asyncio.run(client.get_room_participants("gd-dwwzwx-130ef6c4"))

    # The message has to carry the room and the underlying cause, because this
    # is the only record of why a discussion recorded nothing.
    assert "gd-dwwzwx-130ef6c4" in str(excinfo.value)
    assert "connection refused" in str(excinfo.value)


def test_start_all_track_egresses_raises_when_livekit_never_answers(monkeypatch):
    """Exhausting the retries against a dead LiveKit is a failure, not a result."""
    # Don't actually wait out the 5s backoff between the four attempts.
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    client = _client(
        _FakeRoomService(error=ConnectionRefusedError("connection refused"))
    )

    with pytest.raises(LiveKitUnreachableError):
        asyncio.run(
            client.start_all_track_egresses(
                room_name="gd-dwwzwx-130ef6c4",
                session_id="130ef6c4bfe84c909b9544e93ab622b4",
            )
        )


def test_empty_room_returns_no_egresses_without_claiming_an_outage(monkeypatch):
    """LiveKit answering "nobody here" is a different failure from being down."""
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    client = _client(_FakeRoomService(participants=[]))

    started = asyncio.run(
        client.start_all_track_egresses(
            room_name="gd-8zzv3v-ae46ba27",
            session_id="ae46ba273a6a4702ba6034de57334573",
        )
    )

    assert started == {}


async def _no_sleep(_seconds):
    return None


def test_room_manager_records_why_the_recording_failed():
    """The reason has to survive on the room, not just in a log line."""
    from app.gd.room_manager import GDRoomManager

    mgr = GDRoomManager()
    room = _minimal_room()
    mgr._rooms[room.code] = room

    mgr._mark_recording_failed(room.code, "the recording server was unreachable")

    assert room.recording_failed == "the recording server was unreachable"


def test_a_fresh_room_has_no_recording_failure():
    assert _minimal_room().recording_failed is None


def _minimal_room():
    from app.gd.schemas import GDRoom

    return GDRoom(
        session_id="130ef6c4bfe84c909b9544e93ab622b4",
        code="DWWZWX",
        topic_id="t-1",
        topic_title="Remote work",
        topic_text="Is remote work better?",
        topic_category="general",
        created_at=0.0,
    )
