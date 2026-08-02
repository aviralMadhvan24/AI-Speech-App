"""Tests for debate AI scoring rescale behavior.

Debate turns skip the (slow) HF phoneme pronunciation model, so the final
score must rescale from whatever signals ARE present (fluency + content)
back onto a 0-100 scale. These tests lock that behavior in.
"""

import asyncio
from unittest.mock import patch

from app.debate.service import compute_ai_score_with_content
from app.fluency.schemas import FluencyResult
from app.schemas.pronunciation_schema import PronunciationResult


def _skipped_pron():
    return PronunciationResult(
        available=False,
        provider="skipped_for_debate",
        overall_score=None,
        words=[],
        phoneme_errors=[],
    )


def _fluency(clarity):
    return FluencyResult(
        words_per_minute=140,
        clarity_score=clarity,
        speech_duration_seconds=60,
        total_duration_seconds=60,
    )


class _FakeContent:
    def __init__(self, total, off_topic=False):
        self.available = True
        self.total = total
        self.feedback = "good"
        # Mirror the real ContentScoreResult surface consumed by
        # compute_ai_score_with_content (off_topic gate + logging fields).
        self.off_topic = off_topic
        self.relevance = 0
        self.arguments = 0
        self.error = None

    def to_dict(self):
        return {"total": self.total}


def test_debate_score_rescales_without_pronunciation():
    """fluency(25) + content(42) earned=67 of max 75 -> 89.33 rescaled."""

    async def scenario():
        with patch(
            "app.debate.service.score_debate_content",
            return_value=_FakeContent(42),
        ):
            score, unavailable, breakdown = await compute_ai_score_with_content(
                pronunciation=_skipped_pron(),
                fluency=_fluency(100),  # clarity 100 -> fluency_score 25
                transcript="a" * 100,   # long enough to trigger content scoring
                motion_title="M",
                motion_text="motion text here",
            )
        assert not unavailable
        # earned = 25 (fluency) + 42 (content) = 67; max = 25 + 50 = 75
        assert score == round(67 / 75 * 100, 2)
        assert breakdown["pronunciation"]["raw"] is None

    asyncio.run(scenario())


def test_debate_score_full_when_all_signals_high():
    """All present: fluency(25) + content(50) -> earned 75 of max 75 -> 100."""

    async def scenario():
        with patch(
            "app.debate.service.score_debate_content",
            return_value=_FakeContent(50),
        ):
            score, unavailable, _ = await compute_ai_score_with_content(
                pronunciation=_skipped_pron(),
                fluency=_fluency(100),
                transcript="a" * 100,
                motion_title="M",
                motion_text="motion text here",
            )
        assert not unavailable
        assert score == 100.0

    asyncio.run(scenario())


def test_debate_short_transcript_scores_on_fluency_only():
    """Transcript too short for content -> delivery-only, scored out of 50.

    Content is half the rubric. When content cannot be assessed (transcript
    too short), the delivery-only score is intentionally halved (scored out
    of 50) so a fluent but content-less turn cannot look like a pass. See the
    content-missing branch in ``compute_ai_score_with_content``.
    """

    async def scenario():
        score, unavailable, breakdown = await compute_ai_score_with_content(
            pronunciation=_skipped_pron(),
            fluency=_fluency(80),  # clarity 80 -> fluency_score 20 of 25
            transcript="hi",       # too short for content scoring
            motion_title="M",
            motion_text="motion text",
        )
        # Only fluency present: earned 20, max 25 -> 80.0, then halved
        # because content is missing -> 40.0.
        assert not unavailable
        assert score == 40.0
        assert breakdown["content"]["total"] is None
        assert breakdown["content_missing"] is True

    asyncio.run(scenario())


# ---------------------------------------------------------------------------
# Winner selection: draw-on-tie rule (Property 5, Requirements 9.2/9.3/9.4/9.5)
# ---------------------------------------------------------------------------

import random

from hypothesis import given, settings
from hypothesis import strategies as st

from app.debate.scoring import (
    EFFECTIVE_SCORE_DP,
    compute_effective_score,
    compute_winner,
)
from app.debate.schemas import DebateTurn, ParticipantInternal


def _participant(pid: str, turn_index: int) -> ParticipantInternal:
    return ParticipantInternal(
        participant_id=pid,
        user_id=f"uid-{pid}",
        user_email=f"{pid}@example.com",
        display_name=f"Speaker {pid}",
        joined_at=1000.0,
        is_ready=True,
        turn_index=turn_index,
    )


def _turn(
    pid: str,
    turn_index: int,
    ai_score: float,
    override: int | None = None,
    submitted_at: float = 1000.0,
) -> DebateTurn:
    return DebateTurn(
        turn_id=f"turn-{pid}",
        debate_id="debate-1",
        participant_id=pid,
        turn_index=turn_index,
        analysis_id=f"an-{pid}",
        ai_score=ai_score,
        teacher_override_score=override,
        submitted_at=submitted_at,
    )


def test_winner_unique_highest_returns_single_winner():
    """(a) Exactly one strictly-highest rounded score -> that participant."""
    parts = [_participant(str(i), i) for i in range(4)]
    turns = [
        _turn("0", 0, 90.0),
        _turn("1", 1, 80.0),
        _turn("2", 2, 70.0),
        _turn("3", 3, 60.0),
    ]
    assert compute_winner(turns, parts) == "0"


def test_winner_two_way_tie_is_draw():
    """(b) Two participants share the top rounded score -> None (draw)."""
    parts = [_participant(str(i), i) for i in range(4)]
    turns = [
        _turn("0", 0, 90.0),
        _turn("1", 1, 90.0),
        _turn("2", 2, 70.0),
        _turn("3", 3, 60.0),
    ]
    assert compute_winner(turns, parts) is None


def test_winner_no_scorable_turns_is_none():
    """(c) Empty turns -> None."""
    parts = [_participant(str(i), i) for i in range(4)]
    assert compute_winner([], parts) is None


def test_winner_rounding_boundary_consistent_with_1dp():
    """(e) Winner decision is driven by round(score, 1), whatever it yields.

    We assert compute_winner agrees with the 1-dp rounded comparison for
    near-boundary values rather than hardcoding float-rounding quirks.
    """
    parts = [_participant("a", 0), _participant("b", 1)]
    for a_score, b_score in [
        (87.44, 87.45),
        (87.44, 87.46),
        (87.45, 87.45),
        (87.40, 87.44),
        (99.94, 99.95),
    ]:
        turns = [_turn("a", 0, a_score), _turn("b", 1, b_score)]
        ra = round(a_score, EFFECTIVE_SCORE_DP)
        rb = round(b_score, EFFECTIVE_SCORE_DP)
        result = compute_winner(turns, parts)
        if ra > rb:
            assert result == "a"
        elif rb > ra:
            assert result == "b"
        else:
            assert result is None


@settings(max_examples=100, deadline=None)
@given(
    scores=st.lists(
        st.floats(min_value=0.0, max_value=100.0, allow_nan=False),
        min_size=4,
        max_size=6,
    ),
    seed=st.integers(min_value=0, max_value=1_000_000),
)
def test_winner_draw_on_tie_property(scores: list[float], seed: int):
    """Property 5: unique argmax of 1-dp Effective_Score, else draw.

    Also verifies order/timing independence: shuffling participants and
    perturbing submitted_at / turn_index (without changing rounded scores)
    never changes the result.

    **Validates: Requirements 9.2, 9.3, 9.4, 9.5**
    """
    rng = random.Random(seed)
    pids = [f"p{i}" for i in range(len(scores))]
    parts = [_participant(pid, i) for i, pid in enumerate(pids)]
    turns = [
        _turn(pid, i, ai_score=scores[i], submitted_at=1000.0 + i)
        for i, pid in enumerate(pids)
    ]

    result = compute_winner(turns, parts)

    # Compute expected via the rounded-score argmax definition.
    rounded = {
        t.participant_id: round(compute_effective_score(t), EFFECTIVE_SCORE_DP)
        for t in turns
    }
    max_score = max(rounded.values())
    leaders = [pid for pid, s in rounded.items() if s == max_score]
    if len(leaders) == 1:
        assert result == leaders[0]
        # (a) strictly greater than every other rounded score
        for pid, s in rounded.items():
            if pid != result:
                assert rounded[result] > s
    else:
        # (b) two or more tied -> draw
        assert result is None

    # (d) Order / timing independence: shuffle participants + turns and
    # perturb submitted_at + turn_index without changing rounded scores.
    shuffled_parts = parts[:]
    rng.shuffle(shuffled_parts)
    perturbed_turns = [
        _turn(
            t.participant_id,
            turn_index=rng.randint(0, 99),
            ai_score=t.ai_score,
            submitted_at=t.submitted_at + rng.uniform(-500, 500),
        )
        for t in turns
    ]
    rng.shuffle(perturbed_turns)
    assert compute_winner(perturbed_turns, shuffled_parts) == result
