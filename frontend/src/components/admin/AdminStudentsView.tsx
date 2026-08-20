import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import {
  fetchAllStudents,
  type AdminStudentSummary,
} from "../../adminApi";
import { scoreColorClasses } from "../../utils/scoreColor";
import { relativeTime } from "../../utils/time";

interface AdminStudentsViewProps {
  onOpenStudent: (email: string) => void;
}

type SortKey = "name" | "active" | "top" | "recent";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "recent", label: "Most recent" },
  { value: "active", label: "Most active" },
  { value: "top", label: "Top scorer" },
  { value: "name", label: "Name (A→Z)" },
];

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function applySort(
  students: AdminStudentSummary[],
  sort: SortKey,
): AdminStudentSummary[] {
  const list = [...students];
  switch (sort) {
    case "name":
      list.sort((a, b) => {
        const an = (a.display_name || a.email).toLowerCase();
        const bn = (b.display_name || b.email).toLowerCase();
        return an.localeCompare(bn);
      });
      break;
    case "active":
      list.sort((a, b) => b.submissions_total - a.submissions_total);
      break;
    case "top":
      list.sort((a, b) => {
        const av = a.avg_combined_score ?? -1;
        const bv = b.avg_combined_score ?? -1;
        return bv - av;
      });
      break;
    case "recent":
    default:
      list.sort((a, b) =>
        a.last_seen_at < b.last_seen_at ? 1 : -1,
      );
      break;
  }
  return list;
}

export function AdminStudentsView({ onOpenStudent }: AdminStudentsViewProps) {
  const [students, setStudents] = useState<AdminStudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllStudents();
      setStudents(data.students);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load student roster.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? students.filter((s) => {
          const name = (s.display_name || "").toLowerCase();
          return name.includes(q) || s.email.toLowerCase().includes(q);
        })
      : students;
    return applySort(base, sort);
  }, [students, query, sort]);

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100 inline-flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-300" />
            Students
            <span className="text-sm font-medium text-zinc-500 tabular-nums">
              {students.length}
            </span>
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Filter and sort the class roster. Tap any row to open a profile.
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/40 focus:outline-none pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <label className="text-[11px] uppercase tracking-widest text-zinc-500 inline-flex items-center gap-2">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="rounded-xl bg-zinc-900/60 border border-zinc-800 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/40 focus:outline-none px-3 py-2 text-sm text-zinc-100"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && students.length === 0 && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading roster…
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

      {!loading && !error && students.length === 0 && (
        <div className="card-glass border-dashed border-zinc-700/60 px-6 py-10 text-center">
          <Users className="w-8 h-8 text-zinc-500 mx-auto" />
          <div className="mt-3 text-zinc-200 font-medium">
            No students have signed in yet.
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Once your class logs in with their @kiet.edu accounts they'll appear here.
          </p>
        </div>
      )}

      {!loading && students.length > 0 && filtered.length === 0 && (
        <div className="card-glass border-dashed border-zinc-700/60 px-6 py-8 text-center text-sm text-zinc-400">
          No students match “{query}”.
        </div>
      )}

      {filtered.length > 0 && (
        <ul role="list" className="space-y-2.5">
          {filtered.map((s, idx) => {
            const verdict = scoreColorClasses(s.avg_combined_score);
            return (
              <li
                key={s.email}
                style={{ animationDelay: `${idx * 50}ms` }}
                className="card-glass p-4 md:p-5 flex items-center gap-4 animate-fade-in-up hover:-translate-y-0.5 transition"
              >
                <div className="w-11 h-11 rounded-full bg-[var(--raised)] border border-[var(--hairline-strong)] shadow-glow-sm flex items-center justify-center text-sm font-semibold text-white shrink-0">
                  {initialsFor(s.display_name, s.email)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-100 truncate">
                    {s.display_name || s.email}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {s.email}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Last seen {relativeTime(s.last_seen_at)}
                  </div>
                </div>

                <div className="hidden md:flex flex-col items-end gap-1 w-32 shrink-0">
                  <div className="text-xs text-zinc-400 tabular-nums">
                    <span className="text-zinc-100 font-semibold">
                      {s.submissions_total}
                    </span>{" "}
                    submitted
                  </div>
                  <div className="text-[11px] text-zinc-500 tabular-nums">
                    {s.submissions_reviewed} reviewed
                  </div>
                </div>

                <div className="hidden sm:flex flex-col items-end gap-1 w-28 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums border px-2.5 py-1 rounded-full ${verdict.bg} ${verdict.text} ${verdict.border}`}
                  >
                    {typeof s.avg_combined_score === "number"
                      ? Math.round(s.avg_combined_score)
                      : "—"}
                  </span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
                    Avg combined
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenStudent(s.email)}
                  className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                  aria-label={`View ${s.email} detail`}
                >
                  View
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
