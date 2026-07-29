"""Admin sub-router for debate teacher-review workflows.

Mounted at ``/admin/debates`` alongside the existing ``admin_router``
(Requirement 16.2 forbids editing ``app/admin/`` beyond wiring). Every
handler is guarded by ``require_teacher`` — non-teachers hit the same
403 shape the pronunciation / interview admin routes return.

Endpoints:

- ``GET  /admin/debates?status=pending_review`` — list of completed
  debates that still have at least one turn without a teacher override.
- ``GET  /admin/debates/{debate_id}`` — full debate record + all turns.
- ``POST /admin/debates/{debate_id}/turns/{turn_id}/review`` — persist
  a teacher override score/comment and, if the override flips the
  standings, update the winner in place (Task 8.2).
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import User, require_teacher
from app.debate.schemas import (
    DebateRecord,
    DebateTurn,
    ParticipantInternal,
    TeacherReviewRequest,
)
from app.debate.scoring import compute_winner
from app.storage import custom_topics
from app.storage import debate_turns as debate_turns_store
from app.storage import debates as debates_store


logger = logging.getLogger("debate.admin")


router = APIRouter(prefix="/admin/debates", tags=["admin", "debate"])


# ---------------------------------------------------------------------------
# Local response shapes
# ---------------------------------------------------------------------------


class DebateSummary(BaseModel):
    """One row in ``GET /admin/debates``."""

    debate_id: str
    code: str
    motion_title: str
    completed_at: float
    # Turns whose ``teacher_override_score`` is still ``None``.
    pending_turns_count: int
    total_turns_count: int
    winner_participant_id: Optional[str] = None


class DebateDetail(BaseModel):
    """Response body for ``GET /admin/debates/{debate_id}``."""

    debate: DebateRecord
    turns: list[DebateTurn]


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DebateSummary])
async def list_debates(
    status: Optional[str] = None,
    current_user: User = Depends(require_teacher),
) -> list[DebateSummary]:
    """List debates for the admin panel.

    Currently only the ``pending_review`` filter is meaningful; any other
    value (or ``None``) falls back to the same pending list for MVP.
    Future filters can be added here without touching call sites.
    """
    if status == "pending_review":
        records = debates_store.list_pending_review_debates()
    else:
        records = debates_store.list_pending_review_debates()

    summaries: list[DebateSummary] = []
    for record in records:
        turns = debate_turns_store.list_turns_for_debate(record.debate_id)
        pending = sum(1 for t in turns if t.teacher_override_score is None)
        summaries.append(
            DebateSummary(
                debate_id=record.debate_id,
                code=record.code,
                motion_title=record.motion_title,
                completed_at=record.completed_at,
                pending_turns_count=pending,
                total_turns_count=len(turns),
                winner_participant_id=record.winner_participant_id,
            )
        )
    return summaries


@router.get("/{debate_id}", response_model=DebateDetail)
async def get_debate(
    debate_id: str,
    current_user: User = Depends(require_teacher),
) -> DebateDetail:
    record = debates_store.load_debate(debate_id)
    if record is None:
        raise HTTPException(status_code=404, detail="debate_not_found")
    turns = debate_turns_store.list_turns_for_debate(debate_id)
    return DebateDetail(debate=record, turns=turns)


@router.post(
    "/{debate_id}/turns/{turn_id}/review",
    response_model=DebateTurn,
)
async def review_turn(
    debate_id: str,
    turn_id: str,
    body: TeacherReviewRequest,
    current_user: User = Depends(require_teacher),
) -> DebateTurn:
    """Persist a teacher override for a single turn.

    Pydantic already enforces ``body.score ∈ [0, 100]`` via ``Field(ge=0,
    le=100)`` on ``TeacherReviewRequest`` — an out-of-range value raises
    ``ValidationError`` before this handler runs, which FastAPI turns
    into HTTP 422 with a body naming ``score`` (Req 10.6).
    """
    updated = debate_turns_store.apply_teacher_review(
        turn_id=turn_id,
        score=body.score,
        comment=body.comment,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="turn_not_found")

    # Task 8.2 — recompute the winner in case this override flips the
    # standings. We reconstruct minimal ``ParticipantInternal`` stubs
    # from the record's snapshot dicts; only ``participant_id`` is
    # consulted by ``compute_winner`` but pydantic still requires the
    # other fields, so we pass safe placeholders for those.
    record = debates_store.load_debate(debate_id)
    if record is None:
        return updated

    all_turns = debate_turns_store.list_turns_for_debate(debate_id)
    participants = [
        ParticipantInternal(
            participant_id=str(p.get("participant_id", "")),
            user_id=str(p.get("user_id", "")),
            user_email="",  # not consulted by compute_winner
            display_name=str(p.get("display_name", "")),
            joined_at=record.created_at,
            is_ready=True,
            turn_index=int(p.get("turn_index", 0)),
            is_forfeit=bool(p.get("is_forfeit", False)),
        )
        for p in record.participants
        if isinstance(p, dict)
    ]
    new_winner_id = compute_winner(all_turns, participants)
    if new_winner_id != record.winner_participant_id:
        debates_store.update_winner(debate_id, new_winner_id)

    return updated


# ---------------------------------------------------------------------------
# Motion catalog management (teacher-authored motions)
#
# Deliberately its own router/prefix: the review router already owns
# ``/admin/debates/{debate_id}``, which would swallow ``/admin/debates/motions``
# because FastAPI matches routes in registration order.
# ---------------------------------------------------------------------------

motions_router = APIRouter(prefix="/admin/debate-motions", tags=["admin", "debate"])


class MotionEntry(BaseModel):
    """One row in the motion catalog, with its provenance."""

    id: str
    title: str
    text: str
    is_custom: bool
    created_by: Optional[str] = None


class CreateMotionRequest(BaseModel):
    title: str = Field(min_length=4, max_length=120)
    text: str = Field(min_length=20, max_length=1000)


@motions_router.get("", response_model=List[MotionEntry])
async def list_motion_catalog(
    current_user: User = Depends(require_teacher),
) -> List[MotionEntry]:
    """Full motion catalog: shipped entries plus teacher-authored ones."""
    del current_user
    from app.debate.room_manager import _load_motions

    custom_by_id = {row["id"]: row for row in custom_topics.list_motions()}
    return [
        MotionEntry(
            id=motion.id,
            title=motion.title,
            text=motion.text,
            is_custom=custom_topics.is_custom(motion.id),
            created_by=(custom_by_id.get(motion.id) or {}).get("created_by"),
        )
        for motion in _load_motions()
    ]


@motions_router.post("", response_model=MotionEntry, status_code=201)
async def create_motion(
    body: CreateMotionRequest,
    current_user: User = Depends(require_teacher),
) -> MotionEntry:
    """Add a motion that students can be assigned in debate rooms."""
    from app.debate.room_manager import invalidate_motions_cache

    title = body.title.strip()
    text = body.text.strip()
    if not title or not text:
        raise HTTPException(status_code=422, detail="title_and_text_required")

    record = custom_topics.add_motion(
        title=title,
        text=text,
        created_by=current_user.email,
    )
    # Rooms pick motions from the cached catalog, so refresh it now.
    invalidate_motions_cache()

    return MotionEntry(
        id=record["id"],
        title=record["title"],
        text=record["text"],
        is_custom=True,
        created_by=record.get("created_by"),
    )


@motions_router.delete("/{motion_id}")
async def delete_motion(
    motion_id: str,
    current_user: User = Depends(require_teacher),
) -> dict:
    """Delete a teacher-authored motion. Shipped motions are read-only."""
    from app.debate.room_manager import invalidate_motions_cache

    if not custom_topics.is_custom(motion_id):
        raise HTTPException(status_code=403, detail="builtin_motion_readonly")

    if not custom_topics.delete_motion(motion_id):
        raise HTTPException(status_code=404, detail="motion_not_found")

    logger.info("Teacher %s deleted motion %s", current_user.email, motion_id)
    invalidate_motions_cache()
    return {"deleted": True, "id": motion_id}
