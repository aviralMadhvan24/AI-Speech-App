"""Either side raising a hand: "this pairing is not working".

Before this, a bad pairing only surfaced as `health` going quiet at 7 days and
stalled at 14 — a signal that cannot tell a wrong pairing from exam week, and
arrives a fortnight late either way.

The rule most of these tests exist to protect is the privacy one. A concern is
readable by teachers and by whoever raised it, and by nobody else. A mentee who
has to weigh "will my mentor see this" before reporting an absent mentor will
report nothing, and the feature is worse than not having it.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy.routes import router as buddy_router
from app.storage.buddy import buddy_concerns_store
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store

MENTOR = User(uid="u-mentor", email="mentor@x.com", role="student")
MENTEE = User(uid="u-mentee", email="mentee@x.com", role="student")
OUTSIDER = User(uid="u-out", email="nosy@x.com", role="student")
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


@pytest.fixture()
def pair(buddy_app):
    return buddy_pairs_store.create(
        mentor_email=MENTOR.email,
        mentee_email=MENTEE.email,
        created_by=TEACHER.email,
    )


def _raise(app, pair_id, reason="unresponsive", detail=""):
    return app.post(
        f"/buddy/pairs/{pair_id}/concern",
        json={"reason": reason, "detail": detail},
    )


# --- Privacy: the rule the whole feature rests on -------------------------


def test_the_partner_cannot_see_a_concern_raised_about_them(buddy_app, pair):
    """The mentor must not learn their mentee flagged them."""
    buddy_app.as_(MENTEE)
    assert _raise(buddy_app, pair.pair_id, detail="never replies").status_code == 200

    buddy_app.as_(MENTOR)
    body = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/concern").json()

    assert body["concern"] is None, "the mentor sees only their own"


def test_the_raiser_can_confirm_their_own_concern_was_recorded(buddy_app, pair):
    buddy_app.as_(MENTEE)
    _raise(buddy_app, pair.pair_id, reason="schedule", detail="clashes with labs")

    body = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/concern").json()

    assert body["concern"]["reason"] == "schedule"
    assert body["concern"]["detail"] == "clashes with labs"
    assert body["concern"]["status"] == "open"


def test_an_outsider_cannot_raise_a_concern_on_someone_elses_pairing(buddy_app, pair):
    buddy_app.as_(OUTSIDER)
    assert _raise(buddy_app, pair.pair_id).status_code == 403


def test_the_queue_is_teacher_only(buddy_app, pair):
    buddy_app.as_(MENTEE)
    _raise(buddy_app, pair.pair_id)

    assert buddy_app.get("/buddy/admin/concerns").status_code == 403


def test_a_teacher_is_not_a_participant_and_cannot_raise_one(buddy_app, pair):
    """They created the pairing and already have the queue."""
    buddy_app.as_(TEACHER)
    assert _raise(buddy_app, pair.pair_id).status_code == 403


# --- Raising --------------------------------------------------------------


def test_the_role_is_recorded_so_a_teacher_can_see_which_side_flagged(buddy_app, pair):
    """A mentor reporting a silent mentee is a different problem."""
    buddy_app.as_(MENTOR)
    assert _raise(buddy_app, pair.pair_id).json()["role"] == "mentor"

    buddy_app.as_(MENTEE)
    assert _raise(buddy_app, pair.pair_id).json()["role"] == "mentee"


def test_both_sides_may_flag_the_same_pairing_independently(buddy_app, pair):
    buddy_app.as_(MENTOR)
    _raise(buddy_app, pair.pair_id)
    buddy_app.as_(MENTEE)
    _raise(buddy_app, pair.pair_id)

    buddy_app.as_(TEACHER)
    assert buddy_app.get("/buddy/admin/concerns").json()["total"] == 2


def test_re_flagging_is_refused_rather_than_duplicated(buddy_app, pair):
    """A queue with the same pairing five times in it is a worse queue."""
    buddy_app.as_(MENTEE)
    assert _raise(buddy_app, pair.pair_id).status_code == 200

    second = _raise(buddy_app, pair.pair_id)
    assert second.status_code == 409
    assert second.json()["detail"] == "concern_already_open"


def test_a_resolved_concern_may_be_raised_again(buddy_app, pair):
    """The pairing can go wrong twice, and the second time still matters."""
    buddy_app.as_(MENTEE)
    first = _raise(buddy_app, pair.pair_id).json()

    buddy_app.as_(TEACHER)
    buddy_app.post(
        f"/buddy/admin/concerns/{first['concern_id']}/resolve",
        json={"resolution": "spoke to both"},
    )

    buddy_app.as_(MENTEE)
    assert _raise(buddy_app, pair.pair_id).status_code == 200


def test_an_unknown_reason_is_refused(buddy_app, pair):
    buddy_app.as_(MENTEE)
    response = _raise(buddy_app, pair.pair_id, reason="vibes")

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_reason"


def test_an_overlong_detail_is_refused(buddy_app, pair):
    buddy_app.as_(MENTEE)
    response = _raise(buddy_app, pair.pair_id, detail="x" * 1001)

    assert response.status_code == 400
    assert response.json()["detail"] == "detail_too_long"


def test_a_concern_on_an_unknown_pair_is_a_404(buddy_app):
    buddy_app.as_(MENTEE)
    assert _raise(buddy_app, "no-such-pair").status_code == 404


# --- The teacher's queue --------------------------------------------------


def test_the_queue_is_oldest_first_because_it_is_a_worklist(buddy_app, pair):
    """The pairing waiting three weeks must not be buried under fresh flags."""
    second = buddy_pairs_store.create(
        mentor_email=MENTOR.email, mentee_email="other@x.com", created_by=TEACHER.email
    )

    buddy_app.as_(MENTEE)
    _raise(buddy_app, pair.pair_id, detail="first")
    buddy_app.as_(User(uid="u-other", email="other@x.com", role="student"))
    _raise(buddy_app, second.pair_id, detail="second")

    buddy_app.as_(TEACHER)
    queue = buddy_app.get("/buddy/admin/concerns").json()["concerns"]

    assert [c["detail"] for c in queue] == ["first", "second"]


def test_resolved_concerns_leave_the_queue(buddy_app, pair):
    buddy_app.as_(MENTEE)
    concern = _raise(buddy_app, pair.pair_id).json()

    buddy_app.as_(TEACHER)
    buddy_app.post(
        f"/buddy/admin/concerns/{concern['concern_id']}/resolve",
        json={"resolution": "repaired"},
    )

    assert buddy_app.get("/buddy/admin/concerns").json()["total"] == 0
    assert buddy_app.get("/buddy/admin/concerns?include_resolved=true").json()["total"] == 1


def test_resolving_records_who_did_it_and_what_they_did(buddy_app, pair):
    """"Resolved" with no record of the action is just a click."""
    buddy_app.as_(MENTEE)
    concern = _raise(buddy_app, pair.pair_id).json()

    buddy_app.as_(TEACHER)
    resolved = buddy_app.post(
        f"/buddy/admin/concerns/{concern['concern_id']}/resolve",
        json={"resolution": "re-paired with a new mentor"},
    ).json()

    assert resolved["status"] == "resolved"
    assert resolved["resolved_by"] == TEACHER.email
    assert resolved["resolution"] == "re-paired with a new mentor"
    assert resolved["resolved_at"] is not None


def test_resolving_twice_is_refused(buddy_app, pair):
    buddy_app.as_(MENTEE)
    concern = _raise(buddy_app, pair.pair_id).json()

    buddy_app.as_(TEACHER)
    url = f"/buddy/admin/concerns/{concern['concern_id']}/resolve"
    assert buddy_app.post(url, json={}).status_code == 200
    assert buddy_app.post(url, json={}).status_code == 409


def test_resolving_an_unknown_concern_is_a_404(buddy_app):
    buddy_app.as_(TEACHER)
    response = buddy_app.post("/buddy/admin/concerns/nope/resolve", json={})
    assert response.status_code == 404


def test_open_concerns_ride_along_with_the_pairs_list(buddy_app, pair):
    """A teacher triages pairings on one screen; a second call would drift."""
    buddy_app.as_(MENTEE)
    _raise(buddy_app, pair.pair_id)

    buddy_app.as_(TEACHER)
    body = buddy_app.get("/buddy/admin/pairs").json()

    assert body["open_concerns"] == {pair.pair_id: 1}


def test_a_pair_with_no_concerns_is_absent_from_the_map_not_zero(buddy_app, pair):
    buddy_app.as_(TEACHER)
    assert buddy_app.get("/buddy/admin/pairs").json()["open_concerns"] == {}


def test_a_busy_pairing_can_still_be_the_wrong_pairing(buddy_app, pair):
    """Health judges activity; a concern is a separate axis and must not merge."""
    buddy_app.as_(MENTEE)
    buddy_app.post(f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "hello"})
    _raise(buddy_app, pair.pair_id, reason="mismatch")

    buddy_app.as_(TEACHER)
    body = buddy_app.get("/buddy/admin/pairs").json()

    assert body["open_concerns"][pair.pair_id] == 1
    # Health says nothing about it — that is the point of keeping them apart.
    assert "concern" not in str(body["health"][pair.pair_id])
