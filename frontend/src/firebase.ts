/**
 * Firebase Web SDK initialization.
 *
 * Reads Vite env vars (must be prefixed `VITE_FIREBASE_*` so Vite exposes
 * them to the client bundle). When any required key is missing, this file
 * still loads — but `getFirebaseApp()` and `getFirebaseAuth()` return null
 * so the rest of the app can fall back to bypass mode for local dev.
 *
 * See `AUTH.md` for how to obtain the config values from the Firebase
 * Console.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  measurementId?: string;
}

function readConfig(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as
    | string
    | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as
    | string
    | undefined;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;

  // Required minimum.
  if (!apiKey || !authDomain || !projectId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
      | string
      | undefined,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as
      | string
      | undefined,
  };
}

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

export function isFirebaseConfigured(): boolean {
  return readConfig() !== null;
}

export function getFirebaseApp(): FirebaseApp | null {
  if (_app) return _app;
  const config = readConfig();
  if (!config) return null;
  _app = initializeApp(config);
  return _app;
}

export function getFirebaseAuth(): Auth | null {
  if (_auth) return _auth;
  const app = getFirebaseApp();
  if (!app) return null;
  _auth = getAuth(app);
  return _auth;
}

// Allow components to read the bypass flag.
export const AUTH_BYPASS =
  (import.meta.env.VITE_AUTH_BYPASS as string | undefined)?.toLowerCase() ===
  "true";
