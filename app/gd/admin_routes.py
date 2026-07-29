"""Admin routes for Group Discussion feature.

Teacher-only endpoints for reviewing completed GD sessions, overriding
scores, and adding comments.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import User, require_teacher
from app.gd.schemas import GDSessionRecord, GDSpeechRecord
from app.storage import custom_topics
from app.storage import gd_sessions as gd_sessions_store
from app.storage import gd_speeches as gd_speeches_store

logger = logging.getLogger("gd.admin")

router = APIRouter(prefix="/admin/gd", tags=["admin-gd"])


class GDSessionSummary(BaseModel):
    """Compact view for listing GD sessions."""
    session_id: str
    code: str
    topic_title: str
    participant_count: int
    total_speeches: int
    duration_seconds: float
    completed_at: float
    has_teacher_reviews: bool = False


class GDReviewRequest(BaseModel):
    """Teacher override for a participant's total score."""
    participant_id: str
    score: int = Field(ge=0, le=100)
    comment: Optional[str] = None


class GDReviewResponse(BaseModel):
    session_id: str
    participant_id: str
    original_score: float
    teacher_score: int
    teacher_comment: Optional[str]


@router.get("", response_model=List[GDSessionSummary])
async def list_gd_sessions(
    limit: int = 50,
    current_user: User = Depends(require_teacher),
) -> List[GDSessionSummary]:
    """List all completed GD sessions, newest first."""
    del current_user
    
    from pathlib import Path
    from app.storage._jsonl import read_jsonl
    
    all_sessions = []
    for row in read_jsonl(Path("outputs/gd_sessions.jsonl")):
        try:
            s = GDSessionRecord.model_validate(row)
            duration = (s.completed_at - s.created_at) if s.completed_at else 0.0
            all_sessions.append(GDSessionSummary(
                session_id=s.session_id,
                code=s.code,
                topic_title=s.topic_title,
                participant_count=len(s.participants),
                total_speeches=len(s.speech_ids),
                duration_seconds=duration,
                completed_at=s.completed_at,
                has_teacher_reviews=False,  # TODO: track this
            ))
        except Exception as e:
            logger.warning(f"Skipping malformed gd_session row: {e}")
    
    all_sessions.sort(key=lambda x: x.completed_at, reverse=True)
    return all_sessions[:limit]


@router.get("/{session_id}", response_model=dict)
async def get_gd_session_detail(
    session_id: str,
    current_user: User = Depends(require_teacher),
) -> dict:
    """Get full details of a GD session including all speeches."""
    del current_user
    session = gd_sessions_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    
    speeches = gd_speeches_store.list_speeches_for_session(session_id)
    
    return {
        "session": session.model_dump(),
        "speeches": [s.model_dump() for s in speeches],
    }


@router.get("/{session_id}/speech/{speech_id}/audio")
async def get_speech_audio(
    session_id: str,
    speech_id: str,
    current_user: User = Depends(require_teacher),
):
    """Serve the audio file for a specific speech."""
    from pathlib import Path
    from fastapi import Response
    
    del current_user
    speech = gd_speeches_store.get_speech(speech_id)
    if speech is None:
        raise HTTPException(status_code=404, detail="speech_not_found")
    
    if not speech.audio_ref:
        raise HTTPException(status_code=404, detail="audio_not_available")
    
    # Find the audio file in uploads
    uploads_dir = Path("uploads")
    candidates = [
        uploads_dir / f"{speech.audio_ref}.webm",
        uploads_dir / f"{speech.audio_ref}.wav",
        uploads_dir / f"{speech.audio_ref}.mp3",
        uploads_dir / f"{speech.audio_ref}.ogg",
    ]
    audio_path = next((p for p in candidates if p.is_file()), None)
    
    if audio_path is None:
        raise HTTPException(status_code=404, detail="audio_file_missing")
    
    ext = audio_path.suffix.lstrip(".").lower()
    content_type = {
        "webm": "audio/webm",
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
    }.get(ext, "audio/webm")
    
    return Response(content=audio_path.read_bytes(), media_type=content_type)


@router.post("/{session_id}/review", response_model=GDReviewResponse)
async def submit_gd_review(
    session_id: str,
    body: GDReviewRequest,
    current_user: User = Depends(require_teacher),
) -> GDReviewResponse:
    """Override a participant's total score for a GD session."""
    from pathlib import Path
    from app.storage._jsonl import read_jsonl, overwrite_jsonl
    
    session_path = Path("outputs/gd_sessions.jsonl")
    rows = read_jsonl(session_path)
    
    original_score = 0.0
    updated = False
    out_rows = []
    
    for row in rows:
        try:
            session = GDSessionRecord.model_validate(row)
        except Exception:
            out_rows.append(row)
            continue
        
        if session.session_id == session_id:
            # Find the participant score
            for score in session.scores:
                if score.participant_id == body.participant_id:
                    original_score = score.total_score
                    score.total_score = float(body.score)
                    if body.comment:
                        score.feedback = f"[Teacher: {current_user.name or current_user.email}] {body.comment}"
                    updated = True
                    break
            
            # Re-rank after override
            session.scores.sort(key=lambda s: s.total_score, reverse=True)
            for i, s in enumerate(session.scores):
                s.rank = i + 1
        
        out_rows.append(session.model_dump() if updated else row)
    
    if not updated:
        raise HTTPException(status_code=404, detail="session_or_participant_not_found")
    
    overwrite_jsonl(session_path, out_rows)
    
    return GDReviewResponse(
        session_id=session_id,
        participant_id=body.participant_id,
        original_score=original_score,
        teacher_score=body.score,
        teacher_comment=body.comment,
    )


@router.delete("/{session_id}")
async def delete_gd_session(
    session_id: str,
    current_user: User = Depends(require_teacher),
) -> dict:
    """Delete a GD session (data cleanup)."""
    from pathlib import Path
    from app.storage._jsonl import read_jsonl, overwrite_jsonl
    
    logger.info(f"Teacher {current_user.email} deleting GD session {session_id}")
    
    # Delete session
    session_path = Path("outputs/gd_sessions.jsonl")
    rows = read_jsonl(session_path)
    out_rows = []
    deleted = False
    for row in rows:
        try:
            if row.get("session_id") == session_id:
                deleted = True
                continue
        except Exception:
            pass
        out_rows.append(row)
    
    if not deleted:
        raise HTTPException(status_code=404, detail="session_not_found")
    
    overwrite_jsonl(session_path, out_rows)
    
    # Delete related speeches
    speech_path = Path("outputs/gd_speeches.jsonl")
    if speech_path.exists():
        speech_rows = read_jsonl(speech_path)
        speech_out = [r for r in speech_rows if r.get("session_id") != session_id]
        overwrite_jsonl(speech_path, speech_out)
    
    return {"deleted": True, "session_id": session_id}


# ---------------------------------------------------------------------------
# Topic catalog management (teacher-authored topics)
#
# Deliberately its own router/prefix: the review router already owns
# ``/admin/gd/{session_id}``, which would swallow ``/admin/gd/topics`` because
# FastAPI matches routes in registration order.
# ---------------------------------------------------------------------------

topics_router = APIRouter(prefix="/admin/gd-topics", tags=["admin-gd"])


class TopicEntry(BaseModel):
    """One row in the GD topic catalog, with its provenance."""

    id: str
    title: str
    text: str
    category: str
    is_custom: bool
    created_by: Optional[str] = None


class CreateTopicRequest(BaseModel):
    title: str = Field(min_length=4, max_length=120)
    text: str = Field(min_length=20, max_length=1000)
    category: str = Field(default="general", max_length=40)


@topics_router.get("", response_model=List[TopicEntry])
async def list_topic_catalog(
    current_user: User = Depends(require_teacher),
) -> List[TopicEntry]:
    """Full GD topic catalog: shipped entries plus teacher-authored ones."""
    del current_user
    from app.gd.room_manager import _load_topics

    custom_by_id = {row["id"]: row for row in custom_topics.list_topics()}
    return [
        TopicEntry(
            id=topic.id,
            title=topic.title,
            text=topic.text,
            category=topic.category,
            is_custom=custom_topics.is_custom(topic.id),
            created_by=(custom_by_id.get(topic.id) or {}).get("created_by"),
        )
        for topic in _load_topics()
    ]


@topics_router.post("", response_model=TopicEntry, status_code=201)
async def create_topic(
    body: CreateTopicRequest,
    current_user: User = Depends(require_teacher),
) -> TopicEntry:
    """Add a topic that students can be assigned in GD rooms."""
    from app.gd.room_manager import invalidate_topics_cache

    title = body.title.strip()
    text = body.text.strip()
    category = (body.category or "general").strip() or "general"
    if not title or not text:
        raise HTTPException(status_code=422, detail="title_and_text_required")

    record = custom_topics.add_topic(
        title=title,
        text=text,
        category=category,
        created_by=current_user.email,
    )
    # Rooms pick topics from the cached catalog, so refresh it now.
    invalidate_topics_cache()

    return TopicEntry(
        id=record["id"],
        title=record["title"],
        text=record["text"],
        category=record["category"],
        is_custom=True,
        created_by=record.get("created_by"),
    )


@topics_router.delete("/{topic_id}")
async def delete_topic(
    topic_id: str,
    current_user: User = Depends(require_teacher),
) -> dict:
    """Delete a teacher-authored topic. Shipped topics are read-only."""
    from app.gd.room_manager import invalidate_topics_cache

    if not custom_topics.is_custom(topic_id):
        raise HTTPException(status_code=403, detail="builtin_topic_readonly")

    if not custom_topics.delete_topic(topic_id):
        raise HTTPException(status_code=404, detail="topic_not_found")

    logger.info(f"Teacher {current_user.email} deleted GD topic {topic_id}")
    invalidate_topics_cache()
    return {"deleted": True, "id": topic_id}
