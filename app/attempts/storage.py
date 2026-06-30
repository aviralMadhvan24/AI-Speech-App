import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import List

from app.attempts.schemas import AttemptSummary
from app.core.logger import logger


ATTEMPTS_PATH = Path("outputs/attempts.jsonl")

MAX_ATTEMPTS_RETURNED = 50

_write_lock = Lock()


def _ensure_parent_dir():
    ATTEMPTS_PATH.parent.mkdir(parents=True, exist_ok=True)


def save_attempt(attempt: AttemptSummary) -> None:
    _ensure_parent_dir()

    line = attempt.model_dump_json()

    with _write_lock:
        with open(ATTEMPTS_PATH, "a", encoding="utf-8") as attempts_file:
            attempts_file.write(line + "\n")

    logger.info(f"Saved attempt {attempt.analysis_id}")


def load_recent_attempts(limit: int = MAX_ATTEMPTS_RETURNED) -> List[AttemptSummary]:
    if not ATTEMPTS_PATH.exists():
        return []

    safe_limit = max(1, min(limit, MAX_ATTEMPTS_RETURNED))

    attempts: List[AttemptSummary] = []

    with open(ATTEMPTS_PATH, "r", encoding="utf-8") as attempts_file:
        for raw_line in attempts_file:
            stripped = raw_line.strip()

            if not stripped:
                continue

            try:
                payload = json.loads(stripped)
                attempts.append(AttemptSummary(**payload))
            except (json.JSONDecodeError, TypeError, ValueError) as error:
                logger.warning(f"Skipping malformed attempt row: {error}")
                continue

    return list(reversed(attempts))[:safe_limit]


def count_attempts() -> int:
    if not ATTEMPTS_PATH.exists():
        return 0

    with open(ATTEMPTS_PATH, "r", encoding="utf-8") as attempts_file:
        return sum(1 for line in attempts_file if line.strip())
