"""POST /precheck — run MediaPipe Pose + Face Mesh on a single uploaded frame."""
from __future__ import annotations
import logging

import cv2
import numpy as np

# MediaPipe's submodule layout varies between installs. Try paths in order.
try:
    import mediapipe.solutions.face_mesh as mp_face_mesh
    import mediapipe.solutions.pose as mp_pose
except ImportError:
    try:
        from mediapipe.python.solutions import face_mesh as mp_face_mesh
        from mediapipe.python.solutions import pose as mp_pose
    except ImportError:
        import mediapipe as _mp  # type: ignore[import-not-found]
        mp_face_mesh = _mp.solutions.face_mesh  # type: ignore[attr-defined]
        mp_pose = _mp.solutions.pose  # type: ignore[attr-defined]

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

router = APIRouter()
logger = logging.getLogger(__name__)

# Lazy-init MediaPipe modules — they're heavy
_pose = None
_face_mesh = None


def _get_models():
    global _pose, _face_mesh
    if _pose is None:
        _pose = mp_pose.Pose(static_image_mode=True)
    if _face_mesh is None:
        _face_mesh = mp_face_mesh.FaceMesh(static_image_mode=True)
    return _pose, _face_mesh


@router.post("/precheck")
async def precheck(frame: UploadFile = File(...)):
    try:
        data = await frame.read()
        if not data:
            return JSONResponse(status_code=400, content={"error": "Empty frame", "code": "empty_frame"})

        # Decode JPEG/PNG via OpenCV
        nparr = np.frombuffer(data, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return JSONResponse(status_code=400, content={"error": "Could not decode image", "code": "decode_failed"})

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False

        pose, face_mesh = _get_models()
        pose_result = pose.process(rgb)
        face_result = face_mesh.process(rgb)

        # pose_ok if pose landmarks were detected AND the upper body is visible
        # We use a simpler check: pose detected at all = pose_ok
        pose_ok = pose_result.pose_landmarks is not None

        # Additionally require shoulders to be visible (visibility > 0.5)
        if pose_ok:
            lm = pose_result.pose_landmarks.landmark
            try:
                left_shoulder_vis = lm[11].visibility if hasattr(lm[11], "visibility") else 1.0
                right_shoulder_vis = lm[12].visibility if hasattr(lm[12], "visibility") else 1.0
                if left_shoulder_vis < 0.5 or right_shoulder_vis < 0.5:
                    pose_ok = False
            except Exception:
                pass

        face_ok = (
            face_result.multi_face_landmarks is not None
            and len(face_result.multi_face_landmarks) > 0
        )

        return {"pose_ok": pose_ok, "face_ok": face_ok}
    except Exception as exc:
        logger.exception("Precheck failed")
        return JSONResponse(status_code=500, content={"error": str(exc), "code": "precheck_error"})
