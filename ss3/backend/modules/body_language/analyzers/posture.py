"""Posture analyzer.

Pure function ``analyze(frames, cfg) -> MetricResult`` that scores a session's
posture from MediaPipe Pose landmarks. Implements Requirement 3 (see
``requirements.md``) and the ``Posture_Analyzer`` section of ``design.md``.

The scoring rules are:

* For each frame with a pose detection, compute the angle of the
  mid-shoulder→nose vector and the mid-shoulder→mid-hip vector relative to
  the vertical axis. The frame is classified ``upright`` when *both* angles
  are within the configured thresholds
  (``neck_to_shoulder_max_deg``, ``shoulder_to_hip_max_deg``).
* If pose is detected in ≤ 50% of sampled frames (or in zero frames),
  return ``score=0`` with ``flag="low_confidence"``.
* Otherwise return ``score = round(100 × upright / detected)`` with
  ``flag="ok"``.
"""

from __future__ import annotations

import math

from backend.schemas import FrameLandmarks, MetricResult

# MediaPipe Pose landmark indices we care about.
# https://google.github.io/mediapipe/solutions/pose
_NOSE = 0
_LEFT_SHOULDER = 11
_RIGHT_SHOULDER = 12
_LEFT_HIP = 23
_RIGHT_HIP = 24


def _angle_from_vertical_deg(dx: float, dy: float) -> float:
    """Return the angle in degrees between vector ``(dx, dy)`` and vertical.

    Vertical means the image's y axis (either direction). We use
    ``atan2(|dx|, |dy|)`` so the result is always in ``[0°, 90°]`` and is
    independent of whether y grows up or down in the coordinate system.
    """
    return math.degrees(math.atan2(abs(dx), abs(dy)))


def _landmark_xy(pose, index: int) -> tuple[float, float]:
    """Return ``(x, y)`` for a MediaPipe pose landmark by index.

    Supports both the protobuf-style result (``pose.landmark[i].x``) and a
    plain list/sequence of landmarks (``pose[i].x``), so analyzer tests can
    feed synthetic frames without depending on MediaPipe.
    """
    landmarks = getattr(pose, "landmark", pose)
    lm = landmarks[index]
    return float(lm.x), float(lm.y)


def analyze(frames: list[FrameLandmarks], cfg: dict) -> MetricResult:
    """Score posture across the sampled frames.

    Args:
        frames: One ``FrameLandmarks`` per sampled frame. Frames with
            ``pose is None`` count toward the total but not toward
            "detected".
        cfg: The ``body_language`` config dict; reads
            ``cfg["posture"]["neck_to_shoulder_max_deg"]`` and
            ``cfg["posture"]["shoulder_to_hip_max_deg"]``.

    Returns:
        A ``MetricResult`` named ``"posture"``.
    """
    posture_cfg = cfg["posture"]
    neck_max = float(posture_cfg["neck_to_shoulder_max_deg"])
    hip_max = float(posture_cfg["shoulder_to_hip_max_deg"])

    total = len(frames)
    detected = 0
    upright = 0

    for frame in frames:
        if frame.pose is None:
            continue
        detected += 1

        l_sh_x, l_sh_y = _landmark_xy(frame.pose, _LEFT_SHOULDER)
        r_sh_x, r_sh_y = _landmark_xy(frame.pose, _RIGHT_SHOULDER)
        l_hip_x, l_hip_y = _landmark_xy(frame.pose, _LEFT_HIP)
        r_hip_x, r_hip_y = _landmark_xy(frame.pose, _RIGHT_HIP)
        nose_x, nose_y = _landmark_xy(frame.pose, _NOSE)

        mid_sh_x = (l_sh_x + r_sh_x) / 2.0
        mid_sh_y = (l_sh_y + r_sh_y) / 2.0
        mid_hip_x = (l_hip_x + r_hip_x) / 2.0
        mid_hip_y = (l_hip_y + r_hip_y) / 2.0

        neck_angle = _angle_from_vertical_deg(
            nose_x - mid_sh_x, nose_y - mid_sh_y
        )
        hip_angle = _angle_from_vertical_deg(
            mid_hip_x - mid_sh_x, mid_hip_y - mid_sh_y
        )

        if neck_angle <= neck_max and hip_angle <= hip_max:
            upright += 1

    # Low-confidence when pose is missing from more than half the frames,
    # or when there are no frames at all. Req 3.5.
    if total == 0 or detected / total <= 0.5:
        return MetricResult(name="posture", score=0, flag="low_confidence")

    score = round(100 * upright / detected)
    return MetricResult(name="posture", score=score, flag="ok")


__all__ = ["analyze"]
