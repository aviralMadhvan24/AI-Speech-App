import { ArrowLeft, Bell, Construction } from "lucide-react";

interface ComingSoonViewProps {
  title: string;
  tagline: string;
  description: string;
  bullets?: string[];
  onBack: () => void;
}

export function ComingSoonView({
  title,
  tagline,
  description,
  bullets,
  onBack,
}: ComingSoonViewProps) {
  return (
    <div key={`coming-soon-${title}`} className="animate-fade-in-up">
      <button
        type="button"
        onClick={onBack}
        className="btn-ghost mb-6 inline-flex items-center gap-2"
        aria-label="Back to main menu"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <section className="card-glass relative overflow-hidden p-8 md:p-12">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-600/15 blur-3xl"
        />

        <div className="relative max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
            <Construction className="w-3.5 h-3.5" />
            <span>{tagline}</span>
          </div>

          <h1 className="mt-5 text-3xl md:text-5xl font-bold tracking-tight text-zinc-50">
            {title}
          </h1>

          <p className="mt-3 text-zinc-400 text-base md:text-lg leading-relaxed">
            {description}
          </p>

          {bullets && bullets.length > 0 && (
            <ul className="mt-6 space-y-2.5">
              {bullets.map((bullet, index) => (
                <li
                  key={bullet}
                  style={{ animationDelay: `${index * 60}ms` }}
                  className="animate-fade-in-up flex items-start gap-2.5 text-sm text-zinc-300"
                >
                  <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8 inline-flex items-center gap-2.5 text-sm text-zinc-400 bg-zinc-900/60 border border-zinc-800/70 rounded-xl px-4 py-3">
            <Bell className="w-4 h-4 text-amber-300" />
            <span>
              We'll switch this on as soon as the engine is ready. Stay tuned.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
