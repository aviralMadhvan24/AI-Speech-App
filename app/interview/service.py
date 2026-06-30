"""HTTP client that drives the ss3 gesture-analysis microservice.

The ss3 app exposes:
- POST /sessions (multipart video)            → 202 {session_id, state}
- GET  /sessions/{id}/status                  → {state, error}
- GET  /sessions/{id}/report                  → full Report JSON

We submit the video, poll for completion, fetch the report, and reshape
it into our `InterviewAnalysisResponse`. Polling cadence + total wait
budget are taken from `Settings.CSA_ANALYZE_TIMEOUT_SECONDS`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.core.config import settings

from .schemas import GestureMetric
from .schemas import InterviewAnalysisResponse


logger = logging.getLogger("interview.service")


class CSAServiceError(Exception):
    """Raised when the ss3 service is unreachable or returns an error."""


_POLL_INTERVAL_SECONDS = 1.0
_INITIAL_DELAY_SECONDS = 0.4
# Order matches ss3's body_language module so the frontend can rely on
# stable positions if it wants to (it doesn't, but it's polite).
_KNOWN_METRIC_ORDER = (
    "posture",
    "eye_contact",
    "gesture",
    "stillness",
    "facial_expression",
)


def _normalize_metric_order(metrics: list[dict[str, Any]]) -> list[GestureMetric]:
    """Return metrics in `_KNOWN_METRIC_ORDER`, falling back to source order
    for anything unrecognized so we never silently drop scores."""
    by_name: dict[str, dict[str, Any]] = {}
    extras: list[dict[str, Any]] = []
    for raw in metrics or []:
        name = raw.get("name") if isinstance(raw, dict) else None
        if not isinstance(name, str):
            continue
        if name in _KNOWN_METRIC_ORDER:
            by_name[name] = raw
        else:
            extras.append(raw)

    ordered: list[dict[str, Any]] = [
        by_name[name] for name in _KNOWN_METRIC_ORDER if name in by_name
    ]
    ordered.extend(extras)

    return [
        GestureMetric(
            name=str(raw.get("name", "unknown")),
            score=raw.get("score") if isinstance(raw.get("score"), int) else None,
            flag=str(raw.get("flag") or "ok"),
        )
        for raw in ordered
    ]


async def analyze_video(filename: str, content_type: str, video_bytes: bytes) -> InterviewAnalysisResponse:
    """Submit ``video_bytes`` to ss3 and return the reshaped result.

    Raises
    ------
    CSAServiceError
        On network/transport errors, ss3 timeouts, or ss3-side processing
        failures. The caller should map this to a 502/504 HTTP response.
    """
    base = settings.CSA_SERVICE_URL.rstrip("/")
    timeout_budget = max(15, int(settings.CSA_ANALYZE_TIMEOUT_SECONDS))

    # We use a single client for the whole call so connection setup is
    # reused across the submit + poll + report fetch.
    async with httpx.AsyncClient(
        base_url=base,
        timeout=httpx.Timeout(timeout_budget, connect=5.0),
    ) as client:

        # 1. Upload the video.
        try:
            files = {
                "video": (filename or "recording.webm", video_bytes, content_type or "video/webm"),
            }
            submit_response = await client.post("/sessions", files=files)
        except httpx.RequestError as exc:
            raise CSAServiceError(
                f"Could not reach gesture-analysis service at {base}: {exc}"
            ) from exc

        if submit_response.status_code >= 400:
            raise CSAServiceError(
                f"Gesture service rejected upload: {submit_response.status_code} {submit_response.text[:240]}"
            )

        body = submit_response.json()
        session_id = body.get("session_id")
        if not session_id:
            raise CSAServiceError("Gesture service returned no session_id")

        logger.info("csa session=%s submitted", session_id)

        # 2. Poll until the session reaches a terminal state.
        deadline = asyncio.get_event_loop().time() + timeout_budget
        await asyncio.sleep(_INITIAL_DELAY_SECONDS)
        while True:
            try:
                status_response = await client.get(f"/sessions/{session_id}/status")
            except httpx.RequestError as exc:
                raise CSAServiceError(f"Polling gesture service failed: {exc}") from exc

            if status_response.status_code >= 400:
                raise CSAServiceError(
                    f"Gesture service status check failed: {status_response.status_code}"
                )

            status_body = status_response.json()
            state = status_body.get("state")
            if state == "completed":
                break
            if state == "failed":
                raise CSAServiceError(
                    f"Gesture analysis failed: {status_body.get('error') or 'unknown'}"
                )

            if asyncio.get_event_loop().time() >= deadline:
                raise CSAServiceError(
                    f"Gesture analysis timed out after {timeout_budget}s"
                )
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)

        # 3. Fetch the final report.
        try:
            report_response = await client.get(f"/sessions/{session_id}/report")
        except httpx.RequestError as exc:
            raise CSAServiceError(f"Could not fetch gesture report: {exc}") from exc

        if report_response.status_code >= 400:
            raise CSAServiceError(
                f"Gesture report fetch failed: {report_response.status_code}"
            )

        report = report_response.json()

    # 4. Reshape into our public response.
    overall = report.get("overall") or {}
    raw_metrics = report.get("metrics") or []
    metrics = _normalize_metric_order(raw_metrics)

    return InterviewAnalysisResponse(
        session_id=session_id,
        gesture_score=int(overall.get("value") or 0),
        metrics=metrics,
        duration_seconds=float(report.get("duration_seconds") or 0.0),
        available=True,
        message=(
            "Teacher review pipeline not configured yet — `teacher_score` and "
            "`combined_score` will populate once that lands."
        ),
    )
