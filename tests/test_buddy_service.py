"""Mentor-suggestion logic: who the scores put forward, and who may talk.

`rank_speakers` reads three collaborators (users, submissions, pairs). Rather
than build real JSONL fixtures for all three, each test swaps in the smallest
stand-in that carries the attributes the service actually touches.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.buddy import service
from app.storage.buddy import BuddyPairsStore
from app.storage.buddy import MentorsStore


def _user(email: str, name: str = "Student", role: str = "student"):
    return SimpleNamespace(email=email, display_name=name, role=role)


def _submission(content: float | None = None, pronunciation: float | None = None):
    """A submission stub shaped like the parts `_speaking_signals` reads."""
    snapshot = (
        SimpleNamespace(available=True, score=pronunciation)
        if pronunciation is not None
        else None
    )
    return SimpleNamespace(
        content_result=SimpleNamespace(
            available=content is not None,
            total=content,
            pronunciation=snapshot,
        )
    )


@pytest.fixture()
def buddy_env(tmp_path, monkeypatch):
    """Point the service at empty temp stores and controllable collaborators.

    Returns a handle whose `users` / `submissions` dicts the test fills in
    before calling into the service.
    """
    users: list = []
    submissions: dict[str, list] = {}

    mentors = MentorsStore(path=tmp_path / "mentors.jsonl")
    pairs = BuddyPairsStore(path=tmp_path / "pairs.jsonl")

    monkeypatch.setattr(service, "mentors_store", mentors)
    monkeypatch.setattr(service, "buddy_pairs_store", pairs)
    monkeypatch.setattr(
        service.submissions_store,
        "list_for_student",
        lambda email: submissions.get(email.lower(), []),
    )

    # `rank_speakers` imports users_store inside the function body, so patch
    # the attribute on the package the import resolves against.
    import app.storage as storage

    monkeypatch.setattr(storage.users_store, "list_all", lambda: users)

    return SimpleNamespace(
        users=users, submissions=submissions, mentors=mentors, pairs=pairs
    )


# --- Signal collection ----------------------------------------------------


def test_students_without_scored_work_are_not_ranked(buddy_env):
    buddy_env.users.append(_user("quiet@x.com"))
    assert service.rank_speakers() == []


def test_teachers_are_never_ranked(buddy_env):
    buddy_env.users.append(_user("teacher@x.com", role="teacher"))
    buddy_env.submissions["teacher@x.com"] = [_submission(content=90.0)]
    assert service.rank_speakers() == []


def test_unavailable_results_are_skipped_not_scored_as_zero(buddy_env):
    """An outage must not drag a student's average down."""
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [
        _submission(content=80.0),
        _submission(content=None),  # scoring unavailable
    ]

    ranking = service.rank_speakers()[0]
    assert ranking.content_avg == 80.0
    assert ranking.sample_size == 1


def test_pending_pronunciation_is_skipped(buddy_env):
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [
        _submission(content=80.0, pronunciation=60.0),
        _submission(content=70.0),  # no pronunciation pass yet
    ]

    ranking = service.rank_speakers()[0]
    assert ranking.content_avg == 75.0
    assert ranking.pronunciation_avg == 60.0
    # Sample size is the richer of the two signals, not their sum.
    assert ranking.sample_size == 2


def test_content_and_pronunciation_are_weighted_equally(buddy_env):
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [_submission(content=90.0, pronunciation=70.0)]

    assert service.rank_speakers()[0].speaking_score == 80.0


def test_content_only_student_is_still_rankable(buddy_env):
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [_submission(content=88.0)]

    ranking = service.rank_speakers()[0]
    assert ranking.speaking_score == 88.0
    assert ranking.pronunciation_avg is None


# --- Ranking and suggestion ----------------------------------------------


def test_ranking_is_ordered_best_first(buddy_env):
    buddy_env.users.extend([_user("low@x.com"), _user("high@x.com")])
    buddy_env.submissions["low@x.com"] = [_submission(content=60.0)]
    buddy_env.submissions["high@x.com"] = [_submission(content=95.0)]

    assert [r.email for r in service.rank_speakers()] == ["high@x.com", "low@x.com"]


def test_ranking_counts_active_mentees_only(buddy_env):
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [_submission(content=80.0)]
    buddy_env.pairs.create("ada@x.com", "bob@x.com", created_by="t@x.com")
    ended = buddy_env.pairs.create("ada@x.com", "cleo@x.com", created_by="t@x.com")
    buddy_env.pairs.end(ended.pair_id)

    assert service.rank_speakers()[0].active_mentees == 1


def test_one_good_day_is_not_enough_to_be_suggested(buddy_env):
    """A single high score clears the threshold but not the sample size."""
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [_submission(content=95.0)]

    assert service.rank_speakers()[0].speaking_score == 95.0
    assert service.suggested_mentors() == []


def test_consistent_scores_below_the_threshold_are_not_suggested(buddy_env):
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [
        _submission(content=50.0),
        _submission(content=55.0),
    ]

    assert service.suggested_mentors() == []


def test_consistent_strong_speaker_is_suggested(buddy_env):
    buddy_env.users.append(_user("ada@x.com", name="Ada"))
    buddy_env.submissions["ada@x.com"] = [
        _submission(content=80.0),
        _submission(content=90.0),
    ]

    suggested = service.suggested_mentors()
    assert [s.email for s in suggested] == ["ada@x.com"]
    assert suggested[0].name == "Ada"
    assert suggested[0].status == "none"


def test_a_student_exactly_on_the_threshold_is_suggested(buddy_env):
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [
        _submission(content=service.SUGGESTION_THRESHOLD),
        _submission(content=service.SUGGESTION_THRESHOLD),
    ]

    assert len(service.suggested_mentors()) == 1


def test_already_decided_students_drop_out_of_the_suggestions(buddy_env):
    """A teacher has answered for them; re-suggesting would be noise."""
    buddy_env.users.extend([_user("ada@x.com"), _user("bob@x.com")])
    strong = [_submission(content=85.0), _submission(content=85.0)]
    buddy_env.submissions["ada@x.com"] = strong
    buddy_env.submissions["bob@x.com"] = strong

    buddy_env.mentors.set_status("ada@x.com", "approved", decided_by="t@x.com")
    buddy_env.mentors.set_status("bob@x.com", "rejected", decided_by="t@x.com")

    assert service.suggested_mentors() == []
    # They stay visible in the full ranking, carrying their decision.
    statuses = {r.email: r.status for r in service.rank_speakers()}
    assert statuses == {"ada@x.com": "approved", "bob@x.com": "rejected"}


# --- Access ---------------------------------------------------------------


def test_only_members_and_teachers_can_access_a_pair(buddy_env):
    pair = buddy_env.pairs.create("mentor@x.com", "mentee@x.com", created_by="t@x.com")

    assert service.can_access_pair(pair.pair_id, "MENTOR@x.com") is True
    assert service.can_access_pair(pair.pair_id, "mentee@x.com") is True
    assert service.can_access_pair(pair.pair_id, "stranger@x.com") is False
    assert (
        service.can_access_pair(pair.pair_id, "stranger@x.com", is_teacher=True) is True
    )


def test_unknown_pair_is_inaccessible_even_to_a_teacher(buddy_env):
    assert service.can_access_pair("no-such-pair", "t@x.com", is_teacher=True) is False
