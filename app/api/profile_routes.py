"""Profile API routes for student dashboard."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import User, require_user
from app.storage._jsonl import read_jsonl

logger = logging.getLogger("profile")

router = APIRouter(prefix="/profile", tags=["profile"])


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
    stats: ProfileStats
    recent_debates: List[DebateSummary]
    recent_gds: List[GDSummary]
    recent_interviews: List[InterviewSummary]
    recent_battles: List[BattleSummary]
    recent_pronunciations: List[AttemptSummary]


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
                # Find if user participated
                final_standings = row.get("final_standings", [])
                user_standing = None
                for s in final_standings:
                    if s.get("user_id") == user_id or s.get("email") == user_email:
                        user_standing = s
                        break
                
                if user_standing:
                    stats.total_debates += 1
                    is_winner = user_standing.get("is_winner", False)
                    if is_winner:
                        stats.debate_wins += 1
                    
                    recent_debates.append(DebateSummary(
                        debate_id=row.get("debate_id", ""),
                        code=row.get("code", ""),
                        motion_title=row.get("motion", {}).get("title", "Unknown"),
                        participant_count=len(final_standings),
                        your_score=user_standing.get("effective_score", 0),
                        your_rank=user_standing.get("rank", 0),
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
        stats=stats,
        recent_debates=recent_debates,
        recent_gds=recent_gds,
        recent_interviews=recent_interviews,
        recent_battles=recent_battles,
        recent_pronunciations=recent_pronunciations,
    )
