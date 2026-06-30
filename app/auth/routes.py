"""HTTP routes for the auth subsystem.

Tiny surface — just enough for the frontend to:
- confirm a token is valid (`GET /auth/me`)
- get the current user's display info
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi import Depends

from .dependencies import require_user
from .models import User


router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=User)
async def me(current_user: User = Depends(require_user)) -> User:
    """Return the authenticated caller's identity.

    Returns 401 if no/invalid token, 403 if email is not `@kiet.edu`.
    Honors `AUTH_BYPASS=true`, returning the dev user.
    """
    return current_user
