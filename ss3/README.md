# Communication Skills Analyzer (CSA)

A local web application that analyzes body language from a short webcam
recording. Phase 1 ships rule-based scoring for posture, eye contact,
gestures, stillness, and facial expression using MediaPipe + OpenCV, with a
React + Vite frontend and a FastAPI backend.

Everything runs locally on your laptop. Videos and reports stay on disk
under `data/` and are never sent anywhere.

## Requirements

- Python 3.11 (MediaPipe wheels are not yet stable on 3.13)
- Node.js 18+ and npm
- A webcam and microphone

## Setup

### Backend (Python)

```bash
# From the project root
python -m venv .venv
.venv\Scripts\activate     # Windows
# source .venv/bin/activate  # macOS / Linux

pip install -e ".[dev]"
```

If conda picks up a different Python, create the env explicitly:

```bash
conda create -n csa python=3.11 -y
conda activate csa
pip install -e ".[dev]"
```

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run build
cd ..
```

## Run (production-style: one server)

After `npm run build`, the FastAPI backend serves the compiled React app
on the same port:

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000` in Chrome or Edge.

## Run (dev mode: hot reload for UI work)

Two terminals. The Vite dev server proxies API calls to the backend.

Terminal 1 (backend):

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Terminal 2 (frontend):

```bash
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173` for the UI with hot reload.

## Project layout

```
backend/                FastAPI app and analysis modules
  modules/              One folder per Analysis_Module
  modules/body_language/  Phase 1: posture, eye contact, gestures, stillness, facial expression
frontend/               React + Vite + Tailwind
  src/components/       Top-level views
  dist/                 Vite build output (served by FastAPI)
data/                   Local session storage (gitignored)
  sessions/<id>/        video.webm, metadata.json, report.json
```

## Configuration

Per-analyzer thresholds, scoring weights, and the feedback text bank live
in YAML under `backend/modules/body_language/`:

- `config.yaml` - thresholds + scoring weights
- `suggestions.yaml` - per-metric feedback text bank

Global backend settings (port, data directory, retention limit) live in
`backend/config.yaml`. Restart the backend after editing any config file.

## Phase 1 scope

Phase 1 is intentionally body-language only. The folder layout under
`backend/modules/` is designed so future modules (pronunciation, vocabulary,
interview question bank, gamification) can be added without touching
existing code. See `.kiro/specs/communication-skills-analyzer/design.md` for
the full architecture.
