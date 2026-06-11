import os
import uuid
from pathlib import Path

from app.core.config import project_path
from app.core.config import settings


def generate_filename(filename: str | None):
    extension = Path(filename or "").suffix.lower()
    return f"{uuid.uuid4()}{extension}"

def ensure_directories():
    directories = [
        settings.UPLOAD_DIR,
        settings.OUTPUT_DIR,
        settings.TEMP_DIR
    ]

    for directory in directories:
        os.makedirs(project_path(directory), exist_ok=True)
