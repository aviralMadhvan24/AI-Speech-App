from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.utils.file_utils import ensure_directories

app = FastAPI(
    title="Speech Intelligence Platform",
    version="1.0.0"
)

@app.on_event("startup")
async def startup():

    ensure_directories()

app.include_router(router)

app.mount(
    "/ui",
    StaticFiles(directory="app/frontend", html=True),
    name="ui"
)


@app.get("/app")
async def frontend():

    return RedirectResponse(url="/ui/")
