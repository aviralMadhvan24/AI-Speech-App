import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { fetchAnalytics, type AdminAnalytics } from "../../adminApi";

// Register the Chart.js pieces used here. Done once at module load.
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
);

export function AdminAnalyticsView() {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnalytics();
      setAnalytics(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load analytics.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const barData = useMemo<ChartData<"bar">>(() => {
    const gesture = analytics?.avg_gesture_score ?? 0;
    const teacher = analytics?.avg_teacher_score ?? 0;
    const combined = analytics?.avg_combined_score ?? 0;
    return {
      labels: ["Gesture", "Teacher", "Combined"],
      datasets: [
        {
          label: "Average score",
          data: [gesture, teacher, combined],
          backgroundColor: [
            "rgba(245, 158, 11, 0.65)", // amber
            "rgba(99, 102, 241, 0.65)", // brand-indigo
            "rgba(192, 132, 252, 0.7)", // fuchsia
          ],
          borderColor: [
            "rgba(245, 158, 11, 0.95)",
            "rgba(99, 102, 241, 0.95)",
            "rgba(192, 132, 252, 0.95)",
          ],
          borderWidth: 1,
          borderRadius: 8,
          maxBarThickness: 64,
        },
      ],
    };
  }, [analytics]);

  const barOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const raw = ctx.parsed.y ?? 0;
              return ` ${Math.round(raw)} / 100`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#a1a1aa" },
        },
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 25, color: "#a1a1aa" },
          grid: { color: "rgba(63, 63, 70, 0.4)" },
        },
      },
    }),
    [],
  );

  const doughnutData = useMemo<ChartData<"doughnut">>(() => {
    const pending = analytics?.submissions_pending ?? 0;
    const reviewed = analytics?.submissions_reviewed ?? 0;
    return {
      labels: ["Pending", "Reviewed"],
      datasets: [
        {
          data: [pending, reviewed],
          backgroundColor: [
            "rgba(244, 63, 94, 0.7)", // rose
            "rgba(16, 185, 129, 0.7)", // emerald
          ],
          borderColor: [
            "rgba(244, 63, 94, 0.95)",
            "rgba(16, 185, 129, 0.95)",
          ],
          borderWidth: 1,
          hoverOffset: 6,
        },
      ],
    };
  }, [analytics]);

  const doughnutOptions = useMemo<ChartOptions<"doughnut">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed}`,
          },
        },
      },
    }),
    [],
  );

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100 inline-flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-300" />
            Class analytics
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Live snapshot of activity, scoring, and review throughput.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading && !analytics && (
        <div className="card-glass px-4 py-6 text-sm text-zinc-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading analytics…
        </div>
      )}

      {error && (
        <div className="card-glass border-rose-500/40 px-4 py-3 flex items-start gap-3 text-sm text-rose-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div>{error}</div>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs font-medium text-rose-200 underline underline-offset-4"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {analytics && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            <StatCard
              icon={Users}
              label="Students"
              value={analytics.student_count}
              accent="text-brand-300"
            />
            <StatCard
              icon={UserCheck}
              label="Teachers"
              value={analytics.teacher_count}
              accent="text-emerald-300"
            />
            <StatCard
              icon={ClipboardList}
              label="Submissions"
              value={analytics.submissions_total}
              accent="text-fuchsia-300"
            />
            <StatCard
              icon={Hourglass}
              label="Pending"
              value={analytics.submissions_pending}
              accent="text-rose-300"
            />
            <StatCard
              icon={CheckCircle2}
              label="Reviewed"
              value={analytics.submissions_reviewed}
              accent="text-emerald-300"
            />
            <StatCard
              icon={TrendingUp}
              label="Avg combined"
              value={
                typeof analytics.avg_combined_score === "number"
                  ? Math.round(analytics.avg_combined_score)
                  : "—"
              }
              suffix={
                typeof analytics.avg_combined_score === "number"
                  ? "/100"
                  : undefined
              }
              accent="text-amber-300"
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
            <div className="card-glass p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-100 inline-flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-brand-300" />
                  Average scores
                </h3>
                <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                  0–100 scale
                </span>
              </div>
              <div className="h-[260px]">
                <Bar data={barData} options={barOptions} />
              </div>
            </div>

            <div className="card-glass p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-100 inline-flex items-center gap-2">
                  <Hourglass className="w-4 h-4 text-rose-300" />
                  Pending vs reviewed
                </h3>
                <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                  Counts
                </span>
              </div>
              <div className="h-[260px] flex items-center justify-center">
                {analytics.submissions_total === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No submissions yet to plot.
                  </p>
                ) : (
                  <Doughnut data={doughnutData} options={doughnutOptions} />
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

interface StatCardProps {
  icon: typeof Users;
  label: string;
  value: number | string;
  suffix?: string;
  accent: string;
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  accent,
}: StatCardProps) {
  return (
    <div className="card-glass p-4">
      <div className="relative">
        <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold ${accent}`}>
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-100 leading-none">
          {value}
          {suffix && (
            <span className="text-sm text-zinc-500 ml-1 font-normal">
              {suffix}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
