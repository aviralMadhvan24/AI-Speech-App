"""In-memory `RoomManager` for the battle feature.

Notes for reviewers:
- This is intentionally process-local. With uvicorn `--reload`, room state
  resets on every code change, which is fine for the current dev scope.
- Concurrency is guarded by one `asyncio.Lock` per room. A separate
  manager-level lock guards `_rooms` itself during create/delete.
- Background tasks (countdown / recording timer) are tracked per room so
  abandonment can cancel them cleanly.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
import uuid
from typing import Dict
from typing import Optional
from typing import Tuple

from fastapi import WebSocket

from .schemas import BattlePrompt
from .schemas import BattleRoomState
from .schemas import PlayerScore
from .schemas import PlayerRole
from .schemas import WSInbound
from .schemas import WSOutbound
from .schemas import serialize
from .scoring import compute_stars
from .scoring import zero_score


logger = logging.getLogger("battles.room_manager")


# Avoid ambiguous chars in room codes: 0/O, 1/I/L.
ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6

COUNTDOWN_SECONDS = 3
RECORDING_SECONDS = 60
GC_TTL_SECONDS = 30 * 60


def _generate_room_code() -> str:
    return "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


def _new_player_id() -> str:
    return uuid.uuid4().hex[:16]


class RoomManager:
    def __init__(self) -> None:
        self._rooms: Dict[str, BattleRoomState] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._sockets: Dict[str, Dict[str, WebSocket]] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        self._manager_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _lock_for(self, room_code: str) -> asyncio.Lock:
        lock = self._locks.get(room_code)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[room_code] = lock
        return lock

    def _sweep_stale(self) -> None:
        """Drop rooms whose `closed_at` is older than the TTL."""
        now = time.time()
        stale = [
            code
            for code, room in self._rooms.items()
            if room.closed_at is not None and now - room.closed_at > GC_TTL_SECONDS
        ]
        for code in stale:
            self._discard(code)

    def _discard(self, room_code: str) -> None:
        self._rooms.pop(room_code, None)
        self._locks.pop(room_code, None)
        self._sockets.pop(room_code, None)
        task = self._tasks.pop(room_code, None)
        if task is not None and not task.done():
            task.cancel()

    # ------------------------------------------------------------------
    # Room lifecycle
    # ------------------------------------------------------------------

    async def create_room(self, host_name: str, prompt: BattlePrompt) -> Tuple[str, str]:
        """Create a new room with a unique code and return (code, host_player_id)."""
        async with self._manager_lock:
            self._sweep_stale()
            # Retry on collision. The space is ~10^9 codes, so this is
            # vanishingly unlikely; we cap retries at a small number anyway.
            for _ in range(8):
                code = _generate_room_code()
                if code not in self._rooms:
                    break
            else:
                raise RuntimeError("Could not allocate a unique room code")
            host_player_id = _new_player_id()
            state = BattleRoomState(
                room_code=code,
                status="waiting",
                host_name=host_name,
                host_player_id=host_player_id,
                prompt=prompt,
            )
            self._rooms[code] = state
            self._locks[code] = asyncio.Lock()
            self._sockets[code] = {}
            return code, host_player_id

    async def join_room(self, room_code: str, opponent_name: str) -> str:
        room = self._rooms.get(room_code)
        if room is None:
            raise KeyError("room_not_found")
        async with self._lock_for(room_code):
            if room.opponent_player_id is not None:
                raise ValueError("room_full")
            if room.status not in ("waiting",):
                # Already past the join phase.
                raise ValueError("room_not_joinable")
            opponent_player_id = _new_player_id()
            room.opponent_player_id = opponent_player_id
            room.opponent_name = opponent_name
            room.status = "ready"
        await self.broadcast(room_code)
        return opponent_player_id

    async def get_state(self, room_code: str) -> Optional[BattleRoomState]:
        return self._rooms.get(room_code)

    def role_for(self, room: BattleRoomState, player_id: str) -> Optional[PlayerRole]:
        if player_id == room.host_player_id:
            return "host"
        if player_id == room.opponent_player_id:
            return "opponent"
        return None

    # ------------------------------------------------------------------
    # Socket management
    # ------------------------------------------------------------------

    async def attach_socket(self, room_code: str, player_id: str, websocket: WebSocket) -> None:
        sockets = self._sockets.setdefault(room_code, {})
        sockets[player_id] = websocket

    async def detach_socket(self, room_code: str, player_id: str) -> None:
        sockets = self._sockets.get(room_code)
        if sockets is not None:
            sockets.pop(player_id, None)

    async def broadcast(self, room_code: str) -> None:
        room = self._rooms.get(room_code)
        if room is None:
            return
        payload = serialize(WSOutbound.state_msg(room.to_public()))
        sockets = list(self._sockets.get(room_code, {}).items())
        for player_id, ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception as exc:  # noqa: BLE001 — best-effort broadcast
                logger.debug(
                    "broadcast_failed room=%s player=%s err=%s",
                    room_code,
                    player_id,
                    type(exc).__name__,
                )

    # ------------------------------------------------------------------
    # State transitions
    # ------------------------------------------------------------------

    async def handle_inbound(
        self,
        room_code: str,
        player_id: str,
        message: WSInbound,
    ) -> None:
        room = self._rooms.get(room_code)
        if room is None:
            return
        role = self.role_for(room, player_id)
        if role is None:
            return

        if message.type == "ping":
            ws = self._sockets.get(room_code, {}).get(player_id)
            if ws is not None:
                try:
                    await ws.send_json(serialize(WSOutbound.pong_msg()))
                except Exception:
                    pass
            return

        if message.type == "ready":
            await self._on_ready(room_code, role)
            return

        if message.type == "score_submitted":
            if message.score is None:
                return
            await self._on_score(room_code, role, message.score)
            return

    async def _on_ready(self, room_code: str, role: PlayerRole) -> None:
        should_start_countdown = False
        async with self._lock_for(room_code):
            room = self._rooms.get(room_code)
            if room is None:
                return
            if room.status != "ready":
                return
            if role == "host":
                room.host_ready = True
            else:
                room.opponent_ready = True
            if room.host_ready and room.opponent_ready:
                room.status = "countdown"
                room.phase_deadline = time.time() + COUNTDOWN_SECONDS
                should_start_countdown = True
        await self.broadcast(room_code)
        if should_start_countdown:
            self._spawn_phase_task(room_code, self._run_countdown(room_code))

    async def _on_score(
        self,
        room_code: str,
        role: PlayerRole,
        score: PlayerScore,
    ) -> None:
        compute_now = False
        async with self._lock_for(room_code):
            room = self._rooms.get(room_code)
            if room is None:
                return
            if room.status not in ("recording", "scoring"):
                return
            if role == "host":
                if room.scores.host is not None:
                    return
                room.scores.host = score
            else:
                if room.scores.opponent is not None:
                    return
                room.scores.opponent = score
            both_in = room.scores.host is not None and room.scores.opponent is not None
            if both_in:
                room.status = "scoring"
                compute_now = True
        await self.broadcast(room_code)
        if compute_now:
            await self._finalize(room_code)

    async def _finalize(self, room_code: str) -> None:
        async with self._lock_for(room_code):
            room = self._rooms.get(room_code)
            if room is None:
                return
            host_score = room.scores.host or zero_score()
            opp_score = room.scores.opponent or zero_score()
            room.scores.host = host_score
            room.scores.opponent = opp_score
            room.verdict = compute_stars(host_score, opp_score)
            room.status = "complete"
            room.phase_deadline = None
            room.closed_at = time.time()
        await self.broadcast(room_code)
        # Drop any pending task — the round is over.
        task = self._tasks.pop(room_code, None)
        if task is not None and not task.done():
            task.cancel()

    async def abandon(self, room_code: str, reason: str) -> None:
        async with self._lock_for(room_code):
            room = self._rooms.get(room_code)
            if room is None:
                return
            if room.status in ("complete", "abandoned"):
                return
            room.status = "abandoned"
            room.error = reason
            room.phase_deadline = None
            room.closed_at = time.time()
        await self.broadcast(room_code)
        task = self._tasks.pop(room_code, None)
        if task is not None and not task.done():
            task.cancel()

    # ------------------------------------------------------------------
    # Background phase tasks
    # ------------------------------------------------------------------

    def _spawn_phase_task(self, room_code: str, coro) -> None:
        existing = self._tasks.get(room_code)
        if existing is not None and not existing.done():
            existing.cancel()
        self._tasks[room_code] = asyncio.create_task(coro)

    async def _run_countdown(self, room_code: str) -> None:
        try:
            await asyncio.sleep(COUNTDOWN_SECONDS)
        except asyncio.CancelledError:
            return
        async with self._lock_for(room_code):
            room = self._rooms.get(room_code)
            if room is None or room.status != "countdown":
                return
            room.status = "recording"
            room.phase_deadline = time.time() + RECORDING_SECONDS
        await self.broadcast(room_code)
        self._spawn_phase_task(room_code, self._run_recording_timer(room_code))

    async def _run_recording_timer(self, room_code: str) -> None:
        try:
            await asyncio.sleep(RECORDING_SECONDS)
        except asyncio.CancelledError:
            return
        # Grace window: give the client a few seconds to upload + submit after
        # the timer hits zero before we finalize with zeros for missing scores.
        try:
            await asyncio.sleep(15)
        except asyncio.CancelledError:
            return
        room = self._rooms.get(room_code)
        if room is None:
            return
        if room.status in ("complete", "abandoned"):
            return
        await self._finalize(room_code)


# Module-level singleton — imported by routes and any future helpers.
room_manager = RoomManager()
