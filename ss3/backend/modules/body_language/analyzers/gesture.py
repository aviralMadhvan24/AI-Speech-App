"""Gesture_Analyzer — classifies each sampled frame into one of five
hand-gesture categories and aggregates them into a 0..100 score.

Implements Requirement 5. Each sampled frame is classified into exactly
one of:

* ``hand_to_face``      — any hand landmark within 10 % of the frame
                          diagonal of any face-mesh landmark (Req 5.3).
* ``crossed_arms``      — left wrist.x > right shoulder.x AND
                          right wrist.x < left shoulder.x (Req 5.4).
* ``open_gesture``      — both wrists below shoulder level and the
                          wrist horizontal span exceeds the shoulder
                          width (Req 5.5).
* ``hands_at_rest``     — hands detected but none of the above conditions
                          match (residual "good neutral" category).
* ``hands_not_visible`` — MediaPipe Hands produced no landmarks for the
                          frame.

The categories are mutually exclusive. Detection of MediaPipe Hands acts
as a precondition gate: if no hand landmarks are present we cannot
reliably reason about crossed-arms or open-gesture geometry from pose
alone, so the frame is classified as ``hands_not_visible``. Within
hands-visible frames the remaining categories are checked in priority
order ``hand_to_face → crossed_arms → open_gesture → hands_at_rest``.

The score rewards ``open_gesture`` and ``hands_at_rest`` (Req 5.6).
Per-category counts are surfaced in ``details["per_category"]`` for the
report's gesture breakdown chart (Req 5.7, Req 10.4).
"""

from __future__ import annotations

import math
from typing import Any

from backend.schemas import FrameLandmarks, MetricResult

# MediaPipe Pose landmark indices for the four upper-body points used by
# the crossed-arms (Req 5.4) and open-gesture (Req 5.5) rules.
_LEFT_SHOULDER = 11
_RIGHT_SHOULDER = 12
_LEFT_WRIST = 15
_RIGHT_WRIST = 16

# Frame diagonal in MediaPipe's normalized [0, 1] image coordinates:
# sqrt(1**2 + 1**2). The hand-to-face proximity threshold (Req 5.3) is a
# fraction of this constant, configured via
# ``cfg["gesture"]["hand_to_face_pct_diag"]`` (default 0.10).
_NORMALIZED_FRAME_DIAGONAL = math.sqrt(2.0)

# Default proximity threshold expressed as a fraction of the frame
# diagonal. Mirrors ``config.yaml`` / ``BUILTIN_DEFAULTS`` so the
# analyzer still has a sensible value if ``cfg`` is partially populated.
_DEFAULT_HAND_TO_FACE_PCT_DIAG = 0.10

# The five mutually-exclusive categories. Kept as a tuple so the order
# of iteration is stable for the ``details["per_category"]`` mapping the
# frontend renders.
_CATEGORIES: tuple[str, ...] = (
    "hand_to_face",
    "crossed_arms",
    "open_gesture",
    "hands_at_rest",
    "hands_not_visible",
)


def _hands_visible(hands: Any) -> bool:
    """True iff MediaPipe Hands detected at least one hand in the frame.

    ``frame.hands`` mirrors ``multi_hand_landmarks`` from MediaPipe — it
    is ``None`` when no hand was detected and a (possibly empty) list of
    landmark lists otherwise.
    """
    return hands is not None and len(hands) > 0


def _face_visible(face_mesh: Any) -> bool:
    """True iff MediaPipe Face Mesh detected at least one face."""
    return face_mesh is not None and len(face_mesh) > 0


def _hand_to_face(hands: Any, face_mesh: Any, threshold: float) -> bool:
    """Return True if any hand landmark is within ``threshold`` of any face landmark.

    Distances are computed in the normalized (x, y) image plane to match
    the Req 5.3 wording ("frame diagonal distance"), which is a 2D
    image-plane quantity. The z component is ignored. The squared
    distance is compared against the squared threshold to avoid a square
    root per landmark pair.
    """
    threshold_sq = threshold * threshold
    for hand in hands:
        for hand_lm in hand.landmark:
            hx, hy = hand_lm.x, hand_lm.y
            for face in face_mesh:
                for face_lm in face.landmark:
                    dx = hx - face_lm.x
                    dy = hy - face_lm.y
                    if dx * dx + dy * dy <= threshold_sq:
                        return True
    return False


def _crossed_arms(pose: Any) -> bool:
    """Req 5.4: left wrist.x > right shoulder.x AND right wrist.x < left shoulder.x.

    Returns False if pose landmarks are unavailable, since the rule
    cannot be evaluated without shoulder and wrist positions.
    """
    if pose is None:
        return False
    lm = pose.landmark
    return (
        lm[_LEFT_WRIST].x > lm[_RIGHT_SHOULDER].x
        and lm[_RIGHT_WRIST].x < lm[_LEFT_SHOULDER].x
    )


def _open_gesture(pose: Any) -> bool:
    """Req 5.5: both wrists below shoulder level and wrist span > shoulder width.

    "Below" is interpreted in image coordinates where the y axis points
    down, so a wrist is below a shoulder when ``wrist.y > shoulder.y``.
    Each wrist is paired with its corresponding shoulder. The wrist span
    is the absolute horizontal distance between the two wrists; the
    shoulder width is the absolute horizontal distance between the two
    shoulders. The hand-to-face and crossed-arms conditions take
    precedence (handled by the priority ordering in :func:`_classify`),
    so this function does not re-check them.
    """
    if pose is None:
        return False
    lm = pose.landmark
    l_wrist = lm[_LEFT_WRIST]
    r_wrist = lm[_RIGHT_WRIST]
    l_shoulder = lm[_LEFT_SHOULDER]
    r_shoulder = lm[_RIGHT_SHOULDER]

    both_below = l_wrist.y > l_shoulder.y and r_wrist.y > r_shoulder.y
    wrist_span = abs(l_wrist.x - r_wrist.x)
    shoulder_width = abs(l_shoulder.x - r_shoulder.x)
    return both_below and wrist_span > shoulder_width


def _classify(frame: FrameLandmarks, hand_to_face_threshold: float) -> str:
    """Return the single category that applies to ``frame``.

    Hand visibility is a precondition: without hand landmarks we cannot
    distinguish ``hand_to_face`` (needs hand + face landmarks) or
    reliably read intent from raw pose-wrist positions alone, so the
    frame is classified as ``hands_not_visible``. When hands are
    visible the four remaining categories are checked in priority order
    and the first match wins; ``hands_at_rest`` is the residual
    catch-all for hands-visible frames that match none of the
    high-priority rules.
    """
    if not _hands_visible(frame.hands):
        return "hands_not_visible"

    if _face_visible(frame.face_mesh) and _hand_to_face(
        frame.hands, frame.face_mesh, hand_to_face_threshold
    ):
        return "hand_to_face"

    if _crossed_arms(frame.pose):
        return "crossed_arms"

    if _open_gesture(frame.pose):
        return "open_gesture"

    return "hands_at_rest"


def analyze(frames: list[FrameLandmarks], cfg: dict) -> MetricResult:
    """Score hand gestures across all sampled frames.

    Each frame is classified into exactly one of ``hand_to_face`` /
    ``crossed_arms`` / ``open_gesture`` / ``hands_at_rest`` /
    ``hands_not_visible`` (Req 5.2). The score is the percentage of
    frames classified as ``open_gesture`` or ``hands_at_rest``, rounded
    to the nearest integer (Req 5.6). Per-category counts are returned
    in ``details["per_category"]`` for the report's gesture breakdown
    chart (Req 5.7, Req 10.4).

    Args:
        frames: Cached MediaPipe landmarks from ``Frame_Sampler``. May
            be empty when the source video produced no sampled frames.
        cfg: Body Language config dict. Reads
            ``cfg["gesture"]["hand_to_face_pct_diag"]`` (default 0.10)
            as the hand-to-face proximity threshold expressed as a
            fraction of the frame diagonal.

    Returns:
        A :class:`MetricResult` named ``"gesture"``. When ``frames`` is
        empty the score is ``None`` and the flag is ``"no_frames"``
        (Req 5.8). Otherwise the score is in ``[0, 100]`` and the flag
        is ``"ok"``.
    """
    if not frames:
        return MetricResult(
            name="gesture",
            score=None,
            flag="no_frames",
            details={},
        )

    pct_diag = float(
        cfg.get("gesture", {}).get(
            "hand_to_face_pct_diag", _DEFAULT_HAND_TO_FACE_PCT_DIAG
        )
    )
    proximity_threshold = pct_diag * _NORMALIZED_FRAME_DIAGONAL

    counts: dict[str, int] = {category: 0 for category in _CATEGORIES}
    for frame in frames:
        counts[_classify(frame, proximity_threshold)] += 1

    total = len(frames)
    good = counts["open_gesture"] + counts["hands_at_rest"]
    score = round(100 * good / total)

    return MetricResult(
        name="gesture",
        score=score,
        flag="ok",
        details={"per_category": counts},
    )
