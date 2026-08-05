"""LiveKit API client for live audio rooms.

Configuration (via `.env` or real environment variables):
- LIVEKIT_API_KEY: LiveKit API key
- LIVEKIT_API_SECRET: LiveKit API secret
- LIVEKIT_URL: LiveKit server URL (e.g., wss://your-project.livekit.cloud)

These are read through `settings` rather than `os.getenv`, because nothing in
`app/` exports `.env` into the process environment. Reading them directly from
`os.getenv` left live audio silently disabled during local development.
"""

import logging
import time
from typing import Optional

import jwt

from app.core.config import settings

logger = logging.getLogger("livekit_client")

LIVEKIT_API_KEY = settings.LIVEKIT_API_KEY
LIVEKIT_API_SECRET = settings.LIVEKIT_API_SECRET
LIVEKIT_URL = settings.LIVEKIT_URL


class LiveKitClient:
    """Client for LiveKit token generation."""

    def __init__(self):
        self.api_key = LIVEKIT_API_KEY
        self.api_secret = LIVEKIT_API_SECRET
        self.url = LIVEKIT_URL

    @property
    def is_available(self) -> bool:
        """Check if LiveKit is configured."""
        return bool(self.api_key and self.api_secret and self.url)

    def create_token(
        self,
        room_name: str,
        participant_name: str,
        participant_identity: str,
        ttl_seconds: int = 3600,
    ) -> Optional[str]:
        """Create a LiveKit access token for a participant.
        
        Args:
            room_name: Name of the room to join
            participant_name: Display name of the participant
            participant_identity: Unique identifier for the participant
            ttl_seconds: Token validity in seconds
            
        Returns:
            JWT token string or None if not configured
        """
        if not self.is_available:
            logger.warning("LiveKit not configured")
            return None

        try:
            now = int(time.time())
            
            # Video grant - room permissions
            video_grant = {
                "roomJoin": True,
                "room": room_name,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            }
            
            # Build claims
            claims = {
                "iss": self.api_key,
                "sub": participant_identity,
                "name": participant_name,
                "iat": now,
                "nbf": now,
                "exp": now + ttl_seconds,
                "video": video_grant,
                "metadata": "",
            }
            
            # Sign token
            token = jwt.encode(
                claims,
                self.api_secret,
                algorithm="HS256",
            )
            
            logger.info(f"Created LiveKit token for {participant_name} in room {room_name}")
            return token
            
        except Exception as e:
            logger.error(f"LiveKit token creation failed: {type(e).__name__}: {e}")
            return None

    def get_room_info(self, room_name: str) -> dict:
        """Get room connection info.
        
        Returns:
            {"url": "wss://...", "room": "room-name"}
        """
        return {
            "url": self.url,
            "room": room_name,
        }


# Singleton
livekit = LiveKitClient()
