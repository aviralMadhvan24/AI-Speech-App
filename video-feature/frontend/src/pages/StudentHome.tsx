/**
 * Student home (Task 11, Requirements 2.2, 3.x, 6.1, 6.3).
 *
 * The student's workspace, organized as two tabs:
 *   - "Practice" — pick one of the 10 seeded questions (QuestionList) and
 *     record + submit a video answer (Recorder).
 *   - "My answers" — review submission history with scores/feedback or an
 *     awaiting-review state (StudentProfile).
 *
 * A successful upload bumps a refresh key and switches the student to their
 * answers tab so the freshly submitted answer is visible.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiRequest } from '../api/client';
import type { Question, QuestionsResponse } from '../api/types';
import { QuestionList } from '../components/QuestionList';
import { Recorder } from '../components/Recorder';
import { StudentProfile } from '../components/StudentProfile';
import { StudentDashboard } from '../components/StudentDashboard';

type Tab = 'dashboard' | 'practice' | 'answers';

export function StudentHome(): JSX.Element {
  const { logout } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [selected, setSelected] = useState<Question | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);

  // Load questions once so the profile can show prompt text alongside answers.
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

  function handleSubmitted(): void {
    setRefreshKey((key) => key + 1);
    setSelected(null);
    setTab('answers');
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
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
              onClick={logout}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Student home</h1>
        <p className="mt-1 text-slate-600">
          Practice your interview answers and track your feedback.
        </p>

        <nav className="mt-6 flex gap-2 border-b border-slate-200">
          <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
            Dashboard
          </TabButton>
          <TabButton active={tab === 'practice'} onClick={() => setTab('practice')}>
            Practice
          </TabButton>
          <TabButton active={tab === 'answers'} onClick={() => setTab('answers')}>
            My answers
          </TabButton>
        </nav>

        <div className="mt-6">
          {tab === 'dashboard' ? (
            <StudentDashboard refreshKey={refreshKey} />
          ) : tab === 'practice' ? (
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Choose a question
                </h2>
                <QuestionList selectedId={selected?.id ?? null} onSelect={setSelected} />
              </div>
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Record your answer
                </h2>
                {selected ? (
                  <Recorder
                    key={selected.id}
                    question={selected}
                    onSubmitted={handleSubmitted}
                    onCancel={() => setSelected(null)}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                    Select a question to start recording your answer.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <StudentProfile refreshKey={refreshKey} questions={questions} />
          )}
        </div>
      </div>
    </main>
  );
}

/** A single tab button in the student home navigation. */
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition',
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-slate-500 hover:text-slate-700',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
