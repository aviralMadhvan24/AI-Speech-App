# GOPT Scoring service Dockerfile (scaffold)
# NOTE: This is a scaffold. Adjust the Python/Torch install steps to match your target platform.

FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install minimal OS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git libsndfile1 ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy app sources; in production copy a minimal scoring package instead
COPY . /app

# Install Python deps. Replace with pre-built wheels for torch if needed.
RUN python -m pip install --upgrade pip
RUN if [ -f requirements.txt ]; then pip install -r requirements.txt || true; fi

# NOTE: Installing torch may require selecting the correct wheel per platform.
# Replace the next line with the proper torch installation for your environment.
# Example (CPU): pip install torch --index-url https://download.pytorch.org/whl/cpu

# Expose port for scoring API (optional)
EXPOSE 8001

ENV PYTHONUNBUFFERED=1

# Default command: run a simple scoring worker or HTTP endpoint. Replace with your preferred server.
CMD ["python", "-u", "-c", "print('GOPT scoring container ready; configure CMD to run scoring service')"]
