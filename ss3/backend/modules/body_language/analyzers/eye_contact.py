"""Eye_Contact_Analyzer — head pose from MediaPipe Face Mesh (Req 4).

Estimates yaw/pitch via ``cv2.solvePnP`` on six canonical Face Mesh
landmarks against a generic 3D face model, classifies each face-detected
frame as on-camera iff ``|yaw| < yaw_max_deg`` and ``|pitch| < pitch_max_deg``,
and produces the eye-contact ``MetricResult`` with the score/flag rules
from the design's "Eye_Contact_Analyzer (Req 4)" section.

Score rules:

* ``face_frames == 0`` → ``score = None``, ``flag = "detection_failed"``
* ``0 < face_frames / total <= 0.5`` → ``score = 0``, ``flag = "low_confidence"``
* otherwise → ``score = round(100 * on_camera / face_frames)``, ``flag = "ok"``

Per the task spec, frames where ``solvePnP`` fails are still counted as
face frames but are classified as off-camera (they don't contribute to
``on_camera``).
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from backend.schemas import FrameLandmarks, MetricResult

# ---------------------------------------------------------------------------
# Canonical face geometry
# ---------------------------------------------------------------------------

# MediaPipe Face Mesh landmark indices for the six points fed to solvePnP.
# These match the design's "Eye_Contact_Analyzer (Req 4)" recipe.
_NOSE_TIP = 1
_CHIN = 152
_LEFT_EYE_OUTER = 33
_RIGHT_EYE_OUTER = 263
_LEFT_MOUTH = 61
_RIGHT_MOUTH = 291

# Generic 3D face model in millimetres. Y is up, Z is forward (toward the
# camera). Coordinates are taken from the task description and match the
# common OpenCV head-pose tutorial scale.
_MODEL_POINTS = np.array(
    [
        (0.0, 0.0, 0.0),         # nose tip
        (0.0, -63.6, -12.5),     # chin
        (-43.3, 32.7, -26.0),    # left eye outer corner
        (43.3, 32.7, -26.0),     # right eye outer corner
        (-28.9, -28.9, -24.1),   # left mouth corner
        (28.9, -28.9, -24.1),    # right mouth corner
    ],
    dtype=np.float64,
)

# Synthetic camera matrix for unit-square normalized image coordinates.
# We don't have the real frame dimensions at this layer, so we treat the
# image plane as a 1×1 square with the optical centre at (0.5, 0.5) and
# focal length 1.0. This is approximate but sufficient for the yaw/pitch
# thresholds used by Req 4.3 (see the task notes).
_CAMERA_MATRIX = np.array(
    [
        [1.0, 0.0, 0.5],
        [0.0, 1.0, 0.5],
        [0.0, 0.0, 1.0],
    ],
    dtype=np.float64,
)
_DIST_COEFFS = np.zeros((4, 1), dtype=np.float64)

# Defaults mirror the body_language ``config.yaml`` values; used when the
# config dict omits ``eye_contact`` entries.
_DEFAULT_YAW_MAX_DEG = 15.0
_DEFAULT_PITCH_MAX_DEG = 15.0


# ---------------------------------------------------------------------------
# Head pose estimation
# ---------------------------------------------------------------------------


def _estimate_yaw_pitch(face_landmarks) -> tuple[float, float] | None:
    """Run solvePnP on one MediaPipe face and return (yaw_deg, pitch_deg).

    Returns ``None`` if ``solvePnP`` reports failure or raises. The caller
    treats that as "face detected but not on-camera".
    """
    landmark = face_landmarks.landmark
    try:
        image_points = np.array(
            [
                [landmark[_NOSE_TIP].x, landmark[_NOSE_TIP].y],
                [landmark[_CHIN].x, landmark[_CHIN].y],
                [landmark[_LEFT_EYE_OUTER].x, landmark[_LEFT_EYE_OUTER].y],
                [landmark[_RIGHT_EYE_OUTER].x, landmark[_RIGHT_EYE_OUTER].y],
                [landmark[_LEFT_MOUTH].x, landmark[_LEFT_MOUTH].y],
                [landmark[_RIGHT_MOUTH].x, landmark[_RIGHT_MOUTH].y],
            ],
            dtype=np.float64,
        )

        success, rvec, tvec = cv2.solvePnP(
            _MODEL_POINTS,
            image_points,
            _CAMERA_MATRIX,
            _DIST_COEFFS,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not success:
            return None

        rmat, _ = cv2.Rodrigues(rvec)
        proj_matrix = np.hstack((rmat, tvec))
        # decomposeProjectionMatrix returns Euler angles in degrees as
        # (pitch, yaw, roll). With the face model's +Y-up convention and
        # the camera's +Y-down convention, the neutral pose decomposes
        # with pitch ≈ ±180°; we wrap that below.
        _, _, _, _, _, _, euler = cv2.decomposeProjectionMatrix(proj_matrix)
        pitch, yaw, _roll = (float(a) for a in euler.flatten())
    except (cv2.error, ValueError, IndexError, AttributeError):
        return None

    if math.isnan(pitch) or math.isnan(yaw):
        return None

    # Wrap the 180° offset introduced by the Y-axis flip between the
    # face model and the camera frame, so "looking straight ahead"
    # reads as pitch ≈ 0 rather than ≈ 180.
    if pitch > 90.0:
        pitch -= 180.0
    elif pitch < -90.0:
        pitch += 180.0

    return yaw, pitch


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def analyze(frames: list[FrameLandmarks], cfg: dict) -> MetricResult:
    """Score eye contact over the sampled-frame stream.

    Parameters
    ----------
    frames:
        Sampled frames produced by ``Frame_Sampler``. Each entry's
        ``face_mesh`` is the raw MediaPipe ``multi_face_landmarks`` —
        either ``None`` / empty (no face detected) or a list of face
        landmark objects (we use the first one).
    cfg:
        Body Language config dict. Thresholds are read from
        ``cfg["eye_contact"]["yaw_max_deg"]`` and
        ``cfg["eye_contact"]["pitch_max_deg"]`` with the design defaults
        used as fallbacks.

    Returns
    -------
    MetricResult
        ``name="eye_contact"`` with score/flag per Req 4.4–4.6.
    """
    eye_cfg = cfg.get("eye_contact", {}) if cfg else {}
    yaw_max_deg = float(eye_cfg.get("yaw_max_deg", _DEFAULT_YAW_MAX_DEG))
    pitch_max_deg = float(eye_cfg.get("pitch_max_deg", _DEFAULT_PITCH_MAX_DEG))

    total = len(frames)
    face_frames = 0
    on_camera = 0

    for f in frames:
        # ``face_mesh`` is MediaPipe's ``multi_face_landmarks`` — None or
        # an empty list both mean "no face detected in this frame".
        if not f.face_mesh:
            continue
        face_frames += 1

        yaw_pitch = _estimate_yaw_pitch(f.face_mesh[0])
        if yaw_pitch is None:
            # Per task spec: count this frame in face_frames but treat
            # it as off-camera (don't increment on_camera).
            continue

        yaw, pitch = yaw_pitch
        if abs(yaw) < yaw_max_deg and abs(pitch) < pitch_max_deg:
            on_camera += 1

    if face_frames == 0:
        return MetricResult(name="eye_contact", score=None, flag="detection_failed")

    # Req 4.6: face detected in >0 but ≤50% of sampled frames → flag
    # ``low_confidence`` with score 0. ``total`` is guaranteed > 0 here
    # because ``face_frames > 0`` implies at least one sampled frame.
    if face_frames / total <= 0.5:
        return MetricResult(name="eye_contact", score=0, flag="low_confidence")

    score = round(100 * on_camera / face_frames)
    return MetricResult(name="eye_contact", score=score, flag="ok")


__all__ = ["analyze"]
