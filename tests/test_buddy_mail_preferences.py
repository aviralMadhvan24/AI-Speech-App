"""Turning the digest email off, from inside the app and from the email itself.

Two routes because they serve two moments. The signed-in toggle is for someone
deciding; the link is for someone who has just been emailed and wants it to
stop now, in the client they are reading it in, with no session to hand.

The link is the one that has to be right. Demanding a sign-in to stop unwanted
mail is how an unsubscribe becomes a spam complaint.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy.routes import router as buddy_router
from app.storage.buddy import buddy_mail_prefs_store

STUDENT = User(uid="u-student", email="student@x.test", role="student")
OTHER = User(uid="u-other", email="other@x.test", role="student")


@pytest.fixture()
def app_client(tmp_path, monkeypatch):
    monkeypatch.setattr(buddy_mail_prefs_store, "path", tmp_path / "prefs.jsonl")

    app = FastAPI()
    app.include_router(buddy_router)
    current: dict[str, User] = {"user": STUDENT}

    app.dependency_overrides[require_user] = lambda: current["user"]
    app.dependency_overrides[require_teacher] = lambda: current["user"]

    client = TestClient(app)
    client.as_ = lambda user: current.__setitem__("user", user)
    return client


def test_never_having_said_reads_as_opted_in(app_client):
    body = app_client.get("/buddy/mail-preferences").json()
    assert body["digest_opted_out"] is False


def test_the_toggle_persists_both_ways(app_client):
    off = app_client.post("/buddy/mail-preferences", json={"digest_opted_out": True})
    assert off.json()["digest_opted_out"] is True
    assert app_client.get("/buddy/mail-preferences").json()["digest_opted_out"] is True

    on = app_client.post("/buddy/mail-preferences", json={"digest_opted_out": False})
    assert on.json()["digest_opted_out"] is False


def test_a_preference_is_per_person(app_client):
    app_client.post("/buddy/mail-preferences", json={"digest_opted_out": True})

    app_client.as_(OTHER)
    assert app_client.get("/buddy/mail-preferences").json()["digest_opted_out"] is False


def test_the_link_works_with_no_session_at_all(app_client):
    """The whole point: a mail client carries no auth."""
    token = buddy_mail_prefs_store.ensure(STUDENT.uid).unsubscribe_token

    response = app_client.get(f"/buddy/unsubscribe?token={token}")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert buddy_mail_prefs_store.is_opted_out(STUDENT.uid) is True


def test_clicking_twice_is_not_an_error(app_client):
    """People do click twice, and a scary page is a support request."""
    token = buddy_mail_prefs_store.ensure(STUDENT.uid).unsubscribe_token

    assert app_client.get(f"/buddy/unsubscribe?token={token}").status_code == 200
    assert app_client.get(f"/buddy/unsubscribe?token={token}").status_code == 200
    assert buddy_mail_prefs_store.is_opted_out(STUDENT.uid) is True


def test_an_unknown_token_does_not_reveal_that_it_is_unknown(app_client):
    """A 404 on a bad token turns the endpoint into an oracle for good ones."""
    good = app_client.get("/buddy/unsubscribe?token=deadbeef")
    empty = app_client.get("/buddy/unsubscribe")

    assert good.status_code == empty.status_code == 200
    # Nobody was unsubscribed by guessing.
    assert buddy_mail_prefs_store.list_all() == []


def test_unsubscribing_touches_only_the_mail(app_client):
    """It must not read as leaving the programme."""
    token = buddy_mail_prefs_store.ensure(STUDENT.uid).unsubscribe_token
    page = app_client.get(f"/buddy/unsubscribe?token={token}").text

    assert "pairing is untouched" in page
    # And it is reversible from inside the app, which the page says so that
    # somebody who clicked by accident is not stuck.
    app_client.post("/buddy/mail-preferences", json={"digest_opted_out": False})
    assert buddy_mail_prefs_store.is_opted_out(STUDENT.uid) is False
