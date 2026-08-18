"""Endpoint tests for the buddy router — chiefly the access rules.

The buddy router is mounted on a bare FastAPI app rather than the real
`app.api.routes` aggregate, so these tests don't drag in every other feature's
imports. Auth is supplied by overriding the two dependencies the router uses.

The stores are module-level singletons shared with `app.buddy.service`, so
redirecting each one's `path` at a temp file points every caller at test data.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy.routes import router as buddy_router
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import mentors_store


MENTOR = User(uid="u-mentor", email="mentor@x.com", name="Mentor", role="student")
MENTEE = User(uid="u-mentee", email="mentee@x.com", name="Mentee", role="student")
STRANGER = User(uid="u-stranger", email="stranger@x.com", role="student")
TEACHER = User(uid="u-teacher", email="teacher@x.com", role="teacher")


@pytest.fixture()
def buddy_app(tmp_path, monkeypatch):
    """A test client plus an `as_(user)` switch for the acting identity."""
    monkeypatch.setattr(mentors_store, "path", tmp_path / "mentors.jsonl")
    monkeypatch.setattr(buddy_pairs_store, "path", tmp_path / "pairs.jsonl")
    monkeypatch.setattr(buddy_messages_store, "path", tmp_path / "messages.jsonl")
    monkeypatch.setattr(buddy_cycles_store, "path", tmp_path / "cycles.jsonl")

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
            # Mirrors the real dependency so non-teacher access is a 403.
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
    """An active mentor/mentee pairing to talk in."""
    return buddy_pairs_store.create(
        mentor_email=MENTOR.email,
        mentee_email=MENTEE.email,
        created_by=TEACHER.email,
    )


# --- Conversation access --------------------------------------------------


def test_members_can_read_the_conversation(buddy_app, pair):
    for user in (MENTOR, MENTEE):
        buddy_app.as_(user)
        response = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages")
        assert response.status_code == 200
        assert response.json()["pair_id"] == pair.pair_id


def test_a_member_sees_the_other_as_their_partner(buddy_app, pair):
    buddy_app.as_(MENTEE)
    body = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages").json()
    assert body["partner_email"] == MENTOR.email


def test_thread_and_inbox_agree_on_the_partner_name(buddy_app):
    """The name captured on the pair is what both endpoints report."""
    pair = buddy_pairs_store.create(
        mentor_email=MENTOR.email,
        mentee_email=MENTEE.email,
        created_by=TEACHER.email,
        mentor_name="Ada Mentor",
        mentee_name="Bob Mentee",
    )

    buddy_app.as_(MENTEE)
    thread = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages").json()
    inbox = buddy_app.get("/buddy/me").json()["conversations"][0]
    assert thread["partner_name"] == inbox["partner_name"] == "Ada Mentor"

    # And from the other side of the same pairing.
    buddy_app.as_(MENTOR)
    thread = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages").json()
    inbox = buddy_app.get("/buddy/me").json()["conversations"][0]
    assert thread["partner_name"] == inbox["partner_name"] == "Bob Mentee"


def test_strangers_are_refused(buddy_app, pair):
    buddy_app.as_(STRANGER)
    assert buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages").status_code == 403
    assert (
        buddy_app.post(
            f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "hi"}
        ).status_code
        == 403
    )


def test_teachers_may_read_any_pair(buddy_app, pair):
    """The pairing is their doing, so reading it is in scope."""
    buddy_app.as_(TEACHER)
    assert buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages").status_code == 200


def test_teachers_may_not_post_into_a_pair(buddy_app, pair):
    """Reading is oversight; posting would put a third voice in a 1:1."""
    buddy_app.as_(TEACHER)
    response = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "hello"}
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "not_a_participant"


def test_unknown_pair_is_404(buddy_app):
    buddy_app.as_(MENTEE)
    assert buddy_app.get("/buddy/pairs/no-such-pair/messages").status_code == 404


# --- Messaging ------------------------------------------------------------


def test_send_and_read_back_a_message(buddy_app, pair):
    buddy_app.as_(MENTEE)
    sent = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "  hello  "}
    )
    assert sent.status_code == 200
    assert sent.json()["body"] == "hello"  # trimmed
    assert sent.json()["kind"] == "text"

    history = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages").json()
    assert history["total"] == 1
    assert history["messages"][0]["body"] == "hello"


def test_empty_message_is_rejected(buddy_app, pair):
    buddy_app.as_(MENTEE)
    response = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "   "}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "empty_message"


def test_overlong_message_is_truncated_not_refused(buddy_app, pair):
    from app.buddy.routes import MAX_MESSAGE_CHARS

    buddy_app.as_(MENTEE)
    response = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "a" * 5000}
    )
    assert response.status_code == 200
    assert len(response.json()["body"]) == MAX_MESSAGE_CHARS


def test_ended_conversations_are_read_only(buddy_app, pair):
    buddy_pairs_store.end(pair.pair_id)
    buddy_app.as_(MENTEE)

    assert buddy_app.get(f"/buddy/pairs/{pair.pair_id}/messages").status_code == 200
    response = buddy_app.post(
        f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "hi"}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "conversation_ended"


def test_mark_read_clears_only_the_partners_messages(buddy_app, pair):
    buddy_app.as_(MENTOR)
    buddy_app.post(f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "hi"})
    buddy_app.as_(MENTEE)
    buddy_app.post(f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "hello"})

    marked = buddy_app.post(f"/buddy/pairs/{pair.pair_id}/read")
    assert marked.status_code == 200
    assert marked.json()["marked"] == 1

    inbox = buddy_app.get("/buddy/me").json()
    assert inbox["conversations"][0]["unread_count"] == 0


# --- Inbox ----------------------------------------------------------------


def test_inbox_lists_only_your_own_conversations(buddy_app, pair):
    buddy_app.as_(STRANGER)
    assert buddy_app.get("/buddy/me").json()["total"] == 0

    buddy_app.as_(MENTEE)
    assert buddy_app.get("/buddy/me").json()["total"] == 1


def test_inbox_reports_each_side_s_role(buddy_app, pair):
    buddy_app.as_(MENTOR)
    assert buddy_app.get("/buddy/me").json()["conversations"][0]["my_role"] == "mentor"

    buddy_app.as_(MENTEE)
    assert buddy_app.get("/buddy/me").json()["conversations"][0]["my_role"] == "mentee"


def test_inbox_shows_unread_count_and_preview(buddy_app, pair):
    buddy_app.as_(MENTOR)
    buddy_app.post(f"/buddy/pairs/{pair.pair_id}/messages", json={"body": "how did it go?"})

    buddy_app.as_(MENTEE)
    conversation = buddy_app.get("/buddy/me").json()["conversations"][0]
    assert conversation["unread_count"] == 1
    assert conversation["last_message_preview"] == "how did it go?"
    assert conversation["last_message_at"] is not None


def test_inbox_orders_by_most_recent_activity(buddy_app):
    quiet = buddy_pairs_store.create("a@x.com", MENTEE.email, created_by=TEACHER.email)
    busy = buddy_pairs_store.create("b@x.com", MENTEE.email, created_by=TEACHER.email)

    buddy_app.as_(MENTEE)
    buddy_app.post(f"/buddy/pairs/{busy.pair_id}/messages", json={"body": "hi"})

    conversations = buddy_app.get("/buddy/me").json()["conversations"]
    assert [c["pair_id"] for c in conversations] == [busy.pair_id, quiet.pair_id]


# --- Voice notes ----------------------------------------------------------


def test_voice_note_of_a_stranger_is_not_served(buddy_app, pair):
    message = buddy_messages_store.create(
        pair_id=pair.pair_id,
        sender_email=MENTOR.email,
        kind="voice",
        audio_id="a1",
        audio_path="uploads/a1.webm",
    )

    buddy_app.as_(STRANGER)
    assert buddy_app.get(f"/buddy/messages/{message.message_id}/audio").status_code == 403


def test_voice_note_path_outside_uploads_is_refused(buddy_app, pair):
    """A stored path is never trusted as a key into the filesystem."""
    message = buddy_messages_store.create(
        pair_id=pair.pair_id,
        sender_email=MENTOR.email,
        kind="voice",
        audio_id="a1",
        audio_path="../../etc/passwd",
    )

    buddy_app.as_(MENTEE)
    response = buddy_app.get(f"/buddy/messages/{message.message_id}/audio")
    assert response.status_code == 404


def test_unknown_voice_note_is_404(buddy_app):
    buddy_app.as_(MENTEE)
    assert buddy_app.get("/buddy/messages/nope/audio").status_code == 404


# --- Teacher administration ----------------------------------------------


def test_admin_routes_are_teacher_only(buddy_app):
    buddy_app.as_(MENTEE)
    assert buddy_app.get("/buddy/admin/mentors").status_code == 403
    assert buddy_app.get("/buddy/admin/pairs").status_code == 403
    assert (
        buddy_app.post(
            "/buddy/admin/pairs",
            json={"mentor_email": "a@x.com", "mentee_email": "b@x.com"},
        ).status_code
        == 403
    )


def test_decision_must_be_approved_or_rejected(buddy_app):
    buddy_app.as_(TEACHER)
    response = buddy_app.post(
        "/buddy/admin/mentors/ada@x.com/decision", json={"status": "maybe"}
    )
    assert response.status_code == 400


def test_approving_a_mentor_records_the_decision(buddy_app):
    buddy_app.as_(TEACHER)
    response = buddy_app.post(
        "/buddy/admin/mentors/Ada@X.com/decision", json={"status": "approved"}
    )

    assert response.status_code == 200
    mentors = response.json()["mentors"]
    assert len(mentors) == 1
    assert mentors[0]["email"] == "ada@x.com"
    assert mentors[0]["status"] == "approved"
    assert mentors[0]["decided_by"] == TEACHER.email


def test_pairing_requires_an_approved_mentor(buddy_app):
    buddy_app.as_(TEACHER)
    response = buddy_app.post(
        "/buddy/admin/pairs",
        json={"mentor_email": "ada@x.com", "mentee_email": "bob@x.com"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "mentor_not_approved"


def test_a_rejected_mentor_cannot_be_paired(buddy_app):
    buddy_app.as_(TEACHER)
    buddy_app.post(
        "/buddy/admin/mentors/ada@x.com/decision", json={"status": "rejected"}
    )

    response = buddy_app.post(
        "/buddy/admin/pairs",
        json={"mentor_email": "ada@x.com", "mentee_email": "bob@x.com"},
    )
    assert response.status_code == 400


def test_a_student_cannot_mentor_themselves(buddy_app):
    buddy_app.as_(TEACHER)
    buddy_app.post(
        "/buddy/admin/mentors/ada@x.com/decision", json={"status": "approved"}
    )

    response = buddy_app.post(
        "/buddy/admin/pairs",
        json={"mentor_email": "ada@x.com", "mentee_email": "Ada@X.com"},
    )
    assert response.status_code == 400


def test_creating_a_pair_then_duplicating_it_conflicts(buddy_app):
    buddy_app.as_(TEACHER)
    buddy_app.post(
        "/buddy/admin/mentors/ada@x.com/decision", json={"status": "approved"}
    )

    created = buddy_app.post(
        "/buddy/admin/pairs",
        json={"mentor_email": "Ada@X.com", "mentee_email": "Bob@X.com"},
    )
    assert created.status_code == 200
    assert created.json()["mentor_email"] == "ada@x.com"
    assert created.json()["status"] == "active"

    duplicate = buddy_app.post(
        "/buddy/admin/pairs",
        json={"mentor_email": "ada@x.com", "mentee_email": "bob@x.com"},
    )
    assert duplicate.status_code == 409


def test_a_pair_can_be_recreated_after_it_ends(buddy_app):
    buddy_app.as_(TEACHER)
    buddy_app.post(
        "/buddy/admin/mentors/ada@x.com/decision", json={"status": "approved"}
    )
    payload = {"mentor_email": "ada@x.com", "mentee_email": "bob@x.com"}
    first = buddy_app.post("/buddy/admin/pairs", json=payload).json()

    ended = buddy_app.post(f"/buddy/admin/pairs/{first['pair_id']}/end")
    assert ended.status_code == 200
    assert ended.json()["status"] == "ended"

    assert buddy_app.post("/buddy/admin/pairs", json=payload).status_code == 200


def test_ending_an_unknown_pair_is_404(buddy_app):
    buddy_app.as_(TEACHER)
    assert buddy_app.post("/buddy/admin/pairs/no-such-pair/end").status_code == 404


def test_mentor_candidates_reports_the_tuning_it_used(buddy_app):
    from app.buddy import service

    buddy_app.as_(TEACHER)
    body = buddy_app.get("/buddy/admin/mentor-candidates").json()

    assert body["threshold"] == service.SUGGESTION_THRESHOLD
    assert body["min_sample_size"] == service.MIN_SAMPLE_SIZE


# --- Cycles ---------------------------------------------------------------


def _approve_and_pair(buddy_app, **extra):
    """Approve a mentor and pair them, returning the create response."""
    buddy_app.as_(TEACHER)
    mentors_store.set_status(
        email=MENTOR.email, status="approved", decided_by=TEACHER.email
    )
    return buddy_app.post(
        "/buddy/admin/pairs",
        json={
            "mentor_email": MENTOR.email,
            "mentee_email": MENTEE.email,
            **extra,
        },
    )


def test_pairing_opens_a_cycle_by_default(buddy_app):
    """A pairing with no period is the gap cycles exist to close."""
    response = _approve_and_pair(buddy_app)
    assert response.status_code == 200

    cycle = buddy_cycles_store.active_for_pair(response.json()["pair_id"])
    assert cycle is not None
    assert cycle.mentee_email == MENTEE.email
    assert cycle.starts_at < cycle.ends_at


def test_a_teacher_can_pair_without_starting_a_cycle(buddy_app):
    response = _approve_and_pair(buddy_app, cycle_weeks=0)
    assert buddy_cycles_store.active_for_pair(response.json()["pair_id"]) is None


def test_the_cycle_carries_the_goal_the_teacher_set(buddy_app):
    response = _approve_and_pair(
        buddy_app, cycle_weeks=6, goal="Cut filler words", focus_area="fluency"
    )
    cycle = buddy_cycles_store.active_for_pair(response.json()["pair_id"])

    assert cycle.goal == "Cut filler words"
    assert cycle.focus_area == "fluency"


def test_a_second_cycle_on_an_open_one_is_refused(buddy_app, pair):
    buddy_app.as_(TEACHER)
    first = buddy_app.post(
        "/buddy/admin/cycles", json={"pair_id": pair.pair_id, "weeks": 4}
    )
    assert first.status_code == 200

    second = buddy_app.post(
        "/buddy/admin/cycles", json={"pair_id": pair.pair_id, "weeks": 4}
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "cycle_already_active"


def test_closing_a_cycle_allows_a_renewal(buddy_app, pair):
    buddy_app.as_(TEACHER)
    cycle_id = buddy_app.post(
        "/buddy/admin/cycles", json={"pair_id": pair.pair_id, "weeks": 4}
    ).json()["cycle_id"]

    assert buddy_app.post(f"/buddy/admin/cycles/{cycle_id}/close").status_code == 200
    assert (
        buddy_app.post(
            "/buddy/admin/cycles", json={"pair_id": pair.pair_id, "weeks": 4}
        ).status_code
        == 200
    )
    assert len(buddy_cycles_store.list_for_pair(pair.pair_id)) == 2


def test_an_absurd_cycle_length_is_rejected(buddy_app, pair):
    buddy_app.as_(TEACHER)
    response = buddy_app.post(
        "/buddy/admin/cycles", json={"pair_id": pair.pair_id, "weeks": 500}
    )
    assert response.status_code == 400


def test_only_a_teacher_may_open_a_cycle(buddy_app, pair):
    buddy_app.as_(MENTOR)
    response = buddy_app.post(
        "/buddy/admin/cycles", json={"pair_id": pair.pair_id, "weeks": 4}
    )
    assert response.status_code == 403


def test_a_cycle_needs_a_pair_that_exists(buddy_app):
    buddy_app.as_(TEACHER)
    response = buddy_app.post(
        "/buddy/admin/cycles", json={"pair_id": "no-such-pair", "weeks": 4}
    )
    assert response.status_code == 404


# --- Cycle-scoped activity ------------------------------------------------


def test_both_members_can_read_the_cycle_activity(buddy_app, pair):
    buddy_app.as_(TEACHER)
    buddy_app.post("/buddy/admin/cycles", json={"pair_id": pair.pair_id, "weeks": 4})

    for user in (MENTOR, MENTEE):
        buddy_app.as_(user)
        response = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/activity")
        assert response.status_code == 200
        assert response.json()["cycle"]["pair_id"] == pair.pair_id


def test_a_stranger_cannot_read_the_cycle_activity(buddy_app, pair):
    """The mentee's record is for their own mentor, not any signed-in student."""
    buddy_app.as_(STRANGER)
    response = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/activity")
    assert response.status_code == 403


def test_activity_without_an_open_cycle_is_empty_not_an_error(buddy_app, pair):
    buddy_app.as_(MENTOR)
    body = buddy_app.get(f"/buddy/pairs/{pair.pair_id}/activity").json()

    assert body["cycle"] is None
    assert body["activity"] == []
    assert body["enough_for_trend"] is False
