from pydantic_settings import BaseSettings

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

    class Config:
        env_file = ".env"

settings = Settings()