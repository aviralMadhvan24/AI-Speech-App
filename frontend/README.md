# Pronunciation Frontend

A React + Vite + Tailwind + TypeScript UI that pairs with the FastAPI
pronunciation backend in this repository. Lives entirely under `frontend/`;
the backend (`app/`) and the legacy vanilla-JS UI (`app/frontend/`) are
untouched.

## Prerequisites

- Node.js 18+ (Node 20 LTS recommended).
- The backend running on port `8080`. From the repository root:

  ```pwsh
  uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
  ```

  Vite's dev server proxies `/battle`, `/analyze`, and `/attempts` to
  `http://localhost:8080`.

## Install and run

```pwsh
cd frontend
npm install
npm run dev
```

Then open <http://localhost:5173>. The app talks to the backend via the
Vite proxy, so there is no CORS configuration to manage.

## Production build

```pwsh
npm run build      # type-check + bundle to dist/
npm run preview    # serve dist/ on a local port to sanity-check
```

`npm run preview` does **not** proxy to the backend — use `npm run dev` for
local development against a running backend.

## What it talks to

| UI action                | Backend endpoint              |
| ------------------------ | ----------------------------- |
| Load sentences           | `GET /battle/prompts`         |
| Score a recording        | `POST /analyze` (multipart)   |
| Past sessions list       | `GET /attempts?limit=50`      |

There is no `GET /pronunciation/sessions/{id}` or `DELETE` endpoint in the
backend; the frontend caches the full sectioned `/analyze` response in
memory so the report screen can be reopened during the same session, and
"Delete" only hides items from the local list.

## Project layout

```
frontend/
  index.html                 # html.dark, Inter, ambient orbs slot
  vite.config.ts             # /battle, /analyze, /attempts proxy
  tailwind.config.js         # palette, glows, animations
  src/
    main.tsx
    App.tsx                  # state machine: home / practice / processing / report
    api.ts                   # adapter between wire and domain types
    types.ts                 # public domain types
    index.css                # Tailwind + custom utilities
    components/
      BackgroundOrbs.tsx
      Header.tsx
      HomeView.tsx
      PracticeView.tsx
      ProcessingView.tsx
      ReportView.tsx
      MicButton.tsx
      AudioVisualizer.tsx
      ScoreBadge.tsx
      WordPill.tsx
    hooks/
      useAudioRecorder.ts
      useAudioVisualizer.ts
      useCountUp.ts
```

## 1v1 Pronunciation Battle

The home screen has a second CTA, **Start 1v1 Battle**, that opens a lobby
where two players race on the same prompt at the same time.

### How to start a battle

1. Browser 1 — click **Start 1v1 Battle**, enter your name, hit **Create Room**.
2. The room view shows a 6-character code (e.g. `K7M2X9`). Share it.
3. Browser 2 — open the app, click **Start 1v1 Battle**, enter a name, paste
   the code, hit **Join Room**.
4. Both players see the same prompt. Each clicks **I'm Ready**.
5. Once both are ready, the server pushes a 3-2-1 countdown and then a
   60-second recording window.
6. Recording auto-stops at the deadline (or sooner if the player taps
   stop). Each client runs the standard `POST /analyze` pipeline locally
   and submits the score over the WebSocket.
7. When both scores arrive, the server computes a 3-star verdict
   (pronunciation, clarity, pace) and the UI flips to the result screen.

### What the backend adds

| Action               | Endpoint                            |
| -------------------- | ----------------------------------- |
| Create a room        | `POST /battle/rooms`                |
| Join with a code     | `POST /battle/rooms/{code}/join`    |
| Poll room state      | `GET /battle/rooms/{code}`          |
| Live updates         | `WS  /battle/ws/{code}?player_id=…` |

Vite proxies all `/battle/*` paths (including the WebSocket upgrade) to the
FastAPI backend on port 8080.

### Known limitations

- **No persistence.** Room state lives in-process memory inside the FastAPI
  app. Every uvicorn reload (file save in dev) wipes all active rooms.
- **Single-instance only.** Because state is in-memory, running more than
  one backend process or behind a non-sticky load balancer would not work.
- **No reconnect across page reloads.** Refreshing a browser drops the
  player out of the room. The remaining player is shown an
  "opponent left the battle" screen.
- **No authentication.** Players are identified only by a server-issued
  `player_id` returned at create/join time. Anyone with the room code can
  join up to the second seat.
- **Network jitter.** The 60-second timer is server-driven, so badly out-of-
  sync clocks won't desync the round, but very slow uploads after the
  buzzer may end up replaced with zeros if they miss the grace window.
