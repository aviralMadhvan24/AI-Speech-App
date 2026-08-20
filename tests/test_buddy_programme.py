"""The programme-level rollup: does any of this help, across the whole cohort.

The rules worth pinning here are the honest ones. A rollup is the easiest place
in the codebase to accidentally flatter the programme — by counting unmeasured
cycles as flat, by reporting a rate over an empty denominator as zero, or by
averaging an axis nobody sampled into every mean. Each of those has a test.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy import programme
from app.buddy.routes import router as buddy_router
from app.storage.buddy import CycleAxisResult
from app.storage.buddy import CycleSummary
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store

TEACHER = User(uid="u-teacher", email="teacher@x.com", role="teacher")
STUDENT = User(uid="u-student", email="mentee@x.com", role="student")

STARTS = "2026-01-01T00:00:00+00:00"
ENDS = "2026-02-01T00:00:00+00:00"


@pytest.fixture()
def buddy_app(tmp_path, monkeypatch):
    for store, name in (
        (mentors_store, "mentors"),
        (buddy_pairs_store, "pairs"),
        (buddy_messages_store, "messages"),
        (buddy_cycles_store, "cycles"),
        (buddy_sessions_store, "sessions"),
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


def _axis(key: str, baseline=None, final=None, label="Axis"):
    delta = None if baseline is None or final is None else round(final - baseline, 2)
    return CycleAxisResult(
        key=key,
        label=label,
        baseline=baseline,
        final=final,
        delta=delta,
        sample_size=0 if delta is None else 3,
    )


def _closed(mentee: str, verdict: str, axes: list[CycleAxisResult]):
    """A pair with one closed cycle, frozen with the given axes."""
    pair = buddy_pairs_store.create(
        mentor_email="mentor@x.com", mentee_email=mentee, created_by=TEACHER.email
    )
    cycle = buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email=mentee,
        starts_at=STARTS,
        ends_at=ENDS,
        created_by=TEACHER.email,
    )
    buddy_cycles_store.close(
        cycle.cycle_id,
        summary=CycleSummary(
            axes=axes, verdict=verdict, generated_at="2026-02-01T00:00:00+00:00"
        ),
    )
    return pair


# --- The honesty rules ----------------------------------------------------


def test_an_empty_programme_reports_unknown_not_zero(buddy_app):
    """No cycles is not a zero percent success rate."""
    report = programme.build_report()

    assert report.cycles_closed == 0
    assert report.improvement_rate is None
    assert report.evidence_rate is None
    assert report.keep_rate is None


def test_unmeasured_cycles_are_excluded_from_the_rate_not_counted_as_failures(buddy_app):
    """Otherwise poor measurement coverage reads as a failing programme."""
    _closed("a@x.com", "improved", [_axis("content", 50.0, 62.0)])
    _closed("b@x.com", "not_enough_evidence", [_axis("content")])
    _closed("c@x.com", "not_enough_evidence", [_axis("content")])

    report = programme.build_report()

    assert report.cycles_closed == 3
    assert report.cycles_measured == 1
    assert report.improvement_rate == 1.0, "1 of 1 measured, not 1 of 3"
    assert report.verdicts.not_enough_evidence == 2


def test_the_evidence_rate_is_reported_next_to_the_improvement_rate(buddy_app):
    """A reader told "100% improved" is entitled to see it was 1 cycle in 4."""
    _closed("a@x.com", "improved", [_axis("content", 50.0, 62.0)])
    for email in ("b@x.com", "c@x.com", "d@x.com"):
        _closed(email, "not_enough_evidence", [_axis("content")])

    report = programme.build_report()

    assert report.improvement_rate == 1.0
    assert report.evidence_rate == 0.25


def test_an_unsampled_axis_does_not_drag_its_mean_toward_zero(buddy_app):
    """A cycle that never measured live speaking says nothing about it."""
    _closed(
        "a@x.com",
        "improved",
        [_axis("content", 50.0, 70.0), _axis("live_speaking")],
    )

    by_key = {a.key: a for a in programme.build_report().axes}

    assert by_key["content"].mean_delta == 20.0
    assert by_key["content"].cycles_measured == 1
    assert by_key["live_speaking"].mean_delta is None
    assert by_key["live_speaking"].cycles_measured == 0


def test_every_axis_is_listed_even_when_never_measured(buddy_app):
    """A silently missing axis reads as an axis nobody needs to worry about."""
    keys = [a.key for a in programme.build_report().axes]
    assert keys == ["content", "pronunciation", "live_speaking"]


def test_a_declining_programme_is_reported_as_declining(buddy_app):
    _closed("a@x.com", "declined", [_axis("content", 70.0, 55.0)])
    _closed("b@x.com", "declined", [_axis("content", 65.0, 60.0)])

    report = programme.build_report()

    assert report.verdicts.declined == 2
    assert report.improvement_rate == 0.0, "measured and genuinely zero"
    assert report.axes[0].mean_delta == -10.0


# --- Reach and activity ---------------------------------------------------


def test_open_cycles_are_counted_but_never_scored(buddy_app):
    """A cycle still running has no verdict to contribute."""
    pair = buddy_pairs_store.create(
        mentor_email="mentor@x.com", mentee_email="a@x.com", created_by=TEACHER.email
    )
    buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email="a@x.com",
        starts_at=STARTS,
        ends_at=ENDS,
        created_by=TEACHER.email,
    )

    report = programme.build_report()

    assert report.cycles_active == 1
    assert report.cycles_closed == 0
    assert report.improvement_rate is None


def test_a_mentee_with_two_pairings_is_one_person_served(buddy_app):
    _closed("a@x.com", "improved", [_axis("content", 50.0, 62.0)])
    _closed("A@X.COM", "improved", [_axis("content", 62.0, 70.0)])

    report = programme.build_report()

    assert report.pairs_total == 2
    assert report.mentees_served == 1


def test_ended_pairings_still_count_as_reach(buddy_app):
    """They happened. Dropping them would make the programme look smaller."""
    pair = _closed("a@x.com", "improved", [_axis("content", 50.0, 62.0)])
    buddy_pairs_store.end(pair.pair_id)

    report = programme.build_report()

    assert report.pairs_total == 1
    assert report.pairs_active == 0
    assert report.pairs_ended == 1


def test_only_approved_mentors_are_counted(buddy_app):
    mentors_store.set_status("yes@x.com", "approved", decided_by=TEACHER.email)
    mentors_store.set_status("no@x.com", "rejected", decided_by=TEACHER.email)

    assert programme.build_report().mentors_approved == 1


def test_the_keep_rate_ignores_sessions_that_have_not_come_due(buddy_app):
    """A planned session is neither kept nor missed yet."""
    pair = buddy_pairs_store.create(
        mentor_email="mentor@x.com", mentee_email="a@x.com", created_by=TEACHER.email
    )
    cycle = buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email="a@x.com",
        starts_at=STARTS,
        ends_at=ENDS,
        created_by=TEACHER.email,
    )
    for status_value in ("completed", "completed", "completed", "missed", "planned"):
        session = buddy_sessions_store.create(
            pair_id=pair.pair_id,
            cycle_id=cycle.cycle_id,
            scheduled_at=STARTS,
            created_by=TEACHER.email,
        )
        if status_value == "completed":
            buddy_sessions_store.complete(session.session_id)
        elif status_value == "missed":
            buddy_sessions_store.mark_missed(session.session_id)

    report = programme.build_report()

    assert (report.sessions_completed, report.sessions_missed) == (3, 1)
    assert report.sessions_planned == 1
    assert report.keep_rate == 0.75, "3 of the 4 that came due"


def test_health_is_counted_across_active_pairings(buddy_app):
    """The rollup reuses health rather than re-deriving what "quiet" means."""
    buddy_pairs_store.create(
        mentor_email="mentor@x.com", mentee_email="a@x.com", created_by=TEACHER.email
    )

    report = programme.build_report()

    assert sum(report.health.values()) == 1
    assert "no_cycle" in report.health, "a pairing with no cycle says so"


def test_broken_health_does_not_blank_the_rollup(buddy_app, monkeypatch):
    _closed("a@x.com", "improved", [_axis("content", 50.0, 62.0)])
    monkeypatch.setattr(
        programme.health,
        "build_index",
        lambda pairs=None: (_ for _ in ()).throw(ValueError("bad row")),
    )

    report = programme.build_report()

    assert report.health == {}
    assert report.cycles_closed == 1, "the rest of the report still stands"


# --- Access ---------------------------------------------------------------


def test_the_rollup_is_teacher_only(buddy_app):
    buddy_app.as_(STUDENT)
    assert buddy_app.get("/buddy/admin/programme").status_code == 403


def test_the_rollup_is_served_over_http(buddy_app):
    _closed("a@x.com", "improved", [_axis("content", 50.0, 62.0)])

    body = buddy_app.get("/buddy/admin/programme").json()

    assert body["cycles_closed"] == 1
    assert body["improvement_rate"] == 1.0
    assert body["verdicts"]["improved"] == 1
