"""Practice material a buddy session can be built around.

A session used to carry only a free-text ``topic``, which meant "practice"
was whatever the pair decided on the day — nothing to prepare for, and nothing
to measure afterwards. The platform already ships three catalogs of speaking
material; this exposes them in one shape so a session can point at a real item.

Read-only and cached: these files are small, shipped with the app, and change
only when a teacher edits them (which invalidates the catalogs that own them).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from app.buddy.schemas import PracticePrompt

logger = logging.getLogger("buddy.practice")

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

PRONUNCIATION_PATH = DATA_DIR / "pronunciation_prompts.json"
DEBATE_PATH = DATA_DIR / "debate_motions.json"
GD_PATH = DATA_DIR / "gd_topics.json"


def _load(path: Path) -> list:
    """Parse a catalog, treating a broken file as empty rather than fatal.

    One unreadable catalog must not take session planning down for the other
    two — the pair can still pick from whatever loaded.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
        return raw if isinstance(raw, list) else []
    except Exception as exc:
        logger.warning("practice_catalog_failed path=%s err=%s", path.name, type(exc).__name__)
        return []


def _text(entry: dict, *keys: str) -> str:
    """First non-empty value among `keys` — the catalogs disagree on naming."""
    for key in keys:
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def list_prompts(kind: Optional[str] = None) -> list[PracticePrompt]:
    """Every practice item, or just one catalog's worth."""
    out: list[PracticePrompt] = []

    if kind in (None, "pronunciation"):
        for entry in _load(PRONUNCIATION_PATH):
            if not isinstance(entry, dict):
                continue
            title = _text(entry, "text", "prompt", "title", "sentence")
            if not title:
                continue
            out.append(
                PracticePrompt(
                    kind="pronunciation",
                    id=str(entry.get("id") or title[:40]),
                    title=title,
                    detail=_text(entry, "hint", "difficulty"),
                )
            )

    if kind in (None, "debate"):
        for entry in _load(DEBATE_PATH):
            if not isinstance(entry, dict):
                continue
            title = _text(entry, "title", "motion", "motion_title")
            if not title:
                continue
            out.append(
                PracticePrompt(
                    kind="debate",
                    id=str(entry.get("id") or title[:40]),
                    title=title,
                    detail=_text(entry, "text", "motion_text", "description"),
                )
            )

    if kind in (None, "gd"):
        for entry in _load(GD_PATH):
            if not isinstance(entry, dict):
                continue
            title = _text(entry, "title", "topic", "topic_title")
            if not title:
                continue
            out.append(
                PracticePrompt(
                    kind="gd",
                    id=str(entry.get("id") or title[:40]),
                    title=title,
                    detail=_text(entry, "text", "description", "context"),
                )
            )

    return out


def find(kind: str, prompt_id: str) -> Optional[PracticePrompt]:
    """Resolve one item, so a session can never point at a prompt that is gone."""
    for prompt in list_prompts(kind):
        if prompt.id == prompt_id:
            return prompt
    return None
