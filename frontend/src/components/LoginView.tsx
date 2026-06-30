import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  GraduationCap,
  Loader2,
  Mail,
  Shield,
  Sparkles,
} from "lucide-react";
import { ALLOWED_DOMAIN, type SignInResult } from "../hooks/useAuth";

interface LoginViewProps {
  mode: "firebase" | "bypass";
  onSignInWithEmail: (email: string) => SignInResult;
  onSignInWithGoogle: () => Promise<SignInResult>;
}

export function LoginView({
  mode,
  onSignInWithEmail,
  onSignInWithGoogle,
}: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = onSignInWithEmail(email);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
    }
  }

  async function handleGoogleClick() {
    setError(null);
    setSubmitting(true);
    const result = await onSignInWithGoogle();
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
    }
  }

  return (
    <div
      key="login"
      className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 animate-fade-in-up"
    >
      <div className="w-full max-w-md">
        <div className="card-glass relative overflow-hidden p-8 md:p-10">
          <div
            aria-hidden
            className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-gradient-to-br from-brand-500/40 to-fuchsia-600/30 blur-3xl"
          />

          <div className="relative">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-brand-300 bg-brand-500/10 border border-brand-500/30 px-3 py-1 rounded-full">
              <GraduationCap className="w-3.5 h-3.5" />
              <span>KIET Members Only</span>
            </div>

            <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-zinc-50">
              Welcome back.
            </h1>
            <p className="mt-2 text-zinc-400 text-sm md:text-base leading-relaxed">
              Sign in with your college account to start practicing soft skills
              with live battles, structured drills, and feedback.
            </p>

            {mode === "firebase" ? (
              <div className="mt-8 space-y-4">
                <button
                  type="button"
                  onClick={handleGoogleClick}
                  disabled={submitting}
                  aria-label="Sign in with your KIET Google account"
                  className="w-full inline-flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-white text-zinc-900 font-semibold hover:bg-zinc-100 active:scale-[0.97] transition shadow-glow-sm disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {submitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span>Continue with Google</span>
                </button>

                <div className="text-xs text-zinc-500 text-center">
                  Use your{" "}
                  <span className="text-zinc-300 font-medium">
                    @{ALLOWED_DOMAIN}
                  </span>{" "}
                  Google account.
                </div>
              </div>
            ) : (
              <form onSubmit={handleEmailSubmit} className="mt-8 space-y-4">
                <label className="block">
                  <span className="text-sm text-zinc-300">College email</span>
                  <div className="mt-2 relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      type="email"
                      autoComplete="email"
                      autoFocus
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder={`your.name@${ALLOWED_DOMAIN}`}
                      aria-invalid={!!error}
                      aria-describedby={error ? "login-error" : undefined}
                      className="w-full bg-zinc-950/60 border border-zinc-800 hover:border-zinc-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 outline-none rounded-xl pl-10 pr-4 py-3 text-zinc-100 placeholder:text-zinc-600 transition"
                    />
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary w-full justify-center py-3 text-base"
                  aria-label="Sign in"
                >
                  <span className="flex items-center justify-center gap-2">
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </button>

                <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-full">
                  <Sparkles className="w-3 h-3" />
                  <span>Dev bypass mode · no Google needed</span>
                </div>
              </form>
            )}

            {error && (
              <p
                id="login-error"
                role="alert"
                className="mt-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2"
              >
                {error}
              </p>
            )}

            <div className="mt-6 flex items-start gap-2 text-xs text-zinc-500">
              <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400/70" />
              <p>
                Your audio is processed on the campus server and never sent to
                third parties.
              </p>
            </div>

            <div className="mt-3 flex items-start gap-2 text-xs text-zinc-500">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400/70" />
              <p>
                Only @{ALLOWED_DOMAIN} accounts are allowed during the pilot.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-600">
          A KIET communication-skills pilot · pronunciation, fluency, debates
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M21.6 12.227c0-.687-.062-1.348-.176-1.984H12v3.755h5.382c-.232 1.25-.937 2.31-1.996 3.02v2.51h3.23c1.89-1.74 2.984-4.302 2.984-7.301z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.963-.895 6.616-2.43l-3.23-2.51c-.895.6-2.04.954-3.386.954-2.602 0-4.806-1.756-5.593-4.117H3.07v2.59A9.998 9.998 0 0012 22z"
        fill="#34A853"
      />
      <path
        d="M6.407 13.897A6.001 6.001 0 016.09 12c0-.66.114-1.302.317-1.897V7.514H3.07A9.998 9.998 0 002 12c0 1.614.386 3.14 1.07 4.487l3.337-2.59z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.983c1.47 0 2.787.505 3.825 1.498l2.867-2.867C16.96 2.992 14.697 2 12 2A9.998 9.998 0 003.07 7.513l3.337 2.59C7.194 7.74 9.398 5.983 12 5.983z"
        fill="#EA4335"
      />
    </svg>
  );
}
