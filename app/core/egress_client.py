"""LiveKit Egress client for per-participant audio recording.

Uses the livekit-api Python SDK to start/stop Track Egress for each
participant in a GD or Debate room. Each track is saved as an OGG file
on the server at /opt/livekit/egress-out/.
"""

import asyncio
import logging
import os
from typing import Optional

from livekit import api
from livekit.api import LiveKitAPI
from livekit.protocol.egress import (
    TrackEgressRequest,
    DirectFileOutput,
    StopEgressRequest,
    ListEgressRequest,
)

from app.core.config import settings

logger = logging.getLogger("egress_client")

LIVEKIT_API_KEY = settings.LIVEKIT_API_KEY
LIVEKIT_API_SECRET = settings.LIVEKIT_API_SECRET
LIVEKIT_URL = settings.LIVEKIT_URL
EGRESS_OUTPUT_DIR = "/opt/livekit/egress-out"


class LiveKitUnreachableError(RuntimeError):
    """The LiveKit server did not answer.

    Kept distinct from "the room is empty" on purpose. Both used to reach the
    caller as an empty participant list, so a LiveKit outage looked exactly
    like a discussion nobody spoke in — the recording silently did not happen
    and the session was still scored and reported as complete. Anything that
    starts a recording needs to tell those two apart.
    """


class EgressClient:
    """Manages LiveKit Track Egress for per-participant recording."""

    def __init__(self):
        self.api_key = LIVEKIT_API_KEY
        self.api_secret = LIVEKIT_API_SECRET
        self.url = LIVEKIT_URL
        # Map: room_name -> {participant_identity: egress_id}
        self._active_egresses: dict[str, dict[str, str]] = {}

    @property
    def is_available(self) -> bool:
        return bool(self.api_key and self.api_secret and self.url)

    @staticmethod
    async def _close_api(lk_api: Optional[LiveKitAPI]) -> None:
        """Close a LiveKitAPI client, ignoring shutdown errors.

        Called from `finally` blocks, so it must never raise and mask the
        original failure.
        """
        if lk_api is None:
            return
        try:
            await lk_api.aclose()
        except Exception as exc:  # noqa: BLE001 - cleanup must not raise
            logger.debug("Ignoring LiveKitAPI close error: %s", type(exc).__name__)

    def _get_api(self) -> LiveKitAPI:
        """Create LiveKitAPI client."""
        # Use internal URL for server-to-server communication
        internal_url = settings.LIVEKIT_INTERNAL_URL
        if internal_url:
            http_url = internal_url
        else:
            # Convert ws:// to http:// for API calls
            http_url = self.url.replace("ws://", "http://").replace("wss://", "https://")
        return LiveKitAPI(
            url=http_url,
            api_key=self.api_key,
            api_secret=self.api_secret,
        )

    async def start_track_egress(
        self,
        room_name: str,
        track_sid: str,
        participant_identity: str,
        output_filename: str,
    ) -> Optional[str]:
        """Start recording a specific audio track to file.
        
        Returns egress_id or None on failure.
        """
        if not self.is_available:
            logger.warning("Egress not available - LiveKit not configured")
            return None

        # `aclose()` must run on the failure path too, otherwise every failed
        # attempt leaks an aiohttp session and connector ("Unclosed client
        # session" errors), which piles up fast because this method is retried.
        lk_api = None
        try:
            lk_api = self._get_api()

            # File output path (inside the egress container mapped to /out)
            filepath = f"/out/{output_filename}"

            request = TrackEgressRequest(
                room_name=room_name,
                track_id=track_sid,
                file=DirectFileOutput(
                    filepath=filepath,
                ),
            )

            response = await lk_api.egress.start_track_egress(request)
            egress_id = response.egress_id

            # Track it
            if room_name not in self._active_egresses:
                self._active_egresses[room_name] = {}
            self._active_egresses[room_name][participant_identity] = egress_id

            logger.info(
                f"Started track egress: room={room_name}, "
                f"participant={participant_identity}, egress_id={egress_id}, "
                f"file={output_filename}"
            )
            return egress_id

        except Exception as e:
            logger.error(f"Failed to start track egress: {type(e).__name__}: {e}")
            return None
        finally:
            await self._close_api(lk_api)

    async def stop_egress(self, egress_id: str) -> bool:
        """Stop a specific egress by ID."""
        if not self.is_available:
            return False

        lk_api = None
        try:
            lk_api = self._get_api()
            await lk_api.egress.stop_egress(StopEgressRequest(egress_id=egress_id))
            logger.info(f"Stopped egress: {egress_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to stop egress {egress_id}: {type(e).__name__}: {e}")
            return False
        finally:
            await self._close_api(lk_api)

    async def stop_all_for_room(self, room_name: str) -> dict[str, str]:
        """Stop all active egresses for a room.
        
        Returns map of participant_identity -> egress_id that were stopped.
        """
        stopped = {}
        room_egresses = self._active_egresses.pop(room_name, {})
        
        for participant_id, egress_id in room_egresses.items():
            success = await self.stop_egress(egress_id)
            if success:
                stopped[participant_id] = egress_id
            
        logger.info(f"Stopped {len(stopped)} egresses for room {room_name}")
        return stopped

    async def list_room_egresses(self, room_name: str) -> list:
        """List all egresses for a room (from LiveKit server)."""
        if not self.is_available:
            return []
        lk_api = None
        try:
            lk_api = self._get_api()
            response = await lk_api.egress.list_egress(
                ListEgressRequest(room_name=room_name)
            )
            return list(response.items)
        except Exception as e:
            logger.error(f"Failed to list egresses: {type(e).__name__}: {e}")
            return []
        finally:
            await self._close_api(lk_api)

    async def get_room_participants(self, room_name: str) -> list:
        """Get current participants in a LiveKit room with their track SIDs."""
        if not self.is_available:
            return []
        lk_api = None
        try:
            lk_api = self._get_api()
            response = await lk_api.room.list_participants(
                api.ListParticipantsRequest(room=room_name)
            )
            return list(response.participants)
        except Exception as e:
            raise LiveKitUnreachableError(
                f"Failed to list participants in {room_name}: "
                f"{type(e).__name__}: {e}"
            ) from e
        finally:
            await self._close_api(lk_api)

    async def start_all_track_egresses(self, room_name: str, session_id: str) -> dict[str, str]:
        """Start egress for ALL audio tracks in a room.
        
        Returns map of participant_identity -> egress_id.
        Retries up to 3 times with 5s delay to wait for tracks to be published.
        
        Raises LiveKitUnreachableError if LiveKit never answered, so the caller
        can distinguish "we could not record" from "nobody had anything to
        record". Returns an empty map when LiveKit answered but the room held
        no audio tracks.
        """
        started = {}
        unreachable: Optional[LiveKitUnreachableError] = None
        
        # Retry loop — participants may not have published tracks yet
        for attempt in range(4):
            try:
                participants = await self.get_room_participants(room_name)
            except LiveKitUnreachableError as exc:
                # Worth retrying: LiveKit restarting mid-discussion is the
                # common case, and it usually comes back within a few seconds.
                # Remember the last error so that if every attempt fails we can
                # say *why* nothing was recorded instead of reporting an empty
                # room.
                unreachable = exc
                participants = []
                logger.warning(f"Egress attempt {attempt+1}: {exc}")
            else:
                unreachable = None
                logger.info(
                    f"Egress attempt {attempt+1}: found {len(participants)} participants in {room_name}"
                )
            
            for participant in participants:
                identity = participant.identity
                if identity in started:
                    continue  # Already started for this participant
                    
                # Find the audio track.
                # LiveKit protobuf enums:
                #   TrackType: AUDIO=0, VIDEO=1, DATA=2
                #   TrackSource: UNKNOWN=0, CAMERA=1, MICROPHONE=2
                audio_track = None
                for track in participant.tracks:
                    logger.info(
                        f"  Track for {identity}: sid={track.sid}, "
                        f"type={track.type}, source={track.source}, name={track.name}"
                    )
                    # AUDIO type == 0, or MICROPHONE source == 2
                    if track.type == 0 or track.source == 2:
                        audio_track = track
                        break
                
                if audio_track is None:
                    logger.warning(f"No audio track for participant {identity} (attempt {attempt+1})")
                    continue
                
                filename = f"{session_id}_{identity}.ogg"
                egress_id = await self.start_track_egress(
                    room_name=room_name,
                    track_sid=audio_track.sid,
                    participant_identity=identity,
                    output_filename=filename,
                )
                if egress_id:
                    started[identity] = egress_id
            
            # If we got all participants, stop retrying
            if len(started) >= len(participants) and len(started) > 0:
                break
            
            # Wait before retrying
            if attempt < 3:
                await asyncio.sleep(5)
        
        if unreachable is not None:
            # Every attempt failed to reach LiveKit. Raising here is the point
            # of this function: the discussion is about to run for several
            # minutes recording nothing, and the caller has to know that now
            # rather than discovering it at scoring time.
            raise LiveKitUnreachableError(
                f"Recording {room_name} never started: LiveKit unreachable "
                f"after 4 attempts: {unreachable}"
            )
        
        if not started:
            # LiveKit answered and told us the room was empty (or nobody had a
            # microphone track). Not an outage, but still a discussion that
            # will produce no audio, so it does not belong at INFO.
            logger.error(
                f"Started 0 track egresses for room {room_name}: no participant "
                f"published an audio track. This discussion will have no recording."
            )
            return started
        
        logger.info(f"Started {len(started)} track egresses for room {room_name}")
        return started

    def get_output_path(self, session_id: str, participant_identity: str) -> str:
        """Get the expected output file path for a participant's recording."""
        return os.path.join(EGRESS_OUTPUT_DIR, f"{session_id}_{participant_identity}.ogg")


# Singleton
egress_client = EgressClient()
