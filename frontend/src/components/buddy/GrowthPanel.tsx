/**
 * The cycle panel: what the mentee did this period, and whether it moved.
 *
 * Everything rendered here is already scoped to the open cycle by the server —
 * the component never filters, because anything it received is in-window by
 * construction.
 *
 * Chart colours come from a palette validated for colour-blind separation
 * against this app's dark surface (#101012 composite): worst all-pairs CVD
 * ΔE 9.4, normal-vision ΔE 20.9, every slot ≥ 3:1 contrast. Series are also
 * direct-labelled, so identity never rests on colour alone.
 */
import { useMemo } from "react";
import { Mic, MessageSquareText, Users2 } from "lucide-react";
import type { ActivityItem, CycleReport, GrowthAxis, TrendPoint } from "../../buddyApi";

const SERIES = {
  content: { color: "#3987e5", label: "Content" },
  pronunciation: { color: "#199e70", label: "Pronunciation" },
  live_speaking: { color: "#d95926", label: "Live speaking" },
} as const;

type SeriesKey = keyof typeof SERIES;

const GAIN = "#3987e5";
const LOSS = "#e66767";

function formatDelta(value: number): string {
  // U+2212 rather than a hyphen so the minus lines up in tabular figures.
  return value > 0 ? `+${value.toFixed(1)}` : `−${Math.abs(value).toFixed(1)}`;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Delta bars — polarity, so they diverge from a true zero
// ---------------------------------------------------------------------------

function DeltaBars({ axes }: { axes: GrowthAxis[] }) {
  const measured = axes.filter((axis) => axis.delta !== null);
  if (measured.length === 0) return null;

  const widest = Math.max(...measured.map((a) => Math.abs(a.delta as number)), 5);
  const zero = 250;
  const scale = 150 / widest;
  const rowHeight = 40;

  return (
    <svg
      viewBox={`0 0 440 ${measured.length * rowHeight + 22}`}
      className="w-full h-auto overflow-visible"
      role="img"
      aria-label={measured
        .map((a) => `${a.label} ${formatDelta(a.delta as number)} points`)
        .join(", ")}
    >
      <line
        x1={zero}
        y1={6}
        x2={zero}
        y2={measured.length * rowHeight + 2}
        stroke="#3f3f46"
        strokeWidth={1}
      />
      {measured.map((axis, index) => {
        const delta = axis.delta as number;
        const width = Math.max(Math.abs(delta) * scale, 2);
        const y = index * rowHeight + 10;
        const positive = delta >= 0;
        return (
          <g key={axis.key}>
            <text x={0} y={y + 14} className="fill-zinc-400" fontSize={12}>
              {axis.label}
            </text>
            <rect
              x={positive ? zero : zero - width}
              y={y}
              width={width}
              height={18}
              rx={4}
              fill={positive ? GAIN : LOSS}
            >
              <title>
                {`${axis.label}: ${axis.baseline?.toFixed(1)} at baseline → ${axis.latest?.toFixed(1)} now`}
              </title>
            </rect>
            <text
              x={positive ? zero + width + 8 : zero - width - 8}
              y={y + 14}
              textAnchor={positive ? "start" : "end"}
              className="fill-zinc-100 tabular-nums"
              fontSize={12}
            >
              {formatDelta(delta)}
            </text>
          </g>
        );
      })}
      <text
        x={zero}
        y={measured.length * rowHeight + 16}
        textAnchor="middle"
        className="fill-zinc-600"
        fontSize={10}
      >
        no change
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Trend — every measure is already 0-100, so all three share one axis
// ---------------------------------------------------------------------------

function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const geometry = useMemo(() => {
    const values = trend.flatMap((point) =>
      ([point.content, point.pronunciation, point.live_speaking] as const).filter(
        (value): value is number => value !== null,
      ),
    );
    if (values.length === 0) return null;

    // A little headroom either side so markers never sit on the frame. The
    // range is deliberately not 0-100: an 8-point move has to be visible.
    const low = Math.max(0, Math.floor((Math.min(...values) - 4) / 5) * 5);
    const high = Math.min(100, Math.ceil((Math.max(...values) + 4) / 5) * 5);
    const span = high - low || 1;

    const left = 42;
    const right = 320;
    const top = 14;
    const bottom = 150;

    const x = (index: number) =>
      trend.length === 1
        ? (left + right) / 2
        : left + (index * (right - left)) / (trend.length - 1);
    const y = (value: number) => bottom - ((value - low) / span) * (bottom - top);

    return { low, high, span, left, right, top, bottom, x, y };
  }, [trend]);

  if (!geometry) return null;
  const { low, high, left, right, bottom, x, y } = geometry;
  const mid = Math.round((low + high) / 2);

  const lines = (Object.keys(SERIES) as SeriesKey[]).map((key) => {
    const points = trend
      .map((point, index) => ({ value: point[key], index }))
      .filter((entry): entry is { value: number; index: number } => entry.value !== null);
    return { key, points };
  });

  return (
    <svg
      viewBox="0 0 440 172"
      className="w-full h-auto overflow-visible"
      role="img"
      aria-label="Scores across the cycle"
    >
      {[high, mid, low].map((value) => (
        <g key={value}>
          <line
            x1={left}
            y1={y(value)}
            x2={right}
            y2={y(value)}
            stroke={value === low ? "#3f3f46" : "#27272a"}
            strokeWidth={1}
          />
          <text
            x={left - 8}
            y={y(value) + 3}
            textAnchor="end"
            className="fill-zinc-600 tabular-nums"
            fontSize={10}
          >
            {value}
          </text>
        </g>
      ))}

      {trend.map((point, index) => (
        <text
          key={point.at}
          x={x(index)}
          y={bottom + 16}
          textAnchor="middle"
          className="fill-zinc-600"
          fontSize={10}
        >
          {formatDay(point.at)}
        </text>
      ))}

      {lines.map(({ key, points }) =>
        points.length > 1 ? (
          <polyline
            key={`line-${key}`}
            points={points.map((p) => `${x(p.index)},${y(p.value)}`).join(" ")}
            fill="none"
            stroke={SERIES[key].color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null,
      )}

      {lines.map(({ key, points }) =>
        points.map((p) => (
          <circle
            key={`${key}-${p.index}`}
            cx={x(p.index)}
            cy={y(p.value)}
            r={4.5}
            fill={SERIES[key].color}
            stroke="#101012"
            strokeWidth={2}
          >
            <title>{`${SERIES[key].label} · ${formatDay(trend[p.index].at)} · ${p.value.toFixed(1)}`}</title>
          </circle>
        )),
      )}

      {lines.map(({ key, points }) => {
        const last = points[points.length - 1];
        if (!last) return null;
        return (
          <text
            key={`label-${key}`}
            x={right + 10}
            y={y(last.value) + 4}
            fill={SERIES[key].color}
            fontSize={11}
            fontWeight={600}
          >
            {SERIES[key].label}
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

const ACTIVITY_META = {
  interview: { icon: Mic, label: "Interview" },
  debate: { icon: MessageSquareText, label: "Debate" },
  gd: { icon: Users2, label: "Group discussion" },
} as const;

function ActivityRow({ item }: { item: ActivityItem }) {
  const { icon: Icon, label } = ACTIVITY_META[item.kind];
  return (
    <li className="flex items-center gap-3 py-2 border-b border-zinc-800/60 last:border-0">
      <Icon className="w-4 h-4 text-zinc-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-200 truncate">{item.title}</p>
        <p className="text-xs text-zinc-600">
          {label} · {formatDay(item.at)}
        </p>
      </div>
      {item.score !== null && (
        <span className="text-sm tabular-nums text-zinc-300 shrink-0">
          {item.score.toFixed(1)}
        </span>
      )}
    </li>
  );
}

export function GrowthPanel({ report }: { report: CycleReport }) {
  const { cycle, axes, trend, activity, counts, enough_for_trend } = report;
  if (!cycle) return null;

  const measured = axes.filter((axis) => axis.delta !== null);
  const total = activity.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ["Debates", counts.debate ?? 0],
          ["Group discussions", counts.gd ?? 0],
          ["Interviews", counts.interview ?? 0],
          ["Total this cycle", total],
        ].map(([label, value]) => (
          <div key={label as string} className="card-glass p-3">
            <span className="block text-2xl font-bold tabular-nums text-zinc-100">
              {value as number}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">
              {label as string}
            </span>
          </div>
        ))}
      </div>

      {total === 0 ? (
        <div className="card-glass p-5 text-sm text-zinc-400">
          Nothing scored yet in this cycle. Interviews, debates and group
          discussions will show up here as they happen.
        </div>
      ) : (
        <>
          {measured.length > 0 && (
            <div className="card-glass p-4">
              <h3 className="text-sm font-semibold text-zinc-200">Change this cycle</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Against where this cycle started
              </p>
              <DeltaBars axes={axes} />
            </div>
          )}

          <div className="card-glass p-4">
            <h3 className="text-sm font-semibold text-zinc-200">
              Scores across the cycle
            </h3>
            <p className="text-xs text-zinc-500 mb-3">
              All measures are out of 100
            </p>
            {enough_for_trend ? (
              <TrendChart trend={trend} />
            ) : (
              /* A line through two points implies a trajectory the data
                 cannot support, so the numbers stand alone until there are
                 three. */
              <p className="text-sm text-zinc-400 py-3">
                {trend.length === 0
                  ? "No scored work yet."
                  : `Only ${trend.length} scored ${
                      trend.length === 1 ? "day" : "days"
                    } so far — not enough to show a trend. Keep practising and the chart appears at three.`}
              </p>
            )}
          </div>

          <div className="card-glass p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-1">
              What they did
            </h3>
            <ul>
              {activity.map((item) => (
                <ActivityRow key={`${item.kind}-${item.at}-${item.title}`} item={item} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
