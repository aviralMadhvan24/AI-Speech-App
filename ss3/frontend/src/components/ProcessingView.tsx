import { useEffect, useState } from 'react';
import { AlertTriangle, Cpu, Check } from 'lucide-react';
import { getStatus } from '../api';

interface Props {
  sessionId: string;
  onCompleted: (sessionId: string) => void;
  onFailed: (sessionId: string) => void;
}

const STEPS = [
  'Sampling frames at 5 fps',
  'Detecting pose, face and hand landmarks',
  'Running five body-language analyzers',
  'Generating your personalised report',
];

export default function ProcessingView({ sessionId, onCompleted, onFailed }: Props) {
  const [state, setState] = useState<string>('queued');
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let stepTimer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const data = await getStatus(sessionId);
        if (cancelled) return;
        setState(data.state);
        if (data.state === 'completed') {
          onCompleted(sessionId);
          return;
        }
        if (data.state === 'failed') {
          setError(data.error ?? 'unknown error');
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!cancelled) {
        pollTimer = setTimeout(poll, 1000);
      }
    }

    poll();
    stepTimer = setInterval(() => {
      setStepIndex((i) => (i + 1) % STEPS.length);
    }, 1800);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (stepTimer) clearInterval(stepTimer);
    };
  }, [sessionId, onCompleted]);

  if (error) {
    return (
      <div className="card-glass p-10 max-w-2xl mx-auto text-center animate-scale-in">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
          <AlertTriangle className="w-10 h-10 text-rose-400" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-50 mb-2">Analysis failed</h2>
        <p className="text-sm text-zinc-400 mb-6 break-words font-mono bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-3">
          {error}
        </p>
        <button onClick={() => onFailed(sessionId)} className="btn-primary">
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="card-glass p-12 max-w-2xl mx-auto text-center animate-scale-in">
      {/* Animated loader */}
      <div className="relative w-32 h-32 mx-auto mb-8">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full bg-gradient-conic from-brand-500 via-fuchsia-500 to-brand-500 animate-spin-slow opacity-80" />
        {/* Inner mask */}
        <div className="absolute inset-2 rounded-full bg-zinc-950" />
        {/* Glow */}
        <div className="absolute inset-0 rounded-full bg-brand-500 blur-2xl opacity-40 animate-glow-pulse" />
        {/* Icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Cpu className="w-10 h-10 text-brand-400 animate-pulse" strokeWidth={2} />
        </div>
      </div>

      <h2 className="text-3xl font-bold text-zinc-50 mb-2 tracking-tight">
        Analyzing your video
      </h2>
      <p className="text-sm text-zinc-500 mb-8">
        Status:{' '}
        <span className="font-mono font-semibold text-brand-400 px-2 py-0.5 rounded bg-brand-500/10 border border-brand-500/30">
          {state}
        </span>
      </p>

      <ul className="space-y-3 text-left max-w-md mx-auto">
        {STEPS.map((s, i) => {
          const isActive = i === stepIndex;
          const isPast = i < stepIndex;
          return (
            <li
              key={i}
              className={`flex items-center gap-3 text-sm rounded-xl px-3 py-2 transition-all duration-300 ${
                isActive
                  ? 'bg-brand-500/10 border border-brand-500/30 text-brand-200 font-medium'
                  : isPast
                    ? 'text-zinc-600'
                    : 'text-zinc-500'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                  isActive
                    ? 'bg-brand-500 shadow-glow-sm'
                    : isPast
                      ? 'bg-zinc-700'
                      : 'border border-zinc-700'
                }`}
              >
                {isPast ? (
                  <Check className="w-3 h-3 text-zinc-300" strokeWidth={3} />
                ) : isActive ? (
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                ) : null}
              </span>
              {s}
            </li>
          );
        })}
      </ul>

      <div className="mt-8 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-brand-500 to-transparent animate-shimmer shimmer-bg" />
      </div>
    </div>
  );
}
