"""HTTP routes for Interview Studio.

`POST /interview/analyze` accepts a video upload, forwards it to the
ss3 gesture-analysis microservice, and returns a flattened response
the React `InterviewStudioView` can consume directly.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status

from app.auth import User
from app.auth import require_user

from .schemas import InterviewAnalysisResponse
from .service import CSAServiceError
from .service import analyze_video


logger = logging.getLogger("interview.routes")

router = APIRouter(prefix="/interview", tags=["interview"])


_MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB — webm @ 720p easily fits


@router.post("/analyze", response_model=InterviewAnalysisResponse)
async def analyze(
    video: UploadFile = File(...),
    current_user: User = Depends(require_user),
) -> InterviewAnalysisResponse:
    """Run gesture analysis on the uploaded interview video."""
    content_type = video.content_type or "video/webm"
    if not content_type.startswith("video/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported content type: {content_type}",
        )

    payload = await video.read()
    if len(payload) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Video too large (max 100 MB).",
        )

    logger.info(
        "interview_analyze user=%s filename=%s size=%d",
        current_user.email,
        video.filename or "<unnamed>",
        len(payload),
    )

    try:
        result = await analyze_video(
            filename=video.filename or "recording.webm",
            content_type=content_type,
            video_bytes=payload,
        )
    except CSAServiceError as exc:
        logger.warning("csa_proxy_error %s", exc)
        # 502 — upstream service problem, not the user's fault.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        )

    return result
