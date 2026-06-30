/**
 * TeacherReview component (Task 12.1, Requirements 4.1, 4.2, 4.3, 6.2).
 *
 * The teacher's review workflow:
 *   - Lists pending submissions from `GET /submissions/pending` (Req 4.1).
 *   - Plays back a selected submission's video (Req 4.2). Because the backend
 *     serves videos behind `requireAuth` and a raw `<video src>` cannot send an
 *     Authorization header, the video is fetched as a blob via the authenticated
 *     API client (`apiBlobUrl`) and shown through an object URL.
 *   - Presents the 8-parameter scoring form (each 1–10) plus an Overall
 *     Feedback textarea (Req 4.3) and submits via
 *     `POST /submissions/:id/evaluation`.
 *   - On success, removes the submission from the pending list. Validation
 *     errors (400 `details`) are surfaced inline.
 */

import { useEffect, useRef, useState } from 'react';
import { apiBlobUrl, apiRequest, ApiError } from '../api/client';
import {
  SOFT_SKILL_PARAMETERS,
  SOFT_SKILL_LABELS,
  type EvaluationPayload,
  type EvaluationResponse,
  type ParameterScores,
  type PendingSubmissionsResponse,
  type Question,
  type SoftSkillParameter,
  type SubmissionDto,
} from '../api/types';

export interface TeacherReviewProps {
  /** Optional questions, used to show the prompt text alongside each answer. */
  questions?: Question[];
}

/** Default score for each parameter before the teacher adjusts it (midpoint). */
const DEFAULT_SCORE = 5;

/** Builds a fresh score map with every parameter set to the default. */
function freshScores(): ParameterScores {
  return SOFT_SKILL_PARAMETERS.reduce((acc, parameter) => {
    acc[parameter] = DEFAULT_SCORE;
    return acc;
  }, {} as ParameterScores);
}

/** Looks up a question prompt by id, falling back to the id label. */
function promptFor(questions: Question[] | undefined, questionId: number): string {
  const match = questions?.find((q) => q.id === questionId);
  return match ? match.prompt : `Question ${questionId}`;
}

/** Renders the teacher's pending review queue and the scoring workflow. */
export function TeacherReview({ questions }: TeacherReviewProps): JSX.Element {
  const [submissions, setSubmissions] = useState<SubmissionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SubmissionDto | null>(null);

  // Load the pending queue (Req 4.1).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiRequest<PendingSubmissionsResponse>('/submissions/pending')
      .then((data) => {
        if (!cancelled) setSubmissions(data.submissions);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Failed to load pending submissions. Please try again.',
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

  /** Removes an evaluated submission from the queue and closes the panel. */
  function handleEvaluated(id: string): void {
    setSubmissions((current) => current.filter((s) => s.id !== id));
    setSelected(null);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading pending submissions…</p>;
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
        There are no submissions awaiting review right now.
      </p>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
      {/* Pending queue */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Pending submissions
        </h2>
        <ul className="space-y-3">
          {submissions.map((submission) => {
            const isSelected = submission.id === selected?.id;
            return (
              <li key={submission.id}>
                <button
                  type="button"
                  onClick={() => setSelected(submission)}
                  aria-pressed={isSelected}
                  className={[
                    'w-full rounded-lg border px-4 py-3 text-left transition',
                    isSelected
                      ? 'border-brand bg-brand/5 ring-1 ring-brand'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <p className="text-sm font-medium text-slate-800">
                    {promptFor(questions, submission.questionId)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Submitted {new Date(submission.createdAt).toLocaleString()}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Review panel */}
      <div>
        {selected ? (
          <ReviewPanel
            key={selected.id}
            submission={selected}
            prompt={promptFor(questions, selected.questionId)}
            onEvaluated={() => handleEvaluated(selected.id)}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500">
            Select a submission to play it back and score it.
          </p>
        )}
      </div>
    </div>
  );
}

interface ReviewPanelProps {
  submission: SubmissionDto;
  prompt: string;
  onEvaluated: () => void;
}

/** Plays back one submission's video and hosts the scoring form. */
function ReviewPanel({ submission, prompt, onEvaluated }: ReviewPanelProps): JSX.Element {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const [scores, setScores] = useState<ParameterScores>(() => freshScores());
  const [feedback, setFeedback] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  // Track the active object URL so we can revoke it on cleanup / re-fetch.
  const objectUrlRef = useRef<string | null>(null);

  // Fetch the authenticated video blob and expose it as an object URL (Req 4.2).
  useEffect(() => {
    let cancelled = false;
    setVideoUrl(null);
    setVideoError(null);

    apiBlobUrl(`/submissions/${submission.id}/video`)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url;
        setVideoUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setVideoError(
            err instanceof ApiError
              ? err.message
              : 'Failed to load the video. Please try again.',
          );
        }
      });

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [submission.id]);

  function setScore(parameter: SoftSkillParameter, value: number): void {
    setScores((current) => ({ ...current, [parameter]: value }));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setDetails([]);

    const payload: EvaluationPayload = { scores, overallFeedback: feedback };

    try {
      await apiRequest<EvaluationResponse>(`/submissions/${submission.id}/evaluation`, {
        method: 'POST',
        body: payload,
      });
      onEvaluated();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.details) {
          // The backend returns an array of field-level messages.
          setDetails(Array.isArray(err.details) ? err.details : Object.values(err.details));
        }
      } else {
        setFormError('Failed to submit the evaluation. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-800">{prompt}</p>

      {/* Video playback */}
      <div className="mt-4">
        {videoError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {videoError}
          </p>
        ) : videoUrl ? (
          <video
            src={videoUrl}
            controls
            className="w-full rounded-md bg-black"
            aria-label="Submission playback"
          />
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            Loading video…
          </p>
        )}
      </div>

      {/* Scoring form */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Soft-skill scores (1–10)
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {SOFT_SKILL_PARAMETERS.map((parameter) => (
              <label key={parameter} className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                  {SOFT_SKILL_LABELS[parameter]}
                  <span className="ml-2 inline-flex h-6 w-8 items-center justify-center rounded bg-brand/10 text-xs font-semibold text-brand">
                    {scores[parameter]}
                  </span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={scores[parameter]}
                  onChange={(e) => setScore(parameter, Number(e.target.value))}
                  className="accent-brand"
                  aria-label={`${SOFT_SKILL_LABELS[parameter]} score`}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Overall feedback</span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            placeholder="Share constructive feedback on this answer…"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>

        {formError && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            <p>{formError}</p>
            {details.length > 0 && (
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit evaluation'}
        </button>
      </form>
    </div>
  );
}
