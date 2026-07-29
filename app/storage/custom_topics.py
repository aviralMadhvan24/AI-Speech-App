"""Teacher-authored debate motions and GD topics.

These live under ``outputs/`` (gitignored) rather than alongside the shipped
catalogs in ``app/data/``. That matters for two reasons:

- the deploy script runs ``git checkout -- .`` followed by ``git pull``, which
  would silently discard any edit made to a tracked file;
- the shipped catalog stays pristine, so a bad custom entry is one delete away
  from being undone.

Both collections are merged on top of the built-in catalog at load time.
"""

from __future__ import annotations

import re
import time
import uuid
from pathlib import Path
from typing import Optional

from app.core.logger import logger
from app.storage._jsonl import append_jsonl, read_jsonl, overwrite_jsonl


_MOTIONS_PATH = Path("outputs/custom_debate_motions.jsonl")
_TOPICS_PATH = Path("outputs/custom_gd_topics.jsonl")

# Prefix marks an entry as teacher-authored, so the API can allow deleting it
# while keeping the built-in catalog read-only.
CUSTOM_ID_PREFIX = "custom-"


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:40] or "topic"


def new_custom_id(title: str) -> str:
    """Build a collision-resistant, human-readable id for a new entry."""
    return f"{CUSTOM_ID_PREFIX}{_slugify(title)}-{uuid.uuid4().hex[:6]}"


def is_custom(entry_id: str) -> bool:
    return str(entry_id).startswith(CUSTOM_ID_PREFIX)


def _list(path: Path) -> list[dict]:
    rows = read_jsonl(path)
    # Later rows win on duplicate ids, so an edit-by-reinsert behaves sanely.
    by_id: dict[str, dict] = {}
    for row in rows:
        entry_id = row.get("id")
        if not entry_id:
            continue
        by_id[entry_id] = row
    return list(by_id.values())


def _add(path: Path, record: dict) -> dict:
    record = {**record, "created_at": time.time()}
    append_jsonl(path, record)
    logger.info("custom topic added path=%s id=%s", path, record.get("id"))
    return record


def _delete(path: Path, entry_id: str) -> bool:
    rows = read_jsonl(path)
    remaining = [row for row in rows if row.get("id") != entry_id]
    if len(remaining) == len(rows):
        return False
    overwrite_jsonl(path, remaining)
    logger.info("custom topic deleted path=%s id=%s", path, entry_id)
    return True


def _get(path: Path, entry_id: str) -> Optional[dict]:
    return next((row for row in _list(path) if row.get("id") == entry_id), None)


# --- Debate motions -------------------------------------------------------

def list_motions() -> list[dict]:
    return _list(_MOTIONS_PATH)


def add_motion(*, title: str, text: str, created_by: str) -> dict:
    return _add(
        _MOTIONS_PATH,
        {
            "id": new_custom_id(title),
            "title": title,
            "text": text,
            "created_by": created_by,
        },
    )


def delete_motion(motion_id: str) -> bool:
    return _delete(_MOTIONS_PATH, motion_id)


def get_motion(motion_id: str) -> Optional[dict]:
    return _get(_MOTIONS_PATH, motion_id)


# --- GD topics ------------------------------------------------------------

def list_topics() -> list[dict]:
    return _list(_TOPICS_PATH)


def add_topic(*, title: str, text: str, category: str, created_by: str) -> dict:
    return _add(
        _TOPICS_PATH,
        {
            "id": new_custom_id(title),
            "title": title,
            "text": text,
            "category": category,
            "created_by": created_by,
        },
    )


def delete_topic(topic_id: str) -> bool:
    return _delete(_TOPICS_PATH, topic_id)


def get_topic(topic_id: str) -> Optional[dict]:
    return _get(_TOPICS_PATH, topic_id)
