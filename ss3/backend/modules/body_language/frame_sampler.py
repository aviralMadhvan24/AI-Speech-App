"""Frame_Sampler — single-pass video decode + MediaPipe inference.

Opens the input video with OpenCV, samples frames at the configured
target rate (default 5 fps, see ``config.yaml``), and runs MediaPipe
Pose, Face Mesh, and Hands on each sampled frame **in one pass**. The
resulting ``list[FrameLandmarks]`` is consumed by all five body-language
analyzers so the video is decoded and MediaPipe is invoked exactly once
per session (see design.md → Frame Sampling Strategy).

If ``cv2.VideoCapture`` cannot open the file, or the first frame read
fails, ``UnsupportedFormatError`` is raised. The session pipeline maps
that exception to state ``failed`` with code ``unsupported_format``
(Req 2.6).
"""

from __future__ import annotations

import math

import cv2

# MediaPipe's submodule layout varies between installs. Try the most
# common path first, then fall back to alternatives.
try:
    import mediapipe.solutions.face_mesh as mp_face_mesh
    import mediapipe.solutions.hands as mp_hands
    import mediapipe.solutions.pose as mp_pose
except ImportError:
    try:
        from mediapipe.python.solutions import face_mesh as mp_face_mesh
        from mediapipe.python.solutions import hands as mp_hands
        from mediapipe.python.solutions import pose as mp_pose
    except ImportError:
        # Final fallback: legacy ``import mediapipe as mp`` access.
        import mediapipe as _mp  # type: ignore[import-not-found]
        mp_face_mesh = _mp.solutions.face_mesh  # type: ignore[attr-defined]
        mp_hands = _mp.solutions.hands  # type: ignore[attr-defined]
        mp_pose = _mp.solutions.pose  # type: ignore[attr-defined]

from backend.schemas import FrameLandmarks


class UnsupportedFormatError(Exception):
    """Raised when ``cv2.VideoCapture`` cannot open the supplied file.

    Surfaced by the session pipeline as state ``failed`` with code
    ``unsupported_format`` (Req 2.6).
    """


# Default target sampling rate (frames per second). Matches the value in
# ``config.yaml`` and the Req 2.8 budget (120 s × 5 fps = 600 frames).
_DEFAULT_TARGET_FPS = 5

# Fallback source fps used when the container reports 0 / NaN / negative,
# which happens with some WebM files. 30 fps is a safe upper bound for
# typical webcam captures — the stride math degrades gracefully if the
# actual rate is lower.
_FALLBACK_SOURCE_FPS = 30.0


def sample(video_path: str, cfg: dict) -> list[FrameLandmarks]:
    """Decode ``video_path`` and return one ``FrameLandmarks`` per sample.

    Parameters
    ----------
    video_path:
        Filesystem path to the recorded video.
    cfg:
        Module config dict (the body_language ``config.yaml`` loaded by
        the config loader). The target sampling rate is read from
        ``cfg["sampling"]["fps"]``; missing values fall back to 5 fps.

    Returns
    -------
    list[FrameLandmarks]
        One entry per sampled frame, in source-video order, with
        ``frame_index`` set to the raw video frame index. Each modality
        field (``pose`` / ``face_mesh`` / ``hands``) holds the raw
        MediaPipe landmark object or ``None`` if that modality was not
        detected in the frame.

    Raises
    ------
    UnsupportedFormatError
        If OpenCV cannot open the file or the first frame read fails.
    """
    target_fps = int(cfg.get("sampling", {}).get("fps", _DEFAULT_TARGET_FPS))
    if target_fps < 1:
        target_fps = _DEFAULT_TARGET_FPS

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        raise UnsupportedFormatError(
            f"cv2.VideoCapture could not open video: {video_path}"
        )

    try:
        # Verify the file is actually decodable, not just that the
        # container could be opened. Some malformed files report
        # isOpened()=True but fail on the first read.
        ret, first_frame = cap.read()
        if not ret or first_frame is None:
            raise UnsupportedFormatError(
                f"cv2.VideoCapture opened but could not read a frame: {video_path}"
            )

        source_fps = cap.get(cv2.CAP_PROP_FPS)
        if (
            source_fps is None
            or source_fps <= 0
            or math.isnan(source_fps)
            or math.isinf(source_fps)
        ):
            source_fps = _FALLBACK_SOURCE_FPS

        stride = max(1, round(source_fps / target_fps))

        frames: list[FrameLandmarks] = []

        # Use context managers so MediaPipe graph resources are released
        # even if a downstream call raises. static_image_mode=False lets
        # the trackers exploit temporal coherence between sampled frames.
        with (
            mp_pose.Pose(static_image_mode=False) as pose,
            mp_face_mesh.FaceMesh(static_image_mode=False) as face_mesh,
            mp_hands.Hands(static_image_mode=False) as hands,
        ):

            def _process(frame_index: int, bgr_frame) -> None:
                # MediaPipe expects RGB; OpenCV gives BGR. Marking the
                # array non-writeable is the documented MediaPipe perf
                # tip — it lets the graph hold a zero-copy reference.
                rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False

                pose_result = pose.process(rgb)
                face_result = face_mesh.process(rgb)
                hands_result = hands.process(rgb)

                frames.append(
                    FrameLandmarks(
                        frame_index=frame_index,
                        pose=pose_result.pose_landmarks,
                        face_mesh=face_result.multi_face_landmarks,
                        hands=hands_result.multi_hand_landmarks,
                    )
                )

            # Frame 0 was already read for the format check — process it
            # so we don't waste the decode (stride always emits index 0).
            _process(0, first_frame)

            frame_index = 1
            while True:
                ret, bgr_frame = cap.read()
                if not ret or bgr_frame is None:
                    break
                if frame_index % stride == 0:
                    _process(frame_index, bgr_frame)
                frame_index += 1

        return frames
    finally:
        cap.release()
