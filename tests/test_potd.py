from app.potd.routes import _badge, _streak
from datetime import datetime, timedelta, timezone


def test_streak_ignores_malformed_completion_dates():
    today = datetime.now(timezone.utc).date()
    current, best = _streak([
        {"date": "not-a-date"},
        {"date": today.isoformat()},
        {"date": (today - timedelta(days=1)).isoformat()},
    ])

    assert current == 2
    assert best == 2


def test_badges_are_score_and_streak_based():
    assert _badge(95, 1) == "Standout Performer"
    assert _badge(80, 30) == "Monthly Master"
    assert _badge(40, 2) is None
