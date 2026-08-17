"""HTTP routes for Interview Studio.

`POST /interview/analyze` accepts a video upload, forwards it to the
ss3 gesture-analysis microservice, and returns a flattened response
the React `InterviewStudioView` can consume directly.

`POST /interview/submissions` then takes the gesture-analysis result
and persists a submission record awaiting teacher review.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status
from pydantic import BaseModel
from pydantic import Field

from app.auth import User
from app.auth import require_user
from app.storage import reviews_store
from app.storage import submissions_store
from app.storage.submissions import PronunciationSnapshot

from .schemas import InterviewAnalysisResponse
from .schemas import MySubmissionDetail
from .schemas import MySubmissionsResponse
from .schemas import InterviewSubmitRequest
from .schemas import InterviewSubmitResponse
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


@router.post("/submissions", response_model=InterviewSubmitResponse)
async def submit_for_review(
    body: InterviewSubmitRequest,
    current_user: User = Depends(require_user),
) -> InterviewSubmitResponse:
    """Persist a completed interview attempt for teacher review.

    The frontend calls this after `/interview/analyze` finishes — passing
    the gesture session id + scores so the submission can be reviewed
    later without re-running the analysis.
    """
    submission = submissions_store.create(
        student_email=current_user.email,
        student_uid=current_user.uid,
        student_name=current_user.name,
        question_id=body.question_id,
        question_prompt=body.question_prompt,
        question_category=body.question_category,
        gesture_session_id=body.gesture_session_id,
        gesture_score=body.gesture_score,
        gesture_metrics=[m.model_dump() for m in body.gesture_metrics],
        content_result=(
            body.content_result.model_dump() if body.content_result is not None else None
        ),
        duration_seconds=body.duration_seconds,
        pronunciation_state=(
            "pending"
            if body.content_result
            and body.content_result.speech_asset_id
            and body.content_result.transcript.strip()
            else "not_requested"
        ),
    )
    logger.info(
        "interview_submission user=%s submission=%s",
        current_user.email,
        submission.submission_id,
    )
    if submission.pronunciation_state == "pending":
        asyncio.create_task(_run_delayed_pronunciation(submission.submission_id))
    return InterviewSubmitResponse(submission_id=submission.submission_id)


@router.get("/my-submissions", response_model=MySubmissionsResponse)
async def my_submissions(
    current_user: User = Depends(require_user),
) -> MySubmissionsResponse:
    """Every submission the current student has made, newest first.

    Used by Interview Studio's "My Submissions" panel so a student can
    check whether their pending submission has been reviewed yet.
    """
    subs = submissions_store.list_for_student(current_user.email)
    subs.sort(key=lambda s: s.submitted_at, reverse=True)
    return MySubmissionsResponse(submissions=subs, total=len(subs))


@router.get("/my-submissions/{submission_id}", response_model=MySubmissionDetail)
async def my_submission_detail(
    submission_id: str,
    current_user: User = Depends(require_user),
) -> MySubmissionDetail:
    """Full detail for one of the current student's submissions.

    Includes the teacher review (rubric + comment + combined score) once
    a teacher has posted it. Returns 403 if the submission belongs to
    someone else — students can only see their own work.
    """
    submission = submissions_store.get(submission_id)
    if submission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="submission_not_found",
        )
    if submission.student_email.lower() != current_user.email.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not_your_submission",
        )
    review = reviews_store.get_for_submission(submission_id)
    return MySubmissionDetail(submission=submission, review=review)


# ---------------------------------------------------------------------------
# Answer Content Scoring (Groq LLM)
# ---------------------------------------------------------------------------


class AnswerScoreRequest(BaseModel):
    """Request to score the content of a spoken answer."""
    question_prompt: str
    question_category: str = "general"


class InterviewPronunciationResponse(BaseModel):
    """Compact pronunciation result safe to return and persist with an answer."""

    available: bool = False
    score: float | None = None
    provider: str | None = None
    feedback: str = ""
    issue_count: int = 0


class AnswerScoreResponse(BaseModel):
    """AI content score for an interview answer."""
    relevance: int = 0
    structure: int = 0
    depth: int = 0
    communication: int = 0
    total: int = 0
    feedback: str = ""
    strengths: str = ""
    improvements: str = ""
    available: bool = False
    error: str | None = None
    transcript: str = ""
    speech_asset_id: str | None = None
    pronunciation: InterviewPronunciationResponse = Field(
        default_factory=InterviewPronunciationResponse
    )


def _summarize_pronunciation(result) -> InterviewPronunciationResponse:
    """Turn the detailed pronunciation-engine result into interview feedback.

    Interview answers are open ended, so there is no pre-written reference
    sentence.  We use the ASR transcript as the reference text for the
    acoustic/phoneme comparison.  This is useful coaching feedback, but it is
    deliberately described as approximate because ASR can mask an error.
    """
    if not result.available or result.overall_score is None:
        return InterviewPronunciationResponse(
            available=False,
            provider=result.provider,
            feedback=result.message or "Pronunciation scoring is unavailable.",
            issue_count=len(result.phoneme_errors),
        )

    score = float(result.overall_score)
    if score >= 85:
        feedback = "Pronunciation was clear overall. Keep your current pace."
    elif score >= 70:
        feedback = "Mostly clear pronunciation. Slow down slightly on difficult words."
    else:
        feedback = "Some sounds were unclear. Practice the highlighted words slowly."

    return InterviewPronunciationResponse(
        available=True,
        score=score,
        provider=result.provider,
        feedback=feedback,
        issue_count=len(result.phoneme_errors),
    )


@router.post("/score-answer", response_model=AnswerScoreResponse)
async def score_answer(
    audio: UploadFile = File(...),
    question_prompt: str = "",
    question_category: str = "general",
    current_user: User = Depends(require_user),
) -> AnswerScoreResponse:
    """Score the content quality of a spoken interview answer.
    
    Accepts audio, transcribes it with Groq Whisper, then evaluates
    the answer quality using Groq LLM.
    
    This is complementary to /interview/analyze (which scores body language).
    Together they give a complete picture:
    - /interview/analyze → gesture_score (body language)
    - /interview/score-answer → content_score (what you said)
    """
    from app.asr.whisper_service import transcribe_audio
    from app.audio.preprocessing import preprocess_audio_asset
    from app.audio.storage import save_uploaded_audio
    from app.interview.content_scoring import score_interview_answer
    
    logger.info(
        "interview_score_answer user=%s question=%s",
        current_user.email,
        question_prompt[:50],
    )
    
    # Step 1: Save and preprocess audio. The Interview Studio reuses the
    # same MediaRecorder blob the analyze endpoint already accepts at 100 MB,
    # so raise `save_uploaded_audio`'s default 25 MB cap to match — otherwise a
    # longer 720p answer hits 413 here while `/interview/analyze` succeeds.
    try:
        audio_asset = await save_uploaded_audio(audio, max_bytes=_MAX_UPLOAD_BYTES)
        audio_asset = preprocess_audio_asset(audio_asset)
    except HTTPException:
        # Preserve specific codes (e.g. 415 unsupported format, 413 too large)
        # so the frontend can tell apart "wrong format" from "processing error".
        raise
    except Exception as exc:
        logger.warning(f"Audio processing failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not process audio file.",
        )
    
    # Step 2: Transcribe with Groq Whisper (fast)
    try:
        transcription = transcribe_audio(str(audio_asset.processed_path))
        transcript = transcription.text or transcription.normalized_text or ""
    except Exception as exc:
        logger.warning(f"Transcription failed: {exc}")
        return AnswerScoreResponse(
            error="Transcription failed",
            feedback="Could not transcribe your answer. Please try again.",
            speech_asset_id=audio_asset.audio_id,
        )

    if not transcript.strip():
        return AnswerScoreResponse(
            transcript=transcript,
            feedback="Could not hear a clear answer. Try speaking louder and closer to the microphone.",
            error="transcript_empty",
            speech_asset_id=audio_asset.audio_id,
        )

    # Content feedback is immediate. Pronunciation is intentionally delayed
    # until the student submits, matching Debate/GD's detailed-score flow.
    content_result = await score_interview_answer(
        transcript=transcript,
        question_prompt=question_prompt,
        question_category=question_category,
    )
    pronunciation = InterviewPronunciationResponse(
        available=False,
        feedback="Pronunciation analysis will be available shortly after you submit.",
    )

    if len(transcript.strip()) < 20:
        return AnswerScoreResponse(
            transcript=transcript,
            feedback="Your answer was too short for content feedback. Try speaking for at least 30 seconds.",
            error="transcript_too_short",
            pronunciation=pronunciation,
            speech_asset_id=audio_asset.audio_id,
        )

    return AnswerScoreResponse(
        relevance=content_result.relevance,
        structure=content_result.structure,
        depth=content_result.depth,
        communication=content_result.communication,
        total=content_result.total,
        feedback=content_result.feedback,
        strengths=content_result.strengths,
        improvements=content_result.improvements,
        available=content_result.available,
        error=content_result.error,
        transcript=transcript,
        pronunciation=pronunciation,
        speech_asset_id=audio_asset.audio_id,
    )


async def _run_delayed_pronunciation(submission_id: str) -> None:
    """Run the slow acoustic pass after an interview has been submitted."""
    from pathlib import Path

    from app.asr.schemas import TranscriptionResult
    from app.pronunciation.service import assess_pronunciation

    try:
        await asyncio.sleep(1)
        submission = submissions_store.get(submission_id)
        content = submission.content_result if submission else None
        asset_id = content.speech_asset_id if content else None
        if not asset_id or not content or not content.transcript.strip():
            raise ValueError("missing_saved_speech_asset")
        # audio_id is generated as a UUID by save_uploaded_audio; reject any
        # unexpected value before composing a filesystem path.
        import uuid
        uuid.UUID(asset_id)
        audio_path = Path("temp") / f"processed_{asset_id}.wav"
        if not audio_path.is_file():
            raise FileNotFoundError("processed_audio_missing")

        transcription = TranscriptionResult(
            text=content.transcript,
            normalized_text=content.transcript,
            provider="stored_interview_transcript",
            model="stored",
        )
        result = await asyncio.to_thread(
            assess_pronunciation,
            str(audio_path),
            content.transcript,
            transcription,
            submission_id,
        )
        summary = _summarize_pronunciation(result)
        submissions_store.update_pronunciation(
            submission_id,
            PronunciationSnapshot(
                available=summary.available,
                score=summary.score,
                provider=summary.provider,
                feedback=summary.feedback,
                issue_count=summary.issue_count,
            ),
            "completed" if summary.available else "failed",
        )
        logger.info("interview_pronunciation_complete submission=%s", submission_id)
    except Exception as exc:
        logger.warning("interview_pronunciation_failed submission=%s err=%s", submission_id, type(exc).__name__)
        submissions_store.update_pronunciation(
            submission_id,
            PronunciationSnapshot(feedback="Pronunciation scoring could not be completed."),
            "failed",
        )
