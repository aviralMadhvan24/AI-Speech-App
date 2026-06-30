"""Feedback_Generator — turn per-metric scores into actionable suggestions.

This module implements Requirement 9 of the Communication Skills Analyzer
spec (see ``.kiro/specs/communication-skills-analyzer/design.md``,
"Feedback_Generator (Req 9)" and Property 12).

Given a list of :class:`MetricResult` objects produced by the analyzers
and a *suggestion bank* loaded from configuration, :func:`generate`
returns a flat list of :class:`Suggestion` objects. Every emitted
``text`` is taken verbatim from the bank — the generator never fabricates
wording.

Suggestion bank shape
---------------------

The bank is a nested mapping keyed by metric name. Each metric entry
has three score-band lists plus a single ``recheck`` string used when
the analyzer flagged the metric:

.. code-block:: yaml

    posture:
      low:     ["Sit up tall. Imagine a string pulling your head up."]
      mid:     ["Good posture overall. Watch for slouching when thinking."]
      high:    ["Excellent posture throughout."]
      recheck: "Couldn't read your posture clearly. Re-record with full upper body in frame."

Banding rules
-------------

Numeric scores fall into one of three bands (Requirement 9.2):

* ``0..39``   → ``"low"``
* ``40..69``  → ``"mid"``
* ``70..100`` → ``"high"``

When ``score is None`` (the analyzer could not measure the metric at
all — e.g. ``flag == "detection_failed"`` with no fallback) the
band is reported as ``"unavailable"`` on the emitted recheck
:class:`Suggestion`.

Emission rules
--------------

For each metric in the input list, in input order:

* ``flag == "ok"`` and ``score >= 70``  — emit exactly one ``"high"``
  suggestion (Requirement 9.3).
* ``flag == "ok"`` and ``score < 70``   — emit one ``"low"`` or ``"mid"``
  suggestion (Requirement 9.1).
* ``flag != "ok"``                      — emit the metric's ``recheck``
  string (Requirement 9.5). If the analyzer also produced a fallback
  numeric score (i.e. ``score is not None``, e.g. a flagged metric that
  defaulted to ``0``), an additional band suggestion is emitted *after*
  the recheck entry so the recheck appears first for the metric.
"""

from __future__ import annotations

from backend.schemas import MetricResult, Suggestion

__all__ = ["generate", "score_to_band"]


def score_to_band(score: int | None) -> str:
    """Map a numeric score to its band label.

    Returns ``"unavailable"`` for ``None``, otherwise one of
    ``"low"`` (0–39), ``"mid"`` (40–69), ``"high"`` (70–100).
    """
    if score is None:
        return "unavailable"
    if score <= 39:
        return "low"
    if score <= 69:
        return "mid"
    return "high"


def generate(metrics: list[MetricResult], bank: dict) -> list[Suggestion]:
    """Generate suggestions for the given metrics from the suggestion bank.

    See module docstring for banding and emission rules.

    Parameters
    ----------
    metrics:
        Per-metric results from the analyzers. The output preserves
        input order; for each flagged metric the recheck suggestion is
        emitted before any band suggestion.
    bank:
        Suggestion bank with shape ``{metric: {"low": [...], "mid":
        [...], "high": [...], "recheck": str}}``.

    Returns
    -------
    list[Suggestion]
        One or two suggestions per input metric, all with ``text`` drawn
        verbatim from the bank.
    """
    suggestions: list[Suggestion] = []

    for metric in metrics:
        band = score_to_band(metric.score)
        metric_bank = bank[metric.name]

        if metric.flag == "ok":
            # Unflagged: exactly one band suggestion (high → positive
            # reinforcement; low/mid → improvement tip).
            text = metric_bank[band][0]
            suggestions.append(
                Suggestion(
                    metric=metric.name,
                    score=metric.score,
                    band=band,
                    text=text,
                )
            )
        else:
            # Flagged: always emit the recheck message first.
            suggestions.append(
                Suggestion(
                    metric=metric.name,
                    score=metric.score,
                    band="unavailable",
                    text=metric_bank["recheck"],
                )
            )
            # If the analyzer still produced a numeric fallback score,
            # also emit the corresponding band suggestion so the report
            # surfaces both the data-quality note and the performance tip.
            if metric.score is not None:
                suggestions.append(
                    Suggestion(
                        metric=metric.name,
                        score=metric.score,
                        band=band,
                        text=metric_bank[band][0],
                    )
                )

    return suggestions
