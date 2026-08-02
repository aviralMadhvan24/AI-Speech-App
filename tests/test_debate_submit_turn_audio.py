"""Tests for debate turn-audio persistence in ``submit_turn`` (Tasks 3.5, 3.6).

Covers the refactored ``DebateRoomManager.submit_turn`` audio path plus the
forfeit path, exercising the real manager code with a fake ``AudioBlobStore``:

- Property 3 (Every non-forfeit completed turn has retrievable audio): a
  successful ``submit_turn`` records a non-null ``audio_key``/``audio_url`` and
  puts the blob under ``debate-audio/{debate_id}/{turn_id}.{ext}``; a store
  failure keeps the turn (scoring intact) with both nulled; a forfeit turn has
  all three audio fields null.
  Validates: Requirements 2.2, 2.4, 2.5.
- Property 4 (Audio-URL consistency): for every generated turn,
  ``audio_url is not None`` iff ``audio_key is not None``.
  Validates: Requirements 2.1.

Framework: plain ``pytest`` example tests plus a ``hypothesis`` property test
(min 100 examples).
"""

from __future__ import annotations

import asyncio
from unittest import mock

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.audio.schemas import AudioAsset
from app.auth import User
from app.debate import room_manager as rm_module
from app.debate.room_manager import DebateRoomManager
from app.debate.schemas import DebateRoom, DebateTurn, ParticipantInternal


CODE = "ABCDEF"
DEBATE_ID = "deb1234abcd5678"


class _FakeStore:
    """In-memory stand-in for the ``AudioBlobStore`` protocol."""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.puts: list[tuple[str, str]] = []

    def key_for(self, debate_id: str, turn_id: str, ext: str) -> str:
        normalized = (ext or "").lstrip(".").lower() or "webm"
        return f"debate-audio/{debate_id}/{turn_id}.{normalized}"

    def put(self, key: str, src_path: str) -> None:
        if self.fail:
            raise IOError("simulated store failure")
        self.puts.append((key, src_path))


class _Tx:
    """Minimal transcription stub exposing ``.text``."""

    def __init__(self, text: str) -> None:
        self.text = text


async def _fake_score(**kwargs):
    """Async stand-in for ``compute_ai_score_with_content``."""
    return 75.0, False, {"content": {"total": 40.0, "feedback": "solid"}}


def _asset(ext: str = "webm") -> AudioAsset:
    return AudioAsset(
        audio_id="aud-1",
        original_path=f"uploads/original.{ext}",
        processed_path=f"uploads/processed.{ext}",
    )


def _speaking_manager() -> tuple[DebateRoomManager, DebateRoom, User]:
    """A manager with a 2-participant room in ``speaking`` (active = turn 0).

    Two participants ensure submitting/forfeiting turn 0 advances to turn 1
    rather than triggering the finalize/persist path.
    """
    mgr = DebateRoomManager()
    p0 = ParticipantInternal(
        participant_id="p-0",
        user_id="uid-0",
        user_email="a@example.com",
        display_name="Alice",
        joined_at=1.0,
        turn_index=0,
    )
    p1 = ParticipantInternal(
        participant_id="p-1",
        user_id="uid-1",
        user_email="b@example.com",
        display_name="Bob",
        joined_at=1.0,
        turn_index=1,
    )
    room = DebateRoom(
        debate_id=DEBATE_ID,
        code=CODE,
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        state="speaking",
        active_turn_index=0,
        participants=[p0, p1],
        created_at=0.0,
    )
    mgr._rooms[CODE] = room
    user = User(uid="uid-0", email="a@example.com", name="Alice")
    return mgr, room, user


def _run_submit(
    store_fails: bool, ext: str = "webm"
) -> tuple[DebateTurn, _FakeStore, list[DebateTurn]]:
    """Drive the real ``submit_turn`` with a fake store; return the turn."""
    mgr, _room, user = _speaking_manager()
    fake_store = _FakeStore(fail=store_fails)
    saved: list[DebateTurn] = []

    with mock.patch.object(rm_module, "get_audio_store", return_value=fake_store), \
        mock.patch.object(rm_module, "compute_ai_score_with_content", new=_fake_score), \
        mock.patch.object(
            rm_module.debate_turns_store, "save_turn", new=saved.append
        ):
        turn, _room = asyncio.run(
            mgr.submit_turn(
                code=CODE,
                user=user,
                audio_asset=_asset(ext),
                transcription=_Tx("hello world"),
                pronunciation=None,
                fluency=None,
                analysis_id="an-1",
            )
        )
    mgr._cancel_all_timers(CODE)
    return turn, fake_store, saved


def _run_forfeit() -> DebateTurn:
    """Drive the real forfeit path; return the persisted forfeit turn."""
    mgr, _room, _user = _speaking_manager()
    saved: list[DebateTurn] = []
    with mock.patch.object(
        rm_module.debate_turns_store, "save_turn", new=saved.append
    ):
        asyncio.run(mgr.advance_or_forfeit(CODE, reason="timeout"))
    mgr._cancel_all_timers(CODE)
    assert saved, "expected a forfeit turn to be persisted"
    return saved[0]


# ---------------------------------------------------------------------------
# 3.5 — Example-based unit tests (Property 3)
# ---------------------------------------------------------------------------


def test_submit_turn_persists_audio_on_success() -> None:
    """A stored turn has a non-null key/url, content type, and a put() call.

    Property 3: Every non-forfeit completed turn has retrievable audio.
    Validates: Requirements 2.2.
    """
    turn, fake_store, saved = _run_submit(store_fails=False)

    expected_key = f"debate-audio/{turn.debate_id}/{turn.turn_id}.webm"
    assert turn.audio_key == expected_key
    assert turn.audio_url == f"/debate/rooms/{CODE}/audio/{turn.turn_id}"
    assert turn.audio_content_type == "audio/webm"
    assert turn.forfeit_reason is None
    # The fake store received exactly one put(key, src).
    assert fake_store.puts == [(expected_key, "uploads/processed.webm")]
    assert saved and saved[0].turn_id == turn.turn_id


def test_submit_turn_store_failure_nulls_audio_keeps_scoring() -> None:
    """A store failure persists the turn with null audio but intact scoring.

    Property 3 (failure mode) / Validates: Requirements 2.4.
    """
    turn, fake_store, saved = _run_submit(store_fails=True)

    assert turn.audio_key is None
    assert turn.audio_url is None
    assert turn.audio_content_type is None
    # Scoring is preserved even though audio persistence failed.
    assert turn.ai_score == 75.0
    assert turn.scoring_unavailable is False
    assert fake_store.puts == []
    assert saved and saved[0].turn_id == turn.turn_id


def test_forfeit_turn_has_no_audio() -> None:
    """A forfeit turn has all three audio fields null.

    Validates: Requirements 2.5.
    """
    turn = _run_forfeit()

    assert turn.forfeit_reason == "timeout"
    assert turn.audio_key is None
    assert turn.audio_url is None
    assert turn.audio_content_type is None


# ---------------------------------------------------------------------------
# 3.6 — Property test for audio_url <=> audio_key consistency (Property 4)
# ---------------------------------------------------------------------------


@given(is_forfeit=st.booleans(), store_fails=st.booleans())
@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
def test_audio_url_iff_audio_key(is_forfeit: bool, store_fails: bool) -> None:
    """For every generated turn: audio_url is not None iff audio_key is not None.

    Property 4: Audio-URL consistency.
    Validates: Requirements 2.1.
    """
    if is_forfeit:
        turn = _run_forfeit()
    else:
        turn, _store, _saved = _run_submit(store_fails=store_fails)

    assert (turn.audio_url is not None) == (turn.audio_key is not None)
