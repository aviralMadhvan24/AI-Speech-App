"""Mentor selection must count every kind of speaking the platform can attribute.

Reading interviews alone meant the strongest debater in a cohort was invisible
to mentor suggestion — the two features where students actually speak
competitively counted for nothing. These tests pin the four sources and, just
as importantly, what must NOT be counted: work belonging to nobody.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.buddy import service


class _Pron:
    def __init__(self, score):
        self.available = score is not None
        self.score = score


class _Result:
    def __init__(self, content=None, pronunciation=None):
        self.available = content is not None
        self.total = content
        self.pronunciation = _Pron(pronunciation)


class _Submission:
    def __init__(self, content=None, pronunciation=None):
        self.content_result = _Result(content, pronunciation)
        self.submitted_at = "2026-08-01T00:00:00+00:00"


def _user(email, role="student"):
    return SimpleNamespace(email=email, display_name="Student", role=role)


@pytest.fixture()
def env(monkeypatch):
    """Every source stubbed empty; each test fills in only what it is about."""
    state = SimpleNamespace(users=[], submissions={}, attempts={}, live={})

    from app.storage import users_store

    monkeypatch.setattr(users_store, "list_all", lambda: state.users)
    monkeypatch.setattr(
        service.submissions_store,
        "list_for_student",
        lambda email: state.submissions.get(email, []),
    )
    monkeypatch.setattr(
        service.attempts_storage,
        "list_for_student",
        lambda email: state.attempts.get(email, []),
    )
    monkeypatch.setattr(service.buddy_pairs_store, "list_all", lambda: [])
    monkeypatch.setattr(service.buddy_pairs_store, "list_active", lambda: [])
    monkeypatch.setattr(service.buddy_sessions_store, "list_all", lambda: [])
    monkeypatch.setattr(service.mentors_store, "get", lambda email: None)

    from app.buddy import growth

    monkeypatch.setattr(
        growth, "_live_events", lambda email: state.live.get(email, [])
    )
    return state


def _attempt(score, email="ada@x.com"):
    return SimpleNamespace(
        pronunciation_available=score is not None,
        pronunciation_score=score,
        student_email=email,
    )


def _debate(score):
    return ("2026-08-02T00:00:00+00:00", "THB uniforms", score, "debate")


# --- The gap this closes --------------------------------------------------


def test_a_debater_with_no_interviews_is_still_ranked(env):
    """The whole point: competitive speaking is speaking evidence."""
    env.users.append(_user("ada@x.com"))
    env.live["ada@x.com"] = [_debate(88.0), _debate(82.0)]

    ranking = service.rank_speakers()

    assert len(ranking) == 1
    assert ranking[0].live_speaking_avg == 85.0
    assert ranking[0].speaking_score == 85.0
    assert ranking[0].sample_size == 2


def test_a_strong_debater_can_now_be_suggested_as_a_mentor(env):
    env.users.append(_user("ada@x.com"))
    env.live["ada@x.com"] = [_debate(90.0), _debate(86.0)]

    assert [s.email for s in service.suggested_mentors()] == ["ada@x.com"]


def test_attributed_pronunciation_practice_counts(env):
    env.users.append(_user("ada@x.com"))
    env.attempts["ada@x.com"] = [_attempt(70.0), _attempt(80.0)]

    ranking = service.rank_speakers()[0]
    assert ranking.pronunciation_avg == 75.0
    assert ranking.sample_size == 2


def test_every_axis_is_weighted_equally_not_by_volume(env):
    """Ten drills must not drown out one debate — axes average, then combine."""
    env.users.append(_user("ada@x.com"))
    env.submissions["ada@x.com"] = [_Submission(content=60.0)]
    env.attempts["ada@x.com"] = [_attempt(100.0) for _ in range(10)]
    env.live["ada@x.com"] = [_debate(50.0)]

    ranking = service.rank_speakers()[0]
    # (content 60 + pronunciation 100 + live 50) / 3, not a raw mean of 12.
    assert ranking.speaking_score == 70.0


# --- What must not be counted --------------------------------------------


def test_an_unattributed_attempt_belongs_to_nobody(env):
    """Older rows have no owner; they must not be handed to whoever asks."""
    from app.attempts import storage as attempts_storage

    rows = [_attempt(90.0, email=None)]
    env.users.append(_user("ada@x.com"))
    env.attempts["ada@x.com"] = [r for r in rows if r.student_email == "ada@x.com"]

    assert service.rank_speakers() == []
    assert attempts_storage.list_for_student("") == []


def test_a_broken_live_store_does_not_blank_the_ranking(env, monkeypatch):
    """One bad source must not cost a student their interview evidence."""
    from app.buddy import growth

    def _boom(email):
        raise RuntimeError("store is a mess")

    monkeypatch.setattr(growth, "_live_events", _boom)
    env.users.append(_user("ada@x.com"))
    env.submissions["ada@x.com"] = [_Submission(content=75.0)]

    ranking = service.rank_speakers()[0]
    assert ranking.content_avg == 75.0
    assert ranking.live_speaking_avg is None


def test_one_interview_scoring_two_axes_is_one_piece_of_work(env):
    """sample_size counts work, not scores — MIN_SAMPLE_SIZE depends on it."""
    env.users.append(_user("ada@x.com"))
    env.submissions["ada@x.com"] = [_Submission(content=80.0, pronunciation=60.0)]

    assert service.rank_speakers()[0].sample_size == 1


def test_teachers_are_never_ranked_as_speakers(env):
    env.users.append(_user("teacher@x.com", role="teacher"))
    env.live["teacher@x.com"] = [_debate(95.0)]

    assert service.rank_speakers() == []


# --- Mentoring track record ----------------------------------------------


def test_mentee_ratings_become_a_mentor_track_record(env, monkeypatch):
    """Being a strong speaker and being a good mentor are different things."""
    env.users.append(_user("ada@x.com"))
    env.live["ada@x.com"] = [_debate(90.0)]

    pair = SimpleNamespace(
        pair_id="p1", mentor_email="ada@x.com", mentee_email="bob@x.com", status="active"
    )
    sessions = [
        SimpleNamespace(pair_id="p1", status="completed", mentee_rating=5),
        SimpleNamespace(pair_id="p1", status="completed", mentee_rating=3),
        SimpleNamespace(pair_id="p1", status="missed", mentee_rating=None),
    ]
    monkeypatch.setattr(service.buddy_pairs_store, "list_all", lambda: [pair])
    monkeypatch.setattr(service.buddy_sessions_store, "list_all", lambda: sessions)

    ranking = service.rank_speakers()[0]
    assert ranking.sessions_mentored == 2, "a missed session was not mentoring"
    assert ranking.mentor_rating == 4.0
