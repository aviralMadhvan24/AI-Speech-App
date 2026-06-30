import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "../types";

const STORAGE_KEY = "softskills.auth.user";
export const ALLOWED_DOMAIN = "kiet.edu";

function safeRead(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
  // "rohit.sharma_22" -> "Rohit Sharma"
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\d+$/g, "")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim() || local;
}

export interface UseAuth {
  user: AuthUser | null;
  isAuthenticated: boolean;
  signIn: (rawEmail: string) => { ok: true } | { ok: false; error: string };
  signOut: () => void;
}

export function useAuth(): UseAuth {
  const [user, setUser] = useState<AuthUser | null>(() => safeRead());

  // Cross-tab sync — if the user signs in or out in another tab, reflect it.
  useEffect(() => {
    function handle(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      setUser(safeRead());
    }
    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  const signIn = useCallback(
    (rawEmail: string): { ok: true } | { ok: false; error: string } => {
      const email = rawEmail.trim().toLowerCase();
      if (!email) {
        return { ok: false, error: "Enter your college email." };
      }
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setUser(next);
      return { ok: true };
    },
    [],
  );

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  return {
    user,
    isAuthenticated: !!user,
    signIn,
    signOut,
  };
}
