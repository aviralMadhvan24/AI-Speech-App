# Deployment Guide

A single Docker container runs the whole stack: FastAPI backend, the React frontend (served as static files at `/`), the Whisper ASR pipeline, and the `hf_phoneme` acoustic pronunciation provider.

## Prerequisites

- Docker 24+ and Docker Compose v2 (`docker compose` command).
- ~3 GB free disk for the model cache volume (Whisper + Wav2Vec2 phoneme weights).
- ~4 GB RAM (Wav2Vec2 model + Whisper "small" running side by side).

## One-command deploy

```bash
docker compose up --build
```

Then open <http://localhost:8080>.

The first `/analyze` request takes 1-2 minutes while the Whisper (`small`, ~140 MB) and Wav2Vec2 phoneme (`facebook/wav2vec2-lv-60-espeak-cv-ft`, ~1.26 GB) model weights download into the `model_cache` volume. Subsequent requests are 5-15 seconds on CPU.

To verify the stack is healthy before opening the UI:

```bash
curl http://localhost:8080/health
# {"status":"running","service":"speech-platform"}
```

## Configuration

Copy `.env.example` to `.env` and edit. The compose file picks up env vars from there. Important keys:

| Key                       | Default                                            | Purpose                                                  |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `PRONUNCIATION_PROVIDER`  | `hf_phoneme`                                       | Use `mock` for fast smoke tests without ML downloads.    |
| `HF_PHONEME_MODEL_NAME`   | `facebook/wav2vec2-lv-60-espeak-cv-ft`             | Override to try a different HF phoneme model.            |

`.env` is gitignored. Never commit it.

## Pre-warming the models

To avoid the slow first request after a deploy, hit `/analyze` once with a small dummy audio clip before showing the demo:

```bash
# Generate a 1.5 s sine-wave fixture (already in the repo)
python scripts/generate_sample_audio.py

# Send it through the pipeline
curl -X POST http://localhost:8080/analyze \
  -F "file=@tests/fixtures/short_sample.wav" \
  -F "expected_text=hello world"
```

The first call downloads the models; subsequent calls reuse the cache volume.

## What's in each container directory

```
/app                     # backend code (read-only after build)
/app/frontend/dist       # React bundle, served at /
/app/uploads             # raw uploaded audio (mounted volume: app_uploads)
/app/temp                # ffmpeg-preprocessed WAVs (mounted volume: app_temp)
/app/outputs             # attempts.jsonl history (mounted volume: app_outputs)
/cache                   # Whisper + HuggingFace caches (mounted volume: model_cache)
```

## Routes

| Route                              | Type      | Description                              |
| ---------------------------------- | --------- | ---------------------------------------- |
| `/`                                | static    | React UI (production build).             |
| `/ui/`                             | static    | Legacy vanilla-JS UI (kept for fallback).|
| `/health`                          | GET       | JSON liveness probe.                     |
| `/battle/prompts`                  | GET       | Pronunciation sentences.                 |
| `/analyze`                         | POST      | Multipart audio + expected_text.         |
| `/attempts?limit=N`                | GET       | Recent attempts (1..50).                 |
| `/battle/rooms`                    | POST      | Create a live 1v1 battle room.           |
| `/battle/rooms/{code}/join`        | POST      | Join an existing room.                   |
| `/battle/rooms/{code}`             | GET       | Public room state.                       |
| `/battle/ws/{code}?player_id=...`  | WebSocket | Real-time battle sync.                   |

## Updating

```bash
git pull
docker compose up --build -d
```

The frontend is rebuilt inside the image during the multi-stage build, so a single `docker compose up --build` propagates both backend and frontend changes.

## Local development (no Docker)

Two terminals, both from the repo root.

```bash
# Terminal A — backend on 8080
uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

```bash
# Terminal B — frontend on 5173 with hot reload (Vite proxies /battle, /analyze, /attempts to 8080)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

## Logs and observability

Every `/analyze` call emits one structured log line per pipeline stage, all tagged with the same `analysis_id`:

```
stage=analyze_received analysis_id=... content_type=audio/webm size_hint=42134
stage=audio_saved analysis_id=... audio_id=... size_bytes=42134
stage=audio_preprocessed analysis_id=... sample_rate=16000 channels=1
stage=asr_done analysis_id=... provider=whisper model=small word_count=5
stage=pronunciation_done analysis_id=... provider=hf_phoneme available=True overall_score=89.47
stage=fluency_done analysis_id=... wpm=170.45 clarity=95.59
```

Stream container logs with:

```bash
docker compose logs -f app
```

## Known limitations

- **In-memory battle rooms.** Restarting the container or `uvicorn --reload` clears all live battle rooms. Acceptable for a single-instance demo; revisit before multi-instance hosting.
- **No auth.** Anyone with the room code can join a battle. Public deployment should add auth before broad rollout.
- **JSONL persistence.** Attempts are appended to `outputs/attempts.jsonl`. Fine for a single instance; needs a real DB for horizontal scaling.
- **CPU inference.** The Wav2Vec2 phoneme model runs on CPU by default. GPU inference is faster but requires a CUDA-enabled base image (out of scope here).
- **First request slow.** Documented above. Pre-warm to avoid it.

## Production hardening checklist (future work)

These are not blockers for the current demo, but worth doing before broader rollout:

- [ ] Add a reverse proxy (nginx, Caddy) in front of uvicorn for TLS termination and request limits.
- [ ] Configure CORS explicitly if the frontend will be deployed separately from the backend.
- [ ] Switch attempts persistence from JSONL to Postgres (the `app_postgres` service in older compose files is a starting point).
- [ ] Add Sentry or another error tracker around the `/analyze` request flow.
- [ ] Add a Prometheus exporter for the stage-level latency metrics.
- [ ] Add resource limits (`deploy.resources.limits` in compose) to bound memory / CPU.
- [ ] Move model downloads to a build-time step if cold-start latency matters more than image size.
