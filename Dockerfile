# syntax=docker/dockerfile:1.6
# -----------------------------------------------------------------------------
# Stage 1: Build the React frontend.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS frontend-build

WORKDIR /build

# Install deps with a cached layer.
COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy the rest of the frontend sources and produce a production bundle.
COPY frontend/ ./
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Python backend (FastAPI + ASR + pronunciation models).
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/cache/huggingface \
    XDG_CACHE_HOME=/cache

# System deps for audio preprocessing + soundfile.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        gcc \
        g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first for cached layer.
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy backend source.
COPY app ./app
COPY docker ./docker
COPY scripts ./scripts

# Copy built React bundle from stage 1 into the location the backend mounts.
COPY --from=frontend-build /build/dist ./frontend/dist

# Runtime directories used by the app (uploads/, temp/, outputs/).
RUN mkdir -p uploads temp outputs /cache/huggingface

EXPOSE 8080

# Default provider can be overridden at runtime via -e PRONUNCIATION_PROVIDER=...
# First /analyze call downloads the HF phoneme model (~1.26 GB) and Whisper
# weights into /cache. Mount /cache as a volume in compose for persistence.

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
