import { useState, type FormEvent } from "react";
import { ArrowRight, GraduationCap, Mail, Shield, Sparkles } from "lucide-react";
import { ALLOWED_DOMAIN } from "../hooks/useAuth";

interface LoginViewProps {
  onSignIn: (email: string) => { ok: true } | { ok: false; error: string };
}

export function LoginView({ onSignIn }: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = onSignIn(email);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
    }
    // On success App.tsx will switch views, this component unmounts.
  }

  return (
    <div
      key="login"
      className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 animate-fade-in-up"
    >
      <div className="w-full max-w-md">
        <div className="card-glass relative overflow-hidden p-8 md:p-10">
          {/* Decorative gradient blur in the corner */}
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
              Sign in with your college email to start practicing soft skills
              with live battles, structured drills, and feedback.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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

              {error && (
                <p
                  id="login-error"
                  role="alert"
                  className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2"
                >
                  {error}
                </p>
              )}

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
            </form>

            <div className="mt-6 flex items-start gap-2 text-xs text-zinc-500">
              <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400/70" />
              <p>
                We don't store passwords. Your audio is processed locally on the
                campus server.
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
