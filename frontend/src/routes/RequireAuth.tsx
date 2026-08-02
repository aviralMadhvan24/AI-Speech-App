import type { ReactNode } from "react";
import { BackgroundOrbs } from "../components/BackgroundOrbs";
import { LoginView } from "../components/LoginView";
import { useAuth } from "../hooks/useAuth";

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * RequireAuth — the authentication gate for the routed app.
 *
 * It reproduces the three auth branches `App` renders today, so switching to
 * URL-based routing preserves the existing gate exactly:
 *
 *   1. While the session is still being restored (`loading`), render the
 *      "Restoring your session…" splash.
 *   2. If there is no user, render `LoginView` **in place** — the URL is NOT
 *      changed, so the intended activity route stays in the address bar and
 *      re-renders automatically once `user` becomes truthy after login
 *      (an automatic post-login round-trip — Req 2.9).
 *   3. If there is a user, render `children` (the authenticated route tree).
 *
 * Consuming `useAuth` directly (rather than taking props) keeps the guard a
 * drop-in wrapper anywhere in the route tree.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const {
    user,
    loading,
    mode: authMode,
    signInWithEmail,
    signInWithGoogle,
  } = useAuth();

  // --- Auth loading state (Firebase restoring session) ---
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 relative">
        <BackgroundOrbs />
        <div className="text-sm tracking-wide animate-pulse">
          Restoring your session…
        </div>
      </div>
    );
  }

  // --- Pre-auth: show login in place, keeping the intended URL ---
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
        <BackgroundOrbs />
        <LoginView
          mode={authMode}
          onSignInWithEmail={signInWithEmail}
          onSignInWithGoogle={signInWithGoogle}
        />
      </div>
    );
  }

  // --- Authenticated: render the guarded route tree ---
  return <>{children}</>;
}
