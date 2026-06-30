Ops Playbook — Kaldi GOP + GOPT Production Deployment

Goal

Provide an actionable ops playbook for a production deployment of the free, on-prem/pricing-free Kaldi GOP + GOPT pronunciation scoring stack.

Architecture Overview

- Web API (existing app): receives uploads, enqueues jobs, returns analyze responses.
- Kaldi GOP Worker: prepares Kaldi workspace for each uploaded WAV, runs feature extraction + forced-alignment, and writes numpy feature files to a shared volume (`temp/gopt_features/`). Kaldi must run on Linux (WSL acceptable for dev but production recommend Linux host).
- GOPT Scoring Service: loads GOPT code + checkpoint and consumes feature files to produce `PronunciationResult`. This service can run on CPU or GPU; GPU recommended for throughput but CPU-only is possible (slower).
- Storage: shared persistent volume or object storage for audio, features, model artifacts.
- Queue: Redis/RabbitMQ for job orchestration; workers poll queue and update job status in DB.

Component Responsibilities

- Web/API
  - validate uploads
  - run preprocessing to 16 kHz mono
  - store processed audio under `uploads/` or `temp/`
  - call `KaldiGopFeaturePipeline.ensure_features()` (which prepares Kaldi inputs) and enqueue a job for Kaldi worker if features missing
  - once feature files exist, forward to GOPT scoring service or call adapter directly

- Kaldi GOP Worker
  - reads prepared Kaldi workspace (from `KALDI_GOP_WORK_DIR`)
  - runs Kaldi feature extraction + forced alignment (recipe-specific)
  - converts Kaldi outputs to numpy arrays and writes: `<analysis>_feat.npy` and `<analysis>_phn.npy` into `GOPT_FEATURE_DIR`
  - report errors cleanly back to API

- GOPT Scoring Service
  - ensures GOPT repo and checkpoint are present (`models/pronunciation/gopt/`)
  - loads model once, accepts analysis_id or direct feature paths, returns `PronunciationResult`
  - exposes a small HTTP endpoint or gRPC for scoring (optional)

Deployment Patterns

- Single-host (small deployments)
  - Run Kaldi worker and scoring service on same Linux host using systemd or Docker (Kaldi worker may require privileged build steps; prefer host-level install or dedicated container).
- Distributed (production)
  - Kaldi worker (Linux, possibly large instance) — dedicated; mounts shared storage (NFS/S3 gateway) for `temp/gopt_features`
  - GOPT scoring (GPU node(s)) — autoscaled if needed
  - Web/API (stateless) — containerized behind load balancer
  - Queue (Redis/RabbitMQ), Postgres, Prometheus + Grafana, Sentry for errors

Resource Requirements

- Kaldi worker: Linux x86_64, 8+ CPU cores, 16+ GB RAM (depending on dataset), disk for temporary artifacts; building Kaldi takes extra disk and time.
- GOPT scoring: GPU recommended (NVIDIA CUDA) for good throughput. CPU-only works with slower latency.
- Storage: fast local disk or network storage for features (small files) and audio

Security & Privacy

- Keep audio and features encrypted at rest if they contain PII.
- Run Kaldi/GOPT services in private network; avoid exposing model artifact storage publicly.
- Sanitize user-supplied expected text before placing in Kaldi workspace.

Monitoring & Alerts

- Track job queue backlog and worker health.
- Export simple metrics: feature-generation time, scoring latency, success/failures.
- Alert on repeated Kaldi failures (indicates setup drift).

Calibration & Validation

- Collect 200+ labeled recordings across accents and devices.
- Create a calibration job to sweep score thresholds (phoneme/word) using `tests/pronunciation/sample_cases.json`.
- Store calibration mappings per-word or per-phoneme if desired.

Runbook — Quick Start (dev)

1. Prepare GOPT repo and model (see `scripts/setup_gopt.ps1`).
2. Ensure `KALDI_GOP_COMMAND` is set to a wrapper that runs Kaldi (or to `python scripts/run_kaldi_gop.py` to print next steps while you implement Kaldi).
3. Start app in dev mode and set `PRONUNCIATION_PROVIDER=local_acoustic`.

Commands (examples):

# On Linux (build Kaldi per its docs)
bash scripts/build_kaldi.sh

# Start web app (example using venv)
python -m venv venv
. venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# For production, build images and run docker-compose (see docker/compose.kaldi.yml)

Operational Notes

- Kaldi build is long-running; plan for CI/CD that caches Kaldi binaries or use prebuilt images.
- Precompute and cache features for repeated analyses to reduce cost.

Appendix: Useful env vars

- `KALDI_GOP_COMMAND` — command string run by `KaldiGopFeaturePipeline` (should read GOP env vars set by the pipeline)
- `GOPT_FEATURE_DIR` — where `<analysis>_feat.npy` and `<analysis>_phn.npy` go
- `GOPT_MODEL_DIR` — where GOPT repo and checkpoints live


