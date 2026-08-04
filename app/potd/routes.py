"""Authenticated Problem of the Day assignment and completion API."""

from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import User, require_user
from app.storage._jsonl import append_jsonl, read_jsonl

router = APIRouter(prefix="/potd", tags=["potd"])
ASSIGNMENTS_PATH = Path("outputs/potd_assignments.jsonl")
COMPLETIONS_PATH = Path("outputs/potd_completions.jsonl")
PROMPTS_PATH = Path(__file__).resolve().parents[1] / "data" / "pronunciation_prompts.json"

INTERVIEW_QUESTIONS = [
    {"id": "q-strength", "category": "behavioural", "prompt": "Walk me through a project you led — what went well, what would you do differently?", "hint": "Use STAR: Situation, Task, Action, Result. Keep it under 90 seconds."},
    {"id": "q-conflict", "category": "situational", "prompt": "Tell me about a time you disagreed with a teammate. How did you resolve it?", "hint": "Show empathy, listening, and the path to a shared outcome."},
    {"id": "q-systems", "category": "technical", "prompt": "Explain how you'd design a URL shortener at college-scale.", "hint": "Address storage, hash collisions, redirects, and rate limiting in one minute."},
    {"id": "q-feedback", "category": "behavioural", "prompt": "Describe the most useful feedback you've received this year.", "hint": "Self-awareness + action. Avoid blaming anyone."},
]


class PotdCompletion(BaseModel):
    score: float = Field(ge=0, le=100)
    result_id: str = ""


class PotdChallenge(BaseModel):
    id: str
    type: Literal["pronunciation", "interview"]
    title: str
    prompt: str
    hint: str = ""
    category: str = ""
    date: str
    completed: bool
    score: float | None = None
    current_streak: int
    best_streak: int
    badge: str | None = None


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _month(day: str) -> str:
    return day[:7]


def _user_key(user: User) -> str:
    return user.uid or user.email.lower()


def _records(path: Path, user: User) -> list[dict[str, Any]]:
    key = _user_key(user)
    return [row for row in read_jsonl(path) if row.get("user_id") == key]


def _pool() -> list[dict[str, Any]]:
    import json
    with PROMPTS_PATH.open("r", encoding="utf-8") as handle:
        prompts = json.load(handle)
    pronunciation = [
        {"id": p["id"], "type": "pronunciation", "title": "Pronunciation Drill", "prompt": p["text"], "hint": p.get("hint", ""), "category": p.get("difficulty", "medium")}
        for p in prompts
    ]
    interview = [
        {**q, "type": "interview", "title": "Interview Studio"}
        for q in INTERVIEW_QUESTIONS
    ]
    return pronunciation + interview


def _badge(score: float, streak: int) -> str | None:
    if streak >= 30:
        return "Monthly Master"
    if score >= 90:
        return "Standout Performer"
    if score >= 75:
        return "Strong Start"
    if score >= 60:
        return "Keep Building"
    return None


def _streak(completions: list[dict[str, Any]]) -> tuple[int, int]:
    days = {row.get("date") for row in completions}
    today = datetime.now(timezone.utc).date()
    current = 0
    cursor = today
    while cursor.isoformat() in days:
        current += 1
        from datetime import timedelta
        cursor -= timedelta(days=1)
    best = 0
    run = 0
    for day in sorted(d for d in days if isinstance(d, str)):
        if run == 0:
            run = 1
        else:
            from datetime import date, timedelta
            prev = date.fromisoformat(day) - timedelta(days=1)
            run = run + 1 if prev.isoformat() in days else 1
        best = max(best, run)
    return current, best


@router.get("/today", response_model=PotdChallenge)
async def get_today(current_user: User = Depends(require_user)) -> PotdChallenge:
    today = _today()
    assignments = _records(ASSIGNMENTS_PATH, current_user)
    existing = next((r for r in reversed(assignments) if r.get("date") == today), None)
    completions = _records(COMPLETIONS_PATH, current_user)
    if existing is None:
        completed_ids = {r.get("challenge_id") for r in completions if _month(r.get("date", "")) == _month(today)}
        pool = [item for item in _pool() if item["id"] not in completed_ids] or _pool()
        seed = int(hashlib.sha256(f"{_user_key(current_user)}:{today}".encode()).hexdigest(), 16)
        choice = random.Random(seed).choice(pool)
        existing = {**choice, "date": today, "user_id": _user_key(current_user)}
        append_jsonl(ASSIGNMENTS_PATH, existing)
    done = next((r for r in completions if r.get("date") == today and r.get("challenge_id") == existing["id"]), None)
    current, best = _streak(completions)
    return PotdChallenge(**{k: existing.get(k, "") for k in ("id", "type", "title", "prompt", "hint", "category")}, date=today, completed=done is not None, score=done.get("score") if done else None, current_streak=current, best_streak=best, badge=done.get("badge") if done else None)


@router.post("/{challenge_id}/complete", response_model=PotdChallenge)
async def complete_today(challenge_id: str, body: PotdCompletion, current_user: User = Depends(require_user)) -> PotdChallenge:
    challenge = await get_today(current_user)
    if challenge.id != challenge_id:
        raise HTTPException(status_code=409, detail="This is not today's assigned problem.")
    completions = _records(COMPLETIONS_PATH, current_user)
    if not any(r.get("date") == challenge.date and r.get("challenge_id") == challenge_id for r in completions):
        current, _ = _streak(completions)
        badge = _badge(body.score, current + 1)
        append_jsonl(COMPLETIONS_PATH, {"user_id": _user_key(current_user), "date": challenge.date, "challenge_id": challenge_id, "type": challenge.type, "score": body.score, "result_id": body.result_id, "badge": badge})
    return await get_today(current_user)
