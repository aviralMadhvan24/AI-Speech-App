from fastapi import APIRouter

from app.admin.routes import router as admin_router
from app.api.analysis_routes import router as analysis_router
from app.api.attempts_routes import router as attempts_router
from app.api.health_routes import router as health_router
from app.api.prompt_routes import router as prompt_router
from app.api.profile_routes import router as profile_router
from app.auth.routes import router as auth_router
from app.admin.bulk_routes import router as admin_bulk_router
from app.admin.export_routes import router as admin_export_router
from app.battles.routes import router as battles_router
from app.debate.admin_routes import router as debate_admin_router
from app.debate.routes import router as debate_router
from app.gd.admin_routes import router as gd_admin_router
from app.gd.routes import router as gd_router
from app.interview.routes import router as interview_router


router = APIRouter()

router.include_router(health_router)
router.include_router(auth_router)
router.include_router(prompt_router)
router.include_router(analysis_router)
router.include_router(attempts_router)
router.include_router(battles_router)
router.include_router(interview_router)
router.include_router(admin_router)
router.include_router(admin_bulk_router)
router.include_router(admin_export_router)
router.include_router(debate_router)
router.include_router(debate_admin_router)
router.include_router(gd_router)
router.include_router(gd_admin_router)
router.include_router(profile_router)
