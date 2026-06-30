"""GET /modules — list registered analysis modules."""
from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/modules")
def list_modules(request: Request):
    registry = request.app.state.registry
    return {"modules": registry.list_modules()}
