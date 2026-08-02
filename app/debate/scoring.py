"""Pure scoring functions for the group-debate feature.

See `.kiro/specs/group-debate/design.md` Section "Winner Selection" for the
governing pseudocode. These helpers are intentionally free of I/O and framework
imports so they can be unit- and property-tested in isolation.
"""

from typing import Optional

from app.debate.schemas import DebateTurn, ParticipantInternal


EFFECTIVE_SCORE_DP = 1   # decimal places used for winner comparison + display


def compute_effective_score(turn: DebateTurn) -> float:
    """Effective_Score := teacher_override_score if present, else ai_score."""
    if turn.teacher_override_score is not None:
        return float(turn.teacher_override_score)
    return float(turn.ai_score)


def compute_winner(
    turns: list[DebateTurn],
    participants: list[ParticipantInternal],
) -> Optional[str]:
    """Requirement 9 draw-on-tie rule.

    Round each eligible participant's Effective_Score to 1 decimal place
    (``EFFECTIVE_SCORE_DP``) — the same rounded value shown to users in the
    final standings — find the maximum rounded score, and:

      * return that participant's ``participant_id`` when EXACTLY ONE
        participant holds the maximum (strict unique argmax), OR
      * return ``None`` (a DRAW) when two or more participants share the
        maximum rounded score.

    Also returns ``None`` when there are no scorable turns.

    On a draw no participant is crowned and the debate counts as a win for
    no one (Req 9.3, 9.5). Participant ordering, ``submitted_at``, and
    ``turn_index`` do NOT influence the result — there are no tiebreakers.
    This is a pure function with no I/O.
    """
    if not turns:
        return None
    turn_by_pid: dict[str, DebateTurn] = {t.participant_id: t for t in turns}
    scored: list[tuple[str, float]] = []
    for p in participants:
        t = turn_by_pid.get(p.participant_id)
        if t is None:
            continue
        rounded_eff = round(compute_effective_score(t), EFFECTIVE_SCORE_DP)
        scored.append((p.participant_id, rounded_eff))
    if not scored:
        return None
    max_score = max(s for _, s in scored)
    leaders = [pid for pid, s in scored if s == max_score]
    if len(leaders) == 1:
        return leaders[0]          # unique highest → single winner
    return None                    # two or more tied → draw
