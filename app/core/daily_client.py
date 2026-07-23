"""Daily.co API client for live audio rooms.

Environment variables:
- DAILY_API_KEY: Daily.co API key (from dashboard.daily.co)
"""

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("daily_client")

DAILY_API_KEY = os.getenv("DAILY_API_KEY", "")
DAILY_API_URL = "https://api.daily.co/v1"


class DailyClient:
    """Client for Daily.co REST API."""

    def __init__(self):
        self.api_key = DAILY_API_KEY
        self.timeout = 30.0

    @property
    def is_available(self) -> bool:
        """Check if Daily API is configured."""
        return bool(self.api_key)

    async def create_room(
        self,
        name: str,
        exp_minutes: int = 60,
        enable_chat: bool = False,
    ) -> Optional[dict]:
        """Create a new Daily room for audio.
        
        Args:
            name: Room name (alphanumeric + hyphens)
            exp_minutes: Room expiration in minutes
            enable_chat: Enable text chat
            
        Returns:
            {"url": "https://xxx.daily.co/room-name", "name": "room-name"} or None
        """
        if not self.is_available:
            logger.warning("Daily API key not configured")
            return None

        import time
        exp_time = int(time.time()) + (exp_minutes * 60)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{DAILY_API_URL}/rooms",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "name": name,
                        "privacy": "public",  # Anyone with URL can join
                        "properties": {
                            "exp": exp_time,
                            "enable_chat": enable_chat,
                            "enable_knocking": False,
                            "start_video_off": True,  # Audio only
                            "start_audio_off": False,
                            "enable_screenshare": False,
                            "enable_recording": False,
                            "max_participants": 12,
                        },
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                logger.info(f"Created Daily room: {data.get('url')}")
                return {
                    "url": data.get("url"),
                    "name": data.get("name"),
                }
        except httpx.HTTPStatusError as e:
            logger.error(f"Daily API error: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            logger.error(f"Daily room creation failed: {type(e).__name__}: {e}")
            return None

    async def delete_room(self, room_name: str) -> bool:
        """Delete a Daily room."""
        if not self.is_available:
            return False

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.delete(
                    f"{DAILY_API_URL}/rooms/{room_name}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                resp.raise_for_status()
                logger.info(f"Deleted Daily room: {room_name}")
                return True
        except Exception as e:
            logger.warning(f"Daily room deletion failed: {e}")
            return False

    async def get_room(self, room_name: str) -> Optional[dict]:
        """Get room info."""
        if not self.is_available:
            return None

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{DAILY_API_URL}/rooms/{room_name}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.warning(f"Daily room get failed: {e}")
            return None


# Singleton
daily = DailyClient()
