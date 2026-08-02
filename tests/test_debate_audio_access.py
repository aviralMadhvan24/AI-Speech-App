"""Tests for debate audio access control (Tasks 4.5, 4.6).

Covers ``app.debate.routes._may_access_debate_audio``:

- Property 5 (Access restricted to participants/teachers): access is granted
  iff the caller is a participant of the turn's own ``debate_id`` or is a
  teacher/admin — evaluated against the turn's stored ``debate_id``, never the
  path ``code`` — so swapping the path code to another debate never grants
  access.
  Validates: Requirements 2.3, 4.1.

Both a live room (``debate_room_manager.get_state`` returns a room) and a
completed/evicted room (``get_state`` returns ``None`` and access resolves
against the persisted participant snapshot) are exercised.

Framework: ``pytest`` example tests + a ``hypothesis`` property test (min 100
examples). ``app.debate.routes``'s ``debate_room_manager`` and ``debates_store``
are monkeypatched so no HTTP layer or real storage is required.
"""

from __future__ import annotations

from unittest import mock

from hypothesis import given, settings
from hypothesis import strategies as st

from app.auth import User
from app.debate import routes
from app.debate.schemas import (
    DebateRecord,
    DebateRoom,
    DebateTurn,
    ParticipantInternal,
)


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _turn(debate_id: str, turn_id: str = "t-1", turn_index: int = 0) -> DebateTurn:
    return DebateTurn(
        turn_id=turn_id,
        debate_id=debate_id,
        participant_id="p-0",
        turn_index=turn_index,
        audio_url=f"/debate/rooms/ABCDEF/audio/{turn_id}",
        audio_key=f"debate-audio/{debate_id}/{turn_id}.webm",
        audio_content_type="audio/webm",
        ai_score=50.0,
        submitted_at=1.0,
    )


def _live_room(code: str, member_uids: list[str]) -> DebateRoom:
    participants = [
        ParticipantInternal(
            participant_id=f"p-{i}",
            user_id=uid,
            user_email=f"{uid}@kiet.edu",
            display_name=f"User {uid}",
            joined_at=1.0,
            turn_index=i,
        )
        for i, uid in enumerate(member_uids)
    ]
    return DebateRoom(
        debate_id="deb-live",
        code=code,
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        state="speaking",
        participants=participants,
        created_at=0.0,
    )


def _record(debate_id: str, member_uids: list[str]) -> DebateRecord:
    return DebateRecord(
        debate_id=debate_id,
        code="ABCDEF",
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        participants=[
            {
                "participant_id": f"p-{i}",
                "user_id": uid,
                "display_name": f"User {uid}",
                "turn_index": i,
                "is_forfeit": False,
            }
            for i, uid in enumerate(member_uids)
        ],
        turn_ids=["t-1"],
        created_at=0.0,
        completed_at=2.0,
    )


def _student(uid: str) -> User:
    return User(uid=uid, email=f"{uid}@kiet.edu", role="student")


def _teacher(uid: str = "teach-1") -> User:
    return User(uid=uid, email=f"{uid}@kiet.edu", role="teacher")


# ---------------------------------------------------------------------------
# 4.5 — Example-based unit tests (live + completed rooms)
# ---------------------------------------------------------------------------


def test_live_room_participant_true(monkeypatch) -> None:
    """A current participant of the live room may access the audio."""
    monkeypatch.setattr(
        routes.debate_room_manager,
        "get_state",
        lambda code: _live_room(code, ["uid-0", "uid-1"]),
    )
    turn = _turn("deb-live")
    assert (
        routes._may_access_debate_audio(_student("uid-0"), code="ABCDEF", turn=turn)
        is True
    )


def test_live_room_non_participant_false(monkeypatch) -> None:
    """A non-participant of the live room is denied."""
    monkeypatch.setattr(
        routes.debate_room_manager,
        "get_state",
        lambda code: _live_room(code, ["uid-0", "uid-1"]),
    )
    turn = _turn("deb-live")
    assert (
        routes._may_access_debate_audio(
            _student("intruder"), code="ABCDEF", turn=turn
        )
        is False
    )


def test_live_room_teacher_true(monkeypatch) -> None:
    """A teacher may review audio even when not a participant."""
    monkeypatch.setattr(
        routes.debate_room_manager,
        "get_state",
        lambda code: _live_room(code, ["uid-0", "uid-1"]),
    )
    turn = _turn("deb-live")
    assert (
        routes._may_access_debate_audio(_teacher(), code="ABCDEF", turn=turn) is True
    )


def test_completed_room_participant_true(monkeypatch) -> None:
    """A participant in the persisted snapshot may access completed audio."""
    monkeypatch.setattr(routes.debate_room_manager, "get_state", lambda code: None)
    monkeypatch.setattr(
        routes.debates_store,
        "load_debate",
        lambda did: _record(did, ["uid-0", "uid-1"]),
    )
    turn = _turn("deb-A")
    assert (
        routes._may_access_debate_audio(_student("uid-1"), code="ABCDEF", turn=turn)
        is True
    )


def test_completed_room_non_participant_false(monkeypatch) -> None:
    """A non-participant is denied for a completed debate."""
    monkeypatch.setattr(routes.debate_room_manager, "get_state", lambda code: None)
    monkeypatch.setattr(
        routes.debates_store,
        "load_debate",
        lambda did: _record(did, ["uid-0", "uid-1"]),
    )
    turn = _turn("deb-A")
    assert (
        routes._may_access_debate_audio(
            _student("intruder"), code="ABCDEF", turn=turn
        )
        is False
    )


def test_completed_room_teacher_true(monkeypatch) -> None:
    """A teacher may review completed audio without being a participant."""
    monkeypatch.setattr(routes.debate_room_manager, "get_state", lambda code: None)
    monkeypatch.setattr(
        routes.debates_store,
        "load_debate",
        lambda did: _record(did, ["uid-0", "uid-1"]),
    )
    turn = _turn("deb-A")
    assert (
        routes._may_access_debate_audio(_teacher(), code="ABCDEF", turn=turn) is True
    )


def test_cross_debate_denied(monkeypatch) -> None:
    """A participant of a *different* debate cannot access this turn's audio.

    The turn belongs to debate ``deb-A``; the caller is only a participant of
    ``deb-B``. Even though they pass ``deb-B``'s path code, access is evaluated
    against the turn's own ``debate_id`` (``deb-A``) and denied.
    """
    monkeypatch.setattr(routes.debate_room_manager, "get_state", lambda code: None)
    # load_debate always resolves against the turn's debate_id (deb-A), whose
    # snapshot does NOT include the caller.
    monkeypatch.setattr(
        routes.debates_store,
        "load_debate",
        lambda did: _record(did, ["uid-0", "uid-1"]),
    )
    turn = _turn("deb-A")
    # Caller is a participant of deb-B, using deb-B's path code.
    assert (
        routes._may_access_debate_audio(
            _student("uid-b"), code="BBBBBB", turn=turn
        )
        is False
    )


def test_no_room_no_record_denied(monkeypatch) -> None:
    """When neither a live room nor a persisted record exists, deny."""
    monkeypatch.setattr(routes.debate_room_manager, "get_state", lambda code: None)
    monkeypatch.setattr(routes.debates_store, "load_debate", lambda did: None)
    turn = _turn("deb-A")
    assert (
        routes._may_access_debate_audio(_student("uid-0"), code="ABCDEF", turn=turn)
        is False
    )


# ---------------------------------------------------------------------------
# 4.6 — Property test (Property 5)
# ---------------------------------------------------------------------------


_UIDS = ["uid-0", "uid-1", "uid-2", "uid-3", "intruder"]


@given(
    member_uids=st.lists(st.sampled_from(_UIDS), min_size=0, max_size=5, unique=True),
    caller_uid=st.sampled_from(_UIDS),
    is_teacher=st.booleans(),
    path_code=st.sampled_from(["ABCDEF", "BBBBBB", "ZZZZZZ"]),
)
@settings(max_examples=200, deadline=None)
def test_access_iff_participant_or_teacher(
    member_uids, caller_uid, is_teacher, path_code
) -> None:
    """Access is True iff caller is a participant of turn.debate_id OR teacher.

    The completed/evicted path is modelled (``get_state`` returns ``None``) so
    access resolves against the persisted snapshot of the turn's own
    ``debate_id``. The path ``code`` is varied to prove it never affects the
    decision.

    Property 5: Access restricted to participants/teachers.
    Validates: Requirements 2.3, 4.1.

    ``mock.patch.object`` context managers (rather than the function-scoped
    ``monkeypatch`` fixture) are used so the patches reset for every generated
    input.
    """
    turn = _turn("deb-A")
    caller = _teacher(caller_uid) if is_teacher else _student(caller_uid)
    expected = is_teacher or (caller_uid in member_uids)

    with mock.patch.object(
        routes.debate_room_manager, "get_state", lambda code: None
    ), mock.patch.object(
        routes.debates_store, "load_debate", lambda did: _record(did, member_uids)
    ):
        result = routes._may_access_debate_audio(caller, code=path_code, turn=turn)

    assert result is expected
