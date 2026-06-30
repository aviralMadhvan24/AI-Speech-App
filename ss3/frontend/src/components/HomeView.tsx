import { useEffect, useState } from 'react';
import { Trash2, Video, Eye, Calendar, Loader2, ArrowRight, Zap, BarChart3, Shield } from 'lucide-react';
import { listSessions, deleteSession } from '../api';
import type { SessionMetadata } from '../types';

interface Props {
  onNewRecording: () => void;
  onSelectSession: (sessionId: string) => void;
}

export default function HomeView({ onNewRecording, onSelectSession }: Props) {
  const [sessions, setSessions] = useState<SessionMetadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await listSessions();
      setSessions(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this session? This cannot be undone.')) return;
    try {
      await deleteSession(id);
      await refresh();
    } catch (err) {
      alert('Could not delete: ' + (err as Error).message);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Hero */}
      <section className="card-glass overflow-hidden p-8 sm:p-12 relative bg-grid">
        {/* Animated mesh background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-gradient-to-br from-brand-500 to-fuchsia-500 rounded-full blur-3xl opacity-20 animate-pulse-slow" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-gradient-to-br from-cyan-500 to-brand-500 rounded-full blur-3xl opacity-15 animate-pulse-slow" />
        </div>

        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/30 text-xs font-semibold text-brand-300 mb-4">
            <Zap className="w-3 h-3" />
            Phase 1 · Body Language
          </div>

          <h1 className="text-3xl sm:text-5xl font-bold mb-4 leading-[1.1] tracking-tight max-w-3xl">
            Master your body language for{' '}
            <span className="text-gradient bg-gradient-to-r from-brand-400 via-fuchsia-400 to-cyan-400">
              interviews and presentations.
            </span>
          </h1>
          <p className="text-zinc-400 mb-8 max-w-2xl text-lg leading-relaxed">
            Record a 30 to 120 second mock session. Get instant feedback on posture,
            eye contact, gestures, stillness, and facial expression.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={onNewRecording}
              className="group inline-flex items-center gap-2 bg-white text-zinc-950 font-semibold rounded-xl px-6 py-3.5 hover:bg-zinc-100 transition-all shadow-2xl shadow-white/10 hover:shadow-white/20 active:scale-95"
            >
              <Video className="w-5 h-5" />
              Start New Recording
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Shield className="w-3.5 h-3.5" />
              Your videos never leave this machine
            </div>
          </div>

          {/* Feature row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-10 pt-8 border-t border-zinc-800/60">
            {METRICS.map((m, i) => (
              <div
                key={m.label}
                className="text-center animate-fade-in-up"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="text-2xl mb-1">{m.emoji}</div>
                <div className="text-xs font-medium text-zinc-400">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Past Sessions */}
      <section className="card p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-400" />
            <h2 className="text-lg font-bold text-zinc-50">Past Sessions</h2>
          </div>
          {sessions && (
            <span className="chip bg-zinc-800/60 text-zinc-400 border-zinc-700/60">
              {sessions.length}
            </span>
          )}
        </div>

        {error && (
          <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">
            Could not load sessions: {error}
          </div>
        )}

        {!sessions && !error && (
          <div className="flex items-center justify-center py-10 text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {sessions && sessions.length === 0 && (
          <div className="border border-dashed border-zinc-800 rounded-xl py-12 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800/60 flex items-center justify-center">
              <Calendar className="w-6 h-6 text-zinc-600" />
            </div>
            <div className="text-sm text-zinc-500">
              No sessions yet. Record your first one to see it here.
            </div>
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <ul className="space-y-2">
            {sessions.map((s, i) => (
              <li
                key={s.session_id}
                className="group flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-zinc-800/60 hover:border-zinc-700 hover:bg-zinc-900/60 transition-all animate-fade-in-up cursor-pointer"
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => s.state === 'completed' && onSelectSession(s.session_id)}
              >
                <ScoreBadge value={s.overall_score} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-zinc-100 text-sm sm:text-base">
                    {formatDate(s.created_at)}
                  </div>
                  <div className="text-xs text-zinc-500 flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{Math.round(s.duration_seconds)}s</span>
                    <span>·</span>
                    <StateChip state={s.state} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSession(s.session_id);
                    }}
                    disabled={s.state !== 'completed'}
                    className="btn-ghost text-xs sm:text-sm"
                    title="View report"
                  >
                    <Eye className="w-4 h-4" />
                    <span className="hidden sm:inline">View</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s.session_id);
                    }}
                    className="btn-ghost text-xs sm:text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/40"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const METRICS = [
  { emoji: '🧍', label: 'Posture' },
  { emoji: '👀', label: 'Eye Contact' },
  { emoji: '🙌', label: 'Gestures' },
  { emoji: '🧘', label: 'Stillness' },
  { emoji: '😊', label: 'Expression' },
];

function ScoreBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="w-14 h-14 rounded-xl bg-zinc-800/60 flex items-center justify-center text-zinc-600 font-bold border border-zinc-700/60">
        --
      </div>
    );
  }
  const colors =
    value >= 70
      ? 'from-emerald-500 to-emerald-700 shadow-glow-emerald'
      : value >= 40
        ? 'from-amber-500 to-amber-700'
        : 'from-rose-500 to-rose-700 shadow-glow-rose';
  return (
    <div
      className={`w-14 h-14 rounded-xl bg-gradient-to-br ${colors} flex items-center justify-center text-white font-bold text-lg tabular-nums shadow-lg`}
    >
      {value}
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    processing: 'bg-brand-500/10 text-brand-300 border-brand-500/30',
    queued: 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60',
    failed: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  };
  const cls = styles[state] ?? 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60';
  return <span className={`chip ${cls}`}>{state}</span>;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
