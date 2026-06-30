# Mock Interview MVP

A lean web app where students record short video interview answers and teachers
review and score them, producing a single overall score per answer and one
college-wide leaderboard.

This is an npm-workspaces monorepo:

| Workspace | Stack | Purpose |
|---|---|---|
| `backend/` | Express + TypeScript | REST API: auth, questions, submissions, evaluations, scoring, leaderboard |
| `frontend/` | React + TypeScript + Tailwind + Vite | Single-page application for Students and Teachers |

## Stack

- **Backend:** Express + TypeScript, SQLite via **Prisma**, JWT (HS256) auth, local video storage behind a `VideoStore` interface.
- **Frontend:** Vite + React + TypeScript + Tailwind.
- **Testing:** **Vitest** as the test runner with **fast-check** for property-based tests of the pure scoring / leaderboard / validation logic.

## Getting started

```bash
npm install              # install all workspaces
npm run prisma:generate --workspace backend   # generate the Prisma client
npm run build            # build backend + frontend
npm test                 # run the backend test suite (Vitest + fast-check)
npm run dev:backend      # start the Express dev server (http://localhost:3000)
npm run dev:frontend     # start the Vite dev server
```

Health check: with the backend running, `GET http://localhost:3000/health`
returns `{ "status": "ok" }`.

## Testing

- **Vitest** is the test runner.
- **fast-check** powers property-based tests (minimum 100 iterations), tagged
  `Feature: mock-interview-mvp, Property {n}: {text}`.
