"""Storage-level tests for the buddy mentorship stores.

Each store is constructed against a `tmp_path` file rather than the real
`outputs/` location, so these tests never touch classroom data.
"""

from __future__ import annotations

import pytest

from app.storage.buddy import BuddyMessagesStore
from app.storage.buddy import BuddyPairsStore
from app.storage.buddy import MentorsStore


@pytest.fixture()
def mentors(tmp_path):
    return MentorsStore(path=tmp_path / "mentors.jsonl")


@pytest.fixture()
def pairs(tmp_path):
    return BuddyPairsStore(path=tmp_path / "pairs.jsonl")


@pytest.fixture()
def messages(tmp_path):
    return BuddyMessagesStore(path=tmp_path / "messages.jsonl")


# --- MentorsStore ---------------------------------------------------------


def test_empty_store_reads_as_empty(mentors):
    """A store whose file does not exist yet is empty, not an error."""
    assert mentors.list_all() == []
    assert mentors.get("nobody@example.com") is None
    assert mentors.is_approved("nobody@example.com") is False


def test_set_status_creates_then_updates_one_row(mentors):
    mentors.set_status(
        email="Ada@Example.com",
        status="suggested",
        decided_by="teacher@example.com",
        speaking_score=72.5,
        sample_size=3,
        name="Ada",
    )
    mentors.set_status(
        email="ada@example.com",
        status="approved",
        decided_by="teacher@example.com",
    )

    # The second call must update in place, not append a second row.
    assert len(mentors.list_all()) == 1
    record = mentors.get("ADA@example.com")
    assert record is not None
    assert record.status == "approved"
    assert mentors.is_approved("ada@example.com") is True


def test_update_keeps_the_score_the_decision_was_made_on(mentors):
    """Omitted score/sample/name on a later call must not blank the snapshot."""
    mentors.set_status(
        email="ada@example.com",
        status="suggested",
        decided_by="teacher@example.com",
        speaking_score=81.0,
        sample_size=4,
        name="Ada",
    )
    updated = mentors.set_status(
        email="ada@example.com",
        status="rejected",
        decided_by="teacher@example.com",
    )

    assert updated.speaking_score == 81.0
    assert updated.sample_size == 4
    assert updated.name == "Ada"
    assert updated.decided_by == "teacher@example.com"
    assert updated.decided_at is not None


def test_email_is_normalized_on_create(mentors):
    mentors.set_status(
        email="MiXeD@Example.COM",
        status="approved",
        decided_by="teacher@example.com",
    )
    assert mentors.list_all()[0].email == "mixed@example.com"


def test_list_by_status_filters(mentors):
    mentors.set_status(email="a@x.com", status="approved", decided_by="t@x.com")
    mentors.set_status(email="b@x.com", status="rejected", decided_by="t@x.com")

    assert [m.email for m in mentors.list_by_status("approved")] == ["a@x.com"]
    assert [m.email for m in mentors.list_by_status("rejected")] == ["b@x.com"]


def test_malformed_rows_are_skipped(mentors):
    mentors.set_status(email="a@x.com", status="approved", decided_by="t@x.com")
    with open(mentors.path, "a", encoding="utf-8") as fh:
        fh.write('{"email": "broken@x.com"}\n')  # no created_at -> invalid

    # The valid row still loads; the unparseable one is dropped rather than
    # taking down every read of the file.
    assert [m.email for m in mentors.list_all()] == ["a@x.com"]


# --- BuddyPairsStore ------------------------------------------------------


def test_create_pair_normalizes_and_defaults_to_active(pairs):
    pair = pairs.create(
        mentor_email="Mentor@X.com",
        mentee_email="Mentee@X.com",
        created_by="teacher@x.com",
    )
    assert pair.mentor_email == "mentor@x.com"
    assert pair.mentee_email == "mentee@x.com"
    assert pair.status == "active"
    assert pair.ended_at is None


def test_involves_and_partner_of_are_case_insensitive(pairs):
    pair = pairs.create("mentor@x.com", "mentee@x.com", created_by="t@x.com")

    assert pair.involves("MENTOR@X.com") is True
    assert pair.involves("mentee@x.com") is True
    assert pair.involves("stranger@x.com") is False

    assert pair.partner_of("MENTOR@X.com") == "mentee@x.com"
    assert pair.partner_of("mentee@x.com") == "mentor@x.com"
    assert pair.partner_of("stranger@x.com") is None


def test_list_for_user_returns_both_roles(pairs):
    pairs.create("ada@x.com", "bob@x.com", created_by="t@x.com")
    pairs.create("cleo@x.com", "ada@x.com", created_by="t@x.com")
    pairs.create("dan@x.com", "eve@x.com", created_by="t@x.com")

    # Ada mentors one pair and is mentored in another; both are hers.
    assert len(pairs.list_for_user("ada@x.com")) == 2


def test_end_marks_ended_and_drops_out_of_active(pairs):
    pair = pairs.create("mentor@x.com", "mentee@x.com", created_by="t@x.com")
    ended = pairs.end(pair.pair_id)

    assert ended is not None
    assert ended.status == "ended"
    assert ended.ended_at is not None
    assert pairs.list_active() == []
    # History is kept, not deleted.
    assert len(pairs.list_all()) == 1


def test_end_unknown_pair_returns_none(pairs):
    assert pairs.end("no-such-pair") is None


def test_find_active_between_is_directional_and_ignores_ended(pairs):
    pair = pairs.create("mentor@x.com", "mentee@x.com", created_by="t@x.com")

    assert pairs.find_active_between("MENTOR@x.com", "mentee@x.com") is not None
    # Reversing the roles is a different relationship.
    assert pairs.find_active_between("mentee@x.com", "mentor@x.com") is None

    pairs.end(pair.pair_id)
    assert pairs.find_active_between("mentor@x.com", "mentee@x.com") is None


# --- BuddyMessagesStore ---------------------------------------------------


def test_messages_are_scoped_to_a_pair_and_ordered_by_time(messages):
    messages.create(pair_id="p1", sender_email="a@x.com", body="first")
    messages.create(pair_id="p2", sender_email="a@x.com", body="other pair")
    messages.create(pair_id="p1", sender_email="b@x.com", body="second")

    bodies = [m.body for m in messages.list_for_pair("p1")]
    assert bodies == ["first", "second"]


def test_unread_counts_only_the_partners_messages(messages):
    messages.create(pair_id="p1", sender_email="mentor@x.com", body="hi")
    messages.create(pair_id="p1", sender_email="mentor@x.com", body="you there?")
    messages.create(pair_id="p1", sender_email="mentee@x.com", body="hello")

    # Your own messages are never unread for you.
    assert messages.unread_count("p1", "mentee@x.com") == 2
    assert messages.unread_count("p1", "mentor@x.com") == 1


def test_mark_read_is_scoped_to_the_pair_and_the_reader(messages):
    messages.create(pair_id="p1", sender_email="mentor@x.com", body="hi")
    messages.create(pair_id="p1", sender_email="mentee@x.com", body="hello")
    messages.create(pair_id="p2", sender_email="mentor@x.com", body="other pair")

    marked = messages.mark_read("p1", "mentee@x.com")

    assert marked == 1
    assert messages.unread_count("p1", "mentee@x.com") == 0
    # The other pair is untouched.
    assert messages.unread_count("p2", "mentee@x.com") == 1
    # The mentee's own message is still unread for the mentor.
    assert messages.unread_count("p1", "mentor@x.com") == 1


def test_mark_read_is_idempotent(messages):
    messages.create(pair_id="p1", sender_email="mentor@x.com", body="hi")

    assert messages.mark_read("p1", "mentee@x.com") == 1
    assert messages.mark_read("p1", "mentee@x.com") == 0


def test_voice_note_carries_audio_instead_of_text(messages):
    message = messages.create(
        pair_id="p1",
        sender_email="mentor@x.com",
        kind="voice",
        audio_id="audio-1",
        audio_path="uploads/audio-1.webm",
        duration_seconds=4.5,
    )

    assert message.kind == "voice"
    assert message.body == ""
    assert message.audio_id == "audio-1"

    stored = messages.get(message.message_id)
    assert stored is not None
    assert stored.audio_path == "uploads/audio-1.webm"
    assert stored.duration_seconds == 4.5


def test_get_unknown_message_returns_none(messages):
    assert messages.get("no-such-message") is None
