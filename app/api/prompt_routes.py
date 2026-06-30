import json
from pathlib import Path

from fastapi import APIRouter
from fastapi import Depends

from app.auth import User
from app.auth import require_user


router = APIRouter()

PROMPTS_PATH = Path("app/data/pronunciation_prompts.json")


@router.get("/battle/prompts")
async def get_battle_prompts(current_user: User = Depends(require_user)):

    with open(PROMPTS_PATH, "r", encoding="utf-8") as prompts_file:
        return json.load(prompts_file)
