from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import project_path
from app.utils.file_utils import ensure_directories

app = FastAPI(
    title="Speech Intelligence Platform",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"]
)

@app.on_event("startup")
async def startup():

    ensure_directories()

app.include_router(router)

app.mount(
    "/ui",
    StaticFiles(directory=project_path("app/frontend"), html=True),
    name="ui"
)


@app.get("/app")
async def frontend():

    return RedirectResponse(url="/ui/")
