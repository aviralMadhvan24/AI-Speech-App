import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Inbox,
  Info,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Timer,
} from "lucide-react";
import { getCurrentIdToken } from "../../../hooks/useAuth";
import { DebateReviewPanel } from "./DebateReviewPanel";

// Wire shape returned by GET /admin/debates?status=pending_review.
// Mirrors `DebateSummary` in app/debate/admin_routes.py.
export interface DebateSummary {
  debate_id: string;
  code: string;
  motion_title: string;
  completed_at: number;
  pending_turns_count: number;
  total_turns_count: number;
  winner_participant_id: string | null;
}

async function fetchPendingDebates(): Promise<DebateSummary[]> {
  const token = await getCurrentIdToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch("/admin/debates?status=pending_review", {
    headers,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Failed to load pending debates: ${response.status} ${
        response.statusText
      }${detail ? ` — ${detail.slice(0, 240)}` : ""}`,
    );
  }
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as DebateSummary[];
}

function relativeCompletedAt(unixSeconds: number): string {
  if (!unixSeconds || Number.isNaN(unixSeconds)) return "just now";
  const nowMs = Date.now();
  const thenMs = unixSeconds * 1000;
  const deltaSec = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export function PendingDebatesList({ onOpenDebate }: { onOpenDebate?: (debateId: string) => void }) {
  const [debates, setDebates] = useState<DebateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDebateId, setSelectedDebateId] = useState<string | null>(null);

  // Use external handler if provided, otherwise internal state
  const handleOpenDebate = onOpenDebate || setSelectedDebateId;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPendingDebates();
      // Newest first — completed_at is unix seconds, descending numeric sort.
      const sorted = [...data].sort(
        (a, b) => b.completed_at - a.completed_at,
      );
      setDebates(sorted);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load pending debates.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Detail view (only if using internal state) ----
  if (!onOpenDebate && selectedDebateId) {
    return (
      <DebateReviewPanel
        debateId={selectedDebateId}
        onBack={() => {
          setSelectedDebateId(null);
          // Refresh list on return so `pending_turns_count` reflects any
          // reviews the teacher just submitted.
          void load();
        }}
      />
    );
  }

  // ---- List view ----
  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100 inline-flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-violet-300" />
            Pending debates
            <span className="text-sm font-medium text-zinc-500 tabular-nums">
              {debates.length}
            </span>
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Completed group debates with at least one un-reviewed turn.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          aria-label="Refresh pending debates list"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading && debates.length === 0 && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading…
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
              className="mt-2 text-xs font-medium text-rose-200 underline underline-offset-4 hover:text-rose-100"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && debates.length === 0 && (
        <div className="card-glass border-dashed border-zinc-700/60 px-6 py-10 text-center">
          <Inbox className="w-8 h-8 text-zinc-500 mx-auto" />
          <div className="mt-3 text-zinc-200 font-medium">
            No pending debates. All caught up.
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Debates land here after every turn is scored by the AI.
          </p>
        </div>
      )}

      {debates.length > 0 && (
        <ul className="space-y-2.5" role="list">
          {debates.map((debate, idx) => (
            <li
              key={debate.debate_id}
              style={{ animationDelay: `${idx * 60}ms` }}
              className="card-glass p-4 md:p-5 flex items-center gap-4 animate-fade-in-up hover:-translate-y-0.5 transition focus-within:ring-2 focus-within:ring-brand-500/60"
            >
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-glow-sm flex items-center justify-center text-sm font-semibold text-white shrink-0">
                <MessagesSquare className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono font-semibold text-zinc-100 tracking-widest">
                    {debate.code}
                  </span>
                  <span className="text-[11px] text-zinc-500 uppercase tracking-widest">
                    · Debate
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-300 truncate">
                  {debate.motion_title}
                </p>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <Timer className="w-3 h-3" />
                    {relativeCompletedAt(debate.completed_at)}
                  </span>
                  <span className="inline-flex items-center gap-1 uppercase tracking-widest">
                    <span className="opacity-60">·</span>
                    {debate.pending_turns_count} / {debate.total_turns_count}{" "}
                    turns pending
                  </span>
                </div>
              </div>

              <div className="hidden sm:flex flex-col items-end gap-1">
                <span
                  className={[
                    "inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums border px-2.5 py-1 rounded-full",
                    debate.pending_turns_count > 0
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                      : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
                  ].join(" ")}
                >
                  {debate.pending_turns_count} pending
                </span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
                  {debate.pending_turns_count > 0 ? "Needs review" : "Reviewed"}
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleOpenDebate(debate.debate_id)}
                className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                aria-label={`Review debate ${debate.code}`}
              >
                Review
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
