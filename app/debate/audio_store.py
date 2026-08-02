"""Storage-location abstraction for per-turn debate audio blobs.

Debate previously copied each turn's recording to ``uploads/{turn_id}.{ext}``
with a hand-rolled path. This module replaces that ad-hoc handling with a small
blob-store abstraction (:class:`AudioBlobStore`) and a stable, debate-scoped key
scheme so the backend can later move from local disk to Cloudflare R2
(S3-compatible) without touching callers.

Key scheme::

    debate-audio/{debate_id}/{turn_id}.{ext}

The debate-scoped prefix lets a whole debate's audio be enumerated and deleted
together (per-debate retention).

Security: the served/opened path is derived **only** from the store key — never
from a client-supplied absolute path. Keys are validated and resolved under the
store root; any key that escapes the root is rejected (path-traversal guard).

The Cloudflare R2 backend is intentionally **not** implemented here — it is an
additive, optional, out-of-scope backend (Req 5.3). ``get_audio_store`` reads
``DEBATE_AUDIO_BACKEND`` (default: local disk) using only the standard library,
so selecting the backend requires no new dependency.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import BinaryIO
from typing import Optional
from typing import Protocol
from typing import runtime_checkable

from app.core.logger import logger


# ---------------------------------------------------------------------------
# Content-type mapping
# ---------------------------------------------------------------------------

_CONTENT_TYPE_BY_EXT = {
    "webm": "audio/webm",
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
}

_DEFAULT_CONTENT_TYPE = "application/octet-stream"


def _content_type_for_ext(ext: str) -> str:
    """Map a bare file extension to an audio MIME type.

    ``webm`` -> ``audio/webm``, ``wav`` -> ``audio/wav``, ``mp3`` -> ``audio/mpeg``,
    ``ogg`` -> ``audio/ogg``; anything else -> ``application/octet-stream``.
    The extension is compared case-insensitively and a leading dot is tolerated.
    """
    normalized = (ext or "").lstrip(".").lower()
    return _CONTENT_TYPE_BY_EXT.get(normalized, _DEFAULT_CONTENT_TYPE)


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class AudioBlobStore(Protocol):
    """Abstract per-turn audio blob store.

    Implementations persist and retrieve turn recordings by an opaque key. The
    key is produced by :meth:`key_for` and is the only source of truth for
    locating a blob — callers never pass raw filesystem paths to read APIs.
    """

    def key_for(self, debate_id: str, turn_id: str, ext: str) -> str:
        """Return the storage key ``debate-audio/{debate_id}/{turn_id}.{ext}``."""
        ...

    def put(self, key: str, src_path: str) -> None:
        """Copy the blob at ``src_path`` into the store under ``key``."""
        ...

    def open(self, key: str) -> tuple[BinaryIO, str]:
        """Open the blob for ``key``; return ``(binary stream, content_type)``."""
        ...

    def exists(self, key: str) -> bool:
        """Return ``True`` iff a blob is stored under ``key``."""
        ...

    def signed_url(self, key: str, ttl_seconds: int = 3600) -> Optional[str]:
        """Return a short-lived URL for ``key``, or ``None`` if not applicable."""
        ...

    def delete(self, key: str) -> None:
        """Remove the blob stored under ``key`` (no-op if absent)."""
        ...


# ---------------------------------------------------------------------------
# Local-disk backend (default)
# ---------------------------------------------------------------------------

class LocalDiskAudioStore:
    """Default backend that stores blobs on the local filesystem.

    Blobs live under ``uploads/debate-audio/{debate_id}/{turn_id}.{ext}``.
    ``signed_url`` always returns ``None`` — local audio is served through the
    application route rather than a durably shareable link.
    """

    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root) if root is not None else Path("uploads/debate-audio")

    def key_for(self, debate_id: str, turn_id: str, ext: str) -> str:
        normalized = (ext or "").lstrip(".").lower() or "webm"
        return f"debate-audio/{debate_id}/{turn_id}.{normalized}"

    def _resolve(self, key: str) -> Path:
        """Resolve ``key`` to an absolute path strictly under the store root.

        Guards against path traversal: the key is treated as relative to the
        parent of ``root`` (keys are prefixed with ``debate-audio/``) and the
        resolved path MUST remain within ``root``. A key that escapes the root
        (e.g. via ``..`` segments or an absolute path) raises ``ValueError``.
        """
        if not key:
            raise ValueError("empty audio key")

        # Keys are always store-relative. Reject absolute paths outright.
        candidate = Path(key)
        if candidate.is_absolute() or (len(candidate.parts) > 0 and candidate.parts[0] in ("", os.sep)):
            raise ValueError(f"invalid audio key (absolute): {key!r}")

        root = self.root.resolve()
        # The key includes the "debate-audio/" prefix, which equals root's name,
        # so resolve it relative to root's parent.
        base = root.parent
        resolved = (base / candidate).resolve()

        if resolved != root and root not in resolved.parents:
            raise ValueError(f"audio key escapes store root: {key!r}")

        return resolved

    def put(self, key: str, src_path: str) -> None:
        dest = self._resolve(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dest)

    def open(self, key: str) -> tuple[BinaryIO, str]:
        path = self._resolve(key)
        ext = path.suffix.lstrip(".").lower()
        stream: BinaryIO = open(path, "rb")
        return stream, _content_type_for_ext(ext)

    def exists(self, key: str) -> bool:
        try:
            return self._resolve(key).is_file()
        except ValueError:
            return False

    def signed_url(self, key: str, ttl_seconds: int = 3600) -> Optional[str]:
        # Local disk is served via the application audio route, not a signed URL.
        return None

    def delete(self, key: str) -> None:
        try:
            path = self._resolve(key)
        except ValueError:
            return
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("audio_delete_failed key=%s err=%s", key, type(exc).__name__)


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------

def get_audio_store() -> AudioBlobStore:
    """Return the configured :class:`AudioBlobStore` backend.

    The backend is selected from the ``DEBATE_AUDIO_BACKEND`` environment
    variable (default: local disk). Reading the variable uses only the standard
    library, so no new dependency is required.

    The Cloudflare R2 backend (``DEBATE_AUDIO_BACKEND=r2``) is out of scope for
    the initial implementation (Req 5.3); the branch is documented here but not
    implemented, and the store falls back to local disk with a warning.
    """
    backend = os.getenv("DEBATE_AUDIO_BACKEND", "local").strip().lower()

    if backend in ("", "local", "disk", "local-disk", "localdisk"):
        return LocalDiskAudioStore()

    if backend in ("r2", "cloudflare", "s3"):
        # Out of scope for the initial implementation (Req 5.3). Left as a
        # documented stub: an R2AudioStore would upload via boto3 and return a
        # presigned GET URL from signed_url(). Until implemented, degrade to the
        # default local-disk backend so audio storage keeps working.
        logger.warning(
            "DEBATE_AUDIO_BACKEND=%s requested but the R2 backend is not "
            "implemented; falling back to local disk.",
            backend,
        )
        return LocalDiskAudioStore()

    logger.warning(
        "Unknown DEBATE_AUDIO_BACKEND=%s; falling back to local disk.", backend
    )
    return LocalDiskAudioStore()
