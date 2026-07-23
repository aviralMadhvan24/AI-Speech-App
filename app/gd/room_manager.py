"""In-memory GD Room Manager with concurrent push-to-talk support."""

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
from typing import Dict, Optional

from fastapi import HTTPException, WebSocket

from app.auth import User
from app.core.daily_client import daily
from app.gd.schemas import (
    GDParticipantInternal,
    GDRoom,
    GDSpeechInternal,
    GDTopic,
    PublicGDRoom,
    to_public,
)

logger = logging.getLogger("gd.room_manager")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6

PREP_SECONDS = 120  # 2 minutes prep after all ready
DISCUSSION_SECONDS = 900  # 15 minutes discussion

# Dev mode allows single-player testing (set GD_DEV_MODE=true in .env)
_DEV_MODE = os.getenv("GD_DEV_MODE", "").lower() in ("true", "1", "yes")
MIN_PARTICIPANTS = 1 if _DEV_MODE else 5

# Log dev mode status at startup
import logging as _logging
_startup_logger = _logging.getLogger("gd.room_manager")
_startup_logger.info(f"GD_DEV_MODE={os.getenv('GD_DEV_MODE', 'NOT_SET')}, _DEV_MODE={_DEV_MODE}, MIN_PARTICIPANTS={MIN_PARTICIPANTS}")

MAX_PARTICIPANTS = 10
GC_TTL_SECONDS = 60 * 60
MIN_SPEECH_DURATION = 2.0  # seconds
MAX_SPEECH_DURATION = 90.0  # seconds

TOPICS_PATH = Path("app/data/gd_topics.json")

_topics_cache: Optional[list[GDTopic]] = None


def _load_topics() -> list[GDTopic]:
    """Load topics from JSON file."""
    global _topics_cache
    if _topics_cache is not None:
        return _topics_cache
    try:
        with open(TOPICS_PATH, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, list) or not raw:
            raise ValueError("topics file is empty or not a list")
        topics = [GDTopic.model_validate(entry) for entry in raw]
    except Exception as exc:
        logger.error(f"Failed to load GD topics: {exc}")
        raise HTTPException(status_code=500, detail="topics_unavailable") from exc
    _topics_cache = topics
    return _topics_cache


def _new_participant_id() -> str:
    return uuid.uuid4().hex[:16]


# ---------------------------------------------------------------------------
# Room Manager
# ---------------------------------------------------------------------------

class GDRoomManager:
    """Manages GD rooms with concurrent speech support."""

    def __init__(self):
        self._rooms: Dict[str, GDRoom] = {}
        self._sockets: Dict[str, Dict[str, WebSocket]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._timers: Dict[str, Dict[str, asyncio.Task]] = {}
        self._manager_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Helpers
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

    def _pick_random_topic(self) -> GDTopic:
        return random.choice(_load_topics())

    def get_state(self, code: str) -> Optional[GDRoom]:
        return self._rooms.get(code)

    def to_public(self, room: GDRoom) -> PublicGDRoom:
        return to_public(room)

    def _find_participant(self, room: GDRoom, user_id: str) -> Optional[GDParticipantInternal]:
        for p in room.participants:
            if p.user_id == user_id:
                return p
        return None

    def _find_participant_by_id(self, room: GDRoom, pid: str) -> Optional[GDParticipantInternal]:
        for p in room.participants:
            if p.participant_id == pid:
                return p
        return None

    # ------------------------------------------------------------------
    # Timer helpers
    # ------------------------------------------------------------------

    def _spawn_timer(self, code: str, name: str, coro) -> None:
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

    async def create_room(self, user: User) -> GDRoom:
        """Create new GD room."""
        async with self._manager_lock:
            code: Optional[str] = None
            for _ in range(8):
                candidate = self._random_code()
                if candidate not in self._rooms:
                    code = candidate
                    break
            if code is None:
                raise RuntimeError("Could not allocate room code")

            topic = self._pick_random_topic()
            now = time.time()
            first = GDParticipantInternal(
                participant_id=_new_participant_id(),
                user_id=user.uid,
                user_email=user.email,
                display_name=user.name or user.email,
                joined_at=now,
            )
            room = GDRoom(
                session_id=uuid.uuid4().hex,
                code=code,
                topic_id=topic.id,
                topic_title=topic.title,
                topic_text=topic.text,
                topic_category=topic.category,
                state="waiting",
                participants=[first],
                created_at=now,
            )
            self._rooms[code] = room
            self._locks[code] = asyncio.Lock()
            self._sockets[code] = {}
            self._timers[code] = {}
            return room

    async def join_room(self, code: str, user: User) -> GDRoom:
        """Join existing room."""
        if code not in self._rooms:
            raise HTTPException(status_code=404, detail="room_not_found")
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                raise HTTPException(status_code=404, detail="room_not_found")

            existing = self._find_participant(room, user.uid)
            if existing is not None:
                return room

            if room.state != "waiting":
                raise HTTPException(status_code=409, detail="room_not_joinable")
            if len(room.participants) >= MAX_PARTICIPANTS:
                raise HTTPException(status_code=409, detail="room_full")

            new_p = GDParticipantInternal(
                participant_id=_new_participant_id(),
                user_id=user.uid,
                user_email=user.email,
                display_name=user.name or user.email,
                joined_at=time.time(),
            )
            room.participants.append(new_p)

        await self.broadcast(code)
        return room

    async def flip_ready(self, code: str, user: User) -> GDRoom:
        """Toggle ready flag; auto-start prep after grace period."""
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

            # Cancel pending auto-start if anyone un-readies
            if not participant.is_ready:
                self._cancel_timer(code, "auto_start_grace")
                room.auto_start_deadline = None  # Clear the deadline from UI

            all_ready = (
                room.state == "waiting"
                and len(room.participants) >= MIN_PARTICIPANTS
                and all(p.is_ready for p in room.participants)
            )
            
            logger.info(
                f"flip_ready: code={code}, participants={len(room.participants)}, "
                f"MIN_PARTICIPANTS={MIN_PARTICIPANTS}, all_ready={all(p.is_ready for p in room.participants)}, "
                f"all_ready_condition={all_ready}"
            )

            if all_ready and len(room.participants) >= MAX_PARTICIPANTS:
                # Full room + all ready → start immediately
                room.state = "prep"
                room.prep_deadline = time.time() + PREP_SECONDS
                room.auto_start_deadline = None
                should_start_prep = True
                # Create Daily audio room
                asyncio.create_task(self._create_daily_room(code))
            elif all_ready:
                # Grace period for late joiners (20s)
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
        """Wait delay seconds then start prep if still all-ready."""
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None or room.state != "waiting":
                return
            if not (
                len(room.participants) >= MIN_PARTICIPANTS
                and all(p.is_ready for p in room.participants)
            ):
                return
            room.state = "prep"
            room.prep_deadline = time.time() + PREP_SECONDS
            room.auto_start_deadline = None  # Clear grace timer
        
        # Create Daily audio room (outside lock)
        asyncio.create_task(self._create_daily_room(code))
        
        self._spawn_timer(code, "prep", self._run_prep_timer(code))
        await self.broadcast(code)

    async def _create_daily_room(self, code: str) -> None:
        """Create Daily.co audio room for live discussion."""
        try:
            room = self._rooms.get(code)
            if room is None:
                return
            
            # Create unique room name
            room_name = f"gd-{code.lower()}-{room.session_id[:8]}"
            
            result = await daily.create_room(
                name=room_name,
                exp_minutes=30,  # Room expires 30 min after creation
                enable_chat=False,
            )
            
            if result:
                async with self._lock_for(code):
                    room = self._rooms.get(code)
                    if room:
                        room.daily_room_url = result["url"]
                        room.daily_room_name = result["name"]
                        logger.info(f"Daily room created for GD {code}: {result['url']}")
                await self.broadcast(code)
            else:
                logger.warning(f"Failed to create Daily room for GD {code}")
        except Exception as e:
            logger.error(f"Daily room creation error for {code}: {e}")

    async def _run_prep_timer(self, code: str) -> None:
        try:
            await asyncio.sleep(PREP_SECONDS)
        except asyncio.CancelledError:
            return
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None or room.state != "prep":
                return
            room.state = "discussion"
            room.prep_deadline = None
            room.discussion_deadline = time.time() + DISCUSSION_SECONDS
        self._spawn_timer(code, "discussion", self._run_discussion_timer(code))
        await self.broadcast(code)

    async def _run_discussion_timer(self, code: str) -> None:
        try:
            await asyncio.sleep(DISCUSSION_SECONDS)
        except asyncio.CancelledError:
            return
        await self.end_discussion(code)

    # ------------------------------------------------------------------
    # Speech management (Push-to-Talk)
    # ------------------------------------------------------------------

    async def start_speech(self, code: str, user: User) -> tuple[GDSpeechInternal, bool]:
        """Called when user presses PTT button - notifies backend of speech start."""
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                raise ValueError("room_not_found")
            if room.state != "discussion":
                raise ValueError("not_in_discussion")

            participant = self._find_participant(room, user.uid)
            if participant is None:
                raise ValueError("not_a_participant")

            # Check if this participant is already speaking
            if participant.participant_id in room.active_speakers:
                raise ValueError("already_speaking")

            now = time.time()
            
            # Check for interruption (other speakers active)
            concurrent_speakers = list(room.active_speakers)
            is_interruption = len(concurrent_speakers) > 0
            
            # Mark first speaker if no speeches yet
            if len(room.speeches) == 0:
                participant.is_first_speaker = True

            speech = GDSpeechInternal(
                speech_id=uuid.uuid4().hex,
                participant_id=participant.participant_id,
                display_name=participant.display_name,
                started_at=now,
                is_interruption=is_interruption,
                concurrent_speakers=concurrent_speakers,
            )
            room.speeches.append(speech)
            room.active_speakers.append(participant.participant_id)

            # Track interruption stats
            if is_interruption:
                participant.interruption_count += 1
                # Increment was_interrupted for others
                for other_pid in concurrent_speakers:
                    other = self._find_participant_by_id(room, other_pid)
                    if other:
                        other.was_interrupted_count += 1

        await self.broadcast(code)
        return speech, is_interruption

    async def end_speech(
        self,
        code: str,
        user: User,
        speech_id: str,
        audio_ref: Optional[str] = None,
        transcript: Optional[str] = None,
        analysis_id: Optional[str] = None,
    ) -> Optional[GDSpeechInternal]:
        """Called when user releases PTT button + audio uploaded."""
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return None
            
            # Find the speech
            speech = next(
                (s for s in room.speeches if s.speech_id == speech_id),
                None,
            )
            if speech is None:
                return None

            participant = self._find_participant(room, user.uid)
            if participant is None or participant.participant_id != speech.participant_id:
                return None

            now = time.time()
            duration = now - speech.started_at
            
            speech.ended_at = now
            speech.duration_seconds = duration
            speech.audio_ref = audio_ref
            speech.transcript = transcript
            speech.analysis_id = analysis_id

            # Update participant stats
            participant.speech_count += 1
            participant.total_speak_seconds += duration

            # Remove from active speakers
            if participant.participant_id in room.active_speakers:
                room.active_speakers.remove(participant.participant_id)

        await self.broadcast(code)
        return speech

    async def end_discussion(self, code: str) -> None:
        """Transition to scoring phase."""
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return
            if room.state != "discussion":
                return
            room.state = "scoring"
            room.scoring_started_at = time.time()
            room.discussion_deadline = None
            room.active_speakers = []  # Clear any active
            self._cancel_timer(code, "discussion")

        await self.broadcast(code)

    async def finalize_scores(self, code: str, scores: list) -> None:
        """Called after batch scoring completes."""
        async with self._lock_for(code):
            room = self._rooms.get(code)
            if room is None:
                return
            room.state = "complete"
            room.completed_at = time.time()

        await self.broadcast(code)

    # ------------------------------------------------------------------
    # WebSocket
    # ------------------------------------------------------------------

    async def attach_socket(self, code: str, participant_id: str, ws: WebSocket) -> None:
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

    async def detach_socket(self, code: str, participant_id: str, ws: WebSocket) -> None:
        async with self._lock_for(code):
            sockets = self._sockets.get(code)
            if sockets is None:
                return
            current = sockets.get(participant_id)
            if current is not ws:
                return
            sockets.pop(participant_id, None)
            room = self._rooms.get(code)
            if room is not None:
                participant = self._find_participant_by_id(room, participant_id)
                if participant is not None:
                    participant.disconnected_at = time.time()
                    participant.ws_connected_since = None
                
                # Also clear from active speakers if they disconnected while speaking
                if participant_id in room.active_speakers:
                    room.active_speakers.remove(participant_id)

    async def broadcast(self, code: str) -> None:
        """Send current state to all connected sockets."""
        room = self._rooms.get(code)
        if room is None:
            return
        public = self.to_public(room)
        payload = {"type": "state", "state": public.model_dump()}
        sockets = list(self._sockets.get(code, {}).items())
        for pid, ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception as exc:
                logger.debug(f"broadcast failed for {pid}: {type(exc).__name__}")


# Module singleton
gd_room_manager = GDRoomManager()
