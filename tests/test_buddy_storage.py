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
    assert mentors.get("u-nobody") is None
    assert mentors.is_approved("u-nobody") is False


def test_set_status_creates_then_updates_one_row(mentors):
    mentors.set_status(
        user_id="u-ada-1",
        status="suggested",
        decided_by_id="u-teacher-1",
        speaking_score=72.5,
        sample_size=3,
    )
    mentors.set_status(
        user_id="u-ada-1",
        status="approved",
        decided_by_id="u-teacher-1",
    )

    # The second call must update in place, not append a second row.
    assert len(mentors.list_all()) == 1
    record = mentors.get("u-ada-1")
    assert record is not None
    assert record.status == "approved"
    assert mentors.is_approved("u-ada-1") is True


def test_update_keeps_the_score_the_decision_was_made_on(mentors):
    """An omitted score or sample on a later call must not blank the snapshot."""
    mentors.set_status(
        user_id="u-ada-1",
        status="suggested",
        decided_by_id="u-teacher-1",
        speaking_score=81.0,
        sample_size=4,
    )
    updated = mentors.set_status(
        user_id="u-ada-1",
        status="rejected",
        decided_by_id="u-teacher-1",
    )

    assert updated.speaking_score == 81.0
    assert updated.sample_size == 4
    assert updated.decided_by_id == "u-teacher-1"
    assert updated.decided_at is not None


def test_the_id_is_stored_exactly_as_given(mentors):
    """No normalisation, because an id has no equivalent forms.

    Emails did: `Ada@x.com` and `ada@x.com` are one person, so the store
    lowercased them. A user id is opaque — two ids that differ at all are two
    different people, and folding case would silently merge them.
    """
    mentors.set_status(
        user_id="u-MiXeD",
        status="approved",
        decided_by_id="u-teacher-1",
    )
    assert mentors.list_all()[0].user_id == "u-MiXeD"
    assert mentors.get("u-MiXeD") is not None
    assert mentors.get("u-mixed") is None


def test_list_by_status_filters(mentors):
    mentors.set_status(user_id="u-a", status="approved", decided_by_id="u-t")
    mentors.set_status(user_id="u-b", status="rejected", decided_by_id="u-t")

    assert [m.user_id for m in mentors.list_by_status("approved")] == ["u-a"]
    assert [m.user_id for m in mentors.list_by_status("rejected")] == ["u-b"]


def test_malformed_rows_are_skipped(mentors):
    mentors.set_status(user_id="u-a", status="approved", decided_by_id="u-t")
    with open(mentors.path, "a", encoding="utf-8") as fh:
        fh.write('{"user_id": "u-broken"}\n')  # no created_at -> invalid

    # The valid row still loads; the unparseable one is dropped rather than
    # taking down every read of the file.
    assert [m.user_id for m in mentors.list_all()] == ["u-a"]


# --- BuddyPairsStore ------------------------------------------------------


def test_create_pair_keeps_ids_verbatim_and_defaults_to_active(pairs):
    pair = pairs.create(
        mentor_id="u-mentor",
        mentee_id="u-mentee",
        created_by_id="u-teacher-2",
    )
    assert pair.mentor_id == "u-mentor"
    assert pair.mentee_id == "u-mentee"
    assert pair.status == "active"
    assert pair.ended_at is None


def test_involves_and_partner_of_match_ids_exactly(pairs):
    pair = pairs.create("u-mentor", "u-mentee", created_by_id="u-t")

    assert pair.involves("u-mentor") is True
    assert pair.involves("u-mentee") is True
    assert pair.involves("u-stranger") is False
    # A near-miss is a miss. Membership decides who may read a private
    # conversation, so it must never be approximate.
    assert pair.involves("U-MENTOR") is False

    assert pair.partner_of("u-mentor") == "u-mentee"
    assert pair.partner_of("u-mentee") == "u-mentor"
    assert pair.partner_of("u-stranger") is None


def test_list_for_user_returns_both_roles(pairs):
    pairs.create("u-ada-2", "u-bob", created_by_id="u-t")
    pairs.create("u-cleo", "u-ada-2", created_by_id="u-t")
    pairs.create("u-dan", "u-eve", created_by_id="u-t")

    # Ada mentors one pair and is mentored in another; both are hers.
    assert len(pairs.list_for_user("u-ada-2")) == 2


def test_end_marks_ended_and_drops_out_of_active(pairs):
    pair = pairs.create("u-mentor", "u-mentee", created_by_id="u-t")
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
    pair = pairs.create("u-mentor", "u-mentee", created_by_id="u-t")

    assert pairs.find_active_between("u-mentor", "u-mentee") is not None
    # Reversing the roles is a different relationship.
    assert pairs.find_active_between("u-mentee", "u-mentor") is None

    pairs.end(pair.pair_id)
    assert pairs.find_active_between("u-mentor", "u-mentee") is None


# --- BuddyMessagesStore ---------------------------------------------------


def test_messages_are_scoped_to_a_pair_and_ordered_by_time(messages):
    messages.create(pair_id="p1", sender_id="u-a", body="first")
    messages.create(pair_id="p2", sender_id="u-a", body="other pair")
    messages.create(pair_id="p1", sender_id="u-b", body="second")

    bodies = [m.body for m in messages.list_for_pair("p1")]
    assert bodies == ["first", "second"]


def test_unread_counts_only_the_partners_messages(messages):
    messages.create(pair_id="p1", sender_id="u-mentor", body="hi")
    messages.create(pair_id="p1", sender_id="u-mentor", body="you there?")
    messages.create(pair_id="p1", sender_id="u-mentee", body="hello")

    # Your own messages are never unread for you.
    assert messages.unread_count("p1", "u-mentee") == 2
    assert messages.unread_count("p1", "u-mentor") == 1


def test_mark_read_is_scoped_to_the_pair_and_the_reader(messages):
    messages.create(pair_id="p1", sender_id="u-mentor", body="hi")
    messages.create(pair_id="p1", sender_id="u-mentee", body="hello")
    messages.create(pair_id="p2", sender_id="u-mentor", body="other pair")

    marked = messages.mark_read("p1", "u-mentee")

    assert marked == 1
    assert messages.unread_count("p1", "u-mentee") == 0
    # The other pair is untouched.
    assert messages.unread_count("p2", "u-mentee") == 1
    # The mentee's own message is still unread for the mentor.
    assert messages.unread_count("p1", "u-mentor") == 1


def test_mark_read_is_idempotent(messages):
    messages.create(pair_id="p1", sender_id="u-mentor", body="hi")

    assert messages.mark_read("p1", "u-mentee") == 1
    assert messages.mark_read("p1", "u-mentee") == 0


def test_voice_note_carries_audio_instead_of_text(messages):
    message = messages.create(
        pair_id="p1",
        sender_id="u-mentor",
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
