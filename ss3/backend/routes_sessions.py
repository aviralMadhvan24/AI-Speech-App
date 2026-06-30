"""Sessions API: create, list, status, report, delete.

Implements the lifecycle described in design.md → "Routes" and the
acceptance criteria in Req 2.x / 11.x / 14.x:

* ``POST   /sessions``              — multipart video upload + optional
                                      ``modules`` form field; persists the
                                      file, kicks off the analysis
                                      pipeline as a ``BackgroundTask``, and
                                      returns ``202`` immediately with
                                      ``{session_id, state}`` (Req 2.1–2.4).
* ``GET    /sessions``               — list of past session summaries,
                                      newest-first (Req 14.1, 14.2).
* ``GET    /sessions/{id}/status``  — current lifecycle state plus the
                                      last error string, if any (Req 2.4).
* ``GET    /sessions/{id}/report``  — full persisted report JSON
                                      (Req 14.3); ``404 session_not_found``
                                      when the session is gone (Req 14.4).
* ``DELETE /sessions/{id}``         — removes the session directory
                                      (Req 14.5).

Background pipeline error mapping (design.md → Error Handling):

* :class:`UnsupportedFormatError` from the frame sampler ⇒ ``state=failed``
  with an ``unsupported_format``-prefixed error string (Req 2.6).
* Any other unhandled exception                       ⇒ ``state=failed``
  with an ``internal_error``-prefixed error string, full traceback logged
  (Req 2.7).
* ``body_language`` not registered at request time    ⇒ ``503``
  ``no_modules_available`` (Req 11.7).
* Unknown module id in the request                    ⇒ ``400``
  ``unknown_module`` (Req 11.8).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from backend.feedback import generate as generate_feedback
from backend.module_registry import (
    BodyLanguageMissingError,
    ModuleRegistry,
    UnknownModuleError,
)
from backend.modules.body_language.frame_sampler import UnsupportedFormatError
from backend.schemas import MetricResult, Report
from backend.scoring import compute_overall
from backend.session_manager import VIDEO_FILENAME, SessionManager

router = APIRouter()
logger = logging.getLogger(__name__)


def _err(code: str, message: str, status_code: int) -> JSONResponse:
    """Return a standardized ``{error, code}`` JSON error payload."""
    return JSONResponse(
        status_code=status_code,
        content={"error": message, "code": code},
    )


def _iso_now() -> str:
    """Return the current UTC time as an ISO 8601 string with ``Z`` suffix."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _probe_duration_seconds(video_path: Path) -> float:
    """Best-effort video duration probe.

    Returns ``0.0`` on any failure (container unreadable, missing fps,
    OpenCV throwing). Duration is only used as a display field on the
    home-page session list (Req 14.2), so a missing value degrades
    gracefully rather than aborting the pipeline.
    """
    try:
        # Imported lazily so importing this module doesn't drag in OpenCV
        # for code that only needs the route definitions.
        import cv2  # type: ignore[import-not-found]

        cap = cv2.VideoCapture(str(video_path))
        try:
            if not cap.isOpened():
                return 0.0
            fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
            count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
            if fps > 0 and count > 0:
                return float(count) / float(fps)
        finally:
            cap.release()
    except Exception:
        logger.exception("Failed to probe duration for %s", video_path)
    return 0.0


@router.post("/sessions")
async def create_session_route(
    request: Request,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    modules: Optional[str] = Form(None),
) -> JSONResponse:
    """Accept a video upload and schedule the analysis pipeline.

    The ``modules`` form field, when present, is a comma-separated list of
    Analysis_Module ids. Missing/empty defaults to ``["body_language"]``
    (Req 11.5). Unknown ids return ``400 unknown_module`` (Req 11.8); a
    missing ``body_language`` registration returns ``503
    no_modules_available`` (Req 11.7).

    The handler stores the upload byte-for-byte under
    ``data/sessions/<id>/video.webm``, returns ``202`` with the new
    ``session_id`` and the initial ``queued`` state, and lets
    :func:`_process_session` run after the response is delivered.
    """
    app = request.app
    registry: ModuleRegistry = app.state.registry
    session_manager: SessionManager = app.state.session_manager
    bl_config = app.state.bl_config
    bl_suggestions = app.state.bl_suggestions

    # 1. Resolve the requested module list (Req 11.5).
    if modules:
        module_ids = [m.strip() for m in modules.split(",") if m.strip()]
    else:
        module_ids = []
    if not module_ids:
        module_ids = ["body_language"]

    # 2. Reject unknown module ids early (Req 11.8).
    for mid in module_ids:
        try:
            registry.get_module(mid)
        except UnknownModuleError:
            return _err(
                "unknown_module",
                f"Unknown analysis module: {mid}",
                status_code=400,
            )

    # 3. Refuse if body_language is required but missing (Req 11.7).
    if "body_language" in module_ids:
        try:
            registry.require_body_language()
        except BodyLanguageMissingError:
            return _err(
                "no_modules_available",
                "body_language module is not registered",
                status_code=503,
            )

    # 4. Persist the upload before scheduling the background task so the
    #    pipeline always sees a real file on disk (Req 2.2).
    video_bytes = await video.read()
    session_id = session_manager.create_session()
    session_manager.save_video(session_id, video_bytes)

    # 5. Schedule the analysis pipeline. FastAPI runs background tasks
    #    after the response is sent so the client gets its 202 quickly
    #    (design.md → Routes).
    background_tasks.add_task(
        _process_session,
        session_id=session_id,
        module_ids=module_ids,
        session_manager=session_manager,
        registry=registry,
        bl_config=bl_config,
        bl_suggestions=bl_suggestions,
    )

    return JSONResponse(
        status_code=202,
        content={"session_id": session_id, "state": "queued"},
    )


def _process_session(
    session_id: str,
    module_ids: list[str],
    session_manager: SessionManager,
    registry: ModuleRegistry,
    bl_config: Any,
    bl_suggestions: dict,
) -> None:
    """Background pipeline: run modules → score → feedback → save report.

    The whole body runs inside ``try/except`` so a single bad recording
    never leaves the session stuck in ``processing``:

    * :class:`UnsupportedFormatError` → ``state=failed`` /
      ``unsupported_format`` (Req 2.6).
    * Any other exception → ``state=failed`` / ``internal_error`` with
      the full traceback logged (Req 2.7).
    """
    video_path = session_manager.sessions_dir / session_id / VIDEO_FILENAME

    try:
        # Flip from "queued" to "processing" so polling clients see the
        # transition as soon as the worker picks the task up (Req 2.4).
        session_manager.update_state(session_id, "processing")

        # Run each requested module's entry callable. We accumulate metrics
        # across modules so a future multi-module session (e.g., body
        # language + pronunciation) flows through scoring identically.
        all_metrics: list[MetricResult] = []
        for mid in module_ids:
            registered = registry.get_module(mid)
            if registered.entry_callable is None:
                # Manifest was valid but the entry function wasn't yet
                # importable at registry time; skip with a warning rather
                # than aborting the pipeline.
                logger.warning(
                    "Analysis module %r has no entry callable; skipping",
                    mid,
                )
                continue
            module_result = registered.entry_callable(str(video_path), None)
            all_metrics.extend(module_result.metrics)

        # Scoring engine (Req 8): weights from the body_language config,
        # surviving metrics get the average, flagged ones drop out.
        weights = bl_config.weights.model_dump()
        overall = compute_overall(all_metrics, weights)

        # Feedback generator (Req 9): verbatim text from the suggestion bank.
        suggestions = generate_feedback(all_metrics, bl_suggestions)

        # Persist the report and mark the session completed. ``save_report``
        # also mirrors ``overall.value`` and ``duration_seconds`` into
        # metadata so the home-page list (Req 14.2) renders without
        # parsing the full report.
        report = Report(
            session_id=session_id,
            created_at=_iso_now(),
            duration_seconds=_probe_duration_seconds(video_path),
            overall=overall,
            metrics=all_metrics,
            suggestions=suggestions,
        )
        session_manager.save_report(session_id, report)
        session_manager.update_state(session_id, "completed")

    except UnsupportedFormatError as exc:
        # Req 2.6: the uploaded file isn't a video OpenCV can decode.
        logger.error(
            "Unsupported video format for session %s: %s", session_id, exc
        )
        _safe_update_state(
            session_manager,
            session_id,
            "failed",
            error=f"unsupported_format: {exc}",
        )
    except Exception as exc:  # noqa: BLE001 — boundary handler per Req 2.7
        # Req 2.7: catch absolutely everything so the session lifecycle
        # always reaches a terminal state. The full traceback goes to the
        # log; the client gets a code + generic message.
        logger.exception("Processing failed for session %s", session_id)
        _safe_update_state(
            session_manager,
            session_id,
            "failed",
            error=f"internal_error: {exc}",
        )


def _safe_update_state(
    session_manager: SessionManager,
    session_id: str,
    state: str,
    error: Optional[str] = None,
) -> None:
    """Update session state, logging instead of raising on missing metadata.

    The background task should never crash the worker if its own session
    directory disappeared mid-flight (e.g., a concurrent ``DELETE``); we
    log and swallow the missing-metadata case so the pipeline boundary
    stays tidy.
    """
    try:
        session_manager.update_state(session_id, state, error=error)  # type: ignore[arg-type]
    except FileNotFoundError:
        logger.warning(
            "Could not update state for missing session %s (state=%s)",
            session_id,
            state,
        )


@router.get("/sessions")
def list_sessions_route(request: Request) -> dict:
    """Return all stored sessions, newest first (Req 14.1, 14.2)."""
    session_manager: SessionManager = request.app.state.session_manager
    sessions = session_manager.list_sessions()
    return {"sessions": [s.model_dump() for s in sessions]}


@router.get("/sessions/{session_id}/status")
def get_status_route(request: Request, session_id: str):
    """Return the current lifecycle state for ``session_id`` (Req 2.4)."""
    session_manager: SessionManager = request.app.state.session_manager
    meta = session_manager.get_metadata(session_id)
    if meta is None:
        return _err(
            "session_not_found",
            f"Session {session_id} not found",
            status_code=404,
        )
    return {"state": meta.state, "error": meta.error}


@router.get("/sessions/{session_id}/report")
def get_report_route(request: Request, session_id: str):
    """Return the persisted report for ``session_id`` (Req 14.3, 14.4)."""
    session_manager: SessionManager = request.app.state.session_manager
    report = session_manager.get_report(session_id)
    if report is None:
        return _err(
            "session_not_found",
            f"Session {session_id} not found",
            status_code=404,
        )
    return report.model_dump()


@router.delete("/sessions/{session_id}")
def delete_session_route(request: Request, session_id: str):
    """Remove the on-disk session directory (Req 14.5)."""
    session_manager: SessionManager = request.app.state.session_manager
    deleted = session_manager.delete_session(session_id)
    if not deleted:
        return _err(
            "session_not_found",
            f"Session {session_id} not found",
            status_code=404,
        )
    return {"deleted": session_id}
