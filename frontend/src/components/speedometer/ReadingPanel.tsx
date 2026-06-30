import type { TokenStatus } from "../../hooks/usePassageMatch";

interface ReadingPanelProps {
  tokens: string[];
  statuses: TokenStatus[];
  matchedCount: number;
  progressPct: number;
  passageKey: number | null;
}

export function ReadingPanel({
  tokens,
  statuses,
  matchedCount,
  progressPct,
  passageKey,
}: ReadingPanelProps) {
  return (
    <div className="space-y-3">
      <div
        aria-live="polite"
        className="rounded-2xl bg-zinc-950/60 border border-zinc-800/70 p-5 md:p-6 max-h-72 overflow-y-auto leading-relaxed text-lg"
      >
        <div key={passageKey ?? "empty"} className="animate-fade-in-up">
          {tokens.length === 0 ? (
            <span className="text-zinc-500 italic">
              Select a paragraph above to start reading...
            </span>
          ) : (
            tokens.map((tok, i) => {
              let cls = "text-zinc-500 transition-colors";
              if (i === matchedCount) {
                cls =
                  "text-brand-200 bg-brand-500/15 ring-1 ring-brand-500/40 rounded px-0.5 transition-colors";
              } else if (i < matchedCount) {
                cls =
                  statuses[i] === "wrong"
                    ? "text-rose-300 line-through decoration-rose-500/60"
                    : "text-emerald-300";
              }
              return (
                <span key={`${tok}-${i}`} className={cls}>
                  {tok}{" "}
                </span>
              );
            })
          )}
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-zinc-900/80 border border-zinc-800/60 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-500 via-fuchsia-500 to-cyan-400 transition-[width] duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
