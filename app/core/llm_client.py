"""Unified LLM client for content scoring.

Uses Groq API in production (free tier), falls back to Ollama for local dev.
Environment variables:
- GROQ_API_KEY: Groq API key (production)
- OLLAMA_URL: Ollama server URL (local dev, default http://localhost:11434)
"""

import json
import logging
import os
import re
from typing import Any, Optional

import httpx

logger = logging.getLogger("llm_client")


class LLMClient:
    """Unified LLM client - uses Groq in production, Ollama locally."""

    def __init__(self):
        self.groq_key = os.getenv("GROQ_API_KEY")
        self.ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.timeout = 45.0  # seconds

    @property
    def provider(self) -> str:
        """Return which provider is active."""
        return "groq" if self.groq_key else "ollama"

    @property
    def is_available(self) -> bool:
        """Check if any LLM provider is configured."""
        return bool(self.groq_key) or bool(self.ollama_url)

    async def generate(self, prompt: str, max_tokens: int = 500) -> str:
        """Generate text completion from the configured LLM provider."""
        if self.groq_key:
            return await self._groq_generate(prompt, max_tokens)
        return await self._ollama_generate(prompt, max_tokens)

    async def _groq_generate(self, prompt: str, max_tokens: int) -> str:
        """Generate using Groq API (OpenAI-compatible)."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.groq_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                        "max_tokens": max_tokens,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            logger.error(f"Groq API error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Groq request failed: {type(e).__name__}: {e}")
            raise

    async def _ollama_generate(self, prompt: str, max_tokens: int) -> str:
        """Generate using local Ollama server."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.ollama_url}/api/generate",
                    json={
                        "model": "qwen2.5:7b",
                        "prompt": prompt,
                        "stream": False,
                        "options": {"num_predict": max_tokens},
                    },
                )
                resp.raise_for_status()
                return resp.json()["response"]
        except httpx.ConnectError:
            logger.warning("Ollama not running - content scoring unavailable")
            raise
        except Exception as e:
            logger.error(f"Ollama request failed: {type(e).__name__}: {e}")
            raise

    async def generate_json(self, prompt: str, max_tokens: int = 500) -> Optional[dict]:
        """Generate and parse JSON response from LLM."""
        try:
            response = await self.generate(prompt, max_tokens)
            # Extract JSON from response (handle markdown code blocks)
            json_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            # Try to find JSON object with nested arrays/objects
            # Find the first { and last } to capture the full JSON
            start = response.find("{")
            end = response.rfind("}")
            if start != -1 and end != -1 and end > start:
                json_str = response[start:end + 1]
                return json.loads(json_str)
            logger.warning(f"Could not extract JSON from LLM response: {response[:200]}")
            return None
        except json.JSONDecodeError as e:
            logger.warning(f"JSON parse error: {e}")
            return None
        except Exception as e:
            logger.error(f"generate_json failed: {type(e).__name__}: {e}")
            return None


# Singleton instance
llm = LLMClient()
