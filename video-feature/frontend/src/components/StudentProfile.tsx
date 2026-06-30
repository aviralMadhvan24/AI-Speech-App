/**
 * StudentProfile component (Task 11.2, Requirements 6.1, 6.3).
 *
 * Lists the student's own submissions from `GET /submissions/mine`:
 *   - For `evaluated` submissions, shows the overall score (0–100) and the
 *     teacher's written feedback (Req 6.1).
 *   - For `pending` submissions, shows an "awaiting review" state and does NOT
 *     display a score (Req 6.3).
 *
 * Exposes an imperative-ish `refreshKey` prop: incrementing it (e.g. after a
 * new submission is uploaded) triggers a re-fetch so the new entry appears.
 */

import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import type { MySubmissionsResponse, Question, SubmissionDto } from '../api/types';

export interface StudentProfileProps {
  /** Bumping this value triggers a re-fetch of the submissions list. */
  refreshKey?: number;
  /** Optional questions, used to show the prompt text alongside each answer. */
  questions?: Question[];
}

/** Looks up a question prompt by id, falling back to the id label. */
function promptFor(questions: Question[] | undefined, questionId: number): string {
  const match = questions?.find((q) => q.id === questionId);
  return match ? match.prompt : `Question ${questionId}`;
}

/** Renders the student's submission history with scores/feedback or status. */
export function StudentProfile({ refreshKey = 0, questions }: StudentProfileProps): JSX.Element {
  const [submissions, setSubmissions] = useState<SubmissionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiRequest<MySubmissionsResponse>('/submissions/mine')
      .then((data) => {
        if (!cancelled) setSubmissions(data.submissions);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Failed to load your submissions. Please try again.',
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
    return <p className="text-sm text-slate-500">Loading your submissions…</p>;
  }

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        {error}
      </p>
    );
  }

  if (submissions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        You haven't submitted any answers yet. Pick a question and record your first answer.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {submissions.map((submission) => (
        <li
          key={submission.id}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium text-slate-800">
              {promptFor(questions, submission.questionId)}
            </p>
            <StatusBadge status={submission.status} />
          </div>

          <p className="mt-1 text-xs text-slate-400">
            Submitted {new Date(submission.createdAt).toLocaleString()}
          </p>

          {submission.status === 'evaluated' ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900">
                  {submission.overallScore}
                </span>
                <span className="text-sm text-slate-500">/ 100 overall score</span>
              </div>
              {submission.overallFeedback && (
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Feedback
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    {submission.overallFeedback}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              This answer is awaiting review by a teacher.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A small colored pill conveying the submission status. */
function StatusBadge({ status }: { status: SubmissionDto['status'] }): JSX.Element {
  const isEvaluated = status === 'evaluated';
  return (
    <span
      className={[
        'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
        isEvaluated ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
      ].join(' ')}
    >
      {isEvaluated ? 'Evaluated' : 'Awaiting review'}
    </span>
  );
}
