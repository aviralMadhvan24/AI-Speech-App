import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Crown,
  Info,
  Loader2,
  Medal,
  RefreshCw,
  Trophy,
} from "lucide-react";
import {
  fetchLeaderboard,
  type AdminLeaderboardEntry,
} from "../../adminApi";
import { scoreColorClasses } from "../../utils/scoreColor";

interface AdminLeaderboardViewProps {
  /** Optional caller-driven row limit (admin endpoint caps at 50). */
  limit?: number;
}

type SortKey = "best" | "avg";

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

const PODIUM_THEMES = [
  {
    label: "Gold",
    badge: "from-amber-400 to-orange-500",
    glow: "shadow-[0_0_28px_-6px_rgba(251,191,36,0.55)]",
    accent: "text-amber-300",
    border: "border-amber-500/40",
    chip: "bg-amber-500/10 border-amber-500/40 text-amber-200",
    icon: Crown,
  },
  {
    label: "Silver",
    badge: "from-zinc-300 to-zinc-500",
    glow: "shadow-[0_0_22px_-6px_rgba(228,228,231,0.45)]",
    accent: "text-zinc-200",
    border: "border-zinc-400/40",
    chip: "bg-zinc-500/10 border-zinc-400/40 text-zinc-200",
    icon: Medal,
  },
  {
    label: "Bronze",
    badge: "from-orange-400 to-rose-500",
    glow: "shadow-[0_0_22px_-6px_rgba(249,115,22,0.45)]",
    accent: "text-orange-300",
    border: "border-orange-500/40",
    chip: "bg-orange-500/10 border-orange-500/40 text-orange-200",
    icon: Award,
  },
];

export function AdminLeaderboardView({ limit = 10 }: AdminLeaderboardViewProps) {
  const [entries, setEntries] = useState<AdminLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("best");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeaderboard(limit);
      setEntries(data.entries);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load leaderboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const list = [...entries];
    if (sort === "avg") {
      list.sort((a, b) => b.avg_score - a.avg_score);
    } else {
      list.sort((a, b) => b.best_score - a.best_score);
    }
    return list;
  }, [entries, sort]);

  const podium = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100 inline-flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-300" />
            Top performers
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Top {limit} by score. Toggle between best single attempt and rolling average.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div
        role="radiogroup"
        aria-label="Sort leaderboard by"
        className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/60 p-0.5 text-xs"
      >
        {(
          [
            { value: "best", label: "Best score" },
            { value: "avg", label: "Average score" },
          ] as Array<{ value: SortKey; label: string }>
        ).map((opt) => {
          const active = sort === opt.value;
          return (
            <label
              key={opt.value}
              className={[
                "px-3 py-1.5 rounded-lg cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-brand-500/60",
                active
                  ? "bg-brand-500/20 text-brand-200 border border-brand-500/40"
                  : "text-zinc-400 border border-transparent hover:text-zinc-200",
              ].join(" ")}
            >
              <input
                type="radio"
                name="leaderboard-sort"
                value={opt.value}
                checked={active}
                onChange={() => setSort(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          );
        })}
      </div>

      {loading && entries.length === 0 && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading leaderboard…
        </div>
      )}

      {error && (
        <div className="card-glass border-rose-500/40 px-4 py-3 flex items-start gap-3 text-sm text-rose-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div>{error}</div>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs font-medium text-rose-200 underline underline-offset-4"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="card-glass border-dashed border-zinc-700/60 px-6 py-10 text-center">
          <Trophy className="w-8 h-8 text-zinc-500 mx-auto" />
          <div className="mt-3 text-zinc-200 font-medium">
            No leaderboard data yet.
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Once students complete their first reviewed submission, they show
            up here.
          </p>
        </div>
      )}

      {podium.length > 0 && (
        <section
          aria-label="Top 3"
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          {podium.map((entry, idx) => {
            const theme = PODIUM_THEMES[idx]!;
            const Icon = theme.icon;
            const featured = sort === "best" ? entry.best_score : entry.avg_score;
            return (
              <div
                key={entry.email}
                style={{ animationDelay: `${idx * 90}ms` }}
                className={`card-glass relative overflow-hidden p-5 animate-fade-in-up ${theme.glow}`}
              >
                <div
                  aria-hidden
                  className={`absolute -top-12 -right-12 h-28 w-28 rounded-full `}
                />
                <div className="relative flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-2xl bg-[var(--raised)] border border-[var(--hairline-strong)] flex items-center justify-center text-white`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[10px] uppercase tracking-widest font-semibold ${theme.accent}`}
                    >
                      #{idx + 1} · {theme.label}
                    </div>
                    <div className="text-base font-semibold text-zinc-100 truncate">
                      {entry.display_name || entry.email}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {entry.email}
                    </div>
                  </div>
                </div>

                <div className="relative mt-4 flex items-end gap-2">
                  <div className="text-5xl font-bold tabular-nums leading-none text-zinc-100">
                    {Math.round(featured)}
                  </div>
                  <div className="pb-1 text-xs text-zinc-500">/100</div>
                </div>
                <div className="relative mt-3 grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
                  <Stat label="Attempts" value={entry.attempts.toString()} />
                  <Stat
                    label="Best"
                    value={Math.round(entry.best_score).toString()}
                  />
                  <Stat
                    label="Avg"
                    value={Math.round(entry.avg_score).toString()}
                  />
                </div>
              </div>
            );
          })}
        </section>
      )}

      {rest.length > 0 && (
        <section aria-label="Positions 4 and below">
          <ul role="list" className="space-y-2">
            {rest.map((entry, idx) => {
              const rank = idx + 4;
              const featured =
                sort === "best" ? entry.best_score : entry.avg_score;
              const verdict = scoreColorClasses(featured);
              return (
                <li
                  key={entry.email}
                  style={{ animationDelay: `${idx * 40}ms` }}
                  className="card-glass p-3 md:p-4 flex items-center gap-4 animate-fade-in-up"
                >
                  <div className="w-9 text-center text-sm font-semibold tabular-nums text-zinc-400">
                    #{rank}
                  </div>
                  <div className="w-10 h-10 rounded-full bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-glow-sm flex items-center justify-center text-xs font-semibold text-white shrink-0">
                    {initialsFor(entry.display_name, entry.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-zinc-100 truncate">
                      {entry.display_name || entry.email}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {entry.email}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs text-zinc-500 tabular-nums">
                    <span>
                      <span className="text-zinc-100 font-semibold">
                        {entry.attempts}
                      </span>{" "}
                      attempts
                    </span>
                    <span>
                      Best{" "}
                      <span className="text-zinc-100 font-semibold">
                        {Math.round(entry.best_score)}
                      </span>
                    </span>
                    <span>
                      Avg{" "}
                      <span className="text-zinc-100 font-semibold">
                        {Math.round(entry.avg_score)}
                      </span>
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums border px-2.5 py-1 rounded-full ${verdict.bg} ${verdict.text} ${verdict.border}`}
                  >
                    {Math.round(featured)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-zinc-100 font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-zinc-500">
        {label}
      </div>
    </div>
  );
}
