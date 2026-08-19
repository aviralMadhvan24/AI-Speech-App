"""Cycles and cycle-scoped growth.

The point of most of these tests is the *window*: a mentor sees their mentee's
work for the open cycle and nothing else, so anything dated outside it must be
absent from the report rather than merely hidden by the client.

Debate and GD records are stubbed at the store boundary — what matters here is
the uid -> email join and the window, not how those rooms persist themselves.
"""

from __future__ import annotations

from datetime import datetime
from datetime import timedelta
from datetime import timezone
from types import SimpleNamespace

import pytest

from app.buddy import growth
from app.storage.buddy import BuddyCycle
from app.storage.buddy import BuddyCyclesStore
from app.storage.buddy import CycleBaseline


MENTEE = "mentee@kiet.edu"
UID = "firebase-uid-mentee"

START = "2026-08-01T00:00:00+00:00"
END = "2026-09-01T00:00:00+00:00"


def _unix(day: int, month: int = 8) -> float:
    return datetime(2026, month, day, 12, 0, tzinfo=timezone.utc).timestamp()


def _iso(day: int, month: int = 8) -> str:
    return datetime(2026, month, day, 12, 0, tzinfo=timezone.utc).isoformat()


def _submission(at: str, content: float | None = None, pronunciation: float | None = None):
    snapshot = (
        SimpleNamespace(available=True, score=pronunciation)
        if pronunciation is not None
        else None
    )
    return SimpleNamespace(
        submitted_at=at,
        content_result=SimpleNamespace(
            available=True,
            total=content,
            pronunciation=snapshot,
        ),
    )


def _debate(at_unix: float, score: float, title: str = "AI in classrooms"):
    return SimpleNamespace(
        completed_at=at_unix,
        motion_title=title,
        participants=[{"participant_id": "p1", "user_id": UID}],
        effective_scores=[SimpleNamespace(participant_id="p1", effective_score=score)],
    )


def _gd(at_unix: float, score: float, title: str = "Remote work"):
    return SimpleNamespace(
        completed_at=at_unix,
        topic_title=title,
        participants=[{"participant_id": "g1", "user_id": UID}],
        scores=[SimpleNamespace(participant_id="g1", total_score=score)],
    )


def _cycle(**overrides) -> BuddyCycle:
    defaults = dict(
        pair_id="pair-1",
        mentee_email=MENTEE,
        starts_at=START,
        ends_at=END,
        created_by="teacher@kiet.edu",
        created_at=START,
        baseline=CycleBaseline(content=60.0, pronunciation=70.0, live_speaking=50.0),
    )
    defaults.update(overrides)
    return BuddyCycle(**defaults)


@pytest.fixture()
def sources(monkeypatch):
    """Point growth at controllable stand-ins for all four score sources."""
    state = SimpleNamespace(submissions=[], debates=[], gds=[], attempts=[], uid=UID)

    monkeypatch.setattr(
        growth.submissions_store,
        "list_for_student",
        lambda email: state.submissions,
    )
    monkeypatch.setattr(
        growth,
        "users_store",
        SimpleNamespace(
            get_by_email=lambda email: (
                SimpleNamespace(firebase_uid=state.uid) if state.uid else None
            )
        ),
    )

    import app.storage.debates as debates_store
    import app.storage.gd_sessions as gd_sessions_store

    monkeypatch.setattr(
        debates_store, "list_debates_for_user", lambda uid: state.debates
    )
    monkeypatch.setattr(
        gd_sessions_store, "list_sessions_for_user", lambda uid: state.gds
    )

    from app.attempts import storage as attempts_storage

    monkeypatch.setattr(
        attempts_storage, "list_for_student", lambda email: state.attempts
    )
    return state


# --- BuddyCycle / store ---------------------------------------------------


def test_covers_is_inclusive_of_its_own_bounds():
    cycle = _cycle()
    assert cycle.covers(START) is True
    assert cycle.covers(_iso(15)) is True
    assert cycle.covers(END) is True
    assert cycle.covers(_iso(31, month=7)) is False
    assert cycle.covers(_iso(2, month=9)) is False


def test_store_allows_only_one_open_cycle_per_pair(tmp_path):
    store = BuddyCyclesStore(path=tmp_path / "cycles.jsonl")
    store.create(
        pair_id="pair-1",
        mentee_email=MENTEE,
        starts_at=START,
        ends_at=END,
        created_by="teacher@kiet.edu",
    )
    with pytest.raises(ValueError):
        store.create(
            pair_id="pair-1",
            mentee_email=MENTEE,
            starts_at=START,
            ends_at=END,
            created_by="teacher@kiet.edu",
        )


def test_closing_a_cycle_frees_the_pair_for_a_renewal(tmp_path):
    store = BuddyCyclesStore(path=tmp_path / "cycles.jsonl")
    first = store.create(
        pair_id="pair-1",
        mentee_email=MENTEE,
        starts_at=START,
        ends_at=END,
        created_by="teacher@kiet.edu",
    )
    store.close(first.cycle_id)

    assert store.active_for_pair("pair-1") is None
    renewal = store.create(
        pair_id="pair-1",
        mentee_email=MENTEE,
        starts_at=END,
        ends_at="2026-10-01T00:00:00+00:00",
        created_by="teacher@kiet.edu",
    )
    assert store.active_for_pair("pair-1").cycle_id == renewal.cycle_id
    # The closed period is kept, which is the point of cycles over pair dates.
    assert len(store.list_for_pair("pair-1")) == 2


def test_a_pair_between_cycles_reports_nothing(sources):
    """No open cycle means no window, and so nothing a mentor may see."""
    sources.submissions = [_submission(_iso(15), content=80.0)]
    report = growth.build_report(None, MENTEE)

    assert report.cycle is None
    assert report.activity == []
    assert report.axes == []


# --- Windowing ------------------------------------------------------------


def test_work_outside_the_cycle_is_absent_not_hidden(sources):
    sources.submissions = [
        _submission(_iso(20, month=7), content=95.0),   # before the cycle
        _submission(_iso(15), content=70.0),            # inside
        _submission(_iso(20, month=9), content=99.0),   # after
    ]
    sources.debates = [
        _debate(_unix(25, month=7), 91.0),              # before
        _debate(_unix(10), 64.0),                       # inside
    ]

    report = growth.build_report(_cycle(), MENTEE)

    assert [item.score for item in report.activity if item.kind == "interview"] == [70.0]
    assert [item.score for item in report.activity if item.kind == "debate"] == [64.0]
    assert report.counts == {"interview": 1, "debate": 1, "gd": 0, "practice": 0}


def _attempt(at: str, score: float | None, text: str = "The quick brown fox"):
    return SimpleNamespace(
        created_at=at,
        expected_text=text,
        transcript=text,
        pronunciation_available=score is not None,
        pronunciation_score=score,
    )


def test_pronunciation_drills_count_towards_the_cycle(sources):
    """Drilling is the one thing a mentee can do alone, and what mentors set."""
    sources.attempts = [_attempt(_iso(9), 72.0), _attempt(_iso(14), 81.0)]

    report = growth.build_report(_cycle(), MENTEE)

    axis = next(a for a in report.axes if a.key == "pronunciation")
    assert axis.sample_size == 2
    assert axis.latest == 81.0
    assert report.counts["practice"] == 2


def test_a_pending_drill_is_skipped_rather_than_scored_zero(sources):
    """An outage must not read as the mentee getting worse."""
    sources.attempts = [_attempt(_iso(9), None)]

    report = growth.build_report(_cycle(), MENTEE)

    assert next(a for a in report.axes if a.key == "pronunciation").sample_size == 0
    assert report.counts["practice"] == 0


def test_a_broken_attempts_store_does_not_blank_the_panel(sources, monkeypatch):
    from app.attempts import storage as attempts_storage

    def _boom(email):
        raise RuntimeError("store is a mess")

    monkeypatch.setattr(attempts_storage, "list_for_student", _boom)
    sources.submissions = [_submission(_iso(15), content=70.0)]

    report = growth.build_report(_cycle(), MENTEE)

    assert next(a for a in report.axes if a.key == "content").latest == 70.0


def test_debates_and_gds_are_attributed_through_the_uid_join(sources):
    sources.debates = [_debate(_unix(10), 64.0)]
    sources.gds = [_gd(_unix(12), 58.0)]

    report = growth.build_report(_cycle(), MENTEE)

    live = next(axis for axis in report.axes if axis.key == "live_speaking")
    assert live.sample_size == 2
    assert live.latest == 58.0
    assert {item.kind for item in report.activity} == {"debate", "gd"}


def test_a_student_with_no_account_yields_no_live_work(sources):
    """Without a uid there is no join, so debates simply do not appear."""
    sources.uid = None
    sources.debates = [_debate(_unix(10), 64.0)]

    report = growth.build_report(_cycle(), MENTEE)

    assert report.counts["debate"] == 0
    live = next(axis for axis in report.axes if axis.key == "live_speaking")
    assert live.sample_size == 0


# --- Axes -----------------------------------------------------------------


def test_delta_is_latest_against_the_captured_baseline(sources):
    sources.submissions = [
        _submission(_iso(5), content=64.0, pronunciation=68.0),
        _submission(_iso(20), content=70.4, pronunciation=66.8),
    ]

    report = growth.build_report(_cycle(), MENTEE)
    content = next(axis for axis in report.axes if axis.key == "content")
    pronunciation = next(axis for axis in report.axes if axis.key == "pronunciation")

    assert content.baseline == 60.0
    assert content.latest == 70.4
    assert content.delta == 10.4
    # A decline is reported as plainly as a gain.
    assert pronunciation.delta == -3.2


def test_a_missing_baseline_leaves_the_delta_unknown(sources):
    """No prior work means no baseline — and an unknown delta, never a zero."""
    sources.submissions = [_submission(_iso(15), content=70.0)]

    report = growth.build_report(_cycle(baseline=CycleBaseline()), MENTEE)
    content = next(axis for axis in report.axes if axis.key == "content")

    assert content.baseline is None
    assert content.latest == 70.0
    assert content.delta is None


def test_baseline_averages_only_work_from_before_the_cycle(sources):
    sources.submissions = [
        _submission(_iso(10, month=7), content=50.0),
        _submission(_iso(20, month=7), content=60.0),
        _submission(_iso(15), content=90.0),  # inside the cycle, must not count
    ]

    baseline = growth.baseline_for(MENTEE, START)
    assert baseline.content == 55.0


# --- Trend ----------------------------------------------------------------


def test_two_points_is_not_enough_to_draw_a_trend(sources):
    sources.submissions = [
        _submission(_iso(5), content=64.0),
        _submission(_iso(20), content=70.0),
    ]

    report = growth.build_report(_cycle(), MENTEE)

    assert len(report.trend) == 2
    assert report.enough_for_trend is False


def test_three_points_earns_a_trend(sources):
    sources.submissions = [
        _submission(_iso(5), content=64.0),
        _submission(_iso(12), content=67.0),
        _submission(_iso(20), content=70.0),
    ]

    report = growth.build_report(_cycle(), MENTEE)

    assert report.enough_for_trend is True
    assert [point.at for point in report.trend] == ["2026-08-05", "2026-08-12", "2026-08-20"]


def test_work_on_one_day_shares_a_trend_point(sources):
    """An interview and a debate on the same date are one point, not two."""
    sources.submissions = [_submission(_iso(10), content=64.0)]
    sources.debates = [_debate(_unix(10), 55.0)]

    report = growth.build_report(_cycle(), MENTEE)

    assert len(report.trend) == 1
    assert report.trend[0].content == 64.0
    assert report.trend[0].live_speaking == 55.0


def test_a_broken_debate_store_does_not_blank_the_panel(sources, monkeypatch):
    """Interviews still report even if the debate store raises."""
    import app.storage.debates as debates_store

    def _boom(uid):
        raise RuntimeError("corrupt row")

    monkeypatch.setattr(debates_store, "list_debates_for_user", _boom)
    sources.submissions = [_submission(_iso(15), content=70.0)]

    report = growth.build_report(_cycle(), MENTEE)

    assert report.counts["interview"] == 1
    assert report.counts["debate"] == 0
