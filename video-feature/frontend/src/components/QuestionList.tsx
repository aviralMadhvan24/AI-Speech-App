/**
 * QuestionList component (Task 11.1, Requirement 2.2).
 *
 * Fetches the 10 seeded interview questions from `GET /questions` and renders
 * them as a selectable list. Selecting a question calls `onSelect` so the
 * parent (the student practice flow) can open the Recorder for that prompt.
 */

import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import type { Question, QuestionDifficulty, QuestionsResponse } from '../api/types';

export interface QuestionListProps {
  /** The currently selected question id, if any (for highlighting). */
  selectedId?: number | null;
  /** Called when the student picks a question to answer. */
  onSelect: (question: Question) => void;
}

/** Tailwind classes for each difficulty pill (green / amber / red). */
const DIFFICULTY_STYLES: Record<QuestionDifficulty, string> = {
  Easy: 'bg-green-100 text-green-700',
  Medium: 'bg-amber-100 text-amber-700',
  Hard: 'bg-red-100 text-red-700',
};

/** Renders the seeded questions and lets the student pick one to answer. */
export function QuestionList({ selectedId, onSelect }: QuestionListProps): JSX.Element {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiRequest<QuestionsResponse>('/questions')
      .then((data) => {
        if (!cancelled) setQuestions(data.questions);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Failed to load questions. Please try again.',
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

  if (loading) {
    return <p className="text-sm text-slate-500">Loading questions…</p>;
  }

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        {error}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {questions.map((question) => {
        const isSelected = question.id === selectedId;
        return (
          <li key={question.id}>
            <button
              type="button"
              onClick={() => onSelect(question)}
              aria-pressed={isSelected}
              className={[
                'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition',
                isSelected
                  ? 'border-brand bg-brand/5 ring-1 ring-brand'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
              ].join(' ')}
            >
              <span
                className={[
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isSelected ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600',
                ].join(' ')}
              >
                {question.id}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-800">{question.prompt}</span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {question.category}
                  </span>
                  <span
                    className={[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      DIFFICULTY_STYLES[question.difficulty],
                    ].join(' ')}
                  >
                    {question.difficulty}
                  </span>
                  <span className="inline-flex items-center text-xs text-slate-400">
                    ~{question.expectedDurationSeconds}s
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
