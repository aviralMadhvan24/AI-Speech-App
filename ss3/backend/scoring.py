"""Scoring_Engine: compute the overall weighted score (Requirement 8).

The scoring engine collapses the per-metric :class:`MetricResult` values
produced by the analyzers into a single :class:`OverallScore` for the
report. Its core job is to be *flag-aware*: metrics that the analyzers
marked as unreliable (``low_confidence``, ``detection_failed``,
``no_frames``, ``student_absent``) are dropped from the weighted average
and the surviving weights are re-normalized to sum to 1 so the overall
remains on a 0..100 scale (Req 8.1–8.4).

If every metric is filtered out, the session itself is flagged as
``low_confidence`` and the overall is reported as 0 with an empty
``applied_weights`` map (Req 8.5).

For transparency, ``applied_weights`` always records the weight actually
applied to each input metric — excluded metrics appear with weight
``0.0`` so the report can show how the overall was assembled (Req 8.6).
"""

from __future__ import annotations

from backend.schemas import MetricResult, OverallScore


def compute_overall(
    metrics: list[MetricResult],
    weights: dict[str, float],
) -> OverallScore:
    """Compute the overall weighted score from per-metric results.

    Parameters
    ----------
    metrics:
        The per-metric results from the five analyzers. Each metric's
        ``flag`` determines whether it participates in the average.
    weights:
        The base weight map (e.g., ``{"posture": 0.2, "eye_contact":
        0.25, ...}``) loaded from configuration. Weights for metrics
        missing from this map are treated as ``0.0``.

    Returns
    -------
    OverallScore
        The aggregated score. ``applied_weights`` is empty only when no
        metric survived flag filtering (Req 8.5); otherwise it contains
        an entry for every input metric with the renormalized weight
        (``0.0`` for excluded metrics) per Req 8.6.
    """
    surviving = [m for m in metrics if m.flag == "ok" and m.score is not None]

    # Req 8.5: every metric filtered out → flag the session, empty weights.
    if not surviving:
        return OverallScore(
            value=0,
            session_flag="low_confidence",
            applied_weights={},
        )

    # Req 8.4: renormalize surviving weights to sum to 1.
    total = sum(weights.get(m.name, 0.0) for m in surviving)

    # Req 8.6: record the applied weight for every input metric.
    applied_weights: dict[str, float] = {m.name: 0.0 for m in metrics}
    if total > 0:
        for m in surviving:
            applied_weights[m.name] = weights.get(m.name, 0.0) / total

    # Req 8.1 + 8.2: weighted average, rounded to an int in [0, 100].
    weighted_sum = sum(
        applied_weights[m.name] * (m.score if m.score is not None else 0)
        for m in surviving
    )
    value = max(0, min(100, round(weighted_sum)))

    return OverallScore(
        value=value,
        session_flag=None,
        applied_weights=applied_weights,
    )


__all__ = ["compute_overall"]
