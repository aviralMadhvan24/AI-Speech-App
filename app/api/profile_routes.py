"""Profile API routes for student dashboard."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.auth import User, require_user
from app.storage import users_store
from app.storage._jsonl import read_jsonl

logger = logging.getLogger("profile")

router = APIRouter(prefix="/profile", tags=["profile"])

# Where avatar images live on disk. Served publicly via the /uploads mount
# configured in app.main.
AVATAR_DIR = Path("uploads/avatars")

# Accepted image content types -> file extension.
_ALLOWED_IMAGE_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

# Cap avatar uploads to keep disk usage sane (5 MB).
_MAX_AVATAR_BYTES = 5 * 1024 * 1024


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class DebateSummary(BaseModel):
    debate_id: str
    code: str
    motion_title: str
    participant_count: int
    your_score: float
    your_rank: int
    is_winner: bool
    completed_at: float


class GDSummary(BaseModel):
    session_id: str
    code: str
    topic_title: str
    participant_count: int
    your_score: float
    your_rank: int
    is_winner: bool
    completed_at: float


class InterviewSummary(BaseModel):
    submission_id: str
    question_prompt: str
    gesture_score: float
    teacher_score: Optional[float]
    combined_score: Optional[float]
    status: str
    submitted_at: str


class BattleSummary(BaseModel):
    battle_id: str
    code: str
    your_score: float
    opponent_score: float
    is_winner: bool
    completed_at: float


class AttemptSummary(BaseModel):
    sessionId: str
    sentencePreview: str
    score: float
    createdAt: str


class ProfileStats(BaseModel):
    total_debates: int = 0
    debate_wins: int = 0
    total_gds: int = 0
    gd_wins: int = 0
    total_interviews: int = 0
    avg_interview_score: float = 0.0
    total_battles: int = 0
    battle_wins: int = 0
    total_pronunciations: int = 0
    avg_pronunciation_score: float = 0.0


class ProfileSummaryResponse(BaseModel):
    avatar_url: Optional[str] = None
    stats: ProfileStats
    recent_debates: List[DebateSummary]
    recent_gds: List[GDSummary]
    recent_interviews: List[InterviewSummary]
    recent_battles: List[BattleSummary]
    recent_pronunciations: List[AttemptSummary]


class AvatarResponse(BaseModel):
    avatar_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=ProfileSummaryResponse)
async def get_profile_summary(
    current_user: User = Depends(require_user),
) -> ProfileSummaryResponse:
    """Get aggregated profile data for the current user."""
    user_id = current_user.uid
    user_email = current_user.email

    # Resolve the stored avatar (if the user uploaded one).
    avatar_url: Optional[str] = None
    try:
        record = users_store.get_by_uid(user_id)
        if record:
            avatar_url = record.avatar_url
    except Exception as e:
        logger.warning(f"Could not load avatar for {user_id}: {e}")

    stats = ProfileStats()
    recent_debates: List[DebateSummary] = []
    recent_gds: List[GDSummary] = []
    recent_interviews: List[InterviewSummary] = []
    recent_battles: List[BattleSummary] = []
    recent_pronunciations: List[AttemptSummary] = []
    
    # --- Debates ---
    debates_path = Path("outputs/debates.jsonl")
    if debates_path.exists():
        for row in read_jsonl(debates_path):
            try:
                # Match the caller against the persisted DebateRecord shape:
                # `participants` is a snapshot of dicts carrying `user_id`
                # (email is NOT stored), and scores live in `effective_scores`
                # keyed by participant_id. (The old code read `final_standings`
                # / nested `motion`, which the record never contains — so no
                # debate ever matched and the list stayed empty.)
                participants = row.get("participants", [])
                my_pid: Optional[str] = None
                for p in participants:
                    if p.get("user_id") == user_id:
                        my_pid = p.get("participant_id")
                        break
                if my_pid is None:
                    continue

                stats.total_debates += 1
                winner_pid = row.get("winner_participant_id")
                is_winner = winner_pid is not None and winner_pid == my_pid
                if is_winner:
                    stats.debate_wins += 1

                effective_scores = row.get("effective_scores", [])
                your_score = 0.0
                for es in effective_scores:
                    if es.get("participant_id") == my_pid:
                        your_score = es.get("effective_score", 0) or 0
                        break

                # Rank by effective_score (desc); draw-safe (ties share order).
                ranked = sorted(
                    effective_scores,
                    key=lambda e: e.get("effective_score", 0) or 0,
                    reverse=True,
                )
                your_rank = 0
                for idx, es in enumerate(ranked):
                    if es.get("participant_id") == my_pid:
                        your_rank = idx + 1
                        break

                recent_debates.append(DebateSummary(
                    debate_id=row.get("debate_id", ""),
                    code=row.get("code", ""),
                    motion_title=row.get("motion_title", "Unknown"),
                    participant_count=len(participants),
                    your_score=your_score,
                    your_rank=your_rank,
                    is_winner=is_winner,
                    completed_at=row.get("completed_at", 0),
                ))
            except Exception as e:
                logger.warning(f"Skipping malformed debate row: {e}")
    
    # Sort by completed_at desc and take latest 5
    recent_debates.sort(key=lambda x: x.completed_at, reverse=True)
    recent_debates = recent_debates[:5]
    
    # --- GDs ---
    gd_path = Path("outputs/gd_sessions.jsonl")
    if gd_path.exists():
        seen_sessions = set()
        for row in read_jsonl(gd_path):
            try:
                session_id = row.get("session_id", "")
                if session_id in seen_sessions:
                    continue
                
                # Check if user participated
                scores = row.get("scores", [])
                participants = row.get("participants", [])
                
                user_score = None
                for s in scores:
                    # Match by participant_id through participants list
                    pid = s.get("participant_id")
                    for p in participants:
                        if p.get("participant_id") == pid and p.get("user_id") == user_id:
                            user_score = s
                            break
                    if user_score:
                        break
                
                if user_score:
                    seen_sessions.add(session_id)
                    stats.total_gds += 1
                    is_winner = user_score.get("rank") == 1
                    if is_winner:
                        stats.gd_wins += 1
                    
                    recent_gds.append(GDSummary(
                        session_id=session_id,
                        code=row.get("code", ""),
                        topic_title=row.get("topic_title", "Unknown"),
                        participant_count=len(participants),
                        your_score=user_score.get("total_score", 0),
                        your_rank=user_score.get("rank", 0),
                        is_winner=is_winner,
                        completed_at=row.get("completed_at", 0),
                    ))
            except Exception as e:
                logger.warning(f"Skipping malformed GD row: {e}")
    
    recent_gds.sort(key=lambda x: x.completed_at, reverse=True)
    recent_gds = recent_gds[:5]
    
    # --- Interviews ---
    interview_path = Path("outputs/interview_submissions.jsonl")
    if interview_path.exists():
        interview_scores = []
        for row in read_jsonl(interview_path):
            try:
                if row.get("student_uid") == user_id or row.get("student_email") == user_email:
                    stats.total_interviews += 1
                    combined = row.get("combined_score")
                    if combined is not None:
                        interview_scores.append(combined)
                    
                    recent_interviews.append(InterviewSummary(
                        submission_id=row.get("submission_id", ""),
                        question_prompt=row.get("question_prompt", "Unknown"),
                        gesture_score=row.get("gesture_score", 0),
                        teacher_score=row.get("teacher_score"),
                        combined_score=combined,
                        status=row.get("status", "pending"),
                        submitted_at=row.get("submitted_at", ""),
                    ))
            except Exception as e:
                logger.warning(f"Skipping malformed interview row: {e}")
        
        if interview_scores:
            stats.avg_interview_score = sum(interview_scores) / len(interview_scores)
    
    recent_interviews.sort(key=lambda x: x.submitted_at, reverse=True)
    recent_interviews = recent_interviews[:5]
    
    # --- Pronunciations (attempts) ---
    attempts_path = Path("outputs/attempts.jsonl")
    if attempts_path.exists():
        pronunciation_scores = []
        for row in read_jsonl(attempts_path):
            try:
                if row.get("userId") == user_id or row.get("userEmail") == user_email:
                    stats.total_pronunciations += 1
                    score = row.get("score", 0)
                    if score:
                        pronunciation_scores.append(score)
                    
                    recent_pronunciations.append(AttemptSummary(
                        sessionId=row.get("sessionId", ""),
                        sentencePreview=row.get("sentenceText", "")[:50] + "..." if len(row.get("sentenceText", "")) > 50 else row.get("sentenceText", ""),
                        score=score,
                        createdAt=row.get("createdAt", ""),
                    ))
            except Exception as e:
                logger.warning(f"Skipping malformed attempt row: {e}")
        
        if pronunciation_scores:
            stats.avg_pronunciation_score = sum(pronunciation_scores) / len(pronunciation_scores)
    
    recent_pronunciations.sort(key=lambda x: x.createdAt, reverse=True)
    recent_pronunciations = recent_pronunciations[:10]
    
    return ProfileSummaryResponse(
        avatar_url=avatar_url,
        stats=stats,
        recent_debates=recent_debates,
        recent_gds=recent_gds,
        recent_interviews=recent_interviews,
        recent_battles=recent_battles,
        recent_pronunciations=recent_pronunciations,
    )


# ---------------------------------------------------------------------------
# Avatar upload / removal
# ---------------------------------------------------------------------------

def _delete_existing_avatars(user_id: str) -> None:
    """Remove any previously uploaded avatar files for this user.

    Avatars are named ``<uid>.<ext>`` so a user can only ever have one,
    but the extension may change between uploads (png -> jpg). Clean up
    stale variants so we don't leave orphaned files behind.
    """
    if not AVATAR_DIR.exists():
        return
    for ext in set(_ALLOWED_IMAGE_TYPES.values()):
        stale = AVATAR_DIR / f"{user_id}.{ext}"
        if stale.exists():
            try:
                stale.unlink()
            except OSError as e:
                logger.warning(f"Could not delete stale avatar {stale}: {e}")


@router.post("/avatar", response_model=AvatarResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(require_user),
) -> AvatarResponse:
    """Upload (or replace) the current user's profile photo."""
    content_type = (file.content_type or "").lower()
    extension = _ALLOWED_IMAGE_TYPES.get(content_type)
    if not extension:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    if len(data) > _MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image too large. Maximum size is 5 MB.",
        )

    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    # Clear old files first so a png->jpg switch doesn't orphan the old one.
    _delete_existing_avatars(current_user.uid)

    filename = f"{current_user.uid}.{extension}"
    target = AVATAR_DIR / filename
    try:
        target.write_bytes(data)
    except OSError as e:
        logger.error(f"Failed to write avatar for {current_user.uid}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save the uploaded image.",
        )

    # Cache-busting query param so the browser reloads the new image even
    # though the path (uid-based) stays the same.
    avatar_url = f"/uploads/avatars/{filename}?v={uuid.uuid4().hex[:8]}"
    users_store.set_avatar(current_user.uid, avatar_url)
    logger.info(f"Avatar updated for {current_user.uid}")
    return AvatarResponse(avatar_url=avatar_url)


@router.delete("/avatar", response_model=AvatarResponse)
async def delete_avatar(
    current_user: User = Depends(require_user),
) -> AvatarResponse:
    """Remove the current user's profile photo."""
    _delete_existing_avatars(current_user.uid)
    users_store.set_avatar(current_user.uid, None)
    logger.info(f"Avatar removed for {current_user.uid}")
    return AvatarResponse(avatar_url=None)
