/**
 * StudentDashboard component (polish features).
 *
 * Fetches `GET /students/me/dashboard` and renders the signed-in student's
 * aggregate performance:
 *   - A hero "Overall rating" stat with an improvement-trend arrow.
 *   - A row of summary stat cards: overall rank, average, best, and worst score.
 *   - Consistency + Improvement mini stat chips.
 *   - Strengths / Weak areas pills (mapped to friendly soft-skill labels).
 *   - Category-wise performance bars.
 *   - Earned badges as small pills (falling back to a muted hint when empty).
 *   - A dependency-free progress chart of evaluated scores over time
 *     (delegated to {@link ProgressChart}).
 *
 * Loading, error, and empty states mirror the existing components
 * (StudentProfile / TeacherReview).
 */

import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import {
  BADGE_LABELS,
  SOFT_SKILL_LABELS,
  type BadgeType,
  type ImprovementTrend,
  type SoftSkillParameter,
  type SkillTrend,
  type StudentDashboardResponse,
} from '../api/types';
import { ProgressChart } from './ProgressChart';

export interface StudentDashboardProps {
  /** Bumping this value triggers a re-fetch of the dashboard. */
  refreshKey?: number;
}

/** Visual treatment for each improvement-trend direction. */
const TREND_STYLES: Record<ImprovementTrend, { glyph: string; className: string; label: string }> = {
  up: { glyph: '▲', className: 'text-green-600', label: 'Improving' },
  down: { glyph: '▼', className: 'text-red-600', label: 'Declining' },
  steady: { glyph: '▬', className: 'text-slate-400', label: 'Steady' },
};

/** Renders the student's performance summary, badges, and progress chart. */
export function StudentDashboard({ refreshKey = 0 }: StudentDashboardProps): JSX.Element {
  const [data, setData] = useState<StudentDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiRequest<StudentDashboardResponse>('/students/me/dashboard')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Failed to load your dashboard. Please try again.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading your dashboard…</p>;
  }

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        {error}
      </p>
    );
  }

  if (!data) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        No dashboard data available yet.
      </p>
    );
  }

  const hasEvaluations = data.totalEvaluated > 0;

  const rankLabel =
    data.rank === null ? 'Unranked' : `#${data.rank} of ${data.totalRanked}`;
  const averageLabel =
    data.averageOverallScore === null ? '—' : String(Math.round(data.averageOverallScore));
  const bestLabel = data.bestScore === null ? '—' : String(data.bestScore);
  const worstLabel = data.worstScore === null ? '—' : String(data.worstScore);
  const ratingLabel =
    data.overallRating === null ? '—' : String(Math.round(data.overallRating));

  return (
    <div className="space-y-8">
      {/* Hero: overall rating + trend */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Overall rating
        </p>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-5xl font-bold text-brand">{ratingLabel}</span>
          <span className="text-lg text-slate-500">/ 100</span>
          {data.improvementTrend && <TrendArrow trend={data.improvementTrend} withLabel />}
        </div>
        {!hasEvaluations && (
          <p className="mt-3 text-sm text-slate-500">
            No evaluated answers yet. Record and submit an answer to start building your rating.
          </p>
        )}
      </section>

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Overall rank" value={rankLabel} />
        <StatCard label="Average score" value={averageLabel} suffix="/ 100" />
        <StatCard label="Best score" value={bestLabel} suffix="/ 100" />
        <StatCard label="Worst score" value={worstLabel} suffix="/ 100" />
      </div>

      {/* Consistency + improvement mini chips */}
      <div className="flex flex-wrap gap-3">
        <MiniChip label="Consistency" value={data.consistencyScore} />
        <MiniChip label="Improvement" value={data.improvementScore} />
        <MiniChip
          label="Total interviews"
          rawValue={`${data.totalEvaluated}`}
          hint={`${data.totalSubmissions} submitted`}
        />
      </div>

      {/* Strengths + weak areas */}
      {(data.strengths.length > 0 || data.weakAreas.length > 0) && (
        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Strengths
            </h2>
            {data.strengths.length === 0 ? (
              <p className="text-sm text-slate-400">None identified yet</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.strengths.map((key) => (
                  <li key={key}>
                    <SkillPill skill={key} tone="strength" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Weak areas
            </h2>
            {data.weakAreas.length === 0 ? (
              <p className="text-sm text-slate-400">None identified yet</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.weakAreas.map((key) => (
                  <li key={key}>
                    <SkillPill skill={key} tone="weak" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Skill breakdown: all 8 soft-skill parameters scaled to /10 */}
      {data.skillBreakdown.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Skill breakdown
          </h2>
          <ul className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {data.skillBreakdown.map((row) => {
              const width = Math.max(0, Math.min(100, (row.average / 10) * 100));
              return (
                <li key={row.parameter}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">
                      {SOFT_SKILL_LABELS[row.parameter]}
                    </span>
                    <span className="text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {row.average.toFixed(1)}
                      </span>{' '}
                      / 10
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Skill trend: most improved + weakest */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Skill trend
        </h2>
        {data.skillTrend.mostImproved === null && data.skillTrend.weakest === null ? (
          <p className="text-sm text-slate-400">Not enough data yet</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Most improved
              </p>
              {data.skillTrend.mostImproved === null ? (
                <p className="mt-2 text-sm text-slate-400">Not enough data yet</p>
              ) : (
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="text-lg font-bold text-slate-900">
                    {SOFT_SKILL_LABELS[data.skillTrend.mostImproved]}
                  </span>
                  <MostImprovedDelta
                    trend={data.skillTrend}
                    parameter={data.skillTrend.mostImproved}
                  />
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Weakest
              </p>
              {data.skillTrend.weakest === null ? (
                <p className="mt-2 text-sm text-slate-400">Not enough data yet</p>
              ) : (
                <p className="mt-2">
                  <span className="text-lg font-bold text-amber-600">
                    {SOFT_SKILL_LABELS[data.skillTrend.weakest]}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Tips to improve */}
      {data.improvementSuggestions.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Tips to improve
          </h2>
          <ul className="list-disc space-y-1.5 rounded-lg border border-slate-200 bg-white p-4 pl-8 text-sm text-slate-700 shadow-sm">
            {data.improvementSuggestions.map((tip, index) => (
              <li key={index}>{tip}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Category-wise performance */}
      {data.categoryPerformance.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Category-wise performance
          </h2>
          <ul className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {data.categoryPerformance.map((cat) => {
              const avg = Math.round(cat.averageScore);
              return (
                <li key={cat.category}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">{cat.category}</span>
                    <span className="text-slate-500">
                      <span className="font-semibold text-slate-700">{avg}</span> / 100
                      <span className="ml-2 text-xs text-slate-400">
                        {cat.count} answer{cat.count === 1 ? '' : 's'}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${Math.max(0, Math.min(100, avg))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Earned badges */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Badges
        </h2>
        {data.badges.length === 0 ? (
          <p className="text-sm text-slate-400">No badges yet</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.badges.map((badge) => (
              <li key={badge}>
                <BadgePill badge={badge} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Progress chart */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Progress
        </h2>
        <ProgressChart points={data.timeline} />
      </section>
    </div>
  );
}

/** A single summary stat card. */
function StatCard({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/** A compact 0–100 stat chip (used for consistency / improvement). */
function MiniChip({
  label,
  value,
  rawValue,
  hint,
}: {
  label: string;
  value?: number | null;
  rawValue?: string;
  hint?: string;
}): JSX.Element {
  const display = rawValue !== undefined ? rawValue : value === null || value === undefined ? '—' : String(Math.round(value));
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="text-lg font-bold text-slate-900">{display}</span>
        {rawValue === undefined && <span className="text-xs text-slate-400">/ 100</span>}
      </p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/** A small pill rendering a soft-skill strength or weak area. */
function SkillPill({
  skill,
  tone,
}: {
  skill: SoftSkillParameter;
  tone: 'strength' | 'weak';
}): JSX.Element {
  const className =
    tone === 'strength'
      ? 'bg-green-100 text-green-700'
      : 'bg-amber-100 text-amber-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {SOFT_SKILL_LABELS[skill]}
    </span>
  );
}

/** Renders the "▲ +X.X" green delta for the most-improved parameter. */
function MostImprovedDelta({
  trend,
  parameter,
}: {
  trend: SkillTrend;
  parameter: SoftSkillParameter;
}): JSX.Element | null {
  const row = trend.perParameter.find((p) => p.parameter === parameter);
  if (!row) return null;
  const sign = row.delta >= 0 ? '+' : '';
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600">
      <span aria-hidden="true">▲</span>
      {`${sign}${row.delta.toFixed(1)}`}
    </span>
  );
}

/** A small inline improvement-trend arrow. */
function TrendArrow({
  trend,
  withLabel = false,
}: {
  trend: ImprovementTrend;
  withLabel?: boolean;
}): JSX.Element {
  const { glyph, className, label } = TREND_STYLES[trend];
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-semibold ${className}`}
      title={label}
      aria-label={label}
    >
      <span aria-hidden="true">{glyph}</span>
      {withLabel && <span className="text-xs font-medium">{label}</span>}
    </span>
  );
}

/** A small pill rendering a single earned badge. */
export function BadgePill({ badge }: { badge: BadgeType }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
      {BADGE_LABELS[badge]}
    </span>
  );
}
