"""Profile API routes for student dashboard."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.auth import User, require_user
from app.storage import users_store
from app.storage._jsonl import append_jsonl, read_jsonl

logger = logging.getLogger("profile")

router = APIRouter(prefix="/profile", tags=["profile"])

# Where avatar images live on disk. Served publicly via the /uploads mount
# configured in app.main.
AVATAR_DIR = Path("uploads/avatars")
ACTIVITY_PATH = Path("outputs/activity_events.jsonl")

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
    active_days: int = 0
    current_streak: int = 0
    max_streak: int = 0
    total_submissions: int = 0
    points: int = 0


class ActivityDay(BaseModel):
    date: str
    count: int
    level: int


class ProfileSummaryResponse(BaseModel):
    avatar_url: Optional[str] = None
    stats: ProfileStats
    recent_debates: List[DebateSummary]
    recent_gds: List[GDSummary]
    recent_interviews: List[InterviewSummary]
    recent_battles: List[BattleSummary]
    recent_pronunciations: List[AttemptSummary]
    activity: List[ActivityDay] = []
    badges: List[str] = []


class AvatarResponse(BaseModel):
    avatar_url: Optional[str] = None


class ActivityEventRequest(BaseModel):
    event: str


@router.post("/activity", status_code=204)
async def record_activity(
    body: ActivityEventRequest,
    current_user: User = Depends(require_user),
) -> None:
    """Record lightweight activity such as opening the platform.

    Practice, interviews, debates, and POTD completions are also read from
    their durable stores when the profile is built.
    """
    allowed = {"open", "practice", "potd", "debate_win", "gd_win", "battle_win"}
    if body.event not in allowed:
        raise HTTPException(status_code=400, detail="unsupported_activity")
    if body.event == "open":
        today = datetime.now(timezone.utc).date().isoformat()
        for event in read_jsonl(ACTIVITY_PATH):
            if event.get("user_id") != current_user.uid or event.get("event") != "open":
                continue
            created_at = event.get("created_at")
            if isinstance(created_at, str) and created_at[:10] == today:
                return
    append_jsonl(ACTIVITY_PATH, {
        "user_id": current_user.uid,
        "event": body.event,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


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
    activity_counts: dict[str, int] = {}
    points = 0
    potd_dates: set[str] = set()

    event_points = {"open": 1, "practice": 5, "potd": 10, "debate_win": 20, "gd_win": 20, "battle_win": 10}
    for event in read_jsonl(ACTIVITY_PATH):
        if event.get("user_id") == user_id:
            record_activity_value = event.get("created_at")
            if isinstance(record_activity_value, str):
                try:
                    event_day = datetime.fromisoformat(record_activity_value.replace("Z", "+00:00")).date().isoformat()
                    activity_counts[event_day] = activity_counts.get(event_day, 0) + 1
                except ValueError:
                    pass
            points += event_points.get(event.get("event"), 0)

    def record_activity(value: object) -> None:
        if isinstance(value, (int, float)):
            activity_day = datetime.fromtimestamp(value, tz=timezone.utc).date().isoformat()
        elif isinstance(value, str):
            try:
                activity_day = datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
            except ValueError:
                return
        else:
            return
        activity_counts[activity_day] = activity_counts.get(activity_day, 0) + 1
    
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
                    points += 20
                    record_activity(row.get("completed_at"))

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
                        points += 20
                        record_activity(row.get("completed_at"))
                    
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
                    record_activity(row.get("submitted_at"))
                    points += 5
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
                    record_activity(row.get("createdAt"))
                    points += 5
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

    for row in read_jsonl(Path("outputs/potd_completions.jsonl")):
        if row.get("user_id") == user_id:
            record_activity(row.get("date"))
            potd_dates.add(str(row.get("date", "")))
            points += 10

    # A green activity day means the student completed any pronunciation
    # attempt or submitted any Interview Studio answer, not only POTD.
    today = datetime.now(timezone.utc).date()
    activity: List[ActivityDay] = []
    for offset in range(364, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        count = activity_counts.get(key, 0)
        activity.append(ActivityDay(date=key, count=count, level=min(4, count)))
    active_dates = {day.date for day in activity if day.count > 0}
    current_streak = 0
    cursor = today
    while cursor.isoformat() in active_dates:
        current_streak += 1
        cursor -= timedelta(days=1)
    max_streak = 0
    run = 0
    for day in activity:
        run = run + 1 if day.count > 0 else 0
        max_streak = max(max_streak, run)
    stats.active_days = len(active_dates)
    stats.current_streak = current_streak
    stats.max_streak = max_streak
    stats.total_submissions = sum(activity_counts.values())
    stats.points = points
    badges: List[str] = []
    if stats.total_submissions >= 1:
        badges.append("First Step")
    if max_streak >= 7:
        badges.append("7-Day Streak")
    if max_streak >= 30:
        badges.append("30-Day Streak")
    if max_streak >= 365:
        badges.append("365 Days Badge")
    elif max_streak >= 200:
        badges.append("200 Days Badge")
    elif max_streak >= 100:
        badges.append("100 Days Badge")
    elif max_streak >= 50:
        badges.append("50 Days Badge")
    if len(potd_dates) >= 365:
        badges.append("Annual Daily Challenge")
    for month in sorted({day[:7] for day in potd_dates if len(day) >= 7}):
        try:
            year, month_number = (int(part) for part in month.split("-"))
            next_month = date(year + (month_number == 12), (month_number % 12) + 1, 1)
            days_in_month = (next_month - date(year, month_number, 1)).days
            if sum(day.startswith(month) for day in potd_dates) >= days_in_month:
                badges.append(date(year, month_number, 1).strftime("%B") + " Challenge")
        except ValueError:
            continue
    if points >= 2500:
        badges.append("Guardian")
    elif points >= 1000:
        badges.append("Knight")
    if stats.avg_pronunciation_score >= 90 or stats.avg_interview_score >= 90:
        badges.append("Standout Performer")
    
    return ProfileSummaryResponse(
        avatar_url=avatar_url,
        stats=stats,
        recent_debates=recent_debates,
        recent_gds=recent_gds,
        recent_interviews=recent_interviews,
        recent_battles=recent_battles,
        recent_pronunciations=recent_pronunciations,
        activity=activity,
        badges=badges,
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
