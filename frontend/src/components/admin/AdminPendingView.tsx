import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ClipboardList,
  Inbox,
  Info,
  Loader2,
  RefreshCw,
  Timer,
} from "lucide-react";
import {
  fetchPendingSubmissions,
  type AdminSubmission,
} from "../../adminApi";
import { relativeTime } from "../../utils/time";
import { scoreColorClasses } from "../../utils/scoreColor";

interface AdminPendingViewProps {
  onOpenReview: (submissionId: string) => void;
}

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function AdminPendingView({ onOpenReview }: AdminPendingViewProps) {
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPendingSubmissions();
      // Newest first — submitted_at is ISO 8601, descending lex sort works.
      const sorted = [...data.submissions].sort((a, b) =>
        a.submitted_at < b.submitted_at ? 1 : -1,
      );
      setSubmissions(sorted);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load pending reviews.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const headerCount = useMemo(() => submissions.length, [submissions]);

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100 inline-flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-brand-300" />
            Pending reviews
            <span className="text-sm font-medium text-zinc-500 tabular-nums">
              {headerCount}
            </span>
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Newest submissions first. Tap any row to review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          aria-label="Refresh pending list"
        >
          <RefreshCw
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {loading && submissions.length === 0 && (
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

      {!loading && !error && submissions.length === 0 && (
        <div className="card-glass border-dashed border-zinc-700/60 px-6 py-10 text-center">
          <Inbox className="w-8 h-8 text-zinc-500 mx-auto" />
          <div className="mt-3 text-zinc-200 font-medium">
            All caught up — no pending reviews.
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Submissions land here in real time as students push their interview
            recordings.
          </p>
        </div>
      )}

      {submissions.length > 0 && (
        <ul className="space-y-2.5" role="list">
          {submissions.map((sub, idx) => {
            const verdict = scoreColorClasses(sub.gesture_score);
            const initials = initialsFor(sub.student_name, sub.student_email);
            return (
              <li
                key={sub.submission_id}
                style={{ animationDelay: `${idx * 60}ms` }}
                className="card-glass p-4 md:p-5 flex items-center gap-4 animate-fade-in-up hover:-translate-y-0.5 transition focus-within:ring-2 focus-within:ring-brand-500/60"
              >
                <div className="w-11 h-11 rounded-full bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-glow-sm flex items-center justify-center text-sm font-semibold text-white shrink-0">
                  {initials}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-zinc-100 truncate">
                      {sub.student_name || sub.student_email}
                    </span>
                    <span className="text-[11px] text-zinc-500 truncate">
                      {sub.student_email}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-400 truncate">
                    {sub.question_prompt}
                  </p>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      {relativeTime(sub.submitted_at)}
                    </span>
                    <span className="inline-flex items-center gap-1 uppercase tracking-widest">
                      <span className="opacity-60">·</span>
                      {sub.question_category || "general"}
                    </span>
                    <span className="inline-flex items-center gap-1 uppercase tracking-widest opacity-80">
                      <span className="opacity-60">·</span>
                      {Math.round(sub.duration_seconds)}s
                    </span>
                  </div>
                </div>

                <div className="hidden sm:flex flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums border px-2.5 py-1 rounded-full ${verdict.bg} ${verdict.text} ${verdict.border}`}
                    title="AI body-language score"
                  >
                    {Math.round(sub.gesture_score)}
                    <span className="text-[10px] uppercase tracking-widest opacity-70 font-medium">
                      AI
                    </span>
                  </span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
                    {verdict.label}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenReview(sub.submission_id)}
                  className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                  aria-label={`Review submission from ${sub.student_email}`}
                >
                  Review
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
