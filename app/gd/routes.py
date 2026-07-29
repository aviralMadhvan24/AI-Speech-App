"""HTTP + WebSocket routes for Group Discussion feature."""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)

from app.auth import User, require_user, verify_token_string
from app.core.livekit_client import livekit
from app.gd.room_manager import _load_topics, gd_room_manager
from app.gd.schemas import (
    CreateGDRoomResponse,
    EndDiscussionResponse,
    EndSpeechResponse,
    GDResultsResponse,
    GDSessionRecord,
    GDSpeechRecord,
    GDTopic,
    GDTopicPublic,
    JoinGDRoomResponse,
    PublicGDRoom,
    ReadyGDResponse,
    StartSpeechResponse,
    to_public,
)
from app.gd.scoring import compute_final_scores
from app.gd.service import analyze_speech_audio
from app.storage import gd_sessions as gd_sessions_store
from app.storage import gd_speeches as gd_speeches_store

logger = logging.getLogger("gd.routes")

router = APIRouter(prefix="/gd", tags=["gd"])


# ---------------------------------------------------------------------------
# Room management
# ---------------------------------------------------------------------------

@router.post("/rooms", response_model=CreateGDRoomResponse)
async def create_room(current_user: User = Depends(require_user)) -> CreateGDRoomResponse:
    room = await gd_room_manager.create_room(current_user)
    first = room.participants[0]
    return CreateGDRoomResponse(
        room_code=room.code,
        participant_id=first.participant_id,
        state=to_public(room),
    )


@router.post("/rooms/{code}/join", response_model=JoinGDRoomResponse)
async def join_room(
    code: str,
    current_user: User = Depends(require_user),
) -> JoinGDRoomResponse:
    normalized = code.strip().upper()
    room = await gd_room_manager.join_room(normalized, current_user)
    participant = next(
        (p for p in room.participants if p.user_id == current_user.uid),
        None,
    )
    if participant is None:
        raise HTTPException(status_code=500, detail="participant_missing")
    return JoinGDRoomResponse(
        room_code=room.code,
        participant_id=participant.participant_id,
        state=to_public(room),
    )


@router.post("/rooms/{code}/ready", response_model=ReadyGDResponse)
async def flip_ready(
    code: str,
    current_user: User = Depends(require_user),
) -> ReadyGDResponse:
    normalized = code.strip().upper()
    room = await gd_room_manager.flip_ready(normalized, current_user)
    return ReadyGDResponse(state=to_public(room))


@router.get("/rooms/{code}", response_model=PublicGDRoom)
async def get_room(
    code: str,
    current_user: User = Depends(require_user),
) -> PublicGDRoom:
    normalized = code.strip().upper()
    room = gd_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    return to_public(room)


# ---------------------------------------------------------------------------
# LiveKit Audio Token
# ---------------------------------------------------------------------------

@router.get("/rooms/{code}/livekit-token")
async def get_livekit_token(
    code: str,
    current_user: User = Depends(require_user),
) -> dict:
    """Get LiveKit access token for joining audio room."""
    normalized = code.strip().upper()
    room = gd_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    
    # Find participant
    participant = next(
        (p for p in room.participants if p.user_id == current_user.uid),
        None,
    )
    if participant is None:
        raise HTTPException(status_code=403, detail="not_a_participant")
    
    # Check if LiveKit is configured
    if not livekit.is_available:
        raise HTTPException(status_code=503, detail="livekit_not_configured")
    
    # Check if room has LiveKit room set
    if not room.livekit_room:
        raise HTTPException(status_code=400, detail="audio_not_ready")
    
    # Generate token
    token = livekit.create_token(
        room_name=room.livekit_room,
        participant_name=participant.display_name,
        participant_identity=participant.participant_id,
        ttl_seconds=3600,  # 1 hour
    )
    
    if not token:
        raise HTTPException(status_code=500, detail="token_generation_failed")
    
    return {
        "token": token,
        "url": livekit.url,
        "room": room.livekit_room,
    }


# ---------------------------------------------------------------------------
# Push-to-Talk speech
# ---------------------------------------------------------------------------

@router.post("/rooms/{code}/speech/start", response_model=StartSpeechResponse)
async def start_speech(
    code: str,
    current_user: User = Depends(require_user),
) -> StartSpeechResponse:
    """Called when user presses PTT button - registers speech start."""
    normalized = code.strip().upper()
    try:
        speech, is_interruption = await gd_room_manager.start_speech(normalized, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    
    return StartSpeechResponse(
        speech_id=speech.speech_id,
        started_at=speech.started_at,
        is_interruption=is_interruption,
        concurrent_speakers=speech.concurrent_speakers,
    )


@router.post("/rooms/{code}/speech/{speech_id}/end", response_model=EndSpeechResponse)
async def end_speech(
    code: str,
    speech_id: str,
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_user),
) -> EndSpeechResponse:
    """Called when user releases PTT button - uploads audio and marks speech end."""
    normalized = code.strip().upper()
    room = gd_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    
    audio_ref = None
    transcript = None
    analysis_id = None
    audio_uploaded = False
    
    # Analyze the audio if provided
    if file is not None and file.filename:
        try:
            audio_asset, transcription, pronunciation, fluency, analysis_id = (
                await analyze_speech_audio(file=file, user=current_user)
            )
            audio_ref = audio_asset.audio_id
            transcript = transcription.text
            audio_uploaded = True
            
            # Persist speech record
            speech_internal = next(
                (s for s in room.speeches if s.speech_id == speech_id),
                None,
            )
            if speech_internal:
                import time
                now = time.time()
                duration = now - speech_internal.started_at
                
                # Get pronunciation and fluency scores
                pron_score = pronunciation.overall_score if pronunciation and pronunciation.available else None
                fluency_score = fluency.clarity_score if fluency else None
                
                speech_record = GDSpeechRecord(
                    speech_id=speech_id,
                    session_id=room.session_id,
                    participant_id=speech_internal.participant_id,
                    display_name=speech_internal.display_name,
                    started_at=speech_internal.started_at,
                    ended_at=now,
                    duration_seconds=duration,
                    audio_ref=audio_ref,
                    transcript=transcript,
                    analysis_id=analysis_id,
                    pronunciation_score=pron_score,
                    fluency_score=fluency_score,
                    is_interruption=speech_internal.is_interruption,
                )
                gd_speeches_store.save_speech(speech_record)
        except Exception as exc:
            logger.warning(f"GD speech analysis failed: {type(exc).__name__}: {exc}")
    
    # Update room state
    speech = await gd_room_manager.end_speech(
        code=normalized,
        user=current_user,
        speech_id=speech_id,
        audio_ref=audio_ref,
        transcript=transcript,
        analysis_id=analysis_id,
    )
    
    updated_room = gd_room_manager.get_state(normalized)
    return EndSpeechResponse(
        speech_id=speech_id,
        duration_seconds=speech.duration_seconds if speech else 0.0,
        audio_uploaded=audio_uploaded,
        state=to_public(updated_room) if updated_room else to_public(room),
    )


# ---------------------------------------------------------------------------
# Discussion end and scoring
# ---------------------------------------------------------------------------

@router.post("/rooms/{code}/end", response_model=EndDiscussionResponse)
async def end_discussion_manually(
    code: str,
    current_user: User = Depends(require_user),
) -> EndDiscussionResponse:
    """End discussion manually - host only, starts scoring."""
    normalized = code.strip().upper()
    room = gd_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    
    # Verify caller is a participant
    participant = next(
        (p for p in room.participants if p.user_id == current_user.uid),
        None,
    )
    if participant is None:
        raise HTTPException(status_code=403, detail="not_a_participant")

    # Only the room creator may end the discussion for everyone.
    if not participant.is_host:
        raise HTTPException(status_code=403, detail="host_only")
    
    await gd_room_manager.end_discussion(normalized)
    
    # Kick off scoring in background
    asyncio.create_task(_run_scoring(normalized))
    
    updated_room = gd_room_manager.get_state(normalized)
    return EndDiscussionResponse(
        state=to_public(updated_room) if updated_room else to_public(room),
        total_speeches=len(room.speeches),
    )


async def _run_scoring(code: str) -> None:
    """Background task to compute final scores."""
    try:
        room = gd_room_manager.get_state(code)
        if room is None:
            return
        
        # Wait a moment for any pending speech uploads to complete
        await asyncio.sleep(3.0)
        
        # Get persisted speeches
        persisted_speeches = gd_speeches_store.list_speeches_for_session(room.session_id)
        
        logger.info(f"GD scoring: {len(persisted_speeches)} persisted speeches for session {room.session_id}")
        
        # Recalculate participant stats from persisted speeches (more accurate than in-memory)
        speech_stats: dict[str, dict] = {}
        for speech in persisted_speeches:
            pid = speech.participant_id
            if pid not in speech_stats:
                speech_stats[pid] = {"count": 0, "total_seconds": 0.0}
            speech_stats[pid]["count"] += 1
            speech_stats[pid]["total_seconds"] += speech.duration_seconds or 0.0
        
        # Update room participant stats from persisted data
        for p in room.participants:
            stats = speech_stats.get(p.participant_id, {"count": 0, "total_seconds": 0.0})
            logger.info(f"Participant {p.display_name}: in-memory count={p.speech_count}, persisted count={stats['count']}")
            p.speech_count = stats["count"]
            p.total_speak_seconds = stats["total_seconds"]
        
        # Compute scores
        scores = await compute_final_scores(room, persisted_speeches)
        
        # Persist session
        import time
        session_record = GDSessionRecord(
            session_id=room.session_id,
            code=room.code,
            topic_id=room.topic_id,
            topic_title=room.topic_title,
            topic_text=room.topic_text,
            participants=[
                {
                    "participant_id": p.participant_id,
                    "user_id": p.user_id,
                    "display_name": p.display_name,
                    "speech_count": p.speech_count,
                    "total_speak_seconds": p.total_speak_seconds,
                }
                for p in room.participants
            ],
            speech_ids=[s.speech_id for s in persisted_speeches],
            scores=scores,
            created_at=room.created_at,
            completed_at=time.time(),
        )
        gd_sessions_store.save_session(session_record)
        
        # Store scores on room and finalize
        await gd_room_manager.finalize_scores(code, scores)
        
        logger.info(f"GD scoring complete for {code}: {len(scores)} participants")
    except Exception as exc:
        logger.error(f"GD scoring failed for {code}: {type(exc).__name__}: {exc}")
        import traceback
        traceback.print_exc()


@router.get("/rooms/{code}/results", response_model=GDResultsResponse)
async def get_results(
    code: str,
    current_user: User = Depends(require_user),
) -> GDResultsResponse:
    """Get GD results (must be in complete state)."""
    normalized = code.strip().upper()
    room = gd_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    
    if room.state not in ("complete", "scoring"):
        raise HTTPException(status_code=409, detail="results_not_ready")
    
    # Get from persistence
    session = gd_sessions_store.get_session(room.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    
    duration = (session.completed_at - session.created_at) if session.completed_at else 0.0
    
    return GDResultsResponse(
        session_id=session.session_id,
        code=session.code,
        topic=GDTopicPublic(
            id=session.topic_id,
            title=session.topic_title,
            text=session.topic_text,
            category="general",
        ),
        scores=session.scores,
        total_speeches=len(session.speech_ids),
        duration_seconds=duration,
    )


# ---------------------------------------------------------------------------
# Topics
# ---------------------------------------------------------------------------

@router.get("/topics", response_model=List[GDTopic])
async def list_topics(current_user: User = Depends(require_user)) -> List[GDTopic]:
    return _load_topics()


# ---------------------------------------------------------------------------
# My GD History
# ---------------------------------------------------------------------------

@router.get("/my-sessions")
async def my_sessions(current_user: User = Depends(require_user)):
    """Return user's GD session history."""
    sessions = gd_sessions_store.list_sessions_for_user(current_user.uid)
    result = []
    for s in sessions:
        # Find caller's score
        my_score = next(
            (score for score in s.scores 
             if any(p.get("participant_id") == score.participant_id 
                    and p.get("user_id") == current_user.uid 
                    for p in s.participants)),
            None,
        )
        result.append({
            "session_id": s.session_id,
            "code": s.code,
            "topic_title": s.topic_title,
            "completed_at": s.completed_at,
            "total_score": my_score.total_score if my_score else None,
            "rank": my_score.rank if my_score else None,
            "total_participants": len(s.scores),
        })
    return result


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@router.websocket("/ws/{code}")
async def gd_websocket(
    websocket: WebSocket,
    code: str,
    participant_id: str = Query(...),
    id_token: str = Query(default=""),
) -> None:
    try:
        user = verify_token_string(id_token)
    except HTTPException:
        await websocket.close(code=4401)
        return
    except Exception:
        await websocket.close(code=4401)
        return
    
    normalized = code.strip().upper()
    room = gd_room_manager.get_state(normalized)
    if room is None:
        await websocket.close(code=4404)
        return
    
    participant = next(
        (
            p for p in room.participants
            if p.participant_id == participant_id and p.user_id == user.uid
        ),
        None,
    )
    if participant is None:
        await websocket.close(code=4401)
        return
    
    await websocket.accept()
    await gd_room_manager.attach_socket(normalized, participant_id, websocket)
    
    # Send initial state
    try:
        await websocket.send_json({
            "type": "state",
            "state": to_public(room).model_dump(),
        })
    except Exception:
        await gd_room_manager.detach_socket(normalized, participant_id, websocket)
        return
    
    try:
        while True:
            raw = await websocket.receive_json()
            if isinstance(raw, dict) and raw.get("type") == "ping":
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:
                    pass
    except WebSocketDisconnect:
        await gd_room_manager.detach_socket(normalized, participant_id, websocket)
    except Exception as exc:
        logger.warning(f"GD ws error code={normalized} err={type(exc).__name__}")
        await gd_room_manager.detach_socket(normalized, participant_id, websocket)
