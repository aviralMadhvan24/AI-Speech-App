# Authentication

Real-user auth uses **Firebase Auth** with Google Sign-In, restricted to
`@kiet.edu` accounts. The backend verifies every request via the Firebase
Admin SDK; the frontend uses the Firebase Web SDK in the browser.

For local development without Firebase, set `AUTH_BYPASS=true` (and
`VITE_AUTH_BYPASS=true` for the frontend) — everything keeps working with
a fake `dev@kiet.edu` user.

## Architecture in two sentences

The frontend signs in with Google, gets a Firebase ID token, attaches it
as `Authorization: Bearer <token>` on every API call (and `?id_token=...`
on the WebSocket connection). The backend verifies the token with
firebase-admin, extracts the email claim, and rejects anything that isn't
`@kiet.edu` (403) or fails verification (401).

## One-time Firebase setup

You need exactly one Firebase project for the whole platform. A KIET admin
should own it.

### 1. Create the project

1. Open <https://console.firebase.google.com>.
2. Click **Add project**. Name it something like `kiet-softskills`.
3. Skip Google Analytics (not needed for auth).

### 2. Enable Google Sign-In

1. Go to **Build → Authentication → Get started**.
2. Click **Sign-in method**.
3. Click **Google** in the list, toggle **Enable**, set the support email
   to a KIET admin, and save.
4. Under **Settings → Authorized domains**, add the domain(s) where the
   app will be served (e.g. `localhost`, `softskills.kiet.edu`, or your
   staging domain). Firebase blocks sign-ins from any other domain.

### 3. Restrict sign-ins to `@kiet.edu`

We enforce this in two layers:

1. **Frontend hint** — the Google popup is opened with `hd=kiet.edu` so
   Google preselects the KIET account if the student is signed into
   multiple Google accounts. (Code in `useAuth.ts` already does this.)
2. **Server enforcement** — `app/auth/dependencies.py` checks
   `claims.email.endswith("@kiet.edu")` after verifying the token and
   returns 403 on anything else. This is the actual gate; the frontend
   hint is just UX.

Optional but recommended: add a **Blocking function** in Firebase Auth
(Cloud Functions for Firebase) that rejects the sign-in before the user
record is created. This stops non-KIET emails from cluttering the
Firebase user list. Set up later when you're past the demo phase.

### 4. Get the Web SDK config (for the frontend)

1. Project settings → **General** → scroll to **Your apps**.
2. Click the web icon (`</>`) to register a web app. Name it
   `kiet-softskills-frontend`.
3. Skip Firebase Hosting.
4. Copy the config object — you'll need these values:

   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "kiet-softskills.firebaseapp.com",
     projectId: "kiet-softskills",
     storageBucket: "kiet-softskills.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123",
   };
   ```

5. Put them in `frontend/.env.production` (or `.env.local` for dev):

   ```ini
   VITE_AUTH_BYPASS=false
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=kiet-softskills.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=kiet-softskills
   VITE_FIREBASE_STORAGE_BUCKET=kiet-softskills.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
   VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
   ```

   Note: `apiKey` here is safe to ship in the bundle — it's a public key
   restricted by your auth domain. Don't bother trying to hide it.

### 5. Get the Admin SDK service account (for the backend)

1. Project settings → **Service accounts** → **Generate new private key**.
2. Download the JSON file. Keep it private (gitignored).
3. Provide it to the backend in **one** of two ways:

   **Option A — file path (best for dev / Docker volume mount):**

   ```ini
   GOOGLE_APPLICATION_CREDENTIALS=/secrets/firebase-admin.json
   AUTH_BYPASS=false
   ```

   **Option B — inline JSON (best for cloud env vars):**

   Copy the entire JSON contents into one line and set it directly:

   ```ini
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"kiet-softskills",...}
   AUTH_BYPASS=false
   ```

## Running locally with real Firebase

1. Backend: drop the JSON in `.firebase-admin.json` at repo root, then:

   ```pwsh
   $env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\.firebase-admin.json"
   $env:AUTH_BYPASS = "false"
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
   ```

2. Frontend: write `frontend/.env.local` with the `VITE_FIREBASE_*` keys
   above. Then:

   ```pwsh
   cd frontend
   npm run dev
   ```

Open <http://localhost:5173>. The login screen shows **Continue with Google**.

## Running locally without Firebase (default)

If `AUTH_BYPASS=true` (the default in this repo's `.env`) and the frontend
has `VITE_AUTH_BYPASS=true` (or the `VITE_FIREBASE_*` vars are absent),
everything keeps working with a fake `dev@kiet.edu` user. No Firebase
account, no service account JSON, no popup. Use this for fast iteration.

## Running in production

Compose snippet:

```yaml
services:
  app:
    environment:
      AUTH_BYPASS: "false"
      GOOGLE_APPLICATION_CREDENTIALS: /run/secrets/firebase-admin
      # ... plus the frontend VITE_* vars baked into the image at build time
    secrets:
      - firebase-admin

secrets:
  firebase-admin:
    file: ./.firebase-admin.json
```

The frontend `VITE_*` vars need to be available at **build time** (Vite
inlines them into the bundle). Pass them with `--build-arg` or copy a
`.env.production` file into the build context. See the
multi-stage Dockerfile for one approach.

## Caveats

- `apiKey` in the frontend is public, restricted to your authorized
  domains. Don't ship the admin SDK JSON to the browser — it's privileged.
- The hosted-domain (`hd`) parameter is a Google hint, not a security
  control. Always do the server-side `@kiet.edu` check.
- Token expiration: Firebase ID tokens last about 1 hour. The Web SDK
  refreshes automatically; `useAuth.getIdToken()` always returns a fresh
  one.
- WebSocket auth: browsers can't set headers on `WebSocket()`. We pass
  the token as `?id_token=...` instead and verify it before
  `websocket.accept()`. Server-side close code is `4401` on auth failure.
