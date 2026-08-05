"""HTTP + WebSocket routes for the group-debate feature.

Endpoints (prefix ``/debate``):

- POST   /debate/rooms                    → create room (random motion)
- POST   /debate/rooms/{code}/join        → join existing room
- POST   /debate/rooms/{code}/ready       → toggle ready flag
- POST   /debate/rooms/{code}/turn        → upload turn audio (multipart)
- GET    /debate/rooms/{code}             → fetch public room state
- GET    /debate/rooms/{code}/audio/{turn_id} → serve turn audio file
- GET    /debate/motions                  → list catalog of motions
- GET    /debate/my-debates               → completed debates for caller
- WS     /debate/ws/{code}                → live state stream + keepalive

Room state mutation is delegated to ``debate_room_manager``. This module
is thin: it validates auth, unpacks arguments, and translates the
manager's ``ValueError`` sentinels into HTTP status codes.
"""

from __future__ import annotations

import logging
from typing import List, Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel

from app.auth import User, require_user, verify_token_string
from app.core.livekit_client import livekit
from app.debate.audio_store import get_audio_store
from app.debate.room_manager import _load_motions, debate_room_manager
from app.debate.schemas import (
    CreateRoomResponse,
    DebateDetailResponse,
    DebateRecord,
    DebateTurn,
    DebateTurnAudioRef,
    JoinRoomResponse,
    Motion,
    PublicDebateRoom,
    ReadyResponse,
    TurnUploadResponse,
    to_public,
)
from app.debate.service import analyze_turn_audio
from app.storage import debate_turns as debate_turns_store
from app.storage import debates as debates_store


logger = logging.getLogger("debate.routes")

router = APIRouter(prefix="/debate", tags=["debate"])


# ---------------------------------------------------------------------------
# Local response shapes
# ---------------------------------------------------------------------------


class MyDebateEntry(BaseModel):
    """One row in the ``GET /debate/my-debates`` response.

    Projects a ``DebateRecord`` down to just the caller-relevant fields
    (their turn's scores, plus room-level winner + motion). Kept local
    to this module so schemas.py stays untouched.
    """

    debate_id: str
    code: str
    motion: Motion
    completed_at: float
    ai_score: Optional[float] = None
    teacher_override_score: Optional[int] = None
    teacher_comment: Optional[str] = None
    winner_participant_id: Optional[str] = None
    # Per-turn audio references + speaker labels for post-debate playback.
    # PII-safe (no email/uid); ordered by ascending turn_index.
    turn_audio: list[DebateTurnAudioRef] = []


# ---------------------------------------------------------------------------
# Audio-reference helpers
# ---------------------------------------------------------------------------


def _turn_audio_for_record(record: DebateRecord) -> list[DebateTurnAudioRef]:
    """Return the ordered per-turn audio references for a completed debate.

    Prefers the self-contained ``record.turn_audio`` populated at finalize.
    Falls back to projecting the persisted turns (for older records written
    before ``turn_audio`` existed), labelling each turn from the record's
    participant snapshot. Always ordered by ascending ``turn_index`` and
    PII-safe (no email / uid).
    """
    if record.turn_audio:
        return sorted(record.turn_audio, key=lambda ref: ref.turn_index)

    name_by_pid: dict[str, str] = {}
    for participant in record.participants:
        if isinstance(participant, dict):
            pid = participant.get("participant_id")
            if pid is not None:
                name_by_pid[pid] = participant.get("display_name") or "Speaker"

    turns = debate_turns_store.list_turns_for_debate(record.debate_id)
    refs = [
        DebateTurnAudioRef(
            turn_index=turn.turn_index,
            participant_id=turn.participant_id,
            display_name=name_by_pid.get(turn.participant_id, "Speaker"),
            audio_url=turn.audio_url,
            is_forfeit=turn.forfeit_reason is not None,
        )
        for turn in turns
    ]
    refs.sort(key=lambda ref: ref.turn_index)
    return refs


def _may_access_debate_audio(user: User, *, code: str, turn: DebateTurn) -> bool:
    """Return ``True`` iff ``user`` may access ``turn``'s audio.

    Teachers/admins may review any student audio. Otherwise the caller must be
    a participant of the turn's *own* ``debate_id`` — evaluated against the
    turn's stored ``debate_id``, never the path ``code`` — so a caller cannot
    fetch another debate's audio by swapping the path code.
    """
    if getattr(user, "is_teacher", False) or getattr(user, "role", "") in (
        "teacher",
        "admin",
    ):
        return True

    # Live room: must be a current participant.
    room = debate_room_manager.get_state(code)
    if room is not None:
        return any(p.user_id == user.uid for p in room.participants)

    # Completed/evicted room: must appear in the persisted participant snapshot,
    # resolved against the turn's own debate_id.
    record = debates_store.load_debate(turn.debate_id)
    if record is not None:
        return any(
            isinstance(p, dict) and p.get("user_id") == user.uid
            for p in record.participants
        )
    return False


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------


class CreateDebateRoomRequest(BaseModel):
    """Request body for POST /debate/rooms."""
    scoring_mode: Literal["instant", "detailed"] = "instant"
    # Motion chosen by the creator. Omit to get a random one from the catalog.
    motion_id: Optional[str] = None


@router.post("/rooms", response_model=CreateRoomResponse)
async def create_room(
    body: CreateDebateRoomRequest = CreateDebateRoomRequest(),
    current_user: User = Depends(require_user),
) -> CreateRoomResponse:
    room = await debate_room_manager.create_room(
        current_user,
        scoring_mode=body.scoring_mode,
        motion_id=body.motion_id,
    )
    first = room.participants[0]
    return CreateRoomResponse(
        room_code=room.code,
        participant_id=first.participant_id,
        state=to_public(room),
    )


@router.post("/rooms/{code}/join", response_model=JoinRoomResponse)
async def join_room(
    code: str,
    current_user: User = Depends(require_user),
) -> JoinRoomResponse:
    normalized = code.strip().upper()
    room = await debate_room_manager.join_room(normalized, current_user)
    participant = next(
        (p for p in room.participants if p.user_id == current_user.uid),
        None,
    )
    if participant is None:
        # Should never happen — join_room either raises or appends.
        raise HTTPException(status_code=500, detail="participant_missing")
    return JoinRoomResponse(
        room_code=room.code,
        participant_id=participant.participant_id,
        state=to_public(room),
    )


@router.post("/rooms/{code}/ready", response_model=ReadyResponse)
async def flip_ready(
    code: str,
    current_user: User = Depends(require_user),
) -> ReadyResponse:
    normalized = code.strip().upper()
    room = await debate_room_manager.flip_ready(normalized, current_user)
    return ReadyResponse(state=to_public(room))


@router.post("/rooms/{code}/turn", response_model=TurnUploadResponse)
async def upload_turn(
    code: str,
    file: UploadFile = File(...),
    current_user: User = Depends(require_user),
) -> TurnUploadResponse:
    normalized = code.strip().upper()
    room = debate_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    if room.paused:
        raise HTTPException(status_code=409, detail="debate_paused")
    if room.state != "speaking":
        raise HTTPException(status_code=409, detail="not_in_speaking_state")
    participant = next(
        (p for p in room.participants if p.user_id == current_user.uid),
        None,
    )
    if participant is None:
        raise HTTPException(status_code=403, detail="not_a_participant")
    if participant.turn_index != room.active_turn_index:
        raise HTTPException(status_code=409, detail="not_your_turn")

    # Run the /analyze pipeline. This is the slow step (Whisper); no
    # room lock is held here so concurrent uploads to other rooms proceed
    # in parallel. Out-of-turn uploads were already rejected above.
    try:
        audio_asset, transcription, pronunciation, fluency, analysis_id = (
            await analyze_turn_audio(file=file, user=current_user)
        )
    except Exception as exc:  # noqa: BLE001 — defensive: pipeline failure
        logger.warning(
            "debate_analyze_failed room=%s user=%s err=%s",
            normalized,
            current_user.email,
            type(exc).__name__,
        )
        raise HTTPException(status_code=502, detail="analysis_failed")

    try:
        turn, updated_room = await debate_room_manager.submit_turn(
            code=normalized,
            user=current_user,
            audio_asset=audio_asset,
            transcription=transcription,
            pronunciation=pronunciation,
            fluency=fluency,
            analysis_id=analysis_id,
        )
    except ValueError as exc:
        # e.g. state changed between the pre-check and now
        # (paused / not_your_turn race).
        raise HTTPException(status_code=409, detail=str(exc))

    return TurnUploadResponse(
        turn_id=turn.turn_id,
        ai_score=turn.ai_score,
        scoring_unavailable=turn.scoring_unavailable,
        analysis_id=turn.analysis_id,
        audio_url=turn.audio_url,
        content_score=turn.content_score,
        content_feedback=turn.content_feedback,
        score_breakdown=turn.score_breakdown,
        state=to_public(updated_room),
    )


@router.get("/rooms/{code}/livekit-token")
async def get_livekit_token(
    code: str,
    current_user: User = Depends(require_user),
) -> dict:
    """Issue a LiveKit access token for live debate audio.

    Mirrors the GD token endpoint exactly: membership + configuration +
    room-readiness checks with the same status-code contract. The
    participant is identified by the opaque ``participant_id`` only — the
    response carries no email / uid (Requirement 4.4).
    """
    normalized = code.strip().upper()
    room = debate_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")

    participant = next(
        (p for p in room.participants if p.user_id == current_user.uid),
        None,
    )
    if participant is None:
        raise HTTPException(status_code=403, detail="not_a_participant")

    if not livekit.is_available:
        raise HTTPException(status_code=503, detail="livekit_not_configured")

    if not room.livekit_room:
        raise HTTPException(status_code=400, detail="audio_not_ready")

    token = livekit.create_token(
        room_name=room.livekit_room,
        participant_name=participant.display_name,
        participant_identity=participant.participant_id,
        ttl_seconds=3600,
    )
    if not token:
        raise HTTPException(status_code=500, detail="token_generation_failed")

    return {"token": token, "url": livekit.url, "room": room.livekit_room}


@router.get("/rooms/{code}/audio/{turn_id}")
async def get_turn_audio(
    code: str,
    turn_id: str,
    current_user: User = Depends(require_user),
):
    """Serve the audio blob for a specific turn.

    Access is restricted to participants of the turn's own debate and to
    teachers/admins. The turn is resolved directly (works for live,
    completed, and evicted rooms), access is evaluated against the turn's
    stored ``debate_id`` (never the path ``code``), and the bytes are
    served through the storage abstraction — a ``302`` to a signed URL when
    an object-storage backend is active, otherwise a local stream.
    """
    normalized = code.strip().upper()

    # 1) Resolve the turn (works for live, completed, and evicted rooms).
    turn = debate_turns_store.load_turn(turn_id)
    if turn is None or not turn.audio_key:
        raise HTTPException(status_code=404, detail="audio_not_available")

    # 2) Access control: participant of THIS debate OR a teacher/admin.
    if not _may_access_debate_audio(current_user, code=normalized, turn=turn):
        raise HTTPException(status_code=403, detail="not_authorized")

    # 3) Serve via the storage abstraction.
    store = get_audio_store()
    if not store.exists(turn.audio_key):
        raise HTTPException(status_code=404, detail="audio_file_not_found")

    signed = store.signed_url(turn.audio_key, ttl_seconds=300)
    if signed:  # object-storage future: redirect to an expiring URL
        return RedirectResponse(url=signed, status_code=302)

    stream, content_type = store.open(turn.audio_key)
    return StreamingResponse(
        stream,
        media_type=turn.audio_content_type or content_type or "audio/webm",
        headers={
            "Content-Disposition": (
                f'inline; filename="turn_{turn.turn_index + 1}.webm"'
            )
        },
    )


@router.get("/rooms/{code}", response_model=PublicDebateRoom)
async def get_room(
    code: str,
    current_user: User = Depends(require_user),
) -> PublicDebateRoom:
    normalized = code.strip().upper()
    room = debate_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    return to_public(room)


@router.get("/rooms/{code}/full-scores")
async def get_full_scores(
    code: str,
    current_user: User = Depends(require_user),
):
    """Return full (detailed) scores once pronunciation scoring is complete.

    Returns 202 if scoring is still in progress, 200 with full scores when ready.
    """
    normalized = code.strip().upper()
    room = debate_room_manager.get_state(normalized)
    if room is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    if room.scoring_mode != "detailed":
        raise HTTPException(status_code=400, detail="not_detailed_mode")

    # Check if full scores are ready by looking at persisted turns
    turns = debate_turns_store.list_turns_for_debate(room.debate_id)
    all_ready = all(
        t.full_score_ready or t.forfeit_reason is not None
        for t in turns
    )
    if not all_ready:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "processing", "message": "Full scores still computing."},
        )

    # Return the full scores
    results = []
    for t in turns:
        results.append({
            "turn_id": t.turn_id,
            "participant_id": t.participant_id,
            "turn_index": t.turn_index,
            "ai_score": t.ai_score,
            "full_ai_score": t.full_ai_score,
            "full_score_ready": t.full_score_ready,
        })
    return {"status": "ready", "scores": results}


@router.get("/motions", response_model=List[Motion])
async def list_motions(
    current_user: User = Depends(require_user),
) -> List[Motion]:
    # _load_motions raises HTTPException(500, "motions_unavailable") on
    # parse failure — FastAPI propagates that verbatim.
    return _load_motions()


@router.get("/my-debates", response_model=List[MyDebateEntry])
async def my_debates(
    current_user: User = Depends(require_user),
) -> List[MyDebateEntry]:
    records = debates_store.list_debates_for_user(current_user.uid)
    entries: list[MyDebateEntry] = []
    for record in records:
        # Locate the caller's participant snapshot inside the debate.
        caller_participant_id: Optional[str] = None
        for participant in record.participants:
            if (
                isinstance(participant, dict)
                and participant.get("user_id") == current_user.uid
            ):
                caller_participant_id = participant.get("participant_id")
                break

        ai_score: Optional[float] = None
        teacher_override_score: Optional[int] = None
        teacher_comment: Optional[str] = None
        if caller_participant_id is not None:
            turns = debate_turns_store.list_turns_for_debate(record.debate_id)
            for turn in turns:
                if turn.participant_id == caller_participant_id:
                    ai_score = turn.ai_score
                    teacher_override_score = turn.teacher_override_score
                    teacher_comment = turn.teacher_comment
                    break

        entries.append(
            MyDebateEntry(
                debate_id=record.debate_id,
                code=record.code,
                motion=Motion(
                    id=record.motion_id,
                    title=record.motion_title,
                    text=record.motion_text,
                ),
                completed_at=record.completed_at,
                ai_score=ai_score,
                teacher_override_score=teacher_override_score,
                teacher_comment=teacher_comment,
                winner_participant_id=record.winner_participant_id,
                turn_audio=_turn_audio_for_record(record),
            )
        )
    return entries


@router.get("/debates/{debate_id}", response_model=DebateDetailResponse)
async def get_debate_detail(
    debate_id: str,
    current_user: User = Depends(require_user),
) -> DebateDetailResponse:
    """Return the completed-debate detail with ordered per-turn audio refs.

    The caller must be a participant of the debate (from the persisted
    participant snapshot) or a teacher/admin. Response-safe: no email / uid.
    """
    record = debates_store.load_debate(debate_id)
    if record is None:
        raise HTTPException(status_code=404, detail="debate_not_found")

    is_teacher = getattr(current_user, "is_teacher", False) or getattr(
        current_user, "role", ""
    ) in ("teacher", "admin")
    is_participant = any(
        isinstance(p, dict) and p.get("user_id") == current_user.uid
        for p in record.participants
    )
    if not (is_teacher or is_participant):
        raise HTTPException(status_code=403, detail="not_authorized")

    # A detailed debate whose background pronunciation pass never finished (for
    # example the process restarted before it completed) would otherwise stay
    # "Result is being prepared" forever. Opening the result re-drives it.
    if record.scoring_mode == "detailed" and any(
        not s.full_score_ready for s in record.final_standings
    ):
        debate_room_manager.ensure_detailed_scoring(
            code=record.code,
            debate_id=record.debate_id,
            motion_title=record.motion_title,
            motion_text=record.motion_text,
        )

    return DebateDetailResponse(
        debate_id=record.debate_id,
        code=record.code,
        motion=Motion(
            id=record.motion_id,
            title=record.motion_title,
            text=record.motion_text,
        ),
        completed_at=record.completed_at,
        scoring_mode=record.scoring_mode,
        winner_participant_id=record.winner_participant_id,
        final_standings=record.final_standings,
        turn_audio=_turn_audio_for_record(record),
    )


# ---------------------------------------------------------------------------
# WebSocket route
# ---------------------------------------------------------------------------


@router.websocket("/ws/{code}")
async def debate_websocket(
    websocket: WebSocket,
    code: str,
    participant_id: str = Query(...),
    id_token: str = Query(default=""),
) -> None:
    # Verify the Firebase ID token BEFORE accepting. Close with 4401 on
    # any failure — never ``accept()`` first.
    try:
        user = verify_token_string(id_token)
    except HTTPException:
        await websocket.close(code=4401)
        return
    except Exception:  # noqa: BLE001 — defensive
        await websocket.close(code=4401)
        return

    normalized = code.strip().upper()
    room = debate_room_manager.get_state(normalized)
    if room is None:
        await websocket.close(code=4404)
        return

    # Caller must own the participant slot they're claiming.
    participant = next(
        (
            p
            for p in room.participants
            if p.participant_id == participant_id and p.user_id == user.uid
        ),
        None,
    )
    if participant is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    await debate_room_manager.attach_socket(normalized, participant_id, websocket)

    # Send the current state immediately so the client doesn't have to
    # wait for the next broadcast.
    try:
        await websocket.send_json(
            {"type": "state", "state": to_public(room).model_dump()}
        )
    except Exception:  # noqa: BLE001
        await debate_room_manager.detach_socket(
            normalized, participant_id, websocket
        )
        return

    try:
        while True:
            raw = await websocket.receive_json()
            # Only ``{"type": "ping"}`` is accepted; anything else is ignored.
            if isinstance(raw, dict) and raw.get("type") == "ping":
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:  # noqa: BLE001
                    pass
    except WebSocketDisconnect:
        await debate_room_manager.detach_socket(
            normalized, participant_id, websocket
        )
    except Exception as exc:  # noqa: BLE001 — defensive
        logger.warning(
            "debate_ws_error code=%s err=%s", normalized, type(exc).__name__
        )
        await debate_room_manager.detach_socket(
            normalized, participant_id, websocket
        )
