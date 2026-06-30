from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "Speech Intelligence Platform"

    PRONUNCIATION_PROVIDER: str = "local"

    GOPT_MODEL_DIR: str = "models/pronunciation/gopt"
    GOPT_CHECKPOINT_PATH: str = (
        "models/pronunciation/gopt/pretrained_models/"
        "gopt_librispeech/best_audio_model.pth"
    )
    GOPT_FEATURE_DIR: str = "temp/gopt_features"
    KALDI_GOP_WORK_DIR: str = "temp/kaldi_gop"
    KALDI_GOP_COMMAND: str | None = None
    HF_PHONEME_MODEL_NAME: str | None = None

    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "speech_db"
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432

    UPLOAD_DIR: str = "uploads"
    OUTPUT_DIR: str = "outputs"
    TEMP_DIR: str = "temp"

    # --- Interview Studio (gesture microservice) ---
    # URL of the ss3 Communication Skills Analyzer FastAPI app, which runs
    # MediaPipe gesture analysis in a Python 3.11 conda env. Our backend
    # proxies /interview/analyze to this service. Default points at the
    # local conda env on port 8001.
    CSA_SERVICE_URL: str = "http://127.0.0.1:8001"
    # How long we'll wait (in seconds) for the ss3 service to finish one
    # video. Each /analyze blocks for the duration so frontend just shows
    # an "analyzing" spinner.
    CSA_ANALYZE_TIMEOUT_SECONDS: int = 120

    # --- Auth ---
    # When true, the backend skips Firebase token verification entirely and
    # treats every request as a fake `dev@kiet.edu` user. Pair with
    # `VITE_AUTH_BYPASS=true` on the frontend.
    AUTH_BYPASS: bool = False
    # Inline JSON string of the Firebase service-account credentials. If not
    # set, falls back to `GOOGLE_APPLICATION_CREDENTIALS` (path to a JSON file).
    FIREBASE_SERVICE_ACCOUNT_JSON: str | None = None
    # Path to the Firebase service-account JSON. Loaded from `.env` so users
    # don't have to also export it as a process env var.
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
