"""HTTP + WebSocket routes for the 1v1 battle feature.

Endpoints (prefix `/battle`):
- POST   /battle/rooms                  → create room (random prompt)
- POST   /battle/rooms/{room_code}/join → join existing room
- GET    /battle/rooms/{room_code}      → fetch public room state
- WS     /battle/ws/{room_code}         → live state updates / inbound events

The existing `GET /battle/prompts` route lives in `app/api/prompt_routes.py`
and is left untouched.
"""

from __future__ import annotations

import json
import logging
import random
from pathlib import Path
from typing import Any
from typing import Dict
from typing import List

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import WebSocket
from fastapi import WebSocketDisconnect
from pydantic import ValidationError

from app.auth import User
from app.auth import require_user
from app.auth import verify_token_string

from .room_manager import room_manager
from .schemas import BattlePrompt
from .schemas import CreateRoomRequest
from .schemas import CreateRoomResponse
from .schemas import JoinRoomRequest
from .schemas import JoinRoomResponse
from .schemas import PublicBattleRoomState
from .schemas import WSInbound
from .schemas import WSOutbound
from .schemas import serialize


logger = logging.getLogger("battles.routes")

router = APIRouter(prefix="/battle", tags=["battle"])

PROMPTS_PATH = Path("app/data/pronunciation_prompts.json")


def _load_prompts() -> List[Dict[str, Any]]:
    with open(PROMPTS_PATH, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list) or not data:
        raise RuntimeError("prompts file is empty or malformed")
    return data


def _pick_random_prompt() -> BattlePrompt:
    raw = random.choice(_load_prompts())
    return BattlePrompt(
        id=str(raw.get("id", "")),
        text=str(raw.get("text", "")),
        difficulty=str(raw.get("difficulty", "medium")),
        focus_word=raw.get("focus_word"),
        hint=raw.get("hint"),
    )


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------


@router.post("/rooms", response_model=CreateRoomResponse)
async def create_room(
    body: CreateRoomRequest,
    current_user: User = Depends(require_user),
) -> CreateRoomResponse:
    prompt = _pick_random_prompt()
    code, host_player_id = await room_manager.create_room(
        host_name=body.host_name.strip(),
        prompt=prompt,
    )
    state = await room_manager.get_state(code)
    assert state is not None  # Just created.
    return CreateRoomResponse(
        room_code=code,
        player_id=host_player_id,
        role="host",
        state=state.to_public(),
    )


@router.post("/rooms/{room_code}/join", response_model=JoinRoomResponse)
async def join_room(
    room_code: str,
    body: JoinRoomRequest,
    current_user: User = Depends(require_user),
) -> JoinRoomResponse:
    code = room_code.strip().upper()
    state = await room_manager.get_state(code)
    if state is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    try:
        opponent_player_id = await room_manager.join_room(
            room_code=code,
            opponent_name=body.opponent_name.strip(),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="room_not_found")
    except ValueError as exc:
        # 409 — the room exists but cannot be joined.
        raise HTTPException(status_code=409, detail=str(exc))
    state_after = await room_manager.get_state(code)
    assert state_after is not None
    return JoinRoomResponse(
        room_code=code,
        player_id=opponent_player_id,
        role="opponent",
        state=state_after.to_public(),
    )


@router.get("/rooms/{room_code}", response_model=PublicBattleRoomState)
async def get_room(
    room_code: str,
    current_user: User = Depends(require_user),
) -> PublicBattleRoomState:
    code = room_code.strip().upper()
    state = await room_manager.get_state(code)
    if state is None:
        raise HTTPException(status_code=404, detail="room_not_found")
    return state.to_public()


# ---------------------------------------------------------------------------
# WebSocket route
# ---------------------------------------------------------------------------


@router.websocket("/ws/{room_code}")
async def battle_websocket(
    websocket: WebSocket,
    room_code: str,
    player_id: str = Query(...),
    id_token: str = Query(default=""),
) -> None:
    # Verify the Firebase ID token (or pass through bypass) BEFORE accepting
    # the WebSocket. Close with 4401 on any failure — never `accept()` first.
    try:
        verify_token_string(id_token)
    except HTTPException:
        await websocket.close(code=4401)
        return
    except Exception:  # noqa: BLE001 — defensive
        await websocket.close(code=4401)
        return

    code = room_code.strip().upper()
    state = await room_manager.get_state(code)
    if state is None:
        await websocket.close(code=4404)
        return
    role = room_manager.role_for(state, player_id)
    if role is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    await room_manager.attach_socket(code, player_id, websocket)

    # Send the current state immediately so the client doesn't have to wait
    # for the next broadcast.
    try:
        await websocket.send_json(serialize(WSOutbound.state_msg(state.to_public())))
    except Exception:  # noqa: BLE001
        await room_manager.detach_socket(code, player_id)
        return

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                message = WSInbound.model_validate(raw)
            except ValidationError as exc:
                await websocket.send_json(
                    serialize(WSOutbound.error_msg(f"invalid_message: {exc.errors()[0]['msg']}"))
                )
                continue
            await room_manager.handle_inbound(code, player_id, message)
    except WebSocketDisconnect:
        await room_manager.detach_socket(code, player_id)
        current = await room_manager.get_state(code)
        if current is not None and current.status in (
            "countdown",
            "recording",
            "scoring",
            "ready",
        ):
            await room_manager.abandon(code, "opponent_disconnected")
    except Exception as exc:  # noqa: BLE001 — defensive
        logger.warning("battle_ws_error room=%s err=%s", code, type(exc).__name__)
        await room_manager.detach_socket(code, player_id)
        current = await room_manager.get_state(code)
        if current is not None and current.status in (
            "countdown",
            "recording",
            "scoring",
        ):
            await room_manager.abandon(code, "socket_error")
