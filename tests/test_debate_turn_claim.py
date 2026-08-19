"""The speaking clock must not keep running while a turn is being scored.

The bug this pins: `upload_turn` validated the turn, then ran ffmpeg + Whisper
+ an LLM content call with the 135s turn timer still ticking. A speaker who
used their full two minutes had ~15s of grace for a pipeline that takes far
longer, so the timer forfeited them at 0 — and when their real score finally
arrived it was rejected as `not_your_turn` and thrown away. Both speakers doing
this is how a debate ends up reading 0 to 0.

The rule these tests defend: the turn deadline bounds how long someone may
TALK. Once their audio is in, nothing about how long the server takes to grade
it may cost them the turn.
"""

from __future__ import annotations

import asyncio
from unittest import mock

import pytest

from app.audio.schemas import AudioAsset
from app.auth import User
from app.debate import room_manager as rm_module
from app.debate.room_manager import DebateRoomManager
from app.debate.schemas import DebateRoom, DebateTurn, ParticipantInternal


CODE = "ABCDEF"
DEBATE_ID = "deb1234abcd5678"

ALICE = User(uid="uid-0", email="a@example.com", name="Alice")
BOB = User(uid="uid-1", email="b@example.com", name="Bob")


class _FakeStore:
    def key_for(self, debate_id: str, turn_id: str, ext: str) -> str:
        return f"debate-audio/{debate_id}/{turn_id}.{(ext or 'webm').lstrip('.')}"

    def put(self, key: str, src_path: str) -> None:
        pass


class _Tx:
    def __init__(self, text: str) -> None:
        self.text = text


async def _fake_score(**kwargs):
    return 75.0, False, {"content": {"total": 40.0, "feedback": "solid"}}


def _asset() -> AudioAsset:
    return AudioAsset(
        audio_id="aud-1",
        original_path="uploads/original.webm",
        processed_path="uploads/processed.webm",
    )


def _speaking_manager() -> tuple[DebateRoomManager, DebateRoom]:
    """Two participants, room in `speaking`, Alice (turn 0) active."""
    participants = [
        ParticipantInternal(
            participant_id="p-0",
            user_id="uid-0",
            user_email="a@example.com",
            display_name="Alice",
            joined_at=1.0,
            turn_index=0,
        ),
        ParticipantInternal(
            participant_id="p-1",
            user_id="uid-1",
            user_email="b@example.com",
            display_name="Bob",
            joined_at=1.0,
            turn_index=1,
        ),
    ]
    room = DebateRoom(
        debate_id=DEBATE_ID,
        code=CODE,
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        state="speaking",
        active_turn_index=0,
        turn_deadline=1000.0,
        participants=participants,
        created_at=0.0,
    )
    mgr = DebateRoomManager()
    mgr._rooms[CODE] = room
    return mgr, room


async def _claim(mgr: DebateRoomManager, user: User = ALICE):
    with mock.patch.object(mgr, "broadcast", new=mock.AsyncMock()):
        return await mgr.claim_turn(CODE, user)


async def _submit(mgr: DebateRoomManager, saved: list, user: User = ALICE):
    with mock.patch.object(rm_module, "get_audio_store", return_value=_FakeStore()), \
        mock.patch.object(rm_module, "compute_ai_score_with_content", new=_fake_score), \
        mock.patch.object(rm_module.debate_turns_store, "save_turn", new=saved.append), \
        mock.patch.object(mgr, "broadcast", new=mock.AsyncMock()):
        return await mgr.submit_turn(
            code=CODE,
            user=user,
            audio_asset=_asset(),
            transcription=_Tx("hello world this is my argument"),
            pronunciation=None,
            fluency=None,
            analysis_id="an-1",
        )


# --- The clock stops when the audio arrives -------------------------------


def test_claiming_a_turn_stops_the_speaking_clock():
    mgr, room = _speaking_manager()

    asyncio.run(_claim(mgr))

    assert room.scoring_participant_id == "p-0"
    # A cleared deadline is what stops the countdown on every client.
    assert room.turn_deadline is None
    mgr._cancel_all_timers(CODE)


def test_a_timeout_cannot_forfeit_a_turn_that_is_being_scored():
    """The whole bug in one assertion: no 0 while the real score is computing."""
    mgr, room = _speaking_manager()
    saved: list[DebateTurn] = []

    async def scenario():
        await _claim(mgr)
        # The old turn timer firing mid-pipeline is exactly what wrote the 0.
        with mock.patch.object(rm_module.debate_turns_store, "save_turn", new=saved.append), \
            mock.patch.object(mgr, "broadcast", new=mock.AsyncMock()):
            await mgr.advance_or_forfeit(CODE, reason="timeout")

    asyncio.run(scenario())

    assert saved == [], "a turn being scored must not be forfeited at 0"
    assert room.active_turn_index == 0, "the room must not advance past them"
    mgr._cancel_all_timers(CODE)


def test_a_score_that_finishes_after_the_old_deadline_is_still_accepted():
    mgr, room = _speaking_manager()
    saved: list[DebateTurn] = []

    async def scenario():
        await _claim(mgr)
        return await _submit(mgr, saved)

    turn, _ = asyncio.run(scenario())

    assert turn.ai_score == 75.0
    assert turn.forfeit_reason is None
    assert turn.turn_index == 0
    assert room.scoring_participant_id is None, "the claim must be cleared"
    assert room.active_turn_index == 1, "and the debate moves on"
    mgr._cancel_all_timers(CODE)


def test_a_partner_disconnecting_mid_scoring_does_not_discard_the_score():
    """`paused` flipping on during analysis used to turn the result into a 409."""
    mgr, room = _speaking_manager()
    saved: list[DebateTurn] = []

    async def scenario():
        await _claim(mgr)
        room.paused = True  # Bob's socket dropped while Alice was being scored
        return await _submit(mgr, saved)

    turn, _ = asyncio.run(scenario())

    assert turn.ai_score == 75.0
    assert saved and saved[0].forfeit_reason is None
    mgr._cancel_all_timers(CODE)


def test_a_disconnect_forfeit_does_not_overwrite_a_turn_being_scored():
    mgr, room = _speaking_manager()
    saved: list[DebateTurn] = []

    async def scenario():
        await _claim(mgr)
        mgr._reconnect_targets[CODE] = "p-0"
        with mock.patch.object(rm_module.debate_turns_store, "save_turn", new=saved.append), \
            mock.patch.object(mgr, "broadcast", new=mock.AsyncMock()):
            await mgr.advance_or_forfeit(
                CODE, reason="reconnect_timeout", participant_id="p-0"
            )

    asyncio.run(scenario())

    assert saved == [], "the speech happened — it must not be scored 0"
    mgr._cancel_all_timers(CODE)


# --- Guard rails ----------------------------------------------------------


def test_a_second_upload_for_the_same_turn_is_refused():
    """Two claims would score the same speech twice and save two rows."""
    mgr, _room = _speaking_manager()

    async def scenario():
        await _claim(mgr)
        return await _claim(mgr)

    with pytest.raises(ValueError, match="already_scoring"):
        asyncio.run(scenario())
    mgr._cancel_all_timers(CODE)


def test_someone_elses_turn_still_cannot_be_claimed():
    mgr, _room = _speaking_manager()

    with pytest.raises(ValueError, match="not_your_turn"):
        asyncio.run(_claim(mgr, BOB))
    mgr._cancel_all_timers(CODE)


def test_releasing_a_claim_gives_the_speaker_a_retry_window():
    """A failed analysis is not their fault, so it costs a retry, not the turn."""
    mgr, room = _speaking_manager()

    async def scenario():
        await _claim(mgr)
        with mock.patch.object(mgr, "broadcast", new=mock.AsyncMock()):
            await mgr.release_turn_claim(CODE, ALICE)

    asyncio.run(scenario())

    assert room.scoring_participant_id is None
    assert room.turn_deadline is not None, "they get a window to try again"
    assert room.active_turn_index == 0, "and keep their turn"
    mgr._cancel_all_timers(CODE)


def test_the_claim_is_never_projected_to_clients():
    """Internal bookkeeping must not leak into the broadcast payload."""
    mgr, room = _speaking_manager()
    asyncio.run(_claim(mgr))

    public = rm_module.to_public(room).model_dump()

    assert "scoring_participant_id" not in public
    mgr._cancel_all_timers(CODE)
