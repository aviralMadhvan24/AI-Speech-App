"""Practice material, mentee ratings, the mentor's own record, and nudges.

Four small features that together answer the questions a buddy pairing kept
leaving open: what do we practise, was the mentor any good, what has mentoring
earned me, and has this pairing quietly died.
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
from app.buddy import growth
from app.buddy import practice
from app.buddy.routes import router as buddy_router
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
def paired(buddy_app):
    """A pair whose cycle opened just now, so health reads as freshly started."""
    now = datetime.now(timezone.utc)
    pair = buddy_pairs_store.create(
        mentor_email=MENTOR.email, mentee_email=MENTEE.email, created_by=TEACHER.email
    )
    cycle = buddy_cycles_store.create(
        pair_id=pair.pair_id,
        mentee_email=MENTEE.email,
        starts_at=now.isoformat(),
        ends_at=(now + timedelta(weeks=4)).isoformat(),
        created_by=TEACHER.email,
    )
    return pair, cycle


def _completed_session(pair, cycle):
    session = buddy_sessions_store.create(
        pair_id=pair.pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at=STARTS,
        created_by=MENTOR.email,
    )
    return buddy_sessions_store.complete(session.session_id, is_mentor=True)


# --- Practice material ----------------------------------------------------


def test_the_catalogs_are_offered_as_session_material(buddy_app):
    """Three catalogs already shipped; a session can now point at one."""
    buddy_app.as_(MENTEE)

    body = buddy_app.get("/buddy/practice-prompts").json()

    assert body["total"] > 0
    assert {p["kind"] for p in body["prompts"]} == {"pronunciation", "debate", "gd"}
    assert all(p["id"] and p["title"] for p in body["prompts"])


def test_one_catalog_can_be_asked_for_on_its_own(buddy_app):
    buddy_app.as_(MENTEE)

    prompts = buddy_app.get("/buddy/practice-prompts?kind=debate").json()["prompts"]

    assert prompts and {p["kind"] for p in prompts} == {"debate"}


def test_an_unknown_catalog_is_a_400_not_an_empty_list(buddy_app):
    """Silence would read as 'no material', which is a different problem."""
    buddy_app.as_(MENTEE)

    assert buddy_app.get("/buddy/practice-prompts?kind=poetry").status_code == 400


def test_a_broken_catalog_does_not_take_the_others_down(monkeypatch, tmp_path):
    """A pair can still plan around whatever loaded."""
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(practice, "DEBATE_PATH", broken)

    kinds = {p.kind for p in practice.list_prompts()}

    assert "debate" not in kinds
    assert {"pronunciation", "gd"} <= kinds


def test_a_planned_session_carries_the_prompt_it_is_built_around(buddy_app, paired):
    pair, _cycle = paired
    buddy_app.as_(MENTOR)
    prompt = practice.list_prompts("debate")[0]

    session = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/sessions",
        json={
            "scheduled_at": STARTS,
            "prompt_kind": "debate",
            "prompt_id": prompt.id,
        },
    ).json()

    assert session["prompt_kind"] == "debate"
    assert session["prompt_id"] == prompt.id
    # The title is denormalised so the session still reads if the catalog moves.
    assert session["prompt_title"] == prompt.title


def test_a_session_cannot_point_at_a_prompt_that_does_not_exist(buddy_app, paired):
    pair, _cycle = paired
    buddy_app.as_(MENTOR)

    response = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/sessions",
        json={"scheduled_at": STARTS, "prompt_kind": "debate", "prompt_id": "nope"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "prompt_not_found"


# --- Ratings --------------------------------------------------------------


def test_a_mentee_rates_the_session_they_received(buddy_app, paired):
    pair, cycle = paired
    session = _completed_session(pair, cycle)
    buddy_app.as_(MENTEE)

    body = buddy_app.post(
        f"/buddy/sessions/{session.session_id}/rate", json={"rating": 4}
    ).json()

    assert body["mentee_rating"] == 4


def test_a_mentor_may_not_rate_their_own_session(buddy_app, paired):
    """Self-rating would make the only mentoring-quality signal worthless."""
    pair, cycle = paired
    session = _completed_session(pair, cycle)
    buddy_app.as_(MENTOR)

    response = buddy_app.post(
        f"/buddy/sessions/{session.session_id}/rate", json={"rating": 5}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "only_the_mentee_may_rate"


def test_a_session_that_has_not_happened_cannot_be_rated(buddy_app, paired):
    pair, cycle = paired
    session = buddy_sessions_store.create(
        pair_id=pair.pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at=STARTS,
        created_by=MENTOR.email,
    )
    buddy_app.as_(MENTEE)

    response = buddy_app.post(
        f"/buddy/sessions/{session.session_id}/rate", json={"rating": 5}
    )

    assert response.status_code == 409


@pytest.mark.parametrize("rating", [0, 6, -1])
def test_a_rating_outside_one_to_five_is_refused(buddy_app, paired, rating):
    pair, cycle = paired
    session = _completed_session(pair, cycle)
    buddy_app.as_(MENTEE)

    response = buddy_app.post(
        f"/buddy/sessions/{session.session_id}/rate", json={"rating": rating}
    )

    assert response.status_code == 400


# --- The mentor's own record ---------------------------------------------


def test_a_student_who_mentors_nobody_has_no_record(buddy_app):
    buddy_app.as_(MENTEE)

    body = buddy_app.get("/buddy/my-mentoring").json()

    assert body["is_mentor"] is False
    assert body["sessions_mentored"] == 0


def test_mentoring_adds_up_to_something_the_mentor_can_see(buddy_app, paired):
    """Unpaid work that accrued nothing to the person doing it now has a ledger."""
    pair, cycle = paired
    first = _completed_session(pair, cycle)
    second = _completed_session(pair, cycle)
    buddy_sessions_store.rate(first.session_id, 5)
    buddy_sessions_store.rate(second.session_id, 4)
    buddy_app.as_(MENTOR)

    body = buddy_app.get("/buddy/my-mentoring").json()

    assert body["is_mentor"] is True
    assert body["active_mentees"] == 1
    assert body["sessions_mentored"] == 2
    assert body["average_rating"] == 4.5


def test_an_unmeasured_cycle_is_not_counted_as_a_mentee_improved(buddy_app, paired):
    """The easiest lie on this page would be claiming an unmeasured cycle."""
    pair, cycle = paired
    buddy_app.post(f"/buddy/admin/cycles/{cycle.cycle_id}/close")
    buddy_app.as_(MENTOR)

    body = buddy_app.get("/buddy/my-mentoring").json()

    assert body["cycles_completed"] == 1
    assert body["mentees_improved"] == 0


# --- Nudges ---------------------------------------------------------------


def test_a_pairing_that_never_started_is_told_to_start(buddy_app, paired):
    buddy_app.as_(MENTEE)

    conversation = buddy_app.get("/buddy/me").json()["conversations"][0]

    assert conversation["nudge"] == "You haven't spoken yet. Send a first voice note."


def test_a_healthy_pairing_is_not_nagged(buddy_app, paired):
    """A nudge on every conversation would train people to ignore all of them."""
    pair, _cycle = paired
    buddy_app.as_(MENTEE)
    buddy_app.post(f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "hello"})

    conversation = buddy_app.get("/buddy/me").json()["conversations"][0]

    assert conversation["nudge"] is None


def test_the_inbox_answers_what_now_with_the_next_session(buddy_app, paired):
    pair, cycle = paired
    _completed_session(pair, cycle)
    buddy_sessions_store.create(
        pair_id=pair.pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at="2026-08-20T10:00:00+00:00",
        created_by=MENTOR.email,
    )
    buddy_app.as_(MENTEE)

    conversation = buddy_app.get("/buddy/me").json()["conversations"][0]

    assert conversation["next_session_at"] == "2026-08-20T10:00:00+00:00"
    assert conversation["sessions_kept"] == 1


# --- Why, not just how many stars -----------------------------------------
#
# A bare 2/5 tells a mentor to feel bad and nothing about what to change. The
# reasons are deliberately visible to the mentor: this is feedback TO them.
# The private channel for "this pairing is wrong" is a concern, which they
# never see — see tests/test_buddy_concerns.py.


def _rated(buddy_app, paired, **payload):
    """Complete a session and rate it with the given payload."""
    pair, cycle = paired
    buddy_app.as_(MENTEE)
    session = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/sessions",
        json={"scheduled_at": "2026-08-20T10:00:00+00:00"},
    ).json()
    buddy_app.post(f"/buddy/sessions/{session['session_id']}/complete", json={})
    return buddy_app.post(
        f"/buddy/sessions/{session['session_id']}/rate", json=payload
    )


def test_a_rating_can_carry_its_reasons(buddy_app, paired):
    response = _rated(
        buddy_app,
        paired,
        rating=5,
        aspects=["prepared", "specific"],
        note="Told me exactly which words I was rushing.",
    )

    body = response.json()
    assert body["mentee_rating"] == 5
    assert body["mentee_rating_aspects"] == ["prepared", "specific"]
    assert body["mentee_rating_note"].startswith("Told me exactly")


def test_a_bare_rating_still_works(buddy_app, paired):
    """Reasons are optional — demanding them would suppress ratings."""
    body = _rated(buddy_app, paired, rating=4).json()

    assert body["mentee_rating"] == 4
    assert body["mentee_rating_aspects"] == []
    assert body["mentee_rating_note"] == ""


def test_the_mentor_can_read_the_reasons(buddy_app, paired):
    """The entire point: a mentor learns what to do differently."""
    pair, _cycle = paired
    _rated(buddy_app, paired, rating=2, aspects=["vague"], note="be more specific")

    buddy_app.as_(MENTOR)
    sessions = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/sessions").json()["sessions"]

    assert sessions[0]["mentee_rating_aspects"] == ["vague"]
    assert sessions[0]["mentee_rating_note"] == "be more specific"


def test_an_unknown_aspect_is_refused(buddy_app, paired):
    response = _rated(buddy_app, paired, rating=3, aspects=["mid"])

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_aspect"


def test_duplicate_aspects_are_collapsed(buddy_app, paired):
    """Otherwise the same reason double-counts in any tally."""
    body = _rated(
        buddy_app, paired, rating=5, aspects=["prepared", "PREPARED", "prepared"]
    ).json()

    assert body["mentee_rating_aspects"] == ["prepared"]


def test_an_overlong_note_is_refused(buddy_app, paired):
    response = _rated(buddy_app, paired, rating=3, note="x" * 501)

    assert response.status_code == 400
    assert response.json()["detail"] == "note_too_long"


def test_re_rating_replaces_the_previous_reasons(buddy_app, paired):
    """Otherwise last week's complaint stays attached to this week's five."""
    pair, _cycle = paired
    buddy_app.as_(MENTEE)
    session = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/sessions",
        json={"scheduled_at": "2026-08-20T10:00:00+00:00"},
    ).json()
    buddy_app.post(f"/buddy/sessions/{session['session_id']}/complete", json={})

    url = f"/buddy/sessions/{session['session_id']}/rate"
    buddy_app.post(url, json={"rating": 2, "aspects": ["vague"], "note": "unclear"})
    body = buddy_app.post(url, json={"rating": 5, "aspects": ["specific"]}).json()

    assert body["mentee_rating"] == 5
    assert body["mentee_rating_aspects"] == ["specific"]
    assert body["mentee_rating_note"] == ""


def test_praise_and_criticism_are_both_available(buddy_app, paired):
    """A vocabulary of only complaints turns the rating into a report card."""
    from app.buddy import routes

    assert "encouraging" in routes.VALID_RATING_ASPECTS
    assert "harsh" in routes.VALID_RATING_ASPECTS
