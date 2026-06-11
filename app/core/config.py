from pathlib import Path

from pydantic_settings import BaseSettings


PROJECT_ROOT = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    APP_NAME: str = "Speech Intelligence Platform"

    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "speech_db"
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432

    UPLOAD_DIR: str = "uploads"
    OUTPUT_DIR: str = "outputs"
    TEMP_DIR: str = "temp"
    WHISPER_MODEL: str = "base.en"
    MFA_EXECUTABLE: str = "mfa"

    class Config:
        env_file = ".env"

settings = Settings()


def project_path(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return PROJECT_ROOT / candidate
