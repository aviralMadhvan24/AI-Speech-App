"""FastAPI application factory for the Communication Skills Analyzer.

Wires together the global backend config, the Body Language module config and
suggestions bank, the analysis-module registry, and the on-disk session
manager, then mounts the three API routers and serves the static frontend.

Startup behaviour follows the design's fail-fast contract:

* Global ``backend/config.yaml`` errors abort startup (Req 13.5).
* Body Language ``config.yaml`` errors abort startup (Req 12.5).
* Body Language ``suggestions.yaml`` errors abort startup (Req 12.6).
* The bound loopback host/port comes from the validated global config
  (Req 13.1, 13.2) and is printed once the app is ready (Req 13.5).

The frontend lives in ``frontend/`` at the repository root; it is mounted at
``/`` with ``index.html`` served from the root path so a user can open
``http://127.0.0.1:8000/`` in any browser (Req 13.5).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import ConfigError
from backend.config import load_config as load_backend_config
from backend.module_registry import ModuleRegistry
from backend.modules.body_language.config_loader import (
    SuggestionBankError,
    load_config as load_bl_config,
    load_suggestions,
)
from backend.session_manager import SessionManager

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Build and return the configured :class:`FastAPI` instance.

    Any of the four "must succeed" loaders (global config, body-language
    config, body-language suggestions, module discovery) terminates the
    process via ``sys.exit(1)`` rather than returning a half-initialised
    app, so a broken install can never silently serve traffic.
    """
    # 1. Global backend config (Req 13.1, 13.2, 13.5).
    try:
        backend_cfg = load_backend_config()
    except ConfigError as exc:
        logger.error("Backend config error: %s", exc)
        sys.exit(1)

    # 2. Body Language module config + suggestions bank (Req 12.5, 12.6).
    bl_folder = Path(__file__).parent / "modules" / "body_language"
    try:
        bl_config, bl_warnings = load_bl_config(bl_folder)
        for warning in bl_warnings:
            logger.warning("Body Language config: %s", warning)
        bl_suggestions = load_suggestions(bl_folder)
    except (ConfigError, SuggestionBankError) as exc:
        logger.error("Body Language config error: %s", exc)
        sys.exit(1)

    # 3. Discover analysis modules from ``backend/modules/<id>/manifest.json``.
    registry = ModuleRegistry()
    modules_dir = Path(__file__).parent / "modules"
    registry.discover(modules_dir)

    # 4. Filesystem-backed session manager (Req 14.x; wired here so routes
    #    can pull it from ``app.state``).
    session_manager = SessionManager(
        data_dir=backend_cfg.data_dir,
        retention_limit=backend_cfg.retention_limit,
    )

    # 5. Construct the FastAPI app and stash shared dependencies on
    #    ``app.state`` so route handlers can read them without globals.
    app = FastAPI(title="Communication Skills Analyzer")

    # Allow the Vite dev server on :5173 to call us during development.
    # In production both servers are the same origin (frontend served from
    # dist/) so this has no effect.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.backend_cfg = backend_cfg
    app.state.bl_config = bl_config
    app.state.bl_suggestions = bl_suggestions
    app.state.registry = registry
    app.state.session_manager = session_manager

    # 6. Include the three API routers. Imported lazily so test code can
    #    monkey-patch them before app construction if needed.
    from backend.routes_modules import router as modules_router
    from backend.routes_precheck import router as precheck_router
    from backend.routes_sessions import router as sessions_router

    app.include_router(modules_router)
    app.include_router(precheck_router)
    app.include_router(sessions_router)

    # 7. Serve the built React frontend from ``frontend/dist`` (the Vite
    #    build output). ``StaticFiles(html=True)`` makes the mount return
    #    ``index.html`` for the root path and handles SPA-style routing.
    #
    #    If ``dist/`` does not exist (the user hasn't run ``npm run build``
    #    yet), we fall back to a helpful instruction page so the API still
    #    boots cleanly for dev work.
    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend_dist.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=str(frontend_dist), html=True),
            name="frontend",
        )
    else:
        logger.warning(
            "Frontend build not found at %s. Run 'npm install && npm run "
            "build' inside the frontend/ directory.",
            frontend_dist,
        )

        @app.get("/", include_in_schema=False)
        def root() -> dict:
            return {
                "error": "frontend_not_built",
                "message": (
                    "Run 'npm install && npm run build' in frontend/, "
                    "or use 'npm run dev' for the Vite dev server on port 5173."
                ),
            }

    @app.on_event("startup")
    async def _on_startup() -> None:
        url = f"http://{backend_cfg.host}:{backend_cfg.port}"
        print(f"Communication Skills Analyzer ready at {url}")

    return app


# Module-level app instance for ``uvicorn backend.main:app`` (Req 13.5).
app = create_app()
