"""Firebase Admin SDK initialization + token verification.

We initialize the SDK exactly once at app startup. Two configuration paths
are supported:

1. `FIREBASE_SERVICE_ACCOUNT_JSON` env var — inline JSON string of the
   service account credentials. Easiest for container deploys.
2. `GOOGLE_APPLICATION_CREDENTIALS` env var — path to a JSON file. Read
   directly by firebase-admin via `credentials.ApplicationDefault()`.

If neither is set and `AUTH_BYPASS=true`, init is skipped — protected
endpoints will short-circuit to a fake dev user. If neither is set and
bypass is off, `init_firebase_admin` raises with a clear message.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any
from typing import Dict

from fastapi import HTTPException
from fastapi import status

from app.core.config import settings


logger = logging.getLogger("auth.firebase_admin")


_init_lock = threading.Lock()
_initialized = False
_firebase_module = None  # type: ignore[var-annotated]


def _resolve_gac_path() -> str | None:
    """Read GOOGLE_APPLICATION_CREDENTIALS from `.env` (via settings) or
    the real process environment, preferring the explicit settings value.
    Returns an absolute path so firebase-admin doesn't get confused by the
    server's working directory.
    """
    raw = settings.GOOGLE_APPLICATION_CREDENTIALS or os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS"
    )
    if not raw:
        return None
    raw = raw.strip()
    if not raw:
        return None
    abs_path = os.path.abspath(raw)
    return abs_path


def _do_initialize() -> None:
    """Import and configure firebase-admin lazily so the import is optional
    when `AUTH_BYPASS=true` and the package isn't installed."""
    global _firebase_module

    import firebase_admin  # noqa: WPS433 — intentional lazy import
    from firebase_admin import credentials

    _firebase_module = firebase_admin

    # If an app has already been initialized in this process, reuse it.
    try:
        firebase_admin.get_app()
        logger.info("firebase_admin already initialized")
        return
    except ValueError:
        pass

    inline_json = settings.FIREBASE_SERVICE_ACCOUNT_JSON
    gac_path = _resolve_gac_path()

    if inline_json:
        try:
            cred_dict: Dict[str, Any] = json.loads(inline_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON"
            ) from exc
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        logger.info("firebase_admin initialized via inline JSON")
        return

    if gac_path:
        if not os.path.isfile(gac_path):
            raise RuntimeError(
                f"GOOGLE_APPLICATION_CREDENTIALS points to {gac_path} but "
                "the file does not exist. Check the path in `.env`."
            )
        # `credentials.Certificate(path)` reads the JSON file directly. We
        # prefer this over `ApplicationDefault()` because the latter only
        # reads from `os.environ` which pydantic-settings may not populate.
        cred = credentials.Certificate(gac_path)
        firebase_admin.initialize_app(cred)
        logger.info(
            "firebase_admin initialized via GOOGLE_APPLICATION_CREDENTIALS (%s)",
            gac_path,
        )
        return

    # Should never get here — `init_firebase_admin` guards on bypass first.
    raise RuntimeError(
        "No Firebase credentials configured. Set FIREBASE_SERVICE_ACCOUNT_JSON "
        "or GOOGLE_APPLICATION_CREDENTIALS, or set AUTH_BYPASS=true for dev."
    )


def init_firebase_admin() -> None:
    """Idempotently initialize the Firebase Admin SDK.

    Safe to call multiple times. If `AUTH_BYPASS=true`, this is a no-op.
    Raises `RuntimeError` if credentials are missing and bypass is off.
    """
    global _initialized

    with _init_lock:
        if _initialized:
            return

        if settings.AUTH_BYPASS:
            logger.warning(
                "AUTH_BYPASS=true — Firebase Admin SDK not initialized. "
                "All requests will be treated as dev@kiet.edu."
            )
            _initialized = True
            return

        inline_json = settings.FIREBASE_SERVICE_ACCOUNT_JSON
        gac_path = _resolve_gac_path()
        if not inline_json and not gac_path:
            raise RuntimeError(
                "Auth is enabled but no Firebase credentials are configured. "
                "Set FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON) or "
                "GOOGLE_APPLICATION_CREDENTIALS (path to JSON file), or set "
                "AUTH_BYPASS=true for local dev. See AUTH.md."
            )

        _do_initialize()
        _initialized = True


def verify_id_token(token: str) -> Dict[str, Any]:
    """Verify a Firebase ID token and return the decoded claims dict.

    Raises HTTPException(401) on any verification failure.
    Callers must NOT invoke this when `AUTH_BYPASS` is true.
    """
    # Make sure init was done at least once. If the startup hook missed it
    # (e.g. tests or scripts) we initialize here too.
    if not _initialized:
        init_firebase_admin()

    if _firebase_module is None:
        # init was skipped (bypass mode). Caller error.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="auth_not_configured",
        )

    try:
        # Lazy import for the same reason as in _do_initialize.
        from firebase_admin import auth as firebase_auth
        from firebase_admin import exceptions as firebase_exceptions
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="firebase_admin_not_installed",
        ) from exc

    try:
        claims: Dict[str, Any] = firebase_auth.verify_id_token(
            token,
            check_revoked=False,
        )
    except firebase_exceptions.FirebaseError as exc:
        logger.info("id_token_invalid err=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_id_token",
        ) from exc
    except ValueError as exc:
        # firebase-admin raises ValueError for malformed tokens.
        logger.info("id_token_malformed err=%s", str(exc)[:120])
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_id_token",
        ) from exc

    return claims
