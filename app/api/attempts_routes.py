from fastapi import APIRouter
from fastapi import Depends
from fastapi import Query

from app.attempts.schemas import AttemptListResponse
from app.attempts.storage import count_attempts
from app.attempts.storage import load_recent_attempts
from app.auth import User
from app.auth import require_user


router = APIRouter()


@router.get("/attempts", response_model=AttemptListResponse)
async def list_recent_attempts(
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(require_user),
):
    attempts = load_recent_attempts(limit=limit)

    return AttemptListResponse(
        attempts=attempts,
        total=count_attempts()
    )
