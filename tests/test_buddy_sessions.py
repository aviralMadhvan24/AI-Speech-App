"""Sessions — the countable unit of practice inside a cycle.

Two rules carry most of the weight here: a session cannot exist without a cycle
to belong to, and completing one is idempotent per side, so the mentor's
observation and the mentee's reflection never overwrite each other.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy.routes import router as buddy_router
from app.storage.buddy import BuddySessionsStore
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store


MENTOR = User(uid="u-mentor", email="mentor@x.com", name="Mentor", role="student")
MENTEE = User(uid="u-mentee", email="mentee@x.com", name="Mentee", role="student")
STRANGER = User(uid="u-stranger", email="stranger@x.com", role="student")
TEACHER = User(uid="u-teacher", email="teacher@x.com", role="teacher")

WHEN = "2026-08-20T15:00:00+00:00"


@pytest.fixture()
def buddy_app(tmp_path, monkeypatch):
    monkeypatch.setattr(mentors_store, "path", tmp_path / "mentors.jsonl")
    monkeypatch.setattr(buddy_pairs_store, "path", tmp_path / "pairs.jsonl")
    monkeypatch.setattr(buddy_messages_store, "path", tmp_path / "messages.jsonl")
    monkeypatch.setattr(buddy_cycles_store, "path", tmp_path / "cycles.jsonl")
    monkeypatch.setattr(buddy_sessions_store, "path", tmp_path / "sessions.jsonl")

    from app.storage import users_store

    monkeypatch.setattr(users_store, "get_by_email", lambda email: None)

    app = FastAPI()
    app.include_router(buddy_router)

    current: dict[str, User] = {"user": MENTEE}

    def _current_user() -> User:
        return current["user"]

    def _current_teacher() -> User:
        user = current["user"]
        if not user.is_teacher:
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="teacher_only")
        return user

    app.dependency_overrides[require_user] = _current_user
    app.dependency_overrides[require_teacher] = _current_teacher

    client = TestClient(app)
    client.as_ = lambda user: current.__setitem__("user", user)
    return client


@pytest.fixture()
def pair(buddy_app):
    return buddy_pairs_store.create(
        mentor_email=MENTOR.email,
        mentee_email=MENTEE.email,
        created_by=TEACHER.email,
    )


@pytest.fixture()
def cycled(buddy_app, pair):
    """A pair with an open cycle — the only state sessions can be planned in."""
    buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email=MENTEE.email,
        starts_at="2026-08-01T00:00:00+00:00",
        ends_at="2026-09-01T00:00:00+00:00",
        created_by=TEACHER.email,
    )
    return pair


def _plan(buddy_app, pair_id, **body):
    return buddy_app.post(
        f"/buddy/pairs/{pair_id}/sessions",
        json={"scheduled_at": WHEN, **body},
    )


# --- Store ----------------------------------------------------------------


def test_completing_twice_keeps_both_sides_notes(tmp_path):
    store = BuddySessionsStore(path=tmp_path / "sessions.jsonl")
    session = store.create(
        pair_id="p1", cycle_id="c1", scheduled_at=WHEN, created_by=MENTOR.email
    )

    store.complete(session.session_id, note="Rushed the opening", is_mentor=True)
    updated = store.complete(
        session.session_id, note="Need to slow down", is_mentor=False
    )

    assert updated.mentor_notes == "Rushed the opening"
    assert updated.mentee_reflection == "Need to slow down"
    assert updated.status == "completed"


def test_the_completion_time_is_not_moved_by_a_second_call(tmp_path):
    store = BuddySessionsStore(path=tmp_path / "sessions.jsonl")
    session = store.create(
        pair_id="p1", cycle_id="c1", scheduled_at=WHEN, created_by=MENTOR.email
    )

    first = store.complete(session.session_id, note="a", is_mentor=True)
    second = store.complete(session.session_id, note="b", is_mentor=False)

    assert second.completed_at == first.completed_at


def test_sessions_are_listed_in_the_order_they_will_happen(tmp_path):
    store = BuddySessionsStore(path=tmp_path / "sessions.jsonl")
    for at in ("2026-08-25T10:00:00+00:00", "2026-08-11T10:00:00+00:00"):
        store.create(pair_id="p1", cycle_id="c1", scheduled_at=at, created_by="x@y.com")

    assert [s.scheduled_at[:10] for s in store.list_for_cycle("c1")] == [
        "2026-08-11",
        "2026-08-25",
    ]


# --- Planning -------------------------------------------------------------


def test_either_side_may_plan_a_session(buddy_app, cycled):
    for user in (MENTOR, MENTEE):
        buddy_app.as_(user)
        assert _plan(buddy_app, cycled.pair_id).status_code == 200


def test_a_session_needs_a_cycle_to_belong_to(buddy_app, pair):
    """Without a period to sit in there is nothing for a session to count towards."""
    buddy_app.as_(MENTOR)
    response = _plan(buddy_app, pair.pair_id)

    assert response.status_code == 409
    assert response.json()["detail"] == "no_active_cycle"


def test_a_stranger_cannot_plan_into_someone_elses_pairing(buddy_app, cycled):
    buddy_app.as_(STRANGER)
    assert _plan(buddy_app, cycled.pair_id).status_code == 403


def test_an_unknown_mode_is_rejected(buddy_app, cycled):
    buddy_app.as_(MENTOR)
    response = _plan(buddy_app, cycled.pair_id, mode="telepathy")
    assert response.status_code == 400


def test_async_voice_is_the_default_mode(buddy_app, cycled):
    """Async is a real session here, not a failed live call."""
    buddy_app.as_(MENTOR)
    assert _plan(buddy_app, cycled.pair_id).json()["mode"] == "async_voice"


def test_planning_is_refused_once_the_pairing_has_ended(buddy_app, cycled):
    buddy_pairs_store.end(cycled.pair_id)
    buddy_app.as_(MENTOR)
    assert _plan(buddy_app, cycled.pair_id).status_code == 409


# --- Completing and missing -----------------------------------------------


def test_the_note_lands_on_the_side_that_wrote_it(buddy_app, cycled):
    buddy_app.as_(MENTOR)
    session_id = _plan(buddy_app, cycled.pair_id).json()["session_id"]

    buddy_app.post(
        f"/buddy/sessions/{session_id}/complete", json={"note": "Good pacing"}
    )
    buddy_app.as_(MENTEE)
    body = buddy_app.post(
        f"/buddy/sessions/{session_id}/complete", json={"note": "Felt easier"}
    ).json()

    assert body["mentor_notes"] == "Good pacing"
    assert body["mentee_reflection"] == "Felt easier"


def test_a_missed_session_is_kept_not_erased(buddy_app, cycled):
    """A missed session is the signal that a pairing has stopped working."""
    buddy_app.as_(MENTOR)
    session_id = _plan(buddy_app, cycled.pair_id).json()["session_id"]

    assert buddy_app.post(f"/buddy/sessions/{session_id}/miss").json()["status"] == "missed"
    assert len(buddy_sessions_store.list_all()) == 1


def test_a_stranger_cannot_complete_someone_elses_session(buddy_app, cycled):
    buddy_app.as_(MENTOR)
    session_id = _plan(buddy_app, cycled.pair_id).json()["session_id"]

    buddy_app.as_(STRANGER)
    response = buddy_app.post(
        f"/buddy/sessions/{session_id}/complete", json={"note": "nosy"}
    )
    assert response.status_code == 403


def test_a_planned_session_can_be_cancelled(buddy_app, cycled):
    buddy_app.as_(MENTOR)
    session_id = _plan(buddy_app, cycled.pair_id).json()["session_id"]

    assert buddy_app.delete(f"/buddy/sessions/{session_id}").status_code == 204
    assert buddy_sessions_store.get(session_id) is None


def test_a_resolved_session_cannot_be_cancelled_away(buddy_app, cycled):
    """Once it has happened it is part of the cycle's record."""
    buddy_app.as_(MENTOR)
    session_id = _plan(buddy_app, cycled.pair_id).json()["session_id"]
    buddy_app.post(f"/buddy/sessions/{session_id}/complete", json={})

    response = buddy_app.delete(f"/buddy/sessions/{session_id}")
    assert response.status_code == 409
    assert buddy_sessions_store.get(session_id) is not None


# --- Consistency in the cycle report --------------------------------------


def test_the_cycle_report_counts_kept_and_missed_sessions(buddy_app, cycled):
    buddy_app.as_(MENTOR)
    kept = _plan(buddy_app, cycled.pair_id).json()["session_id"]
    missed = _plan(buddy_app, cycled.pair_id).json()["session_id"]
    _plan(buddy_app, cycled.pair_id)  # still planned

    buddy_app.post(f"/buddy/sessions/{kept}/complete", json={})
    buddy_app.post(f"/buddy/sessions/{missed}/miss")

    body = buddy_app.get(f"/buddy/pairs/{cycled.pair_id}/activity").json()
    assert body["sessions"] == {"planned": 1, "completed": 1, "missed": 1}


def test_sessions_listed_for_a_pair_between_cycles_are_empty(buddy_app, pair):
    buddy_app.as_(MENTOR)
    body = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/sessions").json()
    assert body == {"sessions": [], "total": 0}
