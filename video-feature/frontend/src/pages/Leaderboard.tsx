/**
 * Leaderboard page (Task 12.2, Requirement 7.2).
 *
 * Renders the college-wide ranking from `GET /leaderboard`: each row shows the
 * rank, the student's name, and their average overall score. The endpoint is
 * available to any authenticated user, so this page is reachable from both the
 * student and teacher homes.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  BADGE_LABELS,
  type ImprovementTrend,
  type LeaderboardResponse,
  type LeaderboardRow,
} from '../api/types';

/** Visual treatment for each improvement-trend direction. */
const TREND_STYLES: Record<ImprovementTrend, { glyph: string; className: string; label: string }> = {
  up: { glyph: '▲', className: 'text-green-600', label: 'Improving' },
  down: { glyph: '▼', className: 'text-red-600', label: 'Declining' },
  steady: { glyph: '▬', className: 'text-slate-400', label: 'Steady' },
};

/** A small inline trend arrow with an accessible label. */
function TrendArrow({ trend }: { trend: ImprovementTrend }): JSX.Element {
  const { glyph, className, label } = TREND_STYLES[trend];
  return (
    <span className={`text-xs font-semibold ${className}`} title={label} aria-label={label}>
      {glyph}
    </span>
  );
}

export function Leaderboard(): JSX.Element {
  const { role, logout } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const homePath = role === 'teacher' ? '/teacher' : '/student';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiRequest<LeaderboardResponse>('/leaderboard')
      .then((data) => {
        if (!cancelled) setRows(data.leaderboard);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Failed to load the leaderboard. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="font-semibold text-brand">Mock Interview MVP</span>
          <div className="flex items-center gap-2">
            <Link
              to={homePath}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Leaderboard</h1>
        <p className="mt-1 text-slate-600">
          Students ranked by their overall rating across evaluated answers.
        </p>

        <div className="mt-6">
          {loading ? (
            <p className="text-sm text-slate-500">Loading leaderboard…</p>
          ) : error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              No students have been evaluated yet. The leaderboard will appear once answers are
              scored.
            </p>
          ) : (
            <ol className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {rows.map((row, index) => (
                <li
                  key={row.studentId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={[
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                        index === 0
                          ? 'bg-amber-100 text-amber-700'
                          : index === 1
                            ? 'bg-slate-200 text-slate-700'
                            : index === 2
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-slate-100 text-slate-600',
                      ].join(' ')}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">
                          {row.name}
                        </span>
                        <TrendArrow trend={row.improvementTrend} />
                      </div>
                      {row.badges.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {row.badges.map((badge) => (
                            <span
                              key={badge}
                              className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand"
                            >
                              {BADGE_LABELS[badge]}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Secondary stats */}
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="hidden sm:inline">
                      Avg <span className="font-semibold text-slate-700">{Math.round(row.averageOverallScore)}</span>
                    </span>
                    <span className="hidden sm:inline">
                      Best <span className="font-semibold text-slate-700">{Math.round(row.bestScore)}</span>
                    </span>
                    <span>
                      {row.totalInterviews} interview{row.totalInterviews === 1 ? '' : 's'}
                    </span>
                  </div>

                  {/* Primary ranked value: overall rating */}
                  <span className="text-right text-base font-bold text-slate-900">
                    {Math.round(row.overallRating)}
                    <span className="ml-1 text-xs font-normal text-slate-500">/ 100</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </main>
  );
}
