import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Video,
  Home,
  Sparkles,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Trophy,
} from 'lucide-react';
import { getReport } from '../api';
import type { Report, MetricResult, Suggestion } from '../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, Title);

interface Props {
  sessionId: string;
  onNewRecording: () => void;
  onHome: () => void;
}

export default function ReportView({ sessionId, onNewRecording, onHome }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReport(sessionId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <div className="card-glass p-10 text-center animate-scale-in">
        <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
        <h2 className="font-bold text-zinc-50 mb-2">Could not load report</h2>
        <p className="text-sm text-zinc-400 mb-5">{error}</p>
        <button onClick={onHome} className="btn-primary">
          Back to home
        </button>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="card p-10 text-center">
        <Loader2 className="w-8 h-8 mx-auto text-brand-400 animate-spin" />
      </div>
    );
  }

  const flagged = report.metrics.filter((m) => m.flag !== 'ok');
  const gestureMetric = report.metrics.find((m) => m.name === 'gesture');
  const gestureCats = (
    gestureMetric?.details as { per_category?: Record<string, number> } | undefined
  )?.per_category;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Hero with overall score */}
      <section className="card-glass overflow-hidden bg-grid">
        <div className="relative p-8 sm:p-10">
          {/* Animated background orbs */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-gradient-to-br from-brand-500 to-fuchsia-500 rounded-full blur-3xl opacity-30 animate-pulse-slow" />
          </div>

          <div className="relative flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="text-center sm:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/30 text-xs font-semibold text-brand-300 mb-3">
                <Trophy className="w-3 h-3" />
                Overall Score
              </div>
              <div className="relative inline-block">
                <div className="text-7xl sm:text-9xl font-bold tabular-nums leading-none tracking-tight bg-gradient-to-br from-zinc-50 via-zinc-200 to-zinc-400 text-transparent bg-clip-text">
                  {report.overall.value}
                  <span className="text-3xl sm:text-4xl text-zinc-500 ml-1 font-normal">
                    /100
                  </span>
                </div>
                {/* Glow behind score */}
                <div className="absolute inset-0 blur-3xl opacity-30 bg-gradient-to-br from-brand-500 to-fuchsia-500 -z-10" />
              </div>
              <ScoreVerdict value={report.overall.value} flag={report.overall.session_flag} />
            </div>
            <div className="flex flex-col gap-2 w-full sm:w-auto">
              <button onClick={onNewRecording} className="btn-primary justify-center">
                <Video className="w-4 h-4" />
                New Recording
              </button>
              <button onClick={onHome} className="btn-ghost justify-center">
                <Home className="w-4 h-4" />
                Home
              </button>
            </div>
          </div>
        </div>
        {flagged.length > 0 && (
          <div className="px-6 sm:px-8 py-4 bg-amber-500/10 border-t border-amber-500/30 flex items-start gap-3 text-sm text-amber-200">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-amber-400" />
            <div>
              <strong>Low confidence on:</strong>{' '}
              {flagged.map((m) => prettify(m.name)).join(', ')}.
              These metrics did not count toward the overall score. Try re-recording with
              better framing and lighting.
            </div>
          </div>
        )}
      </section>

      {/* Per-metric cards */}
      <section className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <h3 className="font-bold text-zinc-50 mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-400" />
          Per-Metric Breakdown
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {report.metrics.map((m, i) => (
            <MetricCard key={m.name} metric={m} delay={i * 60} />
          ))}
        </div>
      </section>

      {/* Charts */}
      <section
        className="grid md:grid-cols-2 gap-6 animate-fade-in-up"
        style={{ animationDelay: '200ms' }}
      >
        <div className="card p-6">
          <h3 className="font-bold text-zinc-50 mb-4">Scores</h3>
          <div className="h-64">
            <Bar data={makeBarData(report.metrics)} options={barOpts} />
          </div>
        </div>
        <div className="card p-6">
          <h3 className="font-bold text-zinc-50 mb-4">Gesture Breakdown</h3>
          <div className="h-64">
            {gestureCats ? (
              <Doughnut data={makeDoughnutData(gestureCats)} options={doughnutOpts} />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-zinc-500">
                No gesture data
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Suggestions */}
      <section
        className="card p-6 sm:p-8 animate-fade-in-up"
        style={{ animationDelay: '300ms' }}
      >
        <h3 className="font-bold text-zinc-50 mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-400" />
          Suggestions
        </h3>
        <SuggestionList suggestions={report.suggestions} />
      </section>
    </div>
  );
}

function ScoreVerdict({ value, flag }: { value: number; flag: string | null }) {
  if (flag === 'low_confidence') {
    return <div className="mt-2 text-sm text-amber-300">Low confidence result</div>;
  }
  let label = 'Keep practicing';
  let color = 'text-rose-300';
  if (value >= 80) {
    label = 'Excellent performance';
    color = 'text-emerald-300';
  } else if (value >= 60) {
    label = 'Solid foundation';
    color = 'text-brand-300';
  } else if (value >= 40) {
    label = 'Room to improve';
    color = 'text-amber-300';
  }
  return <div className={`mt-2 text-sm font-medium ${color}`}>{label}</div>;
}

function MetricCard({ metric, delay }: { metric: MetricResult; delay: number }) {
  const score = metric.score;
  const flagged = metric.flag !== 'ok';
  let cardStyle =
    'text-zinc-500 border-zinc-800/60 bg-zinc-900/40';
  let Icon = Minus;
  if (!flagged && score !== null) {
    if (score >= 70) {
      cardStyle = 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5';
      Icon = TrendingUp;
    } else if (score >= 40) {
      cardStyle = 'text-amber-300 border-amber-500/30 bg-amber-500/5';
      Icon = Minus;
    } else {
      cardStyle = 'text-rose-300 border-rose-500/30 bg-rose-500/5';
      Icon = TrendingDown;
    }
  }
  return (
    <div
      className={`p-4 rounded-xl border ${cardStyle} backdrop-blur-sm animate-fade-in-up transition-transform hover:scale-105`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-zinc-300 truncate">
          {prettify(metric.name)}
        </div>
        <Icon className="w-4 h-4 shrink-0" />
      </div>
      <div className="font-bold text-3xl tabular-nums leading-none text-white">
        {score === null ? '--' : score}
      </div>
      {flagged && (
        <div className="mt-1.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
          {metric.flag.replace('_', ' ')}
        </div>
      )}
    </div>
  );
}

function SuggestionList({ suggestions }: { suggestions: Suggestion[] }) {
  const grouped: Record<string, Suggestion[]> = {};
  for (const s of suggestions) {
    if (!grouped[s.metric]) grouped[s.metric] = [];
    grouped[s.metric].push(s);
  }

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([metric, items], i) => (
        <div
          key={metric}
          className="border-l-2 border-brand-500 bg-zinc-900/50 rounded-r-xl px-4 py-3 animate-fade-in-up"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="font-semibold text-zinc-50 mb-1.5">{prettify(metric)}</div>
          <ul className="space-y-1.5">
            {items.map((s, j) => {
              const isRecheck = s.band === 'unavailable';
              return (
                <li
                  key={j}
                  className={`text-sm flex gap-2 ${isRecheck ? 'text-amber-300' : 'text-zinc-300'}`}
                >
                  <span className="select-none text-brand-400">›</span>
                  <span>{s.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function makeBarData(metrics: MetricResult[]) {
  return {
    labels: metrics.map((m) => prettify(m.name)),
    datasets: [
      {
        label: 'Score',
        data: metrics.map((m) => (m.score === null ? 0 : m.score)),
        backgroundColor: metrics.map((m) => (m.flag === 'ok' ? '#818cf8' : '#3f3f46')),
        borderColor: metrics.map((m) => (m.flag === 'ok' ? '#6366f1' : '#52525b')),
        borderWidth: 1,
        borderRadius: 8,
        maxBarThickness: 56,
      },
    ],
  };
}

const barOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#18181b',
      borderColor: '#3f3f46',
      borderWidth: 1,
      titleColor: '#fafafa',
      bodyColor: '#d4d4d8',
      padding: 12,
      cornerRadius: 8,
    },
  },
  scales: {
    y: {
      min: 0,
      max: 100,
      grid: { color: 'rgba(63, 63, 70, 0.4)' },
      ticks: { color: '#71717a' },
    },
    x: {
      grid: { display: false },
      ticks: { color: '#a1a1aa' },
    },
  },
} as const;

function makeDoughnutData(cats: Record<string, number>) {
  const labels = Object.keys(cats);
  const data = labels.map((k) => cats[k]);
  return {
    labels: labels.map(prettify),
    datasets: [
      {
        data,
        backgroundColor: ['#f43f5e', '#f59e0b', '#10b981', '#6366f1', '#71717a'],
        borderColor: '#09090b',
        borderWidth: 2,
      },
    ],
  };
}

const doughnutOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right' as const,
      labels: { boxWidth: 12, color: '#a1a1aa', font: { size: 12 } },
    },
    tooltip: {
      backgroundColor: '#18181b',
      borderColor: '#3f3f46',
      borderWidth: 1,
      titleColor: '#fafafa',
      bodyColor: '#d4d4d8',
      padding: 12,
      cornerRadius: 8,
    },
  },
  cutout: '65%',
} as const;

function prettify(name: string): string {
  return name
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
