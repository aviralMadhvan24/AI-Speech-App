"""Session storage on the local filesystem.

The :class:`SessionManager` owns the on-disk layout described in design.md
under "On-Disk Layout":

    data/sessions/<session_id>/
    ├── video.webm        # raw upload
    ├── metadata.json     # SessionMetadata
    └── report.json       # Report (only when state == "completed")

``session_id`` is a UUID4 hex string. ``metadata.json`` is rewritten on every
state transition; ``report.json`` is written exactly once when the analysis
pipeline finishes.

This module covers task 3.1 (core operations):

* :meth:`SessionManager.create_session`
* :meth:`SessionManager.save_video`
* :meth:`SessionManager.update_state`
* :meth:`SessionManager.save_report`
* :meth:`SessionManager.get_report`
* :meth:`SessionManager.get_metadata`

…and task 3.2 (retention, listing, delete; Req 14.1, 14.2, 14.5, 14.6):

* :meth:`SessionManager.list_sessions`
* :meth:`SessionManager.delete_session`
* :meth:`SessionManager.enforce_retention`

The class takes a ``data_dir`` path in its constructor so it is trivially
testable against ``tmp_path`` in pytest without monkey-patching the global
backend config.
"""

from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .schemas import Report, SessionMetadata, SessionState


# File names used inside each session directory. Centralised so tests and
# downstream callers don't hard-code them.
VIDEO_FILENAME = "video.webm"
METADATA_FILENAME = "metadata.json"
REPORT_FILENAME = "report.json"


def _utc_now_iso() -> str:
    """Return current UTC time as an ISO 8601 string with a trailing ``Z``.

    Uses a timezone-aware ``datetime`` (``datetime.utcnow()`` is deprecated
    in Python 3.12+). The output matches the design's "ISO 8601" requirement
    and is the format the frontend will parse with ``new Date(...)``.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _atomic_write_text(path: Path, content: str) -> None:
    """Write ``content`` to ``path`` atomically.

    Writes to a sibling temp file then renames. ``Path.replace`` is atomic on
    POSIX and "close to atomic" on Windows for files on the same volume,
    which is enough to avoid readers seeing a half-written ``metadata.json``.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


class SessionManager:
    """Filesystem-backed CRUD for analysis sessions.

    Parameters
    ----------
    data_dir:
        Root directory that contains ``sessions/<session_id>/`` subfolders.
        The directory (and its ``sessions/`` child) is created on first use
        so callers can pass a fresh ``tmp_path`` without pre-creating it.
    """

    def __init__(
        self,
        data_dir: Path | str,
        retention_limit: Optional[int] = None,
    ) -> None:
        self.data_dir: Path = Path(data_dir)
        self.sessions_dir: Path = self.data_dir / "sessions"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        # ``retention_limit`` is the maximum number of stored sessions
        # allowed after :meth:`save_report` (Req 14.6). ``None`` disables
        # automatic retention, which keeps the constructor cheap for tests
        # that only want to exercise create/save round-trips.
        self.retention_limit: Optional[int] = retention_limit

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _session_dir(self, session_id: str) -> Path:
        return self.sessions_dir / session_id

    def _metadata_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / METADATA_FILENAME

    def _video_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / VIDEO_FILENAME

    def _report_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / REPORT_FILENAME

    # ------------------------------------------------------------------
    # Core operations (task 3.1)
    # ------------------------------------------------------------------

    def create_session(self) -> str:
        """Create a new session and return its UUID4 hex id.

        Initialises the session directory and writes an initial
        ``metadata.json`` with ``state="queued"``. ``duration_seconds`` is
        unknown at creation time and is recorded as ``0.0``; it is updated
        when :meth:`save_report` is called with the final :class:`Report`.

        Returns:
            The new ``session_id``.
        """
        session_id = uuid.uuid4().hex
        session_dir = self._session_dir(session_id)
        # ``mkdir`` with ``exist_ok=False`` would defend against the
        # astronomically-unlikely UUID4 collision, but it would also race
        # against retention deletions; the cost of a regenerated id is
        # negligible so we keep it strict.
        session_dir.mkdir(parents=True, exist_ok=False)

        metadata = SessionMetadata(
            session_id=session_id,
            created_at=_utc_now_iso(),
            duration_seconds=0.0,
            state="queued",
            error=None,
            overall_score=None,
        )
        self._write_metadata(metadata)
        return session_id

    def save_video(self, session_id: str, data: bytes) -> Path:
        """Persist the uploaded video bytes byte-for-byte.

        Writes to ``data/sessions/<id>/video.webm``. The file name is fixed
        regardless of the source container; the frontend always uploads a
        WebM blob from ``MediaRecorder`` and the Frame_Sampler relies on
        OpenCV's container sniffing rather than the extension.

        Args:
            session_id: Id returned by :meth:`create_session`.
            data: Raw upload bytes.

        Returns:
            The path the video was written to.

        Raises:
            FileNotFoundError: If the session directory does not exist.
        """
        session_dir = self._session_dir(session_id)
        if not session_dir.is_dir():
            raise FileNotFoundError(
                f"Session directory does not exist: {session_id}"
            )
        video_path = self._video_path(session_id)
        # ``write_bytes`` opens in binary mode and writes the buffer verbatim,
        # guaranteeing the byte-for-byte round-trip required by Property 3.
        video_path.write_bytes(data)
        return video_path

    def update_state(
        self,
        session_id: str,
        state: SessionState,
        error: Optional[str] = None,
    ) -> SessionMetadata:
        """Rewrite ``metadata.json`` with a new ``state`` (and optional error).

        Args:
            session_id: Existing session id.
            state: One of ``queued | processing | completed | failed``.
            error: Human-readable error string, set when ``state == "failed"``.
                Passing ``None`` clears any previous error.

        Returns:
            The updated :class:`SessionMetadata`.

        Raises:
            FileNotFoundError: If the session's metadata file is missing.
        """
        metadata = self._read_metadata_or_raise(session_id)
        metadata.state = state
        metadata.error = error
        self._write_metadata(metadata)
        return metadata

    def save_report(self, session_id: str, report: Report) -> Path:
        """Persist ``report.json`` and update metadata's ``overall_score``.

        Writes the full report JSON to ``report.json`` and rewrites
        ``metadata.json`` with the report's ``overall.value`` copied into
        ``overall_score``. The report's ``duration_seconds`` is also
        mirrored into the metadata so the home-page session list (Req 14.2)
        can render duration without parsing the full report.

        The session ``state`` is intentionally **not** flipped to
        ``completed`` here; the route layer makes that transition explicit
        via :meth:`update_state` after the entire pipeline succeeds, so a
        crash between writing the report and updating metadata cannot leave
        the session looking "done but unscored".

        Args:
            session_id: Existing session id.
            report: The finished :class:`Report`.

        Returns:
            The path the report was written to.

        Raises:
            FileNotFoundError: If the session does not exist.
        """
        metadata = self._read_metadata_or_raise(session_id)

        report_path = self._report_path(session_id)
        # ``model_dump_json`` produces canonical JSON for Pydantic v2 models;
        # using ``indent=2`` keeps the on-disk file human-readable for the
        # college-project debugging workflow.
        _atomic_write_text(report_path, report.model_dump_json(indent=2))

        metadata.overall_score = report.overall.value
        metadata.duration_seconds = report.duration_seconds
        self._write_metadata(metadata)

        # Req 14.6: trim oldest sessions once the new report is durable.
        # Done after the metadata write so this session counts toward the
        # post-trim total and never gets deleted by its own save.
        if self.retention_limit is not None:
            self.enforce_retention(self.retention_limit)

        return report_path

    def get_report(self, session_id: str) -> Optional[Report]:
        """Load ``report.json`` for a session, or ``None`` if missing.

        Returns ``None`` both when the session doesn't exist and when it
        exists but hasn't produced a report yet (e.g. still ``processing``).
        The HTTP layer turns this into a 404 with code ``session_not_found``
        (Req 14.4).
        """
        report_path = self._report_path(session_id)
        if not report_path.is_file():
            return None
        try:
            raw = report_path.read_text(encoding="utf-8")
        except OSError:
            return None
        return Report.model_validate_json(raw)

    def get_metadata(self, session_id: str) -> Optional[SessionMetadata]:
        """Load ``metadata.json`` for a session, or ``None`` if missing."""
        metadata_path = self._metadata_path(session_id)
        if not metadata_path.is_file():
            return None
        try:
            raw = metadata_path.read_text(encoding="utf-8")
        except OSError:
            return None
        return SessionMetadata.model_validate_json(raw)

    # ------------------------------------------------------------------
    # Retention, listing, delete (task 3.2)
    # ------------------------------------------------------------------

    def list_sessions(self) -> list[SessionMetadata]:
        """Return all sessions, newest first by ``created_at`` (Req 14.1, 14.2).

        Walks ``sessions_dir`` and reads each ``metadata.json``. Directories
        that don't contain a readable, schema-valid metadata file are
        silently skipped so a partially-deleted or in-flight session can't
        crash the home-screen listing.

        ``created_at`` is an ISO 8601 string with a fixed-width format and
        a ``Z`` suffix (see :func:`_utc_now_iso`), so a plain lexical sort
        is equivalent to a chronological sort and avoids a per-item
        ``datetime`` parse.
        """
        if not self.sessions_dir.is_dir():
            return []

        sessions: list[SessionMetadata] = []
        for entry in self.sessions_dir.iterdir():
            if not entry.is_dir():
                continue
            metadata_path = entry / METADATA_FILENAME
            if not metadata_path.is_file():
                continue
            try:
                raw = metadata_path.read_text(encoding="utf-8")
                sessions.append(SessionMetadata.model_validate_json(raw))
            except (OSError, ValueError):
                # ValueError covers Pydantic's ValidationError (a subclass)
                # and json parse errors; either way the directory is not
                # a usable session and is skipped.
                continue

        sessions.sort(key=lambda m: m.created_at, reverse=True)
        return sessions

    def delete_session(self, session_id: str) -> bool:
        """Recursively remove a session directory (Req 14.5).

        Returns ``True`` if the directory existed and was removed,
        ``False`` if it was already absent. Any other unexpected error
        (permission denied, etc.) is allowed to propagate so the caller
        can surface it; silently swallowing those would mask real bugs.
        """
        session_dir = self._session_dir(session_id)
        if not session_dir.exists():
            return False
        shutil.rmtree(session_dir)
        return True

    def enforce_retention(self, limit: int) -> int:
        """Trim the oldest sessions until at most ``limit`` remain (Req 14.6).

        Args:
            limit: Maximum number of sessions to keep. Must be ``>= 0``;
                a limit of ``0`` deletes every session.

        Returns:
            The number of sessions deleted.
        """
        if limit < 0:
            raise ValueError("retention limit must be non-negative")

        sessions = self.list_sessions()  # newest first
        if len(sessions) <= limit:
            return 0

        # Slice off the tail (the oldest entries) and delete them.
        to_delete = sessions[limit:]
        deleted = 0
        for meta in to_delete:
            if self.delete_session(meta.session_id):
                deleted += 1
        return deleted

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _write_metadata(self, metadata: SessionMetadata) -> None:
        """Atomically rewrite ``metadata.json`` for ``metadata.session_id``."""
        metadata_path = self._metadata_path(metadata.session_id)
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(metadata_path, metadata.model_dump_json(indent=2))

    def _read_metadata_or_raise(self, session_id: str) -> SessionMetadata:
        """Read metadata for ``session_id`` or raise ``FileNotFoundError``."""
        metadata = self.get_metadata(session_id)
        if metadata is None:
            raise FileNotFoundError(
                f"Session metadata not found for id: {session_id}"
            )
        return metadata


__all__ = [
    "SessionManager",
    "VIDEO_FILENAME",
    "METADATA_FILENAME",
    "REPORT_FILENAME",
]
