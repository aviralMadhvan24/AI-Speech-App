import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.auth import init_firebase_admin
from app.utils.file_utils import ensure_directories


logger = logging.getLogger("app.main")


app = FastAPI(
    title="Speech Intelligence Platform",
    version="1.0.0",
)


@app.on_event("startup")
async def startup():
    ensure_directories()
    # Initialize Firebase Admin SDK once at startup. When `AUTH_BYPASS=true`
    # this is a no-op; otherwise it requires Firebase credentials and will
    # raise loudly if they are missing.
    try:
        init_firebase_admin()
    except Exception:
        logger.exception("Firebase Admin initialization failed")
        raise


# Register API routes BEFORE static mounts so they take precedence.
app.include_router(router)


# Optional legacy vanilla-JS frontend at /ui (kept for backward compat).
_legacy_ui_dir = Path("app/frontend")
if _legacy_ui_dir.is_dir():
    app.mount(
        "/ui",
        StaticFiles(directory=str(_legacy_ui_dir), html=True),
        name="ui",
    )


# Production React build (output of `cd frontend && npm run build`).
# Mounted at root so the React UI is the primary entry point.
# In dev, run Vite separately on :5173 — it proxies /battle, /analyze,
# /attempts back to this backend on :8080.
_react_dist = Path("frontend/dist")
if _react_dist.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=str(_react_dist), html=True),
        name="spa",
    )
else:
    # Helpful fallback when running the backend without a built frontend.
    @app.get("/")
    async def index_placeholder():
        return RedirectResponse(url="/ui/") if _legacy_ui_dir.is_dir() else {
            "status": "running",
            "service": "speech-platform",
            "note": (
                "React frontend not built. Run `cd frontend && npm run build`"
                " or start Vite separately with `npm run dev`."
            ),
        }
