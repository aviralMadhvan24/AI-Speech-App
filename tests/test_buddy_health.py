"""Pairing health — whether a pairing is running, as a teacher sees it.

The distinctions this file defends are the ones a teacher acts on differently:
a pairing with no cycle needs the teacher to open one, a pairing that never
started needs a nudge, and a pairing that has gone silent or is missing sessions
needs looking at. Ability never enters into it — a strong mentee must not be
able to make a pairing that has not met in a month look fine.
"""

from __future__ import annotations

from datetime import datetime
from datetime import timedelta
from datetime import timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy import health
from app.buddy.routes import router as buddy_router
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store


MENTOR = User(uid="u-mentor", email="mentor@x.com", name="Mentor", role="student")
MENTEE = User(uid="u-mentee", email="mentee@x.com", name="Mentee", role="student")
TEACHER = User(uid="u-teacher", email="teacher@x.com", role="teacher")


def _days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


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

    current: dict[str, User] = {"user": TEACHER}

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


def _open_cycle(pair, started_days_ago: float = 1):
    return buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email=MENTEE.email,
        starts_at=_days_ago(started_days_ago),
        ends_at=(datetime.now(timezone.utc) + timedelta(weeks=4)).isoformat(),
        created_by=TEACHER.email,
    )


def _health_of(pair):
    return health.build_index([pair])[pair.pair_id]


# --- The states a teacher acts on differently ------------------------------


def test_a_pairing_with_no_cycle_reads_as_no_cycle_not_as_failing(pair):
    """The fix is the teacher's own — opening one — so it must not read as neglect."""
    state = _health_of(pair)

    assert state.state == "no_cycle"
    assert state.has_cycle is False
    assert state.days_quiet is None


def test_a_cycle_where_nothing_has_happened_yet_reads_as_not_started(pair):
    _open_cycle(pair)
    assert _health_of(pair).state == "not_started"


def test_a_pairing_talking_this_week_is_on_track(pair):
    _open_cycle(pair)
    buddy_messages_store.create(pair.pair_id, MENTOR.email, body="how did it go?")

    state = _health_of(pair)
    assert state.state == "on_track"
    assert state.message_count == 1


def test_a_week_of_silence_is_quiet_and_two_is_stalled(pair, monkeypatch):
    cycle = _open_cycle(pair, started_days_ago=30)
    message = buddy_messages_store.create(pair.pair_id, MENTOR.email, body="hello")

    for days, expected in ((8, "quiet"), (20, "stalled")):
        monkeypatch.setattr(
            buddy_messages_store,
            "list_all",
            lambda days=days: [message.model_copy(update={"sent_at": _days_ago(days)})],
        )
        assert _health_of(pair).state == expected
        assert _health_of(pair).days_quiet == days

    assert cycle.status == "active"


def test_missed_sessions_stall_a_pairing_that_is_still_nominally_talking(pair):
    """Two missed sessions is a failing pairing that silence alone would hide."""
    cycle = _open_cycle(pair)
    for _ in range(2):
        session = buddy_sessions_store.create(
            pair_id=pair.pair_id,
            cycle_id=cycle.cycle_id,
            scheduled_at=_days_ago(1),
            created_by=MENTOR.email,
        )
        buddy_sessions_store.mark_missed(session.session_id)
    buddy_messages_store.create(pair.pair_id, MENTOR.email, body="sorry, busy week")

    state = _health_of(pair)
    assert state.state == "stalled"
    assert state.sessions.missed == 2
    assert state.days_quiet == 0


def test_an_ended_pairing_is_not_flagged_for_going_silent(pair):
    """Going quiet is the point of ending it — flagging it buries the live ones."""
    _open_cycle(pair, started_days_ago=60)
    buddy_pairs_store.end(pair.pair_id)

    ended = buddy_pairs_store.get(pair.pair_id)
    assert _health_of(ended).state == "ended"


# --- What counts as activity ----------------------------------------------


def test_a_planned_session_is_an_intention_not_activity(pair):
    """Planning something for next week does not mean the pairing is running."""
    cycle = _open_cycle(pair, started_days_ago=30)
    buddy_sessions_store.create(
        pair_id=pair.pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at=_days_ago(-7),
        created_by=MENTOR.email,
    )

    state = _health_of(pair)
    assert state.sessions.planned == 1
    assert state.last_activity_at is None
    assert state.state == "stalled"


def test_completing_a_session_counts_as_activity(pair):
    cycle = _open_cycle(pair, started_days_ago=30)
    session = buddy_sessions_store.create(
        pair_id=pair.pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at=_days_ago(1),
        created_by=MENTOR.email,
    )
    buddy_sessions_store.complete(session.session_id, note="good pacing", is_mentor=True)

    state = _health_of(pair)
    assert state.state == "on_track"
    assert state.last_activity_at is not None
    assert state.sessions.completed == 1


def test_sessions_from_a_previous_cycle_are_not_counted_against_the_open_one(pair):
    """Closing a cycle draws a line — last period's misses are not this one's."""
    old = _open_cycle(pair, started_days_ago=60)
    for _ in range(2):
        stale = buddy_sessions_store.create(
            pair_id=pair.pair_id,
            cycle_id=old.cycle_id,
            scheduled_at=_days_ago(50),
            created_by=MENTOR.email,
        )
        buddy_sessions_store.mark_missed(stale.session_id)
    buddy_cycles_store.close(old.cycle_id)
    _open_cycle(pair, started_days_ago=1)

    state = _health_of(pair)
    assert state.sessions.missed == 0
    assert state.state == "not_started"


def test_another_pairs_messages_do_not_count_towards_this_one(pair):
    _open_cycle(pair)
    buddy_messages_store.create("some-other-pair", MENTOR.email, body="not ours")

    state = _health_of(pair)
    assert state.message_count == 0
    assert state.state == "not_started"


def test_a_timestamp_written_without_an_offset_is_read_as_utc(pair, monkeypatch):
    """One legacy row must not raise and blank the whole teacher view."""
    _open_cycle(pair, started_days_ago=30)
    naive = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    message = buddy_messages_store.create(pair.pair_id, MENTOR.email, body="hi")
    monkeypatch.setattr(
        buddy_messages_store,
        "list_all",
        lambda: [message.model_copy(update={"sent_at": naive})],
    )

    assert _health_of(pair).state == "on_track"


# --- The teacher's endpoint ------------------------------------------------


def test_the_pairs_list_carries_health_for_every_pair(buddy_app, pair):
    _open_cycle(pair)
    body = buddy_app.get("/buddy/admin/pairs").json()

    assert body["total"] == 1
    assert body["health"][pair.pair_id]["state"] == "not_started"


def test_a_student_cannot_read_the_teachers_pairing_list(buddy_app, pair):
    buddy_app.as_(MENTOR)
    assert buddy_app.get("/buddy/admin/pairs").status_code == 403
