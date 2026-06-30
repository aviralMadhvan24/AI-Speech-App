from fastapi import APIRouter


router = APIRouter()


@router.get("/health")
async def health():

    return {
        "status": "running",
        "service": "speech-platform"
    }
