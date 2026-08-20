"""Mentor-suggestion logic: who the scores put forward, and who may talk.

`rank_speakers` reads three collaborators (users, submissions, pairs). Rather
than build real JSONL fixtures for all three, each test swaps in the smallest
stand-in that carries the attributes the service actually touches.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.buddy import service
from app.storage.buddy import BuddyCyclesStore
from app.storage.buddy import BuddyPairsStore
from app.storage.buddy import CycleAxisResult
from app.storage.buddy import CycleSummary
from app.storage.buddy import BuddySessionsStore
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
    cycles = BuddyCyclesStore(path=tmp_path / "cycles.jsonl")
    sessions = BuddySessionsStore(path=tmp_path / "sessions.jsonl")

    monkeypatch.setattr(service, "mentors_store", mentors)
    monkeypatch.setattr(service, "buddy_pairs_store", pairs)
    monkeypatch.setattr(service, "buddy_cycles_store", cycles)
    monkeypatch.setattr(service, "buddy_sessions_store", sessions)
    monkeypatch.setattr(
        service.submissions_store,
        "list_for_student",
        lambda email: submissions.get(email.lower(), []),
    )
    # Without these the ranking reads the developer's real outputs/*.jsonl and
    # every assertion here depends on whatever happens to be on disk.
    monkeypatch.setattr(
        service.attempts_storage, "list_for_student", lambda email: []
    )
    monkeypatch.setattr("app.buddy.growth._live_events", lambda email: [])

    # `rank_speakers` imports users_store inside the function body, so patch
    # the attribute on the package the import resolves against.
    import app.storage as storage

    monkeypatch.setattr(storage.users_store, "list_all", lambda: users)

    return SimpleNamespace(
        users=users,
        submissions=submissions,
        mentors=mentors,
        pairs=pairs,
        cycles=cycles,
        sessions=sessions,
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


# --- The growth path in ---------------------------------------------------
#
# `speaking_score` is a lifetime mean, so a student who climbed carries their
# early work forever and never clears the score bar. These pin the second way
# in: a closed cycle whose frozen summary says they improved.


def _closed_cycle(env, mentee: str, *, verdict: str, axes: list[tuple[float, float]]):
    """A closed cycle for `mentee`, frozen with `axes` as (baseline, final)."""
    cycle = env.cycles.create(
        pair_id=f"pair-{mentee}",
        mentee_email=mentee,
        starts_at="2026-01-01T00:00:00+00:00",
        ends_at="2026-02-01T00:00:00+00:00",
        created_by="t@x.com",
    )
    summary = CycleSummary(
        axes=[
            CycleAxisResult(
                key="content",
                label="Content",
                baseline=baseline,
                final=final,
                delta=round(final - baseline, 2),
                sample_size=3,
            )
            for baseline, final in axes
        ],
        verdict=verdict,
        generated_at="2026-02-01T00:00:00+00:00",
    )
    return env.cycles.close(cycle.cycle_id, summary=summary)


def _climber(env, email: str = "ada@x.com"):
    """A student whose lifetime average is too low to be suggested on score."""
    env.users.append(_user(email, name="Ada"))
    env.submissions[email] = [
        _submission(content=40.0),  # where they started, and it never stops counting
        _submission(content=72.0),
    ]


def test_a_student_who_climbed_is_suggested_despite_a_low_lifetime_average(buddy_env):
    """The whole point: their early work must not disqualify them forever."""
    _climber(buddy_env)
    _closed_cycle(buddy_env, "ada@x.com", verdict="improved", axes=[(45.0, 72.0)])

    ranking = service.rank_speakers()[0]
    assert ranking.speaking_score == 56.0, "below the score threshold"
    assert ranking.speaking_score < service.SUGGESTION_THRESHOLD

    suggested = service.suggested_mentors()
    assert [s.email for s in suggested] == ["ada@x.com"]
    assert suggested[0].suggestion_basis == "growth"
    assert suggested[0].best_gain == 27.0
    assert (suggested[0].grew_from, suggested[0].grew_to) == (45.0, 72.0)


def test_growth_alone_is_not_enough_if_they_are_still_weak(buddy_env):
    """20 to 35 is a huge climb and still cannot model speaking for anyone."""
    buddy_env.users.append(_user("bob@x.com"))
    buddy_env.submissions["bob@x.com"] = [
        _submission(content=20.0),
        _submission(content=35.0),
    ]
    _closed_cycle(buddy_env, "bob@x.com", verdict="improved", axes=[(20.0, 35.0)])

    assert service.rank_speakers()[0].best_gain == 15.0
    assert service.suggested_mentors() == [], "improvement is not a participation prize"


def test_a_small_climb_is_not_treated_as_evidence(buddy_env):
    """MEANINGFUL_DELTA marks an axis as having moved; it is not a mentor bar."""
    _climber(buddy_env)
    _closed_cycle(buddy_env, "ada@x.com", verdict="improved", axes=[(66.0, 69.0)])

    assert service.rank_speakers()[0].best_gain == 3.0
    assert service.suggested_mentors() == []


def test_only_a_verdict_of_improved_counts(buddy_env):
    """A cycle that held, or was never measured, proves nothing about growth."""
    _climber(buddy_env)
    for verdict in ("held", "declined", "not_enough_evidence"):
        buddy_env.cycles.path.write_text("", encoding="utf-8")
        _closed_cycle(buddy_env, "ada@x.com", verdict=verdict, axes=[(45.0, 72.0)])
        assert service.suggested_mentors() == [], verdict


def test_an_open_cycle_is_not_evidence_yet(buddy_env):
    """Only a period a teacher actually closed can speak to what happened."""
    _climber(buddy_env)
    buddy_env.cycles.create(
        pair_id="p1",
        mentee_email="ada@x.com",
        starts_at="2026-01-01T00:00:00+00:00",
        ends_at="2026-02-01T00:00:00+00:00",
        created_by="t@x.com",
    )

    assert service.rank_speakers()[0].best_gain is None
    assert service.suggested_mentors() == []


def test_the_best_cycle_is_used_not_the_latest(buddy_env):
    """A quieter cycle afterwards does not un-prove an earlier climb."""
    _climber(buddy_env)
    _closed_cycle(buddy_env, "ada@x.com", verdict="improved", axes=[(45.0, 72.0)])
    _closed_cycle(buddy_env, "ada@x.com", verdict="improved", axes=[(70.0, 74.0)])

    ranking = service.rank_speakers()[0]
    assert ranking.best_gain == 27.0
    assert ranking.improved_cycles == 2
    assert (ranking.grew_from, ranking.grew_to) == (45.0, 72.0)


def test_an_unmeasured_axis_is_not_averaged_in_as_a_zero(buddy_env):
    """A cycle that only measured one axis is reported on that axis."""
    _climber(buddy_env)
    cycle = buddy_env.cycles.create(
        pair_id="p1",
        mentee_email="ada@x.com",
        starts_at="2026-01-01T00:00:00+00:00",
        ends_at="2026-02-01T00:00:00+00:00",
        created_by="t@x.com",
    )
    buddy_env.cycles.close(
        cycle.cycle_id,
        summary=CycleSummary(
            axes=[
                CycleAxisResult(
                    key="content",
                    label="Content",
                    baseline=45.0,
                    final=72.0,
                    delta=27.0,
                    sample_size=3,
                ),
                # Never sampled — must contribute nothing, not a zero delta.
                CycleAxisResult(key="live_speaking", label="Live speaking"),
            ],
            verdict="improved",
            generated_at="2026-02-01T00:00:00+00:00",
        ),
    )

    assert service.rank_speakers()[0].best_gain == 27.0


def test_a_strong_speaker_who_also_climbed_is_labelled_both(buddy_env):
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [
        _submission(content=80.0),
        _submission(content=90.0),
    ]
    _closed_cycle(buddy_env, "ada@x.com", verdict="improved", axes=[(60.0, 85.0)])

    assert service.suggested_mentors()[0].suggestion_basis == "both"


def test_growth_candidates_sort_ahead_of_score_candidates(buddy_env):
    """Otherwise they sit below everyone, ordered by the average that hides them."""
    buddy_env.users.extend([_user("strong@x.com"), _user("climber@x.com")])
    buddy_env.submissions["strong@x.com"] = [
        _submission(content=92.0),
        _submission(content=92.0),
    ]
    buddy_env.submissions["climber@x.com"] = [
        _submission(content=40.0),
        _submission(content=72.0),
    ]
    _closed_cycle(buddy_env, "climber@x.com", verdict="improved", axes=[(45.0, 72.0)])

    assert [s.email for s in service.suggested_mentors()] == [
        "climber@x.com",
        "strong@x.com",
    ]


def test_growth_evidence_is_shown_even_when_it_changes_nothing(buddy_env):
    """A teacher deciding on a strong speaker still benefits from the climb."""
    buddy_env.users.append(_user("ada@x.com"))
    buddy_env.submissions["ada@x.com"] = [
        _submission(content=85.0),
        _submission(content=85.0),
    ]
    _closed_cycle(buddy_env, "ada@x.com", verdict="improved", axes=[(70.0, 79.0)])

    ranking = service.rank_speakers()[0]
    assert ranking.improved_cycles == 1
    assert ranking.best_gain == 9.0


def test_a_rejected_climber_is_not_re_suggested(buddy_env):
    """The teacher has answered; the growth path must not reopen the question."""
    _climber(buddy_env)
    _closed_cycle(buddy_env, "ada@x.com", verdict="improved", axes=[(45.0, 72.0)])
    buddy_env.mentors.set_status("ada@x.com", "rejected", decided_by="t@x.com")

    assert service.suggested_mentors() == []


def test_a_broken_cycles_store_does_not_blank_the_ranking(buddy_env, monkeypatch):
    _climber(buddy_env)

    def _explode():
        raise ValueError("corrupt row")

    monkeypatch.setattr(buddy_env.cycles, "list_all", _explode)

    ranking = service.rank_speakers()
    assert len(ranking) == 1, "the score path still works"
    assert ranking[0].best_gain is None


def test_someone_elses_cycle_does_not_credit_this_student(buddy_env):
    _climber(buddy_env)
    _closed_cycle(buddy_env, "someone-else@x.com", verdict="improved", axes=[(45.0, 72.0)])

    assert service.rank_speakers()[0].best_gain is None
    assert service.suggested_mentors() == []
