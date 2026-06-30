"""Pydantic and dataclass schemas for the Communication Skills Analyzer.

This module defines the shared data shapes that flow through the backend:

* ``MetricResult`` / ``ModuleResult`` — what an ``Analysis_Module.run`` returns.
* ``Suggestion`` / ``OverallScore`` / ``Report`` — the report served to the
  frontend and persisted to ``data/sessions/<id>/report.json``.
* ``SessionMetadata`` — the small record persisted at
  ``data/sessions/<id>/metadata.json`` that the session manager rewrites on
  every state transition.
* ``FrameLandmarks`` — a lightweight dataclass that caches per-frame
  MediaPipe outputs (pose / face mesh / hands) so each analyzer can consume
  the same single-pass landmark stream.
* ``SessionState`` and ``MetricFlag`` — literal types used by the models
  above and by the HTTP layer.

The Pydantic models use Pydantic v2. ``FrameLandmarks`` is a ``@dataclass``
(not a Pydantic model) because it holds opaque MediaPipe / numpy objects
that don't need validation or JSON serialization.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Literal types
# ---------------------------------------------------------------------------

SessionState = Literal["queued", "processing", "completed", "failed"]
"""Lifecycle state of a session as exposed by ``GET /sessions/{id}/status``."""

MetricFlag = Literal[
    "ok",
    "low_confidence",
    "detection_failed",
    "no_frames",
    "student_absent",
]
"""Per-metric quality flag produced by analyzers and consumed by the
scoring engine and feedback generator."""


# ---------------------------------------------------------------------------
# Module result schemas
# ---------------------------------------------------------------------------


class MetricResult(BaseModel):
    """The output of a single analyzer (e.g. ``posture``)."""

    name: str
    score: Optional[int] = None
    """0..100, or ``None`` when the metric is unavailable (e.g. no face
    detected for eye contact)."""
    flag: MetricFlag = "ok"
    details: dict[str, Any] = Field(default_factory=dict)
    """Per-metric extras such as gesture per-category counts."""


class ModuleResult(BaseModel):
    """The aggregated output of an ``Analysis_Module.run`` call."""

    module_id: str
    metrics: list[MetricResult] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Report schemas
# ---------------------------------------------------------------------------


class Suggestion(BaseModel):
    """A single piece of actionable feedback for one metric."""

    metric: str
    score: Optional[int] = None
    band: Literal["low", "mid", "high", "unavailable"]
    text: str


class OverallScore(BaseModel):
    """The overall, weighted score derived by the ``Scoring_Engine``."""

    value: int
    """0..100."""
    session_flag: Optional[Literal["low_confidence"]] = None
    """Set when no metric survived flag filtering."""
    applied_weights: dict[str, float] = Field(default_factory=dict)
    """The weight actually applied to each metric (after re-normalization
    over surviving metrics). Metrics that were filtered out appear with
    weight ``0.0`` so the UI can show how the overall was assembled."""


class Report(BaseModel):
    """The full report stored at ``data/sessions/<id>/report.json``."""

    session_id: str
    created_at: str
    """ISO 8601 timestamp."""
    duration_seconds: float
    overall: OverallScore
    metrics: list[MetricResult] = Field(default_factory=list)
    suggestions: list[Suggestion] = Field(default_factory=list)


class SessionMetadata(BaseModel):
    """The small record at ``data/sessions/<id>/metadata.json``."""

    session_id: str
    created_at: str
    duration_seconds: float
    state: SessionState
    error: Optional[str] = None
    overall_score: Optional[int] = None
    """Populated once the session reaches ``completed``."""


# ---------------------------------------------------------------------------
# Frame landmark cache (dataclass — holds MediaPipe / numpy internals)
# ---------------------------------------------------------------------------


@dataclass
class FrameLandmarks:
    """One sampled frame's MediaPipe outputs.

    The ``Frame_Sampler`` runs MediaPipe Pose, Face Mesh, and Hands once
    per sampled frame and stores the raw results here. All five analyzers
    consume a ``list[FrameLandmarks]`` so the video is decoded and MediaPipe
    is invoked exactly once per session (see Architecture → Frame Sampling
    Strategy in design.md).

    Each landmark field is typed as ``Optional[Any]`` because MediaPipe's
    return types are opaque protobuf-backed objects that aren't worth
    constraining at this layer. ``None`` means MediaPipe did not detect
    that modality in this frame.
    """

    frame_index: int
    pose: Optional[Any] = None
    face_mesh: Optional[Any] = None
    hands: Optional[Any] = None


__all__ = [
    "SessionState",
    "MetricFlag",
    "MetricResult",
    "ModuleResult",
    "Suggestion",
    "OverallScore",
    "Report",
    "SessionMetadata",
    "FrameLandmarks",
]
