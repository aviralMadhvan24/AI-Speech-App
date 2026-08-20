"""The outbound worklist: who needs chasing, and who is told.

The inbox nudge only reaches whoever opens the buddy tab, and the pairings that
need chasing are precisely the ones nobody is opening. These pin the routing
rules that make the digest worth reading — chiefly that a nudge goes to someone
who can actually act on it.
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
from app.buddy import digest
from app.buddy.routes import router as buddy_router
from app.storage.buddy import buddy_concerns_store
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store

MENTOR = User(uid="u-mentor", email="mentor@x.com", role="student")
MENTEE = User(uid="u-mentee", email="mentee@x.com", role="student")
TEACHER = User(uid="u-teacher", email="teacher@x.com", role="teacher")


@pytest.fixture()
def buddy_app(tmp_path, monkeypatch):
    for store, name in (
        (mentors_store, "mentors"),
        (buddy_pairs_store, "pairs"),
        (buddy_messages_store, "messages"),
        (buddy_cycles_store, "cycles"),
        (buddy_sessions_store, "sessions"),
        (buddy_concerns_store, "concerns"),
    ):
        monkeypatch.setattr(store, "path", tmp_path / f"{name}.jsonl")

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


def _pair(mentor=MENTOR.email, mentee=MENTEE.email):
    return buddy_pairs_store.create(
        mentor_email=mentor, mentee_email=mentee, created_by=TEACHER.email
    )


def _cycle(pair, *, opened_days_ago: int = 0, mentee=MENTEE.email):
    """A cycle that opened `opened_days_ago` days back and runs four weeks on."""
    opened = datetime.now(timezone.utc) - timedelta(days=opened_days_ago)
    return buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email=mentee,
        starts_at=opened.isoformat(),
        ends_at=(opened + timedelta(weeks=8)).isoformat(),
        created_by=TEACHER.email,
    )


def _by_role(report):
    return {n.role: n for n in report.nudges}


# --- Routing: the nudge goes to whoever can act ---------------------------


def test_a_pairing_with_no_cycle_nudges_the_teacher_not_the_student(buddy_app):
    """Only a teacher can open a cycle. "Ask your teacher" is not an action."""
    _pair()

    report = digest.build_digest()

    assert [n.role for n in report.nudges] == ["teacher"]
    assert report.nudges[0].email == TEACHER.email
    assert "Open one or end the pairing" in report.nudges[0].message


def test_a_quiet_pairing_tells_both_sides(buddy_app):
    pair = _pair()
    _cycle(pair, opened_days_ago=9)

    roles = _by_role(digest.build_digest())

    assert set(roles) == {"mentor", "mentee"}
    assert roles["mentor"].email == MENTOR.email
    assert roles["mentee"].email == MENTEE.email


def test_the_mentor_is_asked_and_the_mentee_is_invited(buddy_app):
    """The mentor holds the job; a mentee waiting was told to wait."""
    pair = _pair()
    _cycle(pair, opened_days_ago=9)

    roles = _by_role(digest.build_digest())

    assert "waiting to be messaged" in roles["mentor"].message
    assert roles["mentor"].message != roles["mentee"].message


def test_each_nudge_names_the_partner_so_it_can_be_addressed(buddy_app):
    pair = _pair()
    _cycle(pair, opened_days_ago=9)

    roles = _by_role(digest.build_digest())

    assert roles["mentor"].partner_email == MENTEE.email
    assert roles["mentee"].partner_email == MENTOR.email


# --- What counts as needing a nudge ---------------------------------------


def test_a_healthy_pairing_produces_nothing(buddy_app):
    """A digest that lists everyone is a digest nobody reads."""
    pair = _pair()
    _cycle(pair, opened_days_ago=0)
    buddy_messages_store.create(pair.pair_id, MENTOR.email, body="hello")

    report = digest.build_digest()

    assert report.nudges == []
    assert report.total == 0


def test_a_pairing_that_never_started_is_distinguished_from_one_that_stopped(buddy_app):
    """Only while the cycle is young — silence from the start ages into quiet."""
    pair = _pair()
    _cycle(pair, opened_days_ago=3)

    assert digest.build_digest().nudges[0].state == "not_started"


def test_an_ended_pairing_is_never_chased(buddy_app):
    pair = _pair()
    _cycle(pair, opened_days_ago=30)
    buddy_pairs_store.end(pair.pair_id)

    assert digest.build_digest().nudges == []


def test_a_stalled_pairing_outranks_a_quiet_one(buddy_app):
    """Most urgent first — this is the order someone works down the list in."""
    stalled = _pair(mentee="stalled@x.com")
    _cycle(stalled, opened_days_ago=30, mentee="stalled@x.com")

    quiet = _pair(mentee="quiet@x.com")
    _cycle(quiet, opened_days_ago=9, mentee="quiet@x.com")

    states = [n.state for n in digest.build_digest().nudges]

    assert states[0] == "stalled"
    assert states[-1] == "quiet"


def test_the_counts_are_per_pairing_not_per_person(buddy_app):
    """Two nudges about one silent pairing is still one silent pairing."""
    pair = _pair()
    _cycle(pair, opened_days_ago=9)

    report = digest.build_digest()

    assert report.total == 2, "both sides are told"
    assert report.counts.quiet == 1, "but it is one pairing"


def test_sessions_kept_rides_along_so_the_conversation_can_differ(buddy_app):
    """A pairing that did real work then stopped needs a different chat."""
    pair = _pair()
    cycle = _cycle(pair, opened_days_ago=3)

    def _session():
        return buddy_sessions_store.create(
            pair_id=pair.pair_id,
            cycle_id=cycle.cycle_id,
            scheduled_at="2026-08-01T10:00:00+00:00",
            created_by=TEACHER.email,
        )

    # Two misses stall a pairing that is otherwise still in touch — the case
    # silence alone would never surface.
    buddy_sessions_store.mark_missed(_session().session_id)
    buddy_sessions_store.mark_missed(_session().session_id)
    buddy_sessions_store.complete(_session().session_id)

    nudge = digest.build_digest().nudges[0]

    assert nudge.state == "stalled"
    assert nudge.sessions_kept == 1, "it did real work before it stopped"


def test_open_concerns_are_surfaced_so_nobody_chases_a_known_problem(buddy_app):
    pair = _pair()
    _cycle(pair, opened_days_ago=9)
    buddy_concerns_store.raise_concern(
        pair_id=pair.pair_id, raised_by=MENTEE.email, role="mentee", reason="mismatch"
    )

    assert digest.build_digest().open_concerns == 1


def test_broken_health_yields_an_empty_digest_rather_than_a_wrong_one(buddy_app, monkeypatch):
    """Chasing the wrong people is worse than chasing nobody."""
    pair = _pair()
    _cycle(pair, opened_days_ago=30)
    monkeypatch.setattr(
        digest.health,
        "build_index",
        lambda pairs=None: (_ for _ in ()).throw(ValueError("bad row")),
    )

    report = digest.build_digest()

    assert report.nudges == []
    assert report.total == 0


# --- Per recipient, for a future mail job ---------------------------------


def test_one_persons_nudges_can_be_selected(buddy_app):
    pair = _pair()
    _cycle(pair, opened_days_ago=9)

    mine = digest.for_recipient("MENTOR@x.com")

    assert len(mine) == 1
    assert mine[0].role == "mentor"


def test_someone_with_nothing_outstanding_gets_an_empty_list(buddy_app):
    pair = _pair()
    _cycle(pair, opened_days_ago=9)

    assert digest.for_recipient("stranger@x.com") == []


# --- Access ---------------------------------------------------------------


def test_the_digest_is_teacher_only(buddy_app):
    buddy_app.as_(MENTEE)
    assert buddy_app.get("/buddy/admin/digest").status_code == 403


def test_the_digest_is_served_over_http(buddy_app):
    pair = _pair()
    _cycle(pair, opened_days_ago=9)

    body = buddy_app.get("/buddy/admin/digest").json()

    assert body["total"] == 2
    assert body["counts"]["quiet"] == 1
