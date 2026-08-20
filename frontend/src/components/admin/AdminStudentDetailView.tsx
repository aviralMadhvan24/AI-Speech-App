import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Mail,
  User,
} from "lucide-react";
import {
  fetchStudentDetail,
  type AdminStudentDetail,
  type AdminSubmission,
} from "../../adminApi";
import { formatDateTime, relativeTime } from "../../utils/time";
import { scoreColorClasses } from "../../utils/scoreColor";

interface AdminStudentDetailViewProps {
  email: string;
  onBack: () => void;
}

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function avgCombined(subs: AdminSubmission[]): number | null {
  const reviewed = subs.filter(
    (s) => typeof s.combined_score === "number",
  );
  if (reviewed.length === 0) return null;
  const total = reviewed.reduce(
    (sum, s) => sum + (s.combined_score ?? 0),
    0,
  );
  return total / reviewed.length;
}

export function AdminStudentDetailView({
  email,
  onBack,
}: AdminStudentDetailViewProps) {
  const [detail, setDetail] = useState<AdminStudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStudentDetail(email);
      // Sort newest first.
      data.submissions.sort((a, b) =>
        a.submitted_at < b.submitted_at ? 1 : -1,
      );
      setDetail(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load student profile.",
      );
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    void load();
  }, [load]);

  const submissions = detail?.submissions ?? [];
  const totalSubs = submissions.length;
  const reviewedSubs = submissions.filter((s) => s.status === "reviewed").length;
  const avg = avgCombined(submissions);
  const avgVerdict = scoreColorClasses(avg);

  return (
    <div key="admin-student" className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          aria-label="Back to students list"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to students
        </button>
      </div>

      {loading && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading profile…
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

      {detail && (
        <>
          <header className="card-glass relative overflow-hidden p-6 md:p-8">
            <div className="relative flex items-center gap-4 flex-wrap">
              <div className="w-16 h-16 rounded-2xl bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-glow-sm flex items-center justify-center text-xl font-semibold text-white">
                {initialsFor(detail.display_name, detail.email)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-2xl font-bold text-zinc-100 tracking-tight inline-flex items-center gap-2">
                  <User className="w-5 h-5 text-brand-300" />
                  {detail.display_name || detail.email}
                </div>
                <div className="text-sm text-zinc-500 inline-flex items-center gap-1.5 mt-1">
                  <Mail className="w-3.5 h-3.5" />
                  {detail.email}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                  <span className="uppercase tracking-widest bg-zinc-900/60 border border-zinc-800/70 rounded-full px-2 py-0.5">
                    Role · {detail.role}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    First seen {relativeTime(detail.first_seen_at)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    Last seen {relativeTime(detail.last_seen_at)}
                  </span>
                </div>
              </div>
            </div>

            <div className="relative mt-6 grid grid-cols-3 gap-3">
              <StatBlock label="Total" value={totalSubs.toString()} />
              <StatBlock
                label="Reviewed"
                value={reviewedSubs.toString()}
                hint={`${totalSubs > 0 ? Math.round((reviewedSubs / totalSubs) * 100) : 0}%`}
              />
              <StatBlock
                label="Avg combined"
                value={avg === null ? "—" : Math.round(avg).toString()}
                tone={avg === null ? "text-zinc-100" : avgVerdict.text}
              />
            </div>
          </header>

          <section className="space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Timeline · newest first
            </div>
            {submissions.length === 0 && (
              <div className="card-glass border-dashed border-zinc-700/60 px-6 py-10 text-center text-sm text-zinc-400">
                No submissions yet from this student.
              </div>
            )}

            <ul role="list" className="space-y-2.5">
              {submissions.map((sub, idx) => (
                <TimelineRow key={sub.submission_id} sub={sub} index={idx} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

interface StatBlockProps {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}

function StatBlock({ label, value, hint, tone }: StatBlockProps) {
  return (
    <div className="rounded-xl bg-zinc-900/40 border border-zinc-800/70 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums leading-none ${tone ?? "text-zinc-100"}`}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

interface TimelineRowProps {
  sub: AdminSubmission;
  index: number;
}

function TimelineRow({ sub, index }: TimelineRowProps) {
  const gesture = scoreColorClasses(sub.gesture_score);
  const teacher = scoreColorClasses(sub.teacher_score);
  const combined = scoreColorClasses(sub.combined_score);
  const isReviewed = sub.status === "reviewed";
  return (
    <li
      style={{ animationDelay: `${index * 40}ms` }}
      className="card-glass p-4 md:p-5 animate-fade-in-up flex items-start gap-4 flex-wrap"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {isReviewed ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
              <CheckCircle2 className="w-3 h-3" />
              Reviewed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
              {sub.status}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">
            {sub.question_category || "general"}
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-100 leading-snug">
          {sub.question_prompt}
        </p>
        <div className="mt-1.5 text-[11px] text-zinc-500 inline-flex items-center gap-2">
          {relativeTime(sub.submitted_at)} ·{" "}
          {formatDateTime(sub.submitted_at)} ·{" "}
          {Math.round(sub.duration_seconds)}s
        </div>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <ScorePill label="AI" value={sub.gesture_score} classes={gesture} />
        <ScorePill label="Teacher" value={sub.teacher_score} classes={teacher} />
        <ScorePill
          label="Combined"
          value={sub.combined_score}
          classes={combined}
        />
      </div>
    </li>
  );
}

interface ScorePillProps {
  label: string;
  value: number | null;
  classes: { bg: string; text: string; border: string };
}

function ScorePill({ label, value, classes }: ScorePillProps) {
  const display = typeof value === "number" ? Math.round(value).toString() : "—";
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border px-2.5 py-1.5 min-w-[60px] ${classes.bg} ${classes.border}`}
    >
      <div className={`text-sm font-semibold tabular-nums ${classes.text}`}>
        {display}
      </div>
      <div className="text-[9px] uppercase tracking-widest text-zinc-500">
        {label}
      </div>
    </div>
  );
}
