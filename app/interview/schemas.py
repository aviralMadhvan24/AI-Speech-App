"""Public-facing pydantic shapes for the Interview Studio endpoints.

We intentionally re-shape the ss3 response into something flatter so the
frontend doesn't need to know about ss3's internal `Report` / `OverallScore`
/ `MetricResult` structure.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel
from pydantic import Field

from app.storage import InterviewReview
from app.storage import InterviewSubmission
from app.storage.submissions import ContentScoreSnapshot


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


class InterviewSubmitRequest(BaseModel):
    """Payload from the frontend when the student clicks "Submit for
    teacher review" after `/interview/analyze` returns."""

    question_id: str
    question_prompt: str
    question_category: str = "behavioural"
    gesture_session_id: Optional[str] = None
    gesture_score: int = 0
    gesture_metrics: list[GestureMetric] = Field(default_factory=list)
    content_result: Optional[ContentScoreSnapshot] = None
    duration_seconds: float = 0.0


class InterviewSubmitResponse(BaseModel):
    submission_id: str



class MySubmissionsResponse(BaseModel):
    """List returned by `GET /interview/my-submissions`."""

    submissions: list[InterviewSubmission] = Field(default_factory=list)
    total: int = 0


class MySubmissionDetail(BaseModel):
    """One student-visible submission plus its review, if any."""

    submission: InterviewSubmission
    review: Optional[InterviewReview] = None
