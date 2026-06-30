"""3-star scoring for a battle round.

Rules:
- Pronunciation star: higher `pronunciation_score` wins, tie if |diff| < 5.
- Clarity star: higher `clarity_score` wins, tie if |diff| < 5.
- Pace star: closer to the ideal WPM wins, tie if both within 10 WPM of
  each other (i.e. |host_distance - opp_distance| < 10).
- Overall winner: more stars wins; equal stars => draw.
"""

from __future__ import annotations

from .schemas import PlayerScore
from .schemas import StarVerdict
from .schemas import Verdict


IDEAL_WPM = 145.0
PRON_TIE_THRESHOLD = 5.0
CLARITY_TIE_THRESHOLD = 5.0
PACE_TIE_THRESHOLD = 10.0


def _star_by_higher(host_value: float, opp_value: float, tie_threshold: float) -> Verdict:
    """Award the star to whichever side is higher, with a tie band."""
    if abs(host_value - opp_value) < tie_threshold:
        return "tie"
    if host_value > opp_value:
        return "host"
    return "opponent"


def _star_by_pace(host_wpm: float, opp_wpm: float) -> Verdict:
    """Closer to the ideal wins; tie if both distances are within band."""
    host_distance = abs(host_wpm - IDEAL_WPM)
    opp_distance = abs(opp_wpm - IDEAL_WPM)
    if abs(host_distance - opp_distance) < PACE_TIE_THRESHOLD:
        return "tie"
    if host_distance < opp_distance:
        return "host"
    return "opponent"


def compute_stars(host: PlayerScore, opponent: PlayerScore) -> StarVerdict:
    pron = _star_by_higher(
        host.pronunciation_score,
        opponent.pronunciation_score,
        PRON_TIE_THRESHOLD,
    )
    clar = _star_by_higher(
        host.clarity_score,
        opponent.clarity_score,
        CLARITY_TIE_THRESHOLD,
    )
    pace = _star_by_pace(host.pace_wpm, opponent.pace_wpm)

    verdicts = [pron, clar, pace]
    host_stars = sum(1 for v in verdicts if v == "host")
    opponent_stars = sum(1 for v in verdicts if v == "opponent")

    if host_stars > opponent_stars:
        winner = "host"
    elif opponent_stars > host_stars:
        winner = "opponent"
    else:
        winner = "draw"

    return StarVerdict(
        pronunciation=pron,
        clarity=clar,
        pace=pace,
        winner=winner,
        host_stars=host_stars,
        opponent_stars=opponent_stars,
    )


def zero_score() -> PlayerScore:
    """Placeholder used when a player fails to submit a score within the timer."""
    return PlayerScore(
        pronunciation_score=0,
        clarity_score=0,
        pace_wpm=0,
        analysis_id="",
    )
