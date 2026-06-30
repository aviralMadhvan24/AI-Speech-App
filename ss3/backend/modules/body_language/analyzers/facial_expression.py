"""Facial expression analyzer.

Pure function ``analyze(frames, cfg) -> MetricResult`` that scores a session's
smile frequency from MediaPipe Face Mesh landmarks. Implements Requirement 7
(see ``requirements.md``) and the ``Facial_Expression_Analyzer`` section of
``design.md``.

The scoring rules are:

* For each frame with a face mesh detection, compute the smile metric as
  ``dist(mouth_left, mouth_right) / dist(eye_left_outer, eye_right_outer)``
  using the landmark ``x`` and ``y`` coordinates. The frame is classified
  ``smiling`` when the metric exceeds the configured threshold
  (``smile_ratio_threshold``, default ``0.45``). Frames whose inter-eye
  distance is zero are skipped as degenerate.
* If no frame has a usable face detection, return ``score=None`` with
  ``flag="student_absent"``.
* If face is detected in more than 0% but at most 50% of sampled frames,
  return ``score=0`` with ``flag="low_confidence"``.
* Otherwise compute ``raw_pct = 100 × smiling / face_frames``, cap at
  ``smile_cap_pct`` (default ``80``), and rescale linearly to ``0..100``.
"""

from __future__ import annotations

import math

from backend.schemas import FrameLandmarks, MetricResult

# MediaPipe Face Mesh landmark indices we care about.
# https://google.github.io/mediapipe/solutions/face_mesh
_MOUTH_LEFT = 61
_MOUTH_RIGHT = 291
_EYE_LEFT_OUTER = 33
_EYE_RIGHT_OUTER = 263


def _landmark_xy(face_mesh_entry, index: int) -> tuple[float, float]:
    """Return ``(x, y)`` for a MediaPipe face mesh landmark by index.

    Supports both the protobuf-style result (``entry.landmark[i].x``) and a
    plain list/sequence of landmarks (``entry[i].x``), so analyzer tests can
    feed synthetic frames without depending on MediaPipe.
    """
    landmarks = getattr(face_mesh_entry, "landmark", face_mesh_entry)
    lm = landmarks[index]
    return float(lm.x), float(lm.y)


def _distance(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """Euclidean distance between two ``(x, y)`` points."""
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def analyze(frames: list[FrameLandmarks], cfg: dict) -> MetricResult:
    """Score facial expression (smile frequency) across the sampled frames.

    Args:
        frames: One ``FrameLandmarks`` per sampled frame. Frames whose
            ``face_mesh`` is ``None`` or empty count toward the total but
            not toward "face_frames". Frames where the inter-eye distance
            is zero are also excluded from "face_frames" as degenerate.
        cfg: The ``body_language`` config dict; reads
            ``cfg["facial_expression"]["smile_ratio_threshold"]`` and
            ``cfg["facial_expression"]["smile_cap_pct"]``.

    Returns:
        A ``MetricResult`` named ``"facial_expression"``.
    """
    fe_cfg = cfg["facial_expression"]
    smile_threshold = float(fe_cfg["smile_ratio_threshold"])
    smile_cap_pct = float(fe_cfg["smile_cap_pct"])

    total = len(frames)
    face_frames = 0
    smiling_frames = 0

    for frame in frames:
        face_mesh = frame.face_mesh
        if face_mesh is None or len(face_mesh) == 0:
            continue

        # Use the first detected face.
        first_face = face_mesh[0]

        mouth_left = _landmark_xy(first_face, _MOUTH_LEFT)
        mouth_right = _landmark_xy(first_face, _MOUTH_RIGHT)
        eye_left = _landmark_xy(first_face, _EYE_LEFT_OUTER)
        eye_right = _landmark_xy(first_face, _EYE_RIGHT_OUTER)

        eye_distance = _distance(eye_left, eye_right)
        if eye_distance == 0:
            # Degenerate frame; skip.
            continue

        face_frames += 1

        mouth_distance = _distance(mouth_left, mouth_right)
        smile_metric = mouth_distance / eye_distance

        if smile_metric > smile_threshold:
            smiling_frames += 1

    # 0% face detected → student absent. Req 7.5.
    if face_frames == 0:
        return MetricResult(
            name="facial_expression", score=None, flag="student_absent"
        )

    # >0% and ≤50% face detected → low confidence. Req 7.6.
    # When ``total`` is zero we already returned above (face_frames would
    # be zero), so the ratio is well-defined here.
    if face_frames / total <= 0.5:
        return MetricResult(
            name="facial_expression", score=0, flag="low_confidence"
        )

    # Req 7.4: percentage of smiling frames, capped, rescaled to 0..100.
    raw_pct = 100.0 * smiling_frames / face_frames
    capped = min(raw_pct, smile_cap_pct)
    score = round(capped * 100.0 / smile_cap_pct)
    score = max(0, min(100, score))

    return MetricResult(name="facial_expression", score=score, flag="ok")


__all__ = ["analyze"]
