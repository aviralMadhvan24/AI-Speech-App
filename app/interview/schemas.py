"""Public-facing pydantic shapes for the Interview Studio endpoints.

We intentionally re-shape the ss3 response into something flatter so the
frontend doesn't need to know about ss3's internal `Report` / `OverallScore`
/ `MetricResult` structure.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel
from pydantic import Field


class GestureMetric(BaseModel):
    """One body-language metric (posture / eye_contact / gesture / etc.)."""

    name: str
    score: Optional[int] = None
    flag: str = "ok"


class InterviewAnalysisResponse(BaseModel):
    """Result of `POST /interview/analyze`.

    `gesture_score` is the weighted overall body-language score from ss3
    on a 0..100 scale. `metrics` is the per-analyzer breakdown so the
    frontend can render individual posture / eye-contact / gesture / etc.
    cards.
    """

    session_id: str
    gesture_score: int
    metrics: list[GestureMetric] = Field(default_factory=list)
    duration_seconds: float = 0.0
    # Stub fields reserved for the teacher-review half of Interview Studio.
    # Empty until the video-feature integration lands.
    teacher_score: Optional[int] = None
    combined_score: Optional[int] = None
    available: bool = True
    message: Optional[str] = None
