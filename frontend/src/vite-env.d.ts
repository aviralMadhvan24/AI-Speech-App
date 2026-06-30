/// <reference types="vite/client" />

interface ImportMetaEnv {
  // When "true", frontend skips Firebase and uses the local demo auth.
  // Pair with backend AUTH_BYPASS=true.
  readonly VITE_AUTH_BYPASS?: string;

  // Firebase Web SDK config. Get these from Firebase Console →
  // Project settings → General → Your apps → SDK setup & config.
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
