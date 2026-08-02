"""Integration tests for the debate LiveKit + audio HTTP routes (Tasks 4.7-4.9).

Uses FastAPI's ``TestClient`` against the real ``app`` with ``require_user``
overridden per test to simulate different callers (participant, non-participant,
teacher). ``app.debate.routes.livekit`` and the storage lookups are monkeypatched
so no LiveKit configuration or on-disk JSONL is required.

- 4.7 Token status-code matrix (Property 2: token requires membership +
  configuration). Validates: Requirements 1.2, 1.4, 1.5, 1.6, 1.7.
- 4.8 Audio-serve access (Property 5: access restricted to
  participants/teachers). Validates: Requirements 2.3, 2.7, 2.8, 2.9, 2.10.
- 4.9 my-debates / detail audio refs. Validates: Requirements 3.1, 3.4, 3.5.
"""

from __future__ import annotations

import contextlib

import pytest
from fastapi.testclient import TestClient

from app.auth import User, require_user
from app.debate import routes
from app.debate.audio_store import LocalDiskAudioStore
from app.debate.room_manager import debate_room_manager
from app.debate.schemas import (
    DebateRecord,
    DebateRoom,
    DebateTurn,
    DebateTurnAudioRef,
    ParticipantInternal,
)
from app.main import app


CODE = "ABCDEF"
client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_state():
    """Reset in-memory rooms and dependency overrides after every test."""
    yield
    debate_room_manager._rooms.clear()
    app.dependency_overrides.pop(require_user, None)


@contextlib.contextmanager
def _as_user(user: User):
    app.dependency_overrides[require_user] = lambda: user
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_user, None)


def _student(uid: str) -> User:
    return User(uid=uid, email=f"{uid}@kiet.edu", role="student")


def _teacher(uid: str = "teach-1") -> User:
    return User(uid=uid, email=f"{uid}@kiet.edu", role="teacher")


class _FakeLK:
    def __init__(self, available: bool = True, token: str = "jwt-token") -> None:
        self.is_available = available
        self.url = "wss://lk.example"
        self._token = token

    def create_token(self, **kwargs) -> str | None:
        return self._token


def _seed_room(members: list[str], livekit_room: str | None) -> DebateRoom:
    participants = [
        ParticipantInternal(
            participant_id=f"p-{i}",
            user_id=uid,
            user_email=f"{uid}@kiet.edu",
            display_name=f"User {uid}",
            joined_at=1.0,
            turn_index=i,
        )
        for i, uid in enumerate(members)
    ]
    room = DebateRoom(
        debate_id="deadbeefcafe1234",
        code=CODE,
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        state="speaking",
        participants=participants,
        created_at=0.0,
        livekit_room=livekit_room,
    )
    debate_room_manager._rooms[CODE] = room
    return room


def _record(debate_id: str, members: list[str], turn_audio=None) -> DebateRecord:
    return DebateRecord(
        debate_id=debate_id,
        code=CODE,
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
            for i, uid in enumerate(members)
        ],
        turn_ids=["t-0", "t-1"],
        created_at=0.0,
        completed_at=2.0,
        turn_audio=turn_audio or [],
    )


# ---------------------------------------------------------------------------
# 4.7 — Token status-code matrix (Property 2)
# ---------------------------------------------------------------------------


def test_token_200_participant_configured(monkeypatch) -> None:
    _seed_room(["uid-0", "uid-1"], livekit_room="debate-abcdef-deadbeef")
    monkeypatch.setattr(routes, "livekit", _FakeLK(available=True))
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/livekit-token")
    assert r.status_code == 200
    body = r.json()
    assert body["token"] == "jwt-token"
    assert body["url"] == "wss://lk.example"
    assert body["room"] == "debate-abcdef-deadbeef"
    # No email / uid in the response body.
    assert set(body) == {"token", "url", "room"}
    assert "user_id" not in r.text and "email" not in r.text


def test_token_404_unknown_room(monkeypatch) -> None:
    monkeypatch.setattr(routes, "livekit", _FakeLK(available=True))
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/livekit-token")
    assert r.status_code == 404
    assert r.json()["detail"] == "room_not_found"


def test_token_403_not_a_participant(monkeypatch) -> None:
    _seed_room(["uid-0", "uid-1"], livekit_room="debate-abcdef-deadbeef")
    monkeypatch.setattr(routes, "livekit", _FakeLK(available=True))
    with _as_user(_student("intruder")):
        r = client.get(f"/debate/rooms/{CODE}/livekit-token")
    assert r.status_code == 403
    assert r.json()["detail"] == "not_a_participant"


def test_token_503_livekit_not_configured(monkeypatch) -> None:
    _seed_room(["uid-0"], livekit_room="debate-abcdef-deadbeef")
    monkeypatch.setattr(routes, "livekit", _FakeLK(available=False))
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/livekit-token")
    assert r.status_code == 503
    assert r.json()["detail"] == "livekit_not_configured"


def test_token_400_audio_not_ready(monkeypatch) -> None:
    _seed_room(["uid-0"], livekit_room=None)
    monkeypatch.setattr(routes, "livekit", _FakeLK(available=True))
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/livekit-token")
    assert r.status_code == 400
    assert r.json()["detail"] == "audio_not_ready"


def test_token_500_generation_failed(monkeypatch) -> None:
    _seed_room(["uid-0"], livekit_room="debate-abcdef-deadbeef")
    monkeypatch.setattr(routes, "livekit", _FakeLK(available=True, token=None))
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/livekit-token")
    assert r.status_code == 500
    assert r.json()["detail"] == "token_generation_failed"


# ---------------------------------------------------------------------------
# 4.8 — Audio-serve access (Property 5)
# ---------------------------------------------------------------------------


def _setup_completed_audio(
    monkeypatch,
    tmp_path,
    members: list[str],
    *,
    debate_id: str = "deb-A",
    turn_id: str = "t-0",
    put_blob: bool = True,
) -> bytes:
    """Wire a completed debate with (optionally) a stored turn blob."""
    store = LocalDiskAudioStore(root=tmp_path / "debate-audio")
    key = store.key_for(debate_id, turn_id, "webm")
    blob = b"RIFF-fake-webm-audio-bytes"
    if put_blob:
        src = tmp_path / "src.webm"
        src.write_bytes(blob)
        store.put(key, str(src))

    turn = DebateTurn(
        turn_id=turn_id,
        debate_id=debate_id,
        participant_id="p-0",
        turn_index=0,
        audio_url=f"/debate/rooms/{CODE}/audio/{turn_id}",
        audio_key=key,
        audio_content_type="audio/webm",
        ai_score=50.0,
        submitted_at=1.0,
    )

    monkeypatch.setattr(routes, "get_audio_store", lambda: store)
    monkeypatch.setattr(
        routes.debate_turns_store,
        "load_turn",
        lambda tid: turn if tid == turn_id else None,
    )
    monkeypatch.setattr(
        routes.debates_store,
        "load_debate",
        lambda did: _record(did, members) if did == debate_id else None,
    )
    return blob


def test_audio_participant_200(monkeypatch, tmp_path) -> None:
    blob = _setup_completed_audio(monkeypatch, tmp_path, ["uid-0", "uid-1"])
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/audio/t-0")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/webm")
    assert r.content == blob


def test_audio_teacher_200(monkeypatch, tmp_path) -> None:
    _setup_completed_audio(monkeypatch, tmp_path, ["uid-0", "uid-1"])
    with _as_user(_teacher()):
        r = client.get(f"/debate/rooms/{CODE}/audio/t-0")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/webm")


def test_audio_cross_debate_403(monkeypatch, tmp_path) -> None:
    """A participant of a different debate is denied even via another code."""
    _setup_completed_audio(monkeypatch, tmp_path, ["uid-0", "uid-1"])
    # Caller uid-b is not in deb-A's snapshot; using a different path code
    # ("BBBBBB") must not grant access.
    with _as_user(_student("uid-b")):
        r = client.get("/debate/rooms/BBBBBB/audio/t-0")
    assert r.status_code == 403
    assert r.json()["detail"] == "not_authorized"


def test_audio_missing_turn_404(monkeypatch, tmp_path) -> None:
    _setup_completed_audio(monkeypatch, tmp_path, ["uid-0"])
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/audio/unknown-turn")
    assert r.status_code == 404
    assert r.json()["detail"] == "audio_not_available"


def test_audio_absent_blob_404(monkeypatch, tmp_path) -> None:
    _setup_completed_audio(monkeypatch, tmp_path, ["uid-0"], put_blob=False)
    with _as_user(_student("uid-0")):
        r = client.get(f"/debate/rooms/{CODE}/audio/t-0")
    assert r.status_code == 404
    assert r.json()["detail"] == "audio_file_not_found"


# ---------------------------------------------------------------------------
# 4.9 — my-debates / detail audio refs
# ---------------------------------------------------------------------------


def _completed_record_with_audio() -> DebateRecord:
    # Deliberately out of order to assert the endpoints sort by turn_index.
    refs = [
        DebateTurnAudioRef(
            turn_index=1,
            participant_id="p-1",
            display_name="Bob",
            audio_url=None,
            is_forfeit=True,
        ),
        DebateTurnAudioRef(
            turn_index=0,
            participant_id="p-0",
            display_name="Alice",
            audio_url="/debate/rooms/ABCDEF/audio/t-0",
            is_forfeit=False,
        ),
    ]
    return _record("deb-A", ["uid-0", "uid-1"], turn_audio=refs)


def test_my_debates_returns_ordered_audio_refs(monkeypatch) -> None:
    record = _completed_record_with_audio()
    monkeypatch.setattr(
        routes.debates_store, "list_debates_for_user", lambda uid: [record]
    )
    monkeypatch.setattr(
        routes.debate_turns_store, "list_turns_for_debate", lambda did: []
    )
    with _as_user(_student("uid-0")):
        r = client.get("/debate/my-debates")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    audio = entries[0]["turn_audio"]
    assert [a["turn_index"] for a in audio] == [0, 1]
    assert audio[0]["display_name"] == "Alice"
    assert audio[0]["is_forfeit"] is False
    assert audio[1]["display_name"] == "Bob"
    assert audio[1]["is_forfeit"] is True
    assert audio[1]["audio_url"] is None
    # PII-safe.
    assert "user_email" not in r.text and "user_id" not in r.text


def test_debate_detail_returns_ordered_audio_refs(monkeypatch) -> None:
    record = _completed_record_with_audio()
    monkeypatch.setattr(
        routes.debates_store,
        "load_debate",
        lambda did: record if did == "deb-A" else None,
    )
    with _as_user(_student("uid-1")):
        r = client.get("/debate/debates/deb-A")
    assert r.status_code == 200
    body = r.json()
    assert body["debate_id"] == "deb-A"
    assert body["code"] == CODE
    assert body["motion"]["id"] == "m-1"
    assert [a["turn_index"] for a in body["turn_audio"]] == [0, 1]
    assert "user_email" not in r.text and "user_id" not in r.text


def test_debate_detail_403_non_participant(monkeypatch) -> None:
    record = _completed_record_with_audio()
    monkeypatch.setattr(
        routes.debates_store,
        "load_debate",
        lambda did: record if did == "deb-A" else None,
    )
    with _as_user(_student("intruder")):
        r = client.get("/debate/debates/deb-A")
    assert r.status_code == 403
    assert r.json()["detail"] == "not_authorized"


def test_debate_detail_404_unknown(monkeypatch) -> None:
    monkeypatch.setattr(routes.debates_store, "load_debate", lambda did: None)
    with _as_user(_student("uid-0")):
        r = client.get("/debate/debates/nope")
    assert r.status_code == 404
    assert r.json()["detail"] == "debate_not_found"
