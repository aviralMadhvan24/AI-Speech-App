"""Closing a cycle has to answer the question the cycle was opened to ask.

Before this, `close_cycle` flipped a status and nothing more — the baseline
was captured, the work was scored, and nobody ever found out whether the
period worked. These tests pin the verdict rules, the freezing, and the
honesty requirement: an unmeasured cycle says so rather than implying a flat
line was a result.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy import growth
from app.buddy.routes import router as buddy_router
from app.storage.buddy import CycleBaseline
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store


MENTOR = User(uid="u-mentor", email="mentor@x.com", role="student")
MENTEE = User(uid="u-mentee", email="mentee@x.com", role="student")
TEACHER = User(uid="u-teacher", email="teacher@x.com", role="teacher")

STARTS = "2026-08-01T00:00:00+00:00"
ENDS = "2026-09-01T00:00:00+00:00"


@pytest.fixture()
def buddy_app(tmp_path, monkeypatch):
    monkeypatch.setattr(mentors_store, "path", tmp_path / "mentors.jsonl")
    monkeypatch.setattr(buddy_pairs_store, "path", tmp_path / "pairs.jsonl")
    monkeypatch.setattr(buddy_messages_store, "path", tmp_path / "messages.jsonl")
    monkeypatch.setattr(buddy_cycles_store, "path", tmp_path / "cycles.jsonl")
    monkeypatch.setattr(buddy_sessions_store, "path", tmp_path / "sessions.jsonl")

    from app.storage import users_store

    monkeypatch.setattr(users_store, "get_by_email", lambda email: None)
    # No scored work unless a test says otherwise.
    monkeypatch.setattr(growth, "_interview_events", lambda email: [])
    monkeypatch.setattr(growth, "_live_events", lambda email: [])

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
def cycled(buddy_app):
    pair = buddy_pairs_store.create(
        mentor_email=MENTOR.email, mentee_email=MENTEE.email, created_by=TEACHER.email
    )
    cycle = buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email=MENTEE.email,
        starts_at=STARTS,
        ends_at=ENDS,
        created_by=TEACHER.email,
        goal="Speak two minutes without filler words",
        baseline=CycleBaseline(content=60.0),
    )
    return pair, cycle


def _interviews(monkeypatch, *totals):
    monkeypatch.setattr(
        growth,
        "_interview_events",
        lambda email: [("2026-08-10T00:00:00+00:00", "Interview", t, None) for t in totals],
    )


def _close(buddy_app, cycle):
    return buddy_app.post(f"/buddy/admin/cycles/{cycle.cycle_id}/close").json()


# --- The verdict ----------------------------------------------------------


def test_a_cycle_that_moved_the_score_reads_as_improved(buddy_app, cycled, monkeypatch):
    _pair, cycle = cycled
    _interviews(monkeypatch, 75.0)  # baseline was 60

    body = _close(buddy_app, cycle)

    assert body["summary"]["verdict"] == "improved"
    assert body["summary"]["goal"] == "Speak two minutes without filler words"
    content = next(a for a in body["summary"]["axes"] if a["key"] == "content")
    assert content["baseline"] == 60.0
    assert content["final"] == 75.0
    assert content["delta"] == 15.0


def test_a_cycle_that_went_backwards_says_so(buddy_app, cycled, monkeypatch):
    _pair, cycle = cycled
    _interviews(monkeypatch, 45.0)

    assert _close(buddy_app, cycle)["summary"]["verdict"] == "declined"


def test_a_wobble_is_not_progress(buddy_app, cycled, monkeypatch):
    """A point either way is noise; calling it progress cheapens the real thing."""
    _pair, cycle = cycled
    _interviews(monkeypatch, 61.0)

    assert _close(buddy_app, cycle)["summary"]["verdict"] == "held"


def test_a_cycle_with_nothing_measured_admits_it(buddy_app, cycled):
    """Never imply an unmeasured cycle was a flat result."""
    _pair, cycle = cycled

    summary = _close(buddy_app, cycle)["summary"]
    assert summary["verdict"] == "not_enough_evidence"
    assert all(a["delta"] is None for a in summary["axes"])


def test_an_axis_with_no_baseline_does_not_vote(buddy_app, monkeypatch):
    """Nothing to measure against is not the same as no movement."""
    pair = buddy_pairs_store.create(
        mentor_email=MENTOR.email, mentee_email=MENTEE.email, created_by=TEACHER.email
    )
    cycle = buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email=MENTEE.email,
        starts_at=STARTS,
        ends_at=ENDS,
        created_by=TEACHER.email,
        baseline=CycleBaseline(),  # nothing known at the start
    )
    _interviews(monkeypatch, 90.0)

    assert _close(buddy_app, cycle)["summary"]["verdict"] == "not_enough_evidence"


# --- Freezing -------------------------------------------------------------


def test_the_summary_is_frozen_at_close_not_recomputed_later(
    buddy_app, cycled, monkeypatch
):
    """A finished period's result must not drift as later work is scored."""
    _pair, cycle = cycled
    _interviews(monkeypatch, 75.0)
    _close(buddy_app, cycle)

    # More work lands afterwards — the stored verdict must not move.
    _interviews(monkeypatch, 75.0, 20.0)

    stored = buddy_cycles_store.get(cycle.cycle_id)
    assert stored.summary.verdict == "improved"
    content = next(a for a in stored.summary.axes if a.key == "content")
    assert content.final == 75.0


def test_session_consistency_is_recorded_alongside_the_score(
    buddy_app, cycled, monkeypatch
):
    """A flat score with every session kept is a different story from neither."""
    pair, cycle = cycled
    kept = buddy_sessions_store.create(
        pair_id=pair.pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at=STARTS,
        created_by=MENTOR.email,
    )
    missed = buddy_sessions_store.create(
        pair_id=pair.pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at=STARTS,
        created_by=MENTOR.email,
    )
    buddy_sessions_store.complete(kept.session_id, is_mentor=True)
    buddy_sessions_store.mark_missed(missed.session_id)

    summary = _close(buddy_app, cycle)["summary"]
    assert summary["sessions_completed"] == 1
    assert summary["sessions_missed"] == 1


def test_a_reporting_failure_does_not_block_the_close(buddy_app, cycled, monkeypatch):
    """A teacher must always be able to end a cycle."""
    _pair, cycle = cycled

    def _boom(*args, **kwargs):
        raise RuntimeError("report is broken")

    monkeypatch.setattr(growth, "build_summary", _boom)

    body = _close(buddy_app, cycle)
    assert body["status"] == "closed"
    assert body["summary"] is None


def test_closing_an_unknown_cycle_is_a_404(buddy_app):
    assert buddy_app.post("/buddy/admin/cycles/nope/close").status_code == 404


# --- Who gets to see it ---------------------------------------------------


def test_the_pair_finds_out_how_their_own_cycle_went(buddy_app, cycled, monkeypatch):
    """Teachers could already see the verdict; the two who did the work could not."""
    pair, cycle = cycled
    _interviews(monkeypatch, 75.0)
    _close(buddy_app, cycle)
    buddy_app.as_(MENTEE)

    report = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/activity").json()

    assert report["cycle"] is None, "the cycle is over"
    assert report["last_summary"]["verdict"] == "improved"


def test_an_open_cycle_shows_no_verdict_yet(buddy_app, cycled):
    """A period still running has no result to report."""
    pair, _cycle = cycled
    buddy_app.as_(MENTEE)

    report = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/activity").json()

    assert report["last_summary"] is None
