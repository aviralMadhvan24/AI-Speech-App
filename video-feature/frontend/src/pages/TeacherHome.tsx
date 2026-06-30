/**
 * Teacher home (Task 12.1, Requirements 4.1, 4.2, 4.3, 6.2).
 *
 * The teacher's workspace: a review queue of pending submissions with video
 * playback and the 8-parameter scoring form (TeacherReview). A nav link to the
 * shared Leaderboard is available in the header.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiRequest, ApiError, downloadCsv } from '../api/client';
import type {
  Question,
  QuestionAnalyticsRow,
  QuestionsResponse,
  ScoreBand,
  StudentScoreRef,
  TeacherDashboardResponse,
} from '../api/types';
import { TeacherReview } from '../components/TeacherReview';

export function TeacherHome(): JSX.Element {
  const { logout } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [counts, setCounts] = useState<TeacherDashboardResponse | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownloadReport(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadCsv('/teacher/report.csv', 'class-report.csv');
    } catch (err: unknown) {
      setDownloadError(
        err instanceof ApiError ? err.message : 'Failed to download the report. Please try again.',
      );
    } finally {
      setDownloading(false);
    }
  }

  // Load questions once so the review queue can show prompt text per answer.
  useEffect(() => {
    let cancelled = false;
    apiRequest<QuestionsResponse>('/questions')
      .then((data) => {
        if (!cancelled) setQuestions(data.questions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the teacher's review workload counts (pending + completed).
  useEffect(() => {
    let cancelled = false;
    apiRequest<TeacherDashboardResponse>('/teacher/dashboard')
      .then((data) => {
        if (!cancelled) setCounts(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-semibold text-brand">Mock Interview MVP</span>
          <div className="flex items-center gap-2">
            <Link
              to="/leaderboard"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Leaderboard
            </Link>
            <button
              type="button"
              onClick={handleDownloadReport}
              disabled={downloading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloading ? 'Preparing…' : 'Download report (CSV)'}
            </button>
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

      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Teacher home</h1>
        <p className="mt-1 text-slate-600">
          Review pending submissions, play them back, and score student answers.
        </p>

        {downloadError && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {downloadError}
          </p>
        )}

        {counts && (
          <>
            <div className="mt-6 flex flex-wrap gap-3">
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Pending
                </p>
                <p className="mt-1 text-2xl font-bold text-amber-600">{counts.pending}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Completed
                </p>
                <p className="mt-1 text-2xl font-bold text-green-600">{counts.completed}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Average score
                </p>
                <p className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-900">
                    {counts.averageScore === null ? '—' : Math.round(counts.averageScore)}
                  </span>
                  <span className="text-sm text-slate-500">/ 100</span>
                </p>
              </div>
            </div>

            {(counts.topStudents.length > 0 || counts.weakStudents.length > 0) && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <StudentScoreList
                  title="Top students"
                  students={counts.topStudents}
                  scoreClassName="text-green-600"
                  emptyHint="No evaluated students yet."
                />
                <StudentScoreList
                  title="Needs attention"
                  students={counts.weakStudents}
                  scoreClassName="text-red-600"
                  emptyHint="No evaluated students yet."
                />
              </div>
            )}

            {counts.scoreDistribution.length > 0 && (
              <ScoreDistribution bands={counts.scoreDistribution} />
            )}

            {counts.questionAnalytics.length > 0 && (
              <QuestionAnalytics rows={counts.questionAnalytics} />
            )}
          </>
        )}

        <div className="mt-6">
          <TeacherReview questions={questions} />
        </div>
      </div>
    </main>
  );
}

/** A compact list of students with their rounded average overall score. */
function StudentScoreList({
  title,
  students,
  scoreClassName,
  emptyHint,
}: {
  title: string;
  students: StudentScoreRef[];
  scoreClassName: string;
  emptyHint: string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {students.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyHint}</p>
      ) : (
        <ul className="space-y-2">
          {students.map((student) => (
            <li
              key={student.studentId}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate text-slate-800">{student.name}</span>
              <span className={`shrink-0 font-semibold ${scoreClassName}`}>
                {Math.round(student.averageOverallScore)}
                <span className="ml-1 text-xs font-normal text-slate-400">/ 100</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Score distribution as horizontal bars, one per band. */
function ScoreDistribution({ bands }: { bands: ScoreBand[] }): JSX.Element {
  const maxCount = Math.max(1, ...bands.map((b) => b.count));
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Score distribution
      </h2>
      <ul className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {bands.map((band) => {
          const width = (band.count / maxCount) * 100;
          return (
            <li key={band.band}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-800">{band.band}</span>
                <span className="font-semibold text-slate-700">{band.count}</span>
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
  );
}

/** Per-question analytics as a compact table. */
function QuestionAnalytics({ rows }: { rows: QuestionAnalyticsRow[] }): JSX.Element {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Question-wise analytics
      </h2>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 font-semibold">Question</th>
              <th className="px-4 py-2 font-semibold">Category</th>
              <th className="px-4 py-2 text-right font-semibold">Attempts</th>
              <th className="px-4 py-2 text-right font-semibold">Avg score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.questionId} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2">
                  <span className="block max-w-md truncate text-slate-800" title={row.prompt}>
                    {row.prompt}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {row.category}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-slate-600">{row.attempts}</td>
                <td className="px-4 py-2 text-right font-semibold text-slate-800">
                  {row.averageScore === null ? '—' : Math.round(row.averageScore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
