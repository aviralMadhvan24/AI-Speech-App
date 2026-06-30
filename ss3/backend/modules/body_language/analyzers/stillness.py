"""Stillness_Analyzer — fidgeting / restlessness scoring (Req 6).

Per design.md → Components → Analyzers → Stillness_Analyzer:

* For each consecutive pair of pose-detected frames, compute the mean
  Euclidean distance of the **nose**, **left wrist**, and **right wrist**
  landmarks, divided by the frame diagonal (sqrt(2) in MediaPipe's
  normalized [0, 1] image coordinates). This yields a per-pair
  normalized displacement.
* The full recording's stillness score is derived from the **variance**
  of the displacement series via a piecewise-linear map:

      variance ≤ ``cfg["stillness"]["variance_min"]`` (default 0.0005)  → 100
      variance ≥ ``cfg["stillness"]["variance_max"]`` (default 0.01)    →   0
      otherwise: linear in between, clamped to [0, 100] and rounded.

* If fewer than two sampled frames have a detected pose — or no
  consecutive pose-detected pair exists, so the displacement series is
  empty — the analyzer returns ``score=0`` and ``flag="low_confidence"``
  (Req 6.5).

The function is a pure transformation over the cached
``list[FrameLandmarks]`` and does no I/O.
"""

from __future__ import annotations

import math

from backend.schemas import FrameLandmarks, MetricResult

# MediaPipe Pose landmark indices (mp.solutions.pose.PoseLandmark).
# Pinned here so the analyzer doesn't need to import mediapipe at module
# load time and so the tests can hit it without the mediapipe wheel.
_NOSE = 0
_LEFT_WRIST = 15
_RIGHT_WRIST = 16

# Frame diagonal in MediaPipe's normalized [0, 1] coordinate space.
# Image width = height = 1, so the diagonal is sqrt(1^2 + 1^2) = sqrt(2).
_FRAME_DIAGONAL = math.sqrt(2.0)

# Defaults for the piecewise-linear variance → score map. The cfg dict
# normally carries the values from ``config.yaml``; these mirror the
# design-doc defaults so the analyzer remains usable if a key is missing.
_DEFAULT_VARIANCE_MIN = 0.0005
_DEFAULT_VARIANCE_MAX = 0.01


def _displacement(prev_pose, curr_pose) -> float:
    """Mean normalized Euclidean displacement of nose + both wrists.

    Both arguments are MediaPipe pose-landmarks objects (``.landmark[i]``
    yields a landmark with ``.x`` and ``.y`` in [0, 1]). The result is the
    arithmetic mean of the three landmark distances, divided by the frame
    diagonal so the value is unit-less and resolution-independent.
    """
    total = 0.0
    for idx in (_NOSE, _LEFT_WRIST, _RIGHT_WRIST):
        dx = curr_pose.landmark[idx].x - prev_pose.landmark[idx].x
        dy = curr_pose.landmark[idx].y - prev_pose.landmark[idx].y
        total += math.sqrt(dx * dx + dy * dy)
    mean = total / 3.0
    return mean / _FRAME_DIAGONAL


def _variance_to_score(variance: float, v_min: float, v_max: float) -> int:
    """Piecewise-linear map of displacement variance to a 0..100 score.

    * variance ≤ ``v_min`` → 100 (perfectly still)
    * variance ≥ ``v_max`` → 0   (very fidgety)
    * in between           → linear, clamped, rounded
    """
    if variance <= v_min:
        return 100
    if variance >= v_max:
        return 0
    # Linear interpolation: at v_min → 100, at v_max → 0.
    fraction = (v_max - variance) / (v_max - v_min)
    score = round(100.0 * fraction)
    # Defensive clamp — fraction is in (0, 1) here so this is belt-and-braces.
    return max(0, min(100, score))


def analyze(frames: list[FrameLandmarks], cfg: dict) -> MetricResult:
    """Score stillness over a sampled-frame sequence.

    Parameters
    ----------
    frames:
        Per-frame MediaPipe outputs, in source-video order, as produced
        by ``Frame_Sampler.sample``. ``frame.pose`` is the MediaPipe
        pose-landmarks object or ``None`` if pose was not detected.
    cfg:
        Module config dict. Reads
        ``cfg["stillness"]["variance_min"]`` and
        ``cfg["stillness"]["variance_max"]``; missing values fall back to
        the design-doc defaults (0.0005 and 0.01).

    Returns
    -------
    MetricResult
        ``name="stillness"``. When fewer than two frames contain pose
        landmarks, ``score=0`` and ``flag="low_confidence"`` (Req 6.5).
        Otherwise ``score`` is the piecewise-linear map of the
        displacement-series variance and ``flag="ok"``.
    """
    stillness_cfg = cfg.get("stillness", {}) if isinstance(cfg, dict) else {}
    variance_min = float(stillness_cfg.get("variance_min", _DEFAULT_VARIANCE_MIN))
    variance_max = float(stillness_cfg.get("variance_max", _DEFAULT_VARIANCE_MAX))

    # Count pose-detected frames first — Req 6.5 keys off this, not off
    # the number of consecutive pairs.
    pose_frame_count = sum(1 for f in frames if f.pose is not None)
    if pose_frame_count < 2:
        return MetricResult(name="stillness", score=0, flag="low_confidence")

    # Build the displacement series from consecutive pose-detected pairs.
    displacements: list[float] = []
    prev_pose = None
    for frame in frames:
        curr_pose = frame.pose
        if curr_pose is not None and prev_pose is not None:
            displacements.append(_displacement(prev_pose, curr_pose))
        prev_pose = curr_pose

    # If every pose-detected frame was isolated (no consecutive pair),
    # we cannot compute a meaningful displacement series — treat as
    # low-confidence to stay safely on the conservative side of Req 6.5.
    if not displacements:
        return MetricResult(name="stillness", score=0, flag="low_confidence")

    # Population variance: sum((x - mean)^2) / n. Single-point series
    # gives variance 0 → score 100, which is the intended behaviour for
    # a perfectly still recording.
    mean = sum(displacements) / len(displacements)
    variance = sum((d - mean) ** 2 for d in displacements) / len(displacements)

    score = _variance_to_score(variance, variance_min, variance_max)
    return MetricResult(name="stillness", score=score, flag="ok")


__all__ = ["analyze"]
