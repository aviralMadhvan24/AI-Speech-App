"""FastAPI dependencies that gate protected endpoints on a verified user.

Usage:

    from fastapi import Depends
    from app.auth import User, require_user

    @router.post("/protected")
    async def handler(current_user: User = Depends(require_user)):
        ...

For WebSocket endpoints (where headers are awkward), use
`verify_token_string` directly with the `id_token` query parameter.
"""

from __future__ import annotations

from fastapi import HTTPException
from fastapi import Request
from fastapi import status

from app.core.config import settings

from .firebase_admin import verify_id_token
from .models import User


# Only `@kiet.edu` accounts may use the app. Enforced on the server so the
# client-side check is purely a UX nicety.
ALLOWED_EMAIL_DOMAIN = "kiet.edu"


def _dev_user() -> User:
    return User(
        uid="dev-user",
        email=f"dev@{ALLOWED_EMAIL_DOMAIN}",
        name="Dev User",
        email_verified=True,
    )


def _build_user_from_claims(claims: dict) -> User:
    email = (claims.get("email") or "").lower()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token_missing_email",
        )
    if not email.endswith(f"@{ALLOWED_EMAIL_DOMAIN}"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Email must be @{ALLOWED_EMAIL_DOMAIN}",
        )
    uid = claims.get("uid") or claims.get("user_id") or claims.get("sub")
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token_missing_uid",
        )
    return User(
        uid=str(uid),
        email=email,
        name=claims.get("name"),
        email_verified=bool(claims.get("email_verified")),
    )


async def require_user(request: Request) -> User:
    """FastAPI dependency: verify the bearer token and return the User."""
    if settings.AUTH_BYPASS:
        return _dev_user()

    header = request.headers.get("Authorization") or ""
    if not header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = header[len("Bearer "):].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = verify_id_token(token)
    return _build_user_from_claims(claims)


def verify_token_string(token: str) -> User:
    """Same verification as `require_user`, but for callers that already
    have the raw token string (e.g. a WebSocket query param).

    Honors `AUTH_BYPASS` for parity with `require_user`.
    """
    if settings.AUTH_BYPASS:
        return _dev_user()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty id_token",
        )
    claims = verify_id_token(token)
    return _build_user_from_claims(claims)
