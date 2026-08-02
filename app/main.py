import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import router


class SPAStaticFiles(StaticFiles):
    """StaticFiles that falls back to ``index.html`` for unmatched paths.

    The React app uses client-side (URL) routing, so deep links like
    ``/debate/ABC234`` or a browser refresh on ``/report/<id>`` have no
    corresponding file on disk. Plain ``StaticFiles`` would return 404 for
    those. This subclass serves ``index.html`` instead so the SPA router can
    resolve the route in the browser. Real asset requests (JS/CSS/images) that
    genuinely don't exist still 404, because those requests carry a file
    extension and we only fall back for extension-less "route" paths.

    API routes are registered on the app BEFORE this mount, so they always take
    precedence and are never shadowed by the fallback.
    """

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            # Only rewrite genuine "not found" for route-like paths (no file
            # extension). Missing assets (foo.js, bar.png) keep their 404.
            if exc.status_code == 404 and "." not in Path(path).name:
                return await super().get_response("index.html", scope)
            raise
from app.auth import init_firebase_admin
from app.utils.file_utils import ensure_directories


logger = logging.getLogger("app.main")


app = FastAPI(
    title="Speech Intelligence Platform",
    version="1.0.0",
)

# Enable CORS for Vercel frontend + ngrok + local dev + nip.io
# NOTE: FastAPI CORSMiddleware doesn't support wildcards like "https://*.vercel.app"
# Use allow_origin_regex for pattern matching instead
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Local Vite dev
        "http://localhost:8080",   # Local backend served frontend
        "http://127.0.0.1:5173",   # Local Vite dev (alternate)
        "http://127.0.0.1:8080",   # Local backend (alternate)
    ],
    # Regex patterns for dynamic subdomains (Vercel previews, ngrok tunnels, nip.io)
    allow_origin_regex=r"https?://.*\.(vercel\.app|ngrok-free\.app|ngrok\.io|fly\.dev|nip\.io)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    
    # Preload Whisper model in background to reduce first-request latency.
    # This is non-blocking so the app can start serving requests immediately.
    import asyncio
    async def _preload_whisper():
        try:
            from app.asr.whisper_service import get_model
            await asyncio.to_thread(get_model)
            logger.info("Whisper model preloaded successfully")
        except Exception as exc:
            logger.warning(f"Whisper preload failed (will lazy-load): {type(exc).__name__}")
    
    asyncio.create_task(_preload_whisper())


# Register API routes BEFORE static mounts so they take precedence.
app.include_router(router)


# Serve user-uploaded files (e.g. profile avatars) at /uploads. Mounted
# before the SPA catch-all so these paths resolve to real files on disk.
_uploads_dir = Path("uploads")
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/uploads",
    StaticFiles(directory=str(_uploads_dir)),
    name="uploads",
)


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
        SPAStaticFiles(directory=str(_react_dist), html=True),
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
