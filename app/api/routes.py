from fastapi import APIRouter

from app.api.analysis_routes import router as analysis_router
from app.api.attempts_routes import router as attempts_router
from app.api.health_routes import router as health_router
from app.api.prompt_routes import router as prompt_router
from app.battles.routes import router as battles_router


router = APIRouter()

router.include_router(health_router)
router.include_router(prompt_router)
router.include_router(analysis_router)
router.include_router(attempts_router)
router.include_router(battles_router)
