import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  AUTH_BYPASS,
  getFirebaseAuth,
  isFirebaseConfigured,
} from "../firebase";
import type { AuthUser } from "../types";

const BYPASS_STORAGE_KEY = "softskills.auth.bypassUser";
export const ALLOWED_DOMAIN = "kiet.edu";

// ---------------------------------------------------------------------------
// Bypass mode storage (used when VITE_AUTH_BYPASS=true OR Firebase isn't
// configured — keeps local dev one-click while still simulating the @kiet.edu
// gate.)
// ---------------------------------------------------------------------------

function readBypassUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BYPASS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.email || typeof parsed.email !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function deriveDisplayName(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local) return "Student";
  return (
    local
      .replace(/[._-]+/g, " ")
      .replace(/\d+$/g, "")
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
      .trim() || local
  );
}

// ---------------------------------------------------------------------------
// Module-level token bridge — lets non-React modules (api.ts, battleApi.ts,
// useBattleSocket.ts) fetch the current ID token without prop-drilling.
// The hook registers the active getter on mount and clears it on unmount.
// ---------------------------------------------------------------------------

let activeTokenGetter: (() => Promise<string | null>) | null = null;

export async function getCurrentIdToken(): Promise<string | null> {
  if (!activeTokenGetter) return null;
  return activeTokenGetter();
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export type SignInResult = { ok: true } | { ok: false; error: string };

export interface UseAuth {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True while we're waiting for Firebase to restore the previous session. */
  loading: boolean;
  /** Whichever auth mode is live ("firebase" or "bypass"). */
  mode: "firebase" | "bypass";
  /** Bypass-mode email sign-in. No-op when running on real Firebase. */
  signInWithEmail: (rawEmail: string) => SignInResult;
  /** Google popup sign-in. No-op when in bypass mode. */
  signInWithGoogle: () => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Latest Firebase ID token if available. Refreshes lazily. */
  getIdToken: () => Promise<string | null>;
}

const firebaseConfigured = isFirebaseConfigured();
const mode: UseAuth["mode"] = AUTH_BYPASS || !firebaseConfigured
  ? "bypass"
  : "firebase";

function firebaseUserToAuthUser(fbUser: FirebaseUser): AuthUser {
  const email = (fbUser.email ?? "").toLowerCase();
  const name =
    fbUser.displayName ||
    (email ? deriveDisplayName(email) : "Student");
  return {
    email,
    displayName: name,
    loggedInAt: new Date().toISOString(),
  };
}

export function useAuth(): UseAuth {
  // Bypass mode: pull from localStorage immediately. Firebase mode: wait
  // for onAuthStateChanged to fire before deciding.
  const [user, setUser] = useState<AuthUser | null>(() =>
    mode === "bypass" ? readBypassUser() : null,
  );
  const [loading, setLoading] = useState<boolean>(mode === "firebase");
  const tokenRef = useRef<string | null>(null);
  const fbUserRef = useRef<FirebaseUser | null>(null);

  // Subscribe to Firebase auth state in Firebase mode.
  useEffect(() => {
    if (mode !== "firebase") return;
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      fbUserRef.current = fbUser;
      if (!fbUser) {
        tokenRef.current = null;
        setUser(null);
        setLoading(false);
        return;
      }
      const email = (fbUser.email ?? "").toLowerCase();
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        // Domain check on the client too — sign them out immediately so the
        // backend never sees a forbidden token.
        await firebaseSignOut(auth);
        tokenRef.current = null;
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        tokenRef.current = await fbUser.getIdToken();
      } catch {
        tokenRef.current = null;
      }
      setUser(firebaseUserToAuthUser(fbUser));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Cross-tab sync for bypass mode.
  useEffect(() => {
    if (mode !== "bypass") return;
    function handle(event: StorageEvent) {
      if (event.key !== BYPASS_STORAGE_KEY) return;
      setUser(readBypassUser());
    }
    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  const signInWithEmail = useCallback(
    (rawEmail: string): SignInResult => {
      if (mode !== "bypass") {
        return {
          ok: false,
          error:
            "Email sign-in is only available in dev (VITE_AUTH_BYPASS=true).",
        };
      }
      const email = rawEmail.trim().toLowerCase();
      if (!email) return { ok: false, error: "Enter your college email." };
      const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!looksLikeEmail) {
        return { ok: false, error: "That doesn't look like a valid email." };
      }
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return {
          ok: false,
          error: `Only @${ALLOWED_DOMAIN} accounts can sign in.`,
        };
      }
      const next: AuthUser = {
        email,
        displayName: deriveDisplayName(email),
        loggedInAt: new Date().toISOString(),
      };
      window.localStorage.setItem(BYPASS_STORAGE_KEY, JSON.stringify(next));
      setUser(next);
      return { ok: true };
    },
    [],
  );

  const signInWithGoogle = useCallback(async (): Promise<SignInResult> => {
    if (mode !== "firebase") {
      return {
        ok: false,
        error: "Google sign-in needs VITE_FIREBASE_API_KEY etc to be set.",
      };
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      return { ok: false, error: "Firebase failed to initialize." };
    }
    const provider = new GoogleAuthProvider();
    // Hint Google to prefer the @kiet.edu hosted-domain accounts when
    // the user has Workspace. This is just a hint — the real enforcement is
    // the email-domain check below.
    provider.setCustomParameters({ hd: ALLOWED_DOMAIN });
    try {
      const result = await signInWithPopup(auth, provider);
      const email = (result.user.email ?? "").toLowerCase();
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await firebaseSignOut(auth);
        return {
          ok: false,
          error: `Only @${ALLOWED_DOMAIN} Google accounts can sign in.`,
        };
      }
      // onAuthStateChanged will set the user state.
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "unknown";
      if (code === "auth/popup-closed-by-user") {
        return { ok: false, error: "Sign-in cancelled." };
      }
      const message = err instanceof Error ? err.message : "Sign-in failed.";
      return { ok: false, error: message };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (mode === "firebase") {
      const auth = getFirebaseAuth();
      if (auth) await firebaseSignOut(auth);
    } else {
      window.localStorage.removeItem(BYPASS_STORAGE_KEY);
      setUser(null);
    }
    tokenRef.current = null;
    fbUserRef.current = null;
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (mode === "bypass") {
      // Backend's AUTH_BYPASS path doesn't check the token, but sending a
      // sentinel makes server logs greppable.
      return "dev-bypass-token";
    }
    const fbUser = fbUserRef.current;
    if (!fbUser) return tokenRef.current;
    try {
      // Firebase auto-refreshes when expired.
      const fresh = await fbUser.getIdToken();
      tokenRef.current = fresh;
      return fresh;
    } catch {
      return tokenRef.current;
    }
  }, []);

  // Register/unregister the module-level bridge so non-React modules can
  // call `getCurrentIdToken()` without subscribing to this hook.
  useEffect(() => {
    activeTokenGetter = getIdToken;
    return () => {
      if (activeTokenGetter === getIdToken) {
        activeTokenGetter = null;
      }
    };
  }, [getIdToken]);

  return {
    user,
    isAuthenticated: !!user,
    loading,
    mode,
    signInWithEmail,
    signInWithGoogle,
    signOut,
    getIdToken,
  };
}
