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

from app.core.config import settings

logger = logging.getLogger("llm_client")


class LLMUnavailableError(RuntimeError):
    """No LLM provider could be reached.

    Distinguished from a malformed response so callers can report the real
    cause. `is_available` cannot detect this on its own: the Ollama URL has a
    default value, so it always looks configured even when nothing is
    listening on it.
    """


class LLMClient:
    """Unified LLM client - uses Groq in production, Ollama locally."""

    def __init__(self):
        # Prefer Settings (which reads both real env vars and `.env`) and fall
        # back to os.getenv so anything exported at runtime still wins.
        self.groq_key = settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")
        self.groq_model = os.getenv("GROQ_MODEL") or settings.GROQ_MODEL
        effort = os.getenv("GROQ_REASONING_EFFORT")
        self.groq_reasoning_effort = (
            effort if effort is not None else settings.GROQ_REASONING_EFFORT
        ).strip()
        self.ollama_url = (
            os.getenv("OLLAMA_URL") or settings.OLLAMA_URL or "http://localhost:11434"
        )
        self.timeout = 45.0  # seconds
        logger.info(
            "LLM client initialised: provider=%s",
            f"groq({self.groq_model})" if self.groq_key else f"ollama({self.ollama_url})",
        )

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
        payload = {
            "model": self.groq_model,
            "messages": [{"role": "user", "content": prompt}],
            # Groq's OpenAI-compatible JSON mode prevents the
            # debate judge from wrapping its rubric in prose or a
            # markdown fence, which was the main source of the
            # "Could not parse LLM response" fallback.
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
            "max_tokens": max_tokens,
        }
        # On a reasoning model the reasoning is billed against max_tokens, so an
        # uncapped effort starves the JSON body the scorers actually need. See
        # Settings.GROQ_REASONING_EFFORT.
        if self.groq_reasoning_effort:
            payload["reasoning_effort"] = self.groq_reasoning_effort
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.groq_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                if resp.status_code == 400:
                    salvaged = self._salvage_failed_generation(resp)
                    if salvaged:
                        logger.warning(
                            "Groq rejected its own JSON (json_validate_failed); "
                            "recovering the raw generation instead of losing the score"
                        )
                        return salvaged
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            logger.error(f"Groq API error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Groq request failed: {type(e).__name__}: {e}")
            raise

    @staticmethod
    def _repair_json_quotes(json_str: str) -> str:
        """Fix the doubled-double-quote pattern models produce when quoting text.

        Two distinct mistakes need different repairs:

        1. A whole value wrapped twice - ``"quote": ""some text""`` - where the
           outer pair is the real delimiter, so the extra pair is dropped.
        2. A stray inner pair inside an otherwise valid string - ``"the word
           ""x"" is wrong"`` - where the inner quotes must become single quotes,
           since dropping them would terminate the string early.
        """
        # Case 1: the doubled quotes span an entire value.
        repaired = re.sub(
            r':\s*""([^"]*)""\s*(?=[,}\]])',
            lambda m: ': "%s"' % m.group(1),
            json_str,
        )
        if repaired != json_str:
            try:
                json.JSONDecoder().raw_decode(repaired.lstrip())
                return repaired
            except json.JSONDecodeError:
                pass

        # Case 2: collapse any remaining doubled quotes to single quotes.
        return re.sub(r'""([^"]+?)""', r"'\1'", repaired)

    @staticmethod
    def _salvage_failed_generation(resp: httpx.Response) -> Optional[str]:
        """Pull the model's raw output out of a Groq ``json_validate_failed`` 400.

        In JSON mode Groq validates the completion and, when the model emits
        malformed JSON, answers 400 with the rejected text under
        ``error.failed_generation``. That text still holds the rubric scores, so
        returning it lets the caller's own parser/repair pass have a go rather
        than throwing the whole turn's content score away.
        """
        try:
            payload = resp.json()
        except Exception:  # noqa: BLE001 - body may not be JSON at all
            return None

        error = payload.get("error") if isinstance(payload, dict) else None
        if not isinstance(error, dict):
            return None
        if error.get("code") != "json_validate_failed":
            return None
        failed = error.get("failed_generation")
        return failed if isinstance(failed, str) and failed.strip() else None

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
        except httpx.ConnectError as e:
            logger.warning(
                "Ollama not reachable at %s - content scoring unavailable",
                self.ollama_url,
            )
            raise LLMUnavailableError(
                f"no LLM provider reachable (set GROQ_API_KEY, or start Ollama "
                f"at {self.ollama_url})"
            ) from e
        except Exception as e:
            logger.error(f"Ollama request failed: {type(e).__name__}: {e}")
            raise

    async def generate_json(self, prompt: str, max_tokens: int = 500) -> Optional[dict]:
        """Generate and parse JSON response from LLM.

        Returns None when the response could not be parsed. Raises
        `LLMUnavailableError` when no provider could be reached, so callers can
        tell "the model replied with junk" apart from "there is no model".
        """
        try:
            response = await self.generate(prompt, max_tokens)
            # Extract JSON from response (handle markdown code blocks). First
            # ask the decoder for the first complete object rather than taking
            # everything through the final `}`; a model can append an example
            # or explanation containing braces after the answer.
            json_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", response, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                # Try to find JSON object with nested arrays/objects
                # Find the first { and last } to capture the full JSON
                start = response.find("{")
                end = response.rfind("}")
                if start != -1 and end != -1 and end > start:
                    json_str = response[start:end + 1]
                else:
                    logger.warning(f"Could not extract JSON from LLM response: {response[:200]}")
                    return None
            
            # Sanitize JSON string - escape control characters inside strings only
            # This handles LLM outputs that include raw newlines in feedback text
            def sanitize_json(s: str) -> str:
                # First, try to parse as-is
                try:
                    json.loads(s)
                    return s
                except json.JSONDecodeError:
                    pass
                
                # Replace raw newlines/tabs in string values with escaped versions
                result = []
                in_string = False
                i = 0
                while i < len(s):
                    c = s[i]
                    
                    # Handle escape sequences
                    if c == '\\' and i + 1 < len(s):
                        result.append(c)
                        result.append(s[i + 1])
                        i += 2
                        continue
                    
                    # Track string boundaries
                    if c == '"':
                        in_string = not in_string
                        result.append(c)
                        i += 1
                        continue
                    
                    # Handle control characters
                    if ord(c) < 32:
                        if in_string:
                            # Inside a string - escape them
                            if c == '\n':
                                result.append('\\n')
                            elif c == '\r':
                                result.append('\\r')
                            elif c == '\t':
                                result.append('\\t')
                            # Skip other control characters inside strings
                        else:
                            # Outside string - these are formatting, keep newlines/tabs
                            if c in '\n\r\t':
                                result.append(c)
                        i += 1
                        continue
                    
                    result.append(c)
                    i += 1
                
                return ''.join(result)
            
            json_str = sanitize_json(json_str)
            try:
                decoded = json.JSONDecoder().raw_decode(json_str.lstrip())
            except json.JSONDecodeError:
                repaired = self._repair_json_quotes(json_str)
                if repaired == json_str:
                    raise
                logger.warning("Repairing doubled quotes in LLM JSON response")
                decoded = json.JSONDecoder().raw_decode(repaired.lstrip())
            parsed = decoded[0]
            if not isinstance(parsed, dict):
                logger.warning("LLM JSON response was not an object")
                return None
            return parsed
            
        except LLMUnavailableError:
            # Propagate: this is a configuration/connectivity problem, not a
            # parsing problem, and reporting it as the latter is misleading.
            raise
        except json.JSONDecodeError as e:
            logger.warning(f"JSON parse error: {e}")
            return None
        except Exception as e:
            logger.error(f"generate_json failed: {type(e).__name__}: {e}")
            return None


# Singleton instance
llm = LLMClient()
