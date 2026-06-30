import {
  Calendar,
  ChevronRight,
  Eye,
  Flame,
  Mic,
  Play,
  Shield,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
} from "lucide-react";
import type { SessionPreview } from "../types";
import { ScoreBadge } from "./ScoreBadge";

interface HomeViewProps {
  sessions: SessionPreview[];
  cachedSessionIds: Set<string>;
  bestStreak: number;
  wordsMastered: number;
  onStart: () => void;
  onStartBattle: () => void;
  onView: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "—";
    const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
    const diffDay = Math.round(diffHr / 24);
    if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds - mins * 60);
  return `${mins}m ${rem}s`;
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent: string;
}

function StatCard({ label, value, hint, icon, accent }: StatCardProps) {
  return (
    <div className="card-glass p-5 flex flex-col gap-2 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          {label}
        </span>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent}`}>
          {icon}
        </span>
      </div>
      <div className="text-3xl font-bold tabular-nums text-zinc-100 leading-none">
        {value}
      </div>
      {hint ? <div className="text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function HomeView({
  sessions,
  cachedSessionIds,
  bestStreak,
  wordsMastered,
  onStart,
  onStartBattle,
  onView,
  onDelete,
}: HomeViewProps) {
  const sessionsWithScores = sessions.filter((s): s is SessionPreview & { score: number } =>
    typeof s.score === "number",
  );
  const avgScore =
    sessionsWithScores.length > 0
      ? Math.round(
          sessionsWithScores.reduce((sum, s) => sum + s.score, 0) /
            sessionsWithScores.length,
        )
      : null;

  return (
    <div key="home" className="animate-fade-in-up space-y-8">
      {/* Hero */}
      <section className="card-glass p-8 md:p-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-brand-500/20 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <span className="chip-brand">
              <Mic className="w-3 h-3" />
              Phase 2 · Pronunciation
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05]">
            <span className="gradient-text">Practice clear,</span>
            <br />
            <span className="text-zinc-100">confident speech.</span>
          </h1>
          <p className="max-w-xl text-zinc-400 leading-relaxed">
            Read short sentences out loud. Get instant, word-by-word feedback on
            your pronunciation, pace, and clarity. No grading, no judgment —
            just steady practice that sticks.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button type="button" onClick={onStart} className="btn-primary px-6 py-3 text-base">
              <Play className="w-4 h-4" strokeWidth={2.6} />
              Start Practicing
              <ChevronRight className="w-4 h-4 -mr-1" />
            </button>
            <button
              type="button"
              onClick={onStartBattle}
              className="btn relative overflow-hidden text-white px-6 py-3 text-base"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #a21caf 0%, #c026d3 50%, #06b6d4 100%)",
                boxShadow:
                  "0 0 18px -4px rgba(192, 38, 211, 0.5), 0 0 6px -1px rgba(6, 182, 212, 0.35)",
              }}
            >
              <Swords className="w-4 h-4" strokeWidth={2.6} />
              Start 1v1 Battle
            </button>
            <div className="inline-flex items-center gap-2 text-xs text-zinc-500">
              <Shield className="w-3.5 h-3.5 text-emerald-400/80" />
              Local processing — your audio never leaves this device
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Sentences Done"
          value={String(sessions.length)}
          hint={sessions.length === 0 ? "Start your first session" : "Total practice runs"}
          icon={<Sparkles className="w-4 h-4 text-brand-400" />}
          accent="bg-brand-500/10"
        />
        <StatCard
          label="Avg Score"
          value={avgScore == null ? "—" : `${avgScore}`}
          hint={avgScore == null ? "No scored sessions yet" : "Across all attempts"}
          icon={<Trophy className="w-4 h-4 text-amber-300" />}
          accent="bg-amber-500/10"
        />
        <StatCard
          label="Best Streak"
          value={String(bestStreak)}
          hint="Consecutive 70+ scores"
          icon={<Flame className="w-4 h-4 text-rose-300" />}
          accent="bg-rose-500/10"
        />
        <StatCard
          label="Words Mastered"
          value={String(wordsMastered)}
          hint="Correct in this browser"
          icon={<Sparkles className="w-4 h-4 text-emerald-300" />}
          accent="bg-emerald-500/10"
        />
      </section>

      {/* Past sessions */}
      <section className="card-glass p-6 md:p-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-zinc-100 tracking-tight">
            Past Sessions
          </h2>
          <span className="chip-zinc">
            {sessions.length} total
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-10 flex flex-col items-center gap-3 text-zinc-500">
            <Calendar className="w-6 h-6" />
            <div className="text-sm">No sessions yet. Your practice runs will appear here.</div>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {sessions.map((session, index) => {
              const hasFullReport = cachedSessionIds.has(session.sessionId);
              return (
                <li
                  key={session.sessionId}
                  className="flex items-center gap-4 py-3 group animate-fade-in-up"
                  style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
                >
                  <ScoreBadge score={session.score} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate">
                      {session.sentencePreview}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
                      <span>{formatRelative(session.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDuration(session.durationSeconds)}</span>
                      {!session.available && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-400/80">no pronunciation data</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-90">
                    <button
                      type="button"
                      onClick={() => onView(session.sessionId)}
                      disabled={!hasFullReport}
                      title={hasFullReport ? "View report" : "Full report unavailable for older sessions"}
                      className={[
                        "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        hasFullReport
                          ? "bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 border border-brand-500/30"
                          : "bg-zinc-800/40 text-zinc-500 border border-zinc-800 cursor-not-allowed",
                      ].join(" ")}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(session.sessionId)}
                      title="Hide from this list (local only)"
                      className="inline-flex items-center justify-center rounded-lg w-8 h-8 text-zinc-500 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30 transition-colors"
                      aria-label="Delete session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
