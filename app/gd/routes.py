"""HTTP + WebSocket routes for Group Discussion feature."""

from __future__ import annotations

import asyncio
import logging
from typing import List, Literal, Optional

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

from pydantic import BaseModel as PydanticBaseModel


class CreateGDRoomRequest(PydanticBaseModel):
    """Request body for POST /gd/rooms."""
    scoring_mode: Literal["instant", "detailed"] = "instant"

logger = logging.getLogger("gd.routes")

router = APIRouter(prefix="/gd", tags=["gd"])


# ---------------------------------------------------------------------------
# Room management
# ---------------------------------------------------------------------------

@router.post("/rooms", response_model=CreateGDRoomResponse)
async def create_room(
    body: CreateGDRoomRequest = CreateGDRoomRequest(),
    current_user: User = Depends(require_user),
) -> CreateGDRoomResponse:
    room = await gd_room_manager.create_room(current_user, scoring_mode=body.scoring_mode)
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
    """Background task to compute final scores using egress audio files."""
    try:
        room = gd_room_manager.get_state(code)
        if room is None:
            return
        
        # Wait for egress files to be written (they need time to flush)
        await asyncio.sleep(8.0)
        
        logger.info(f"GD scoring: processing egress audio for session {room.session_id}")
        
        # Import transcription + scoring
        from app.core.egress_client import egress_client
        from app.asr.whisper_service import transcribe_audio
        from app.audio.schemas import AudioAsset
        from app.fluency.service import build_fluency_section
        import os
        
        persisted_speeches: list = []
        
        # Process each participant's egress audio file
        for participant in room.participants:
            audio_path = egress_client.get_output_path(
                room.session_id, participant.participant_id
            )
            
            if not os.path.exists(audio_path):
                logger.warning(
                    f"No egress audio for {participant.display_name} at {audio_path}"
                )
                # Fall back to any PTT speeches that might exist
                ptts = gd_speeches_store.list_speeches_for_participant(
                    room.session_id, participant.participant_id
                )
                if ptts:
                    persisted_speeches.extend(ptts)
                continue
            
            # Transcribe the full audio
            try:
                transcription = transcribe_audio(audio_path)
                transcript_text = transcription.text if transcription else ""
                
                if not transcript_text.strip():
                    logger.info(f"Empty transcript for {participant.display_name}")
                    continue
                
                # Get audio duration
                import subprocess
                result = subprocess.run(
                    ["ffprobe", "-v", "quiet", "-show_entries", 
                     "format=duration", "-of", "csv=p=0", audio_path],
                    capture_output=True, text=True, timeout=10
                )
                duration = float(result.stdout.strip()) if result.stdout.strip() else 0.0
                
                # Compute fluency (clarity/WPM) from the transcript + duration.
                # Without this, the communication sub-score stays at 0.
                fluency_score = None
                try:
                    audio_asset = AudioAsset(
                        audio_id=f"egress_{participant.participant_id}",
                        original_path=audio_path,
                        duration_seconds=duration,
                        sample_rate=48000,
                        channels=1,
                        format="ogg",
                    )
                    fluency = build_fluency_section(
                        transcription=transcription,
                        audio_asset=audio_asset,
                    )
                    fluency_score = fluency.clarity_score
                    logger.info(
                        f"Fluency for {participant.display_name}: "
                        f"clarity={fluency_score}, wpm={fluency.words_per_minute}"
                    )
                except Exception as exc:
                    logger.warning(
                        f"Fluency computation failed for {participant.display_name}: "
                        f"{type(exc).__name__}: {exc}"
                    )
                
                # Create a single speech record for this participant
                speech_record = GDSpeechRecord(
                    speech_id=f"egress_{participant.participant_id}",
                    session_id=room.session_id,
                    participant_id=participant.participant_id,
                    display_name=participant.display_name,
                    started_at=room.scoring_started_at - duration if room.scoring_started_at else 0,
                    ended_at=room.scoring_started_at or 0,
                    duration_seconds=duration,
                    audio_ref=audio_path,
                    transcript=transcript_text,
                    analysis_id=None,
                    pronunciation_score=None,
                    fluency_score=fluency_score,
                    is_interruption=False,
                )
                gd_speeches_store.save_speech(speech_record)
                persisted_speeches.append(speech_record)
                
                # Update participant stats
                participant.speech_count = 1
                participant.total_speak_seconds = duration
                
                logger.info(
                    f"Transcribed {participant.display_name}: "
                    f"{len(transcript_text)} chars, {duration:.1f}s"
                )
                
            except Exception as exc:
                logger.error(
                    f"Failed to transcribe egress for {participant.display_name}: "
                    f"{type(exc).__name__}: {exc}"
                )
        
        # Also include any PTT speeches that were recorded
        ptt_speeches = gd_speeches_store.list_speeches_for_session(room.session_id)
        for ptt in ptt_speeches:
            if not any(s.speech_id == ptt.speech_id for s in persisted_speeches):
                persisted_speeches.append(ptt)
        
        logger.info(f"GD scoring: {len(persisted_speeches)} total speech records")
        
        # Compute scores
        scores = await compute_final_scores(room, persisted_speeches)
        
        # Persist session
        import time as time_mod
        session_record = GDSessionRecord(
            session_id=room.session_id,
            code=room.code,
            topic_id=room.topic_id,
            topic_title=room.topic_title,
            topic_text=room.topic_text,
            scoring_mode=room.scoring_mode,
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
            completed_at=time_mod.time(),
        )
        gd_sessions_store.save_session(session_record)
        
        # Store scores on room and finalize
        await gd_room_manager.finalize_scores(code, scores)
        
        logger.info(f"GD scoring complete for {code}: {len(scores)} participants")

        # If detailed mode, spawn background pronunciation re-scoring
        if room.scoring_mode == "detailed":
            asyncio.create_task(
                _run_detailed_pronunciation_gd(code, room.session_id, persisted_speeches, scores)
            )
    except Exception as exc:
        logger.error(f"GD scoring failed for {code}: {type(exc).__name__}: {exc}")
        import traceback
        traceback.print_exc()


def _resolve_speech_audio_path(audio_ref: str) -> Optional[str]:
    """Resolve a speech's audio_ref to a WAV file the pronunciation model can read.

    Handles two shapes of `audio_ref`:
      * An absolute path to an egress recording (``/opt/livekit/egress-out/x.ogg``)
        — transcoded to 16 kHz mono WAV, since the phoneme model needs WAV.
      * A bare audio_id from the older push-to-talk flow — looked up under
        ``uploads/`` then ``temp/``.

    Returns the WAV path, or None when nothing usable exists.
    """
    import os
    import subprocess

    # Case 1: egress recording (absolute path, non-WAV container)
    if os.path.isabs(audio_ref) and os.path.exists(audio_ref):
        if audio_ref.lower().endswith(".wav"):
            return audio_ref
        wav_path = os.path.splitext(audio_ref)[0] + ".wav"
        if os.path.exists(wav_path):
            return wav_path
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", audio_ref,
                    "-ar", "16000", "-ac", "1",
                    wav_path,
                ],
                capture_output=True,
                timeout=120,
                check=True,
            )
            return wav_path
        except Exception as exc:  # noqa: BLE001 - fall through to None
            logger.warning(
                f"ffmpeg transcode failed for {audio_ref}: {type(exc).__name__}: {exc}"
            )
            return None

    # Case 2: legacy push-to-talk audio_id
    for candidate in (f"uploads/{audio_ref}.wav", f"temp/{audio_ref}.wav"):
        if os.path.exists(candidate):
            return candidate

    return None


async def _run_detailed_pronunciation_gd(
    code: str,
    session_id: str,
    persisted_speeches: list,
    scores: list,
) -> None:
    """Background task: run pronunciation on GD speeches and recompute communication scores."""
    from app.pronunciation.service import assess_pronunciation
    from app.asr.schemas import TranscriptionResult
    from app.gd.scoring import compute_communication_score

    try:
        await asyncio.sleep(2.0)
        logger.info(f"GD detailed scoring: starting pronunciation for session {session_id}")

        # Group speeches by participant
        speeches_by_pid: dict[str, list] = {}
        for sp in persisted_speeches:
            speeches_by_pid.setdefault(sp.participant_id, []).append(sp)

        # For each participant's speeches, run pronunciation assessment
        updated_comm_scores: dict[str, float] = {}
        for pid, speeches in speeches_by_pid.items():
            pron_scores_for_pid = []
            for speech in speeches:
                if not speech.audio_ref:
                    continue

                import os

                audio_path = _resolve_speech_audio_path(speech.audio_ref)
                if audio_path is None:
                    logger.warning(
                        f"GD detailed: could not resolve audio for speech "
                        f"{speech.speech_id} (ref={speech.audio_ref})"
                    )
                    continue

                try:
                    transcription = TranscriptionResult(
                        text=speech.transcript or "",
                        words=[],
                        provider="cached",
                        language="en",
                    )
                    pronunciation = assess_pronunciation(
                        audio_path=audio_path,
                        expected_text=speech.transcript,
                        transcription=transcription,
                    )
                    if pronunciation.available and pronunciation.overall_score is not None:
                        pron_scores_for_pid.append(pronunciation.overall_score)
                        # Update the speech record too
                        speech.pronunciation_score = pronunciation.overall_score
                        gd_speeches_store.save_speech(speech)
                except Exception as exc:
                    logger.warning(
                        f"GD detailed pron failed for speech {speech.speech_id}: {type(exc).__name__}"
                    )

            # Recompute communication score with real pronunciation
            if pron_scores_for_pid:
                avg_pron = sum(pron_scores_for_pid) / len(pron_scores_for_pid)
                fluency_scores = [s.fluency_score for s in speeches if s.fluency_score is not None]
                avg_fluency = sum(fluency_scores) / len(fluency_scores) if fluency_scores else None

                if avg_fluency is not None:
                    comm = round((avg_pron + avg_fluency) / 2.0 / 100.0 * 20.0, 2)
                else:
                    comm = round(avg_pron / 100.0 * 20.0, 2)
                updated_comm_scores[pid] = comm

        # Recompute total scores with updated communication
        session = gd_sessions_store.get_session(session_id)
        if session is not None:
            for score in session.scores:
                if score.participant_id in updated_comm_scores:
                    old_comm = score.communication
                    new_comm = updated_comm_scores[score.participant_id]
                    # Recalculate total: replace old communication with new
                    new_total = score.total_score - old_comm + new_comm
                    new_total = round(min(100.0, max(0.0, new_total)), 2)
                    score.full_total_score = new_total
                    score.full_score_ready = True
                else:
                    # No pronunciation data available, keep instant score
                    score.full_total_score = score.total_score
                    score.full_score_ready = True

            # Must upsert, not append — `get_session` reads the first matching
            # row, so an appended duplicate would never be seen.
            gd_sessions_store.upsert_session(session)
            logger.info(f"GD detailed scoring complete for {code}")

    except Exception as exc:
        logger.error(f"GD detailed scoring failed for {code}: {type(exc).__name__}: {exc}")
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
        scoring_mode=session.scoring_mode,
    )


@router.get("/sessions/{session_id}", response_model=GDResultsResponse)
async def get_session_detail(
    session_id: str,
    current_user: User = Depends(require_user),
) -> GDResultsResponse:
    """Return a completed GD's full result, read from the durable store.

    Unlike `/rooms/{code}/results` this does not require the in-memory room to
    still exist, so it powers the My Performance history detail view. The
    caller must have participated in the session (or be a teacher).
    """
    session = gd_sessions_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session_not_found")

    is_teacher = getattr(current_user, "role", "") in ("teacher", "admin")
    is_participant = any(
        isinstance(p, dict) and p.get("user_id") == current_user.uid
        for p in session.participants
    )
    if not (is_teacher or is_participant):
        raise HTTPException(status_code=403, detail="not_authorized")

    duration = (
        (session.completed_at - session.created_at) if session.completed_at else 0.0
    )

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
        scoring_mode=session.scoring_mode,
    )


@router.get("/rooms/{code}/full-scores")
async def get_full_scores(
    code: str,
    current_user: User = Depends(require_user),
):
    """Return full (detailed) scores once pronunciation scoring is complete.

    Returns 202 if scoring is still in progress, 200 with full scores when ready.
    """
    normalized = code.strip().upper()
    room = gd_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    if room.scoring_mode != "detailed":
        raise HTTPException(status_code=400, detail="not_detailed_mode")

    session = gd_sessions_store.get_session(room.session_id)
    if session is None:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "processing", "message": "Full scores still computing."},
        )

    all_ready = all(s.full_score_ready for s in session.scores)
    if not all_ready:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "processing", "message": "Full scores still computing."},
        )

    results = []
    for s in session.scores:
        results.append({
            "participant_id": s.participant_id,
            "display_name": s.display_name,
            "total_score": s.total_score,
            "full_total_score": s.full_total_score,
            "full_score_ready": s.full_score_ready,
        })
    return {"status": "ready", "scores": results}


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
