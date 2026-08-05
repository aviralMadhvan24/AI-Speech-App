from pydantic import field_validator
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
    # Local filesystem path where ss3 stores per-session videos and reports.
    # We read videos from here directly for the admin panel (ss3 doesn't
    # expose an HTTP endpoint for video download).
    CSA_DATA_DIR: str = "ss3/data"
    # How long we'll wait (in seconds) for the ss3 service to finish one
    # video. Each /analyze blocks for the duration so frontend just shows
    # an "analyzing" spinner.
    CSA_ANALYZE_TIMEOUT_SECONDS: int = 120

    # --- LLM (content scoring) ---
    # Read through Settings rather than os.getenv so a local `.env` works the
    # same way it does for every other setting. pydantic-settings still picks
    # these up from real environment variables, which is how systemd supplies
    # them in production.
    GROQ_API_KEY: str | None = None
    OLLAMA_URL: str = "http://localhost:11434"

    # --- Auth ---
    # When true, the backend skips Firebase token verification entirely and
    # treats every request as a fake `dev@kiet.edu` user. Pair with
    # `VITE_AUTH_BYPASS=true` on the frontend.
    AUTH_BYPASS: bool = False
    # Comma-separated emails granted teacher/admin role. Anyone whose
    # Firebase email matches one of these (case-insensitive) gets access
    # to the admin panel. Defaults to a single dev/seed entry so the
    # AUTH_BYPASS path can still see the teacher view.
    TEACHER_EMAILS: str = "dev@kiet.edu"
    # Inline JSON string of the Firebase service-account credentials. If not
    # set, falls back to `GOOGLE_APPLICATION_CREDENTIALS` (path to a JSON file).
    FIREBASE_SERVICE_ACCOUNT_JSON: str | None = None
    # Path to the Firebase service-account JSON. Loaded from `.env` so users
    # don't have to also export it as a process env var.
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None

    # --- LiveKit (live audio rooms + per-participant egress recording) ---
    # Read through Settings so a local `.env` works. `LIVEKIT_INTERNAL_URL` is
    # used for server-to-server API calls (egress), bypassing the public proxy.
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""
    LIVEKIT_INTERNAL_URL: str = ""

    # --- Dev mode (single-player testing) ---
    # Lower the minimum-participant gate so one person can drive a debate / GD
    # room end-to-end. Read through Settings (not `os.getenv`) because nothing
    # in `app/` exports `.env` into the process environment, so `os.getenv`
    # only ever sees these when they're real env vars.
    DEBATE_DEV_MODE: bool = False
    GD_DEV_MODE: bool = False

    @field_validator("DEBATE_DEV_MODE", "GD_DEV_MODE", mode="before")
    @classmethod
    def _strip_inline_comment(cls, value: object) -> object:
        """Tolerate ``VALUE  # trailing comment`` from systemd EnvironmentFile.

        ``python-dotenv`` strips unquoted trailing comments when reading
        ``.env`` directly, but systemd's ``EnvironmentFile=`` only treats
        ``#`` as a comment at the start of a line. In production these flags
        arrive as ``"true      # Single player debate testing"``, which is not
        parseable as a bool, so the comment is removed before validation.
        """
        if isinstance(value, str) and "#" in value:
            return value.split("#", 1)[0].strip()
        return value

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
