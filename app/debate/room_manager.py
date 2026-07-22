"""In-memory `DebateRoomManager` for the group-debate feature.

Notes for reviewers:
- This is intentionally process-local. With uvicorn ``--reload``, room
  state resets on every code change, which is fine for the current
  dev scope.
- Concurrency is guarded by one ``asyncio.Lock`` per room. A separate
  manager-level lock guards ``_rooms`` itself during create/GC.
- Background tasks (prep timer, turn timer, reconnect-grace timer)
  are tracked per room so abandonment / re-entry can cancel them
  cleanly.
- Structure mirrors ``app.battles.room_manager`` but generalized to
  N=4-6 participants with per-participant pause/forfeit instead of
  whole-room abandon.

See ``.kiro/specs/group-debate/design.md`` Section 3 (State Machine)
and Section "app/debate/room_manager.py" for the governing pseudocode.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import secrets
import time
import uuid
from pathlib import Path
from typing import Dict, Literal, Optional

from fastapi import HTTPException, WebSocket

from app.asr.schemas import TranscriptionResult
from app.audio.schemas import AudioAsset
from app.auth import User
from app.debate.schemas import (
    DebateRecord,
    DebateRoom,
    DebateTurn,
    EffectiveScoreEntry,
    FinalStanding,
    Motion,
    ParticipantInternal,
    PublicDebateRoom,
    to_public,
)
from app.debate.scoring import compute_effective_score, compute_winner
from app.debate.service import compute_ai_score, compute_ai_score_with_content
from app.fluency.schemas import FluencyResult
from app.schemas.pronunciation_schema import PronunciationResult
from app.storage import debate_turns as debate_turns_store
from app.storage import debates as debates_store


logger = logging.getLogger("debate.room_manager")


# ---------------------------------------------------------------------------
# Module constants (single source of truth for deadlines and shape)
# ---------------------------------------------------------------------------

# Avoid ambiguous chars in room codes: 0/O, 1/I/L.
ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6

PREP_SECONDS = 60
TURN_SECONDS = 120
TURN_GRACE_SECONDS = 15
RECONNECT_GRACE_SECONDS = 30

# Dev mode allows single-player testing (set DEBATE_DEV_MODE=true in .env)
_DEV_MODE = os.getenv("DEBATE_DEV_MODE", "").lower() in ("true", "1", "yes")
MIN_PARTICIPANTS = 1 if _DEV_MODE else 4
MAX_PARTICIPANTS = 6
GC_TTL_SECONDS = 60 * 60


MOTIONS_PATH = Path("app/data/debate_motions.json")

# Cached motions list. Populated lazily on first access so import time
# stays cheap and parse errors surface as HTTP 500 at request time
# rather than at module load.
_motions_cache: Optional[list[Motion]] = None


def _load_motions() -> list[Motion]:
    """Load motions once and cache them.

    Raises ``HTTPException(500, "motions_unavailable")`` on parse
    failure or empty catalog per Req 12.4.
    """
    global _motions_cache
    if _motions_cache is not None:
        return _motions_cache
    try:
        with open(MOTIONS_PATH, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, list) or not raw:
            raise ValueError("motions file is empty or not a list")
        motions = [Motion.model_validate(entry) for entry in raw]
    except Exception as exc:
        logger.error(
            "motions_load_failed path=%s err=%s",
            MOTIONS_PATH,
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail="motions_unavailable") from exc
    _motions_cache = motions
    return _motions_cache


def _new_participant_id() -> str:
    return uuid.uuid4().hex[:16]


class DebateRoomManager:
    """Owns all in-memory debate rooms, their locks, timers, and sockets."""

    def __init__(self) -> None:
        self._rooms: Dict[str, DebateRoom] = {}
        # code -> {participant_id -> ws}
        self._sockets: Dict[str, Dict[str, WebSocket]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        # code -> {slot_name -> asyncio.Task}
        # slot_name is one of: "prep", "turn", "reconnect".
        self._timers: Dict[str, Dict[str, asyncio.Task]] = {}
        # Which participant a pending "reconnect" timer is waiting for.
        self._reconnect_targets: Dict[str, str] = {}
        self._manager_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _lock_for(self, code: str) -> asyncio.Lock:
        lock = self._locks.get(code)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[code] = lock
        return lock

    def _random_code(self) -> str:
        return "".join(
            secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH)
        )

    def _pick_random_motion(self) -> Motion:
        motions = _load_motions()
        return random.choice(motions)

    def get_state(self, code: str) -> Optional[DebateRoom]:
        return self._rooms.get(code)

    def to_public(self, room: DebateRoom) -> PublicDebateRoom:
        return to_public(room)

    def _find_participant(
        self, room: DebateRoom, user_id: str
    ) -> Optional[ParticipantInternal]:
        for p in room.participants:
            if p.user_id == user_id:
                return p
        return None

    def _find_participant_by_id(
        self, room: DebateRoom, participant_id: str
    ) -> Optional[ParticipantInternal]:
        for p in room.participants:
            if p.participant_id == participant_id:
                return p
        return None

    def _connected_non_forfeit_count(self, room: DebateRoom) -> int:
        """Count participants who are not forfeited and currently have
        at least one WebSocket attached.
        """
        sockets = self._sockets.get(room.code, {})
        count = 0
        for p in room.participants:
            if p.is_forfeit:
                continue
            if p.participant_id in sockets:
                count += 1
        return count

    def _sweep_stale(self) -> None:
        """Drop rooms whose ``completed_at`` is older than the TTL."""
        now = time.time()
        stale = [
            code
            for code, room in self._rooms.items()
            if room.completed_at is not None
            and now - room.completed_at > GC_TTL_SECONDS
        ]
        for code in stale:
            self._discard(code)

    def _discard(self, code: str) -> None:
        self._rooms.pop(code, None)
        self._locks.pop(code, None)
        self._sockets.pop(code, None)
        self._reconnect_targets.pop(code, None)
        slots = self._timers.pop(code, {})
        for task in slots.values():
            if not task.done():
                task.cancel()

    # ------------------------------------------------------------------
    # Timer helpers
    # ------------------------------------------------------------------

    def _spawn_timer(self, code: str, name: str, coro) -> None:
        """Cancel any existing timer in ``name`` slot for ``code`` and
        spawn a new one running ``coro``.
        """
        slots = self._timers.setdefault(code, {})
        existing = slots.get(name)
        if existing is not None and not existing.done():
            existing.cancel()
        slots[name] = asyncio.create_task(coro)

    def _cancel_timer(self, code: str, name: str) -> None:
        slots = self._timers.get(code)
        if not slots:
            return
        task = slots.pop(name, None)
        if task is not None and not task.done():
            task.cancel()

    def _cancel_all_timers(self, code: str) -> None:
        slots = self._timers.pop(code, {})
        for task in slots.values():
            if not task.done():
                task.cancel()

    # ------------------------------------------------------------------
    # Room lifecycle
    # ------------------------------------------------------------------

    async def create_room(self, user: User) -> DebateRoom:
        """Create a new room with a unique code and register the caller
        as the first participant.
        """
        async with self._manager_lock:
            self._sweep_stale()
            code: Optional[str] = None
            for _ in range(8):
                candidate = self._random_code()
                if candidate not in self._rooms:
                    code = candidate
                    break
            if code is None:
                raise RuntimeError("Could not allocate a unique room code")

            motion = self._pick_random_motion()
            now = time.time()
            first = ParticipantInternal(
                participant_id=_new_participant_id(),
                user_id=user.uid,
                user_email=user.email,
                display_name=user.name or user.email,
                joined_at=now,
                is_ready=False,
                turn_index=0,
            )
            room = DebateRoom(
                debate_id=uuid.uuid4().hex,
                code=code,
                motion_id=motion.id,
                motion_title=motion.title,
                motion_text=motion.text,
                state="waiting",
                paused=False,
                participants=[first],
                created_at=now,
            )
            self._rooms[code] = room
            self._locks[code] = asyncio.Lock()
            self._sockets[code] = {}
            self._timers[code] = {}
            return room

    async def join_room(self, code: str, user: User) -> DebateRoom:
        """Add ``user`` to the room identified by ``code``.

        Idempotent: if the caller's ``user_id`` is already in
        ``participants``, returns the room without adding a duplicate.

        Raises:
            HTTPException(404, "room_not_found") if the room is unknown.
            HTTPException(409, "room_not_joinable") if not in `waiting`.
            HTTPException(409, "room_full") if capacity is at MAX.
        """
        if code not in self._rooms:
            raise HTTPException(status_code=404, detail="room_not_found")
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                raise HTTPException(status_code=404, detail="room_not_found")

            # Idempotent rejoin.
            existing = self._find_participant(room, user.uid)
            if existing is not None:
                return room

            if room.state != "waiting":
                raise HTTPException(
                    status_code=409, detail="room_not_joinable"
                )
            if len(room.participants) >= MAX_PARTICIPANTS:
                raise HTTPException(status_code=409, detail="room_full")

            new_p = ParticipantInternal(
                participant_id=_new_participant_id(),
                user_id=user.uid,
                user_email=user.email,
                display_name=user.name or user.email,
                joined_at=time.time(),
                is_ready=False,
                turn_index=len(room.participants),
            )
            room.participants.append(new_p)

        await self.broadcast(code)
        return room

    # ------------------------------------------------------------------
    # Ready flip + auto-start
    # ------------------------------------------------------------------

    async def flip_ready(self, code: str, user: User) -> DebateRoom:
        """Toggle the caller's ``is_ready`` flag and, if the auto-start
        condition is now satisfied, transition the room into ``prep``.
        """
        if code not in self._rooms:
            raise HTTPException(status_code=404, detail="room_not_found")

        should_start_prep = False
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                raise HTTPException(status_code=404, detail="room_not_found")

            participant = self._find_participant(room, user.uid)
            if participant is None:
                raise HTTPException(status_code=403, detail="not_a_participant")

            participant.is_ready = not participant.is_ready

            # If any participant un-readies, cancel pending auto-start timer
            if not participant.is_ready:
                self._cancel_timer(code, "auto_start_grace")
                room.auto_start_deadline = None  # Clear the deadline from UI

            # Auto-start conditions:
            # 1. All participants are ready AND
            # 2. Either at MAX capacity (6) OR at least MIN (4) with grace time
            # This gives late joiners a chance to enter before room locks.
            all_ready_condition = (
                room.state == "waiting"
                and len(room.participants) >= MIN_PARTICIPANTS
                and all(p.is_ready for p in room.participants)
            )
            
            if all_ready_condition and len(room.participants) >= MAX_PARTICIPANTS:
                # Full room + all ready → start immediately
                for idx, p in enumerate(room.participants):
                    p.turn_index = idx
                room.state = "prep"
                room.prep_deadline = time.time() + PREP_SECONDS
                room.auto_start_deadline = None  # Clear grace timer
                should_start_prep = True
            elif all_ready_condition:
                # Below max + all ready → schedule delayed start (20s grace)
                # so late joiners can still enter. Cancel if someone unready.
                room.auto_start_deadline = time.time() + 20.0
                self._spawn_timer(
                    code, "auto_start_grace",
                    self._delayed_auto_start(code, delay=20.0),
                )

        if should_start_prep:
            self._spawn_timer(code, "prep", self._run_prep_timer(code))
        await self.broadcast(code)
        return self._rooms[code]

    async def _delayed_auto_start(self, code: str, delay: float = 20.0) -> None:
        """Wait `delay` seconds then start prep IF still all-ready.
        
        This gives late joiners a chance to enter the room after minimum
        participants are ready. If someone un-readies or leaves during the
        grace period, the timer is cancelled by the next flip_ready call.
        """
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None or room.state != "waiting":
                return
            # Re-check conditions after grace period
            if not (
                len(room.participants) >= MIN_PARTICIPANTS
                and all(p.is_ready for p in room.participants)
            ):
                return
            # Start prep phase
            for idx, p in enumerate(room.participants):
                p.turn_index = idx
            room.state = "prep"
            room.prep_deadline = time.time() + PREP_SECONDS
            room.auto_start_deadline = None  # Clear grace timer
        
        self._spawn_timer(code, "prep", self._run_prep_timer(code))
        await self.broadcast(code)

    async def _run_prep_timer(self, code: str) -> None:
        try:
            await asyncio.sleep(PREP_SECONDS)
        except asyncio.CancelledError:
            return
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None or room.state != "prep":
                return
            room.state = "speaking"
            room.active_turn_index = 0
            room.prep_deadline = None
            room.turn_deadline = time.time() + TURN_SECONDS + TURN_GRACE_SECONDS
        self._spawn_timer(code, "turn", self._run_turn_timer(code))
        await self.broadcast(code)

    async def _run_turn_timer(self, code: str) -> None:
        try:
            await asyncio.sleep(TURN_SECONDS + TURN_GRACE_SECONDS)
        except asyncio.CancelledError:
            return
        await self.advance_or_forfeit(code, reason="timeout")

    # ------------------------------------------------------------------
    # Turn submission
    # ------------------------------------------------------------------

    async def submit_turn(
        self,
        code: str,
        user: User,
        audio_asset: AudioAsset,
        transcription: TranscriptionResult,
        pronunciation: PronunciationResult,
        fluency: FluencyResult,
        analysis_id: str,
    ) -> tuple[DebateTurn, DebateRoom]:
        """Persist the caller's turn and advance state.

        Raises ``ValueError`` with one of the following codes for the
        route to translate into HTTP 409:

        - ``not_in_speaking_state`` — room state != "speaking".
        - ``debate_paused`` — paused overlay is active.
        - ``not_a_participant`` — caller is not in the room.
        - ``not_your_turn`` — caller's turn_index != active_turn_index.
        """
        # Get room info outside the lock for content scoring
        room = self._rooms.get(code)
        if room is None:
            raise ValueError("room_not_found")
        
        motion_title = room.motion_title
        motion_text = room.motion_text
        transcript_text = transcription.text if transcription else ""

        # Run content scoring outside the lock (it's async and may take time)
        try:
            ai_score, scoring_unavailable, score_breakdown = await compute_ai_score_with_content(
                pronunciation=pronunciation,
                fluency=fluency,
                transcript=transcript_text,
                motion_title=motion_title,
                motion_text=motion_text,
            )
            content_score = score_breakdown.get("content", {}).get("total")
            content_feedback = score_breakdown.get("content", {}).get("feedback", "")
        except Exception as exc:
            logger.warning(f"Content scoring failed, falling back: {exc}")
            # Fallback to basic scoring
            ai_score, scoring_unavailable = compute_ai_score(pronunciation, fluency)
            content_score = None
            content_feedback = "Content scoring unavailable"
            score_breakdown = None

        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                raise ValueError("room_not_found")
            if room.state != "speaking":
                raise ValueError("not_in_speaking_state")
            if room.paused:
                raise ValueError("debate_paused")
            participant = self._find_participant(room, user.uid)
            if participant is None:
                raise ValueError("not_a_participant")
            if participant.turn_index != room.active_turn_index:
                raise ValueError("not_your_turn")

            turn = DebateTurn(
                turn_id=uuid.uuid4().hex,
                debate_id=room.debate_id,
                participant_id=participant.participant_id,
                turn_index=room.active_turn_index,
                analysis_id=analysis_id,
                ai_score=float(ai_score),
                scoring_unavailable=bool(scoring_unavailable),
                submitted_at=time.time(),
                forfeit_reason=None,
                content_score=content_score,
                content_feedback=content_feedback,
                score_breakdown=score_breakdown,
            )
            debate_turns_store.save_turn(turn)

            # Turn accepted; cancel the pending 135s timer.
            self._cancel_timer(code, "turn")

            self._advance_active_index_locked(room)

        await self.broadcast(code)
        return turn, self._rooms[code]

    # ------------------------------------------------------------------
    # WebSocket attach/detach + pause overlay
    # ------------------------------------------------------------------

    async def attach_socket(
        self, code: str, participant_id: str, ws: WebSocket
    ) -> None:
        should_reconnect = False
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return
            sockets = self._sockets.setdefault(code, {})
            sockets[participant_id] = ws
            participant = self._find_participant_by_id(room, participant_id)
            if participant is not None:
                participant.ws_connected_since = time.time()
                participant.disconnected_at = None
            # If the room is paused waiting for this specific participant,
            # trigger the reconnect resolution path.
            if (
                room.paused
                and self._reconnect_targets.get(code) == participant_id
            ):
                should_reconnect = True

        if should_reconnect:
            await self.handle_reconnect(code, participant_id)

    async def detach_socket(
        self, code: str, participant_id: str, ws: WebSocket
    ) -> None:
        should_disconnect = False
        async with self._lock_for(code):
            sockets = self._sockets.get(code)
            if sockets is None:
                return
            current = sockets.get(participant_id)
            # Ignore stale mismatches: another socket may have replaced
            # this one before the detach call landed.
            if current is not ws:
                return
            sockets.pop(participant_id, None)
            room = self._rooms.get(code)
            if room is not None:
                participant = self._find_participant_by_id(
                    room, participant_id
                )
                if participant is not None:
                    participant.disconnected_at = time.time()
                    participant.ws_connected_since = None
            # If this participant has no other socket, trigger disconnect.
            if participant_id not in sockets:
                should_disconnect = True

        if should_disconnect:
            await self.handle_disconnect(code, participant_id)

    async def handle_disconnect(
        self, code: str, participant_id: str
    ) -> None:
        """Apply the paused overlay + start reconnect-grace countdown."""
        should_check_abandoned = False
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return
            if room.state not in ("prep", "speaking", "scoring"):
                # Waiting-phase disconnects don't pause. We still check
                # abandoned condition below.
                should_check_abandoned = True
            else:
                participant = self._find_participant_by_id(
                    room, participant_id
                )
                if participant is None or participant.is_forfeit:
                    return
                if room.paused:
                    # Already paused (for someone else, presumably). Do
                    # not overlay a second pause.
                    return

                now = time.time()
                room.paused = True
                room.reconnect_deadline = now + RECONNECT_GRACE_SECONDS
                room._pause_started_at = now
                self._reconnect_targets[code] = participant_id

                # Pause the turn timer if one is running.
                self._cancel_timer(code, "turn")

                self._spawn_timer(
                    code,
                    "reconnect",
                    self._run_reconnect_timer(code, participant_id),
                )

        if should_check_abandoned:
            await self._maybe_abandon(code)
            return
        await self.broadcast(code)

    async def handle_reconnect(
        self, code: str, participant_id: str
    ) -> None:
        """Clear the paused overlay if the disconnected participant
        rejoined in time, and resume the turn timer with the extended
        deadline.
        """
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return
            if not room.paused:
                return
            if self._reconnect_targets.get(code) != participant_id:
                return

            pause_started_at = room._pause_started_at
            now = time.time()

            # Cancel the pending reconnect timer.
            self._cancel_timer(code, "reconnect")
            self._reconnect_targets.pop(code, None)

            # Extend turn_deadline by the paused duration so the speaker
            # gets the full remaining budget they had at pause time.
            if room.turn_deadline is not None and pause_started_at is not None:
                paused_for = now - pause_started_at
                room.turn_deadline = room.turn_deadline + paused_for

            room.paused = False
            room.reconnect_deadline = None
            room._pause_started_at = None

            # Respawn a turn timer for the remaining budget, if applicable.
            if (
                room.state == "speaking"
                and room.turn_deadline is not None
            ):
                remaining = max(0.0, room.turn_deadline - now)
                self._spawn_timer(
                    code,
                    "turn",
                    self._run_turn_timer_with_delay(code, remaining),
                )

        await self.broadcast(code)

    async def _run_turn_timer_with_delay(
        self, code: str, delay_seconds: float
    ) -> None:
        try:
            await asyncio.sleep(delay_seconds)
        except asyncio.CancelledError:
            return
        await self.advance_or_forfeit(code, reason="timeout")

    async def _run_reconnect_timer(
        self, code: str, participant_id: str
    ) -> None:
        try:
            await asyncio.sleep(RECONNECT_GRACE_SECONDS)
        except asyncio.CancelledError:
            return
        await self.advance_or_forfeit(
            code, reason="reconnect_timeout", participant_id=participant_id
        )

    # ------------------------------------------------------------------
    # Forfeit / advance
    # ------------------------------------------------------------------

    async def advance_or_forfeit(
        self,
        code: str,
        reason: Literal["timeout", "reconnect_timeout"],
        participant_id: Optional[str] = None,
    ) -> None:
        """Handle a turn-timeout or reconnect-timeout event.

        - ``reason == "timeout"``: the current active speaker missed the
          135s window. Persist a forfeit turn for them and advance.
        - ``reason == "reconnect_timeout"``: the disconnected
          ``participant_id`` never reconnected. Mark them ``is_forfeit``,
          clear the paused overlay. If they were the active speaker,
          persist a forfeit turn and advance.
        """
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return
            if room.state not in ("prep", "speaking", "scoring"):
                return

            if reason == "reconnect_timeout":
                if participant_id is None:
                    return
                # Ensure we're still waiting on THIS participant.
                if self._reconnect_targets.get(code) != participant_id:
                    return

                participant = self._find_participant_by_id(
                    room, participant_id
                )
                if participant is None:
                    return

                # Clear paused overlay and forfeit the participant.
                room.paused = False
                room.reconnect_deadline = None
                room._pause_started_at = None
                self._reconnect_targets.pop(code, None)
                participant.is_forfeit = True

                # If they were the active speaker, persist a forfeit turn.
                if (
                    room.state == "speaking"
                    and room.active_turn_index is not None
                    and participant.turn_index == room.active_turn_index
                ):
                    forfeit_turn = DebateTurn(
                        turn_id=uuid.uuid4().hex,
                        debate_id=room.debate_id,
                        participant_id=participant.participant_id,
                        turn_index=participant.turn_index,
                        analysis_id=None,
                        ai_score=0.0,
                        scoring_unavailable=False,
                        submitted_at=time.time(),
                        forfeit_reason="reconnect_timeout",
                    )
                    debate_turns_store.save_turn(forfeit_turn)
                    self._cancel_timer(code, "turn")
                    self._advance_active_index_locked(room)
                elif room.state == "speaking":
                    # Not the active speaker — resume the turn timer for
                    # the current speaker if it was paused.
                    if room.turn_deadline is not None:
                        remaining = max(0.0, room.turn_deadline - time.time())
                        self._spawn_timer(
                            code,
                            "turn",
                            self._run_turn_timer_with_delay(
                                code, remaining
                            ),
                        )

            else:  # reason == "timeout"
                if room.state != "speaking" or room.active_turn_index is None:
                    return
                participant = None
                for p in room.participants:
                    if p.turn_index == room.active_turn_index:
                        participant = p
                        break
                if participant is None:
                    return
                forfeit_turn = DebateTurn(
                    turn_id=uuid.uuid4().hex,
                    debate_id=room.debate_id,
                    participant_id=participant.participant_id,
                    turn_index=participant.turn_index,
                    analysis_id=None,
                    ai_score=0.0,
                    scoring_unavailable=False,
                    submitted_at=time.time(),
                    forfeit_reason="timeout",
                )
                debate_turns_store.save_turn(forfeit_turn)
                self._cancel_timer(code, "turn")
                self._advance_active_index_locked(room)

        # Abandonment / final broadcast happens after we drop the lock
        # so nested broadcasts don't deadlock.
        await self._maybe_abandon(code)
        await self.broadcast(code)

    def _advance_active_index_locked(self, room: DebateRoom) -> None:
        """Move ``active_turn_index`` forward, auto-forfeiting any
        upcoming turns for participants that are already ``is_forfeit``.
        Transitions to ``scoring`` → ``complete`` when the last turn
        has been handled.

        MUST be called with the room lock held.
        """
        if room.active_turn_index is None:
            return

        next_index = room.active_turn_index + 1
        while next_index < len(room.participants):
            candidate = None
            for p in room.participants:
                if p.turn_index == next_index:
                    candidate = p
                    break
            if candidate is None:
                # Should never happen (turn_index is dense), but bail
                # safely.
                next_index += 1
                continue
            if candidate.is_forfeit:
                # Auto-persist a forfeit row for this pending turn so
                # winner selection has an entry for them (Req 8.3).
                forfeit_turn = DebateTurn(
                    turn_id=uuid.uuid4().hex,
                    debate_id=room.debate_id,
                    participant_id=candidate.participant_id,
                    turn_index=candidate.turn_index,
                    analysis_id=None,
                    ai_score=0.0,
                    scoring_unavailable=False,
                    submitted_at=time.time(),
                    forfeit_reason="reconnect_timeout",
                )
                debate_turns_store.save_turn(forfeit_turn)
                next_index += 1
                continue
            # Found the next real speaker.
            room.active_turn_index = next_index
            room.turn_deadline = (
                time.time() + TURN_SECONDS + TURN_GRACE_SECONDS
            )
            # Spawn a fresh turn timer for the new speaker.
            self._spawn_timer(
                room.code, "turn", self._run_turn_timer(room.code)
            )
            return

        # No more speakers — transition through scoring to complete.
        self._finalize_locked(room)

    def _finalize_locked(self, room: DebateRoom) -> None:
        """Transition an in-progress room through ``scoring`` → ``complete``.

        Analyses are already synchronous in this design, so scoring is
        effectively an instant hop.

        MUST be called with the room lock held.
        """
        room.state = "scoring"
        room.turn_deadline = None
        self._cancel_timer(room.code, "turn")

        turns = debate_turns_store.list_turns_for_debate(room.debate_id)
        winner_id = compute_winner(turns, room.participants)
        room.winner_participant_id = winner_id
        room.state = "complete"
        room.completed_at = time.time()
        self._cancel_all_timers(room.code)

        # Build the effective score list keyed by participant.
        turn_by_pid = {t.participant_id: t for t in turns}
        effective_scores: list[EffectiveScoreEntry] = []
        for p in room.participants:
            t = turn_by_pid.get(p.participant_id)
            if t is None:
                continue
            effective_scores.append(
                EffectiveScoreEntry(
                    participant_id=p.participant_id,
                    ai_score=t.ai_score,
                    teacher_override_score=t.teacher_override_score,
                    effective_score=compute_effective_score(t),
                )
            )

        # Build ranked standings for the completion screen. Order matches
        # compute_winner's cascade: effective_score DESC, then submitted_at
        # ASC, turn_index ASC, participant_id ASC as deterministic tiebreaks.
        display_by_pid = {p.participant_id: p.display_name for p in room.participants}
        forfeit_by_pid = {p.participant_id: p.is_forfeit for p in room.participants}
        ranked = sorted(
            (turn_by_pid[p.participant_id] for p in room.participants
             if p.participant_id in turn_by_pid),
            key=lambda t: (
                -compute_effective_score(t),
                t.submitted_at,
                t.turn_index,
                t.participant_id,
            ),
        )
        room.final_standings = [
            FinalStanding(
                participant_id=t.participant_id,
                display_name=display_by_pid.get(t.participant_id, "Speaker"),
                rank=idx + 1,
                ai_score=round(float(t.ai_score), 1),
                content_score=t.content_score,
                content_feedback=t.content_feedback,
                effective_score=round(compute_effective_score(t), 1),
                is_forfeit=forfeit_by_pid.get(t.participant_id, False),
                is_winner=(t.participant_id == winner_id),
            )
            for idx, t in enumerate(ranked)
        ]

        record = DebateRecord(
            debate_id=room.debate_id,
            code=room.code,
            motion_id=room.motion_id,
            motion_title=room.motion_title,
            motion_text=room.motion_text,
            participants=[
                {
                    "participant_id": p.participant_id,
                    "user_id": p.user_id,
                    "display_name": p.display_name,
                    "turn_index": p.turn_index,
                    "is_forfeit": p.is_forfeit,
                }
                for p in room.participants
            ],
            turn_ids=[t.turn_id for t in turns],
            winner_participant_id=winner_id,
            effective_scores=effective_scores,
            created_at=room.created_at,
            completed_at=room.completed_at,
        )
        try:
            debates_store.save_debate(record)
        except Exception as exc:
            logger.warning(
                "debate_persist_failed code=%s debate_id=%s err=%s",
                room.code,
                room.debate_id,
                type(exc).__name__,
            )

    async def _maybe_abandon(self, code: str) -> None:
        """If the connected non-forfeit count fell below 2, transition
        the room to ``abandoned`` without persisting a ``DebateRecord``.
        """
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return
            if room.state in ("complete", "abandoned", "waiting"):
                return
            if self._connected_non_forfeit_count(room) >= 2:
                return
            room.state = "abandoned"
            room.completed_at = time.time()
            room.paused = False
            room.reconnect_deadline = None
            room.turn_deadline = None
            room.prep_deadline = None
            room._pause_started_at = None
            self._reconnect_targets.pop(code, None)
            self._cancel_all_timers(code)
        # Do NOT call broadcast here to avoid double-broadcasts when
        # the caller already broadcasts. `handle_disconnect` /
        # `advance_or_forfeit` will broadcast after this returns.

    # ------------------------------------------------------------------
    # Broadcast
    # ------------------------------------------------------------------

    async def broadcast(self, code: str) -> None:
        room = self._rooms.get(code)
        if room is None:
            return
        public = self.to_public(room)
        payload = {"type": "state", "state": public.model_dump()}
        sockets = list(self._sockets.get(code, {}).items())
        for participant_id, ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception as exc:  # noqa: BLE001 — best-effort delivery
                logger.debug(
                    "broadcast_failed code=%s participant=%s err=%s",
                    code,
                    participant_id,
                    type(exc).__name__,
                )


# Module-level singleton — imported by routes and any future helpers.
debate_room_manager = DebateRoomManager()
