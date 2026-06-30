/**
 * ProgressChart component (polish features).
 *
 * A small, dependency-free inline SVG line chart of a student's overall scores
 * over time. The y-axis is fixed to the 0–100 score range; the x-axis maps
 * points to their chronological order (left = oldest, right = newest).
 *
 * Renders gracefully for any number of points:
 *   - 0 points → a muted hint (no chart drawn).
 *   - 1 point  → a single dot centred horizontally.
 *   - 2+ points → a polyline connecting each dot.
 *
 * Intentionally lightweight: no charting library, just an SVG with a baseline,
 * a polyline, and a dot per point.
 */

import type { TimelinePoint } from '../api/types';

export interface ProgressChartProps {
  /** The score timeline, oldest first. Each score is expected in 0–100. */
  points: TimelinePoint[];
}

/** Internal drawing constants for the SVG viewBox coordinate space. */
const WIDTH = 480;
const HEIGHT = 160;
const PADDING = { top: 12, right: 16, bottom: 24, left: 32 } as const;
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/** Plot area dimensions derived from the viewBox and padding. */
const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

/** Maps a 0–100 score to a y pixel coordinate (higher score → higher up). */
function scoreToY(score: number): number {
  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
  const ratio = (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
  return PADDING.top + (1 - ratio) * PLOT_HEIGHT;
}

/** Maps a point index to an x pixel coordinate, spreading points evenly. */
function indexToX(index: number, count: number): number {
  if (count <= 1) {
    // A single point sits in the horizontal centre of the plot area.
    return PADDING.left + PLOT_WIDTH / 2;
  }
  const ratio = index / (count - 1);
  return PADDING.left + ratio * PLOT_WIDTH;
}

/** Renders the student's score progression as an inline SVG line chart. */
export function ProgressChart({ points }: ProgressChartProps): JSX.Element {
  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        No evaluated answers yet. Your progress chart will appear once your answers are scored.
      </p>
    );
  }

  const count = points.length;
  const coords = points.map((point, index) => ({
    x: indexToX(index, count),
    y: scoreToY(point.score),
    point,
  }));

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');

  // Horizontal gridlines / y-axis labels at 0, 50, 100.
  const yTicks = [0, 50, 100];

  return (
    <figure className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Progress chart of overall scores over time"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis gridlines + labels */}
        {yTicks.map((tick) => {
          const y = scoreToY(tick);
          return (
            <g key={tick}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={WIDTH - PADDING.right}
                y2={y}
                className="stroke-slate-100"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-400 text-[10px]"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Axis baseline (score = 0) */}
        <line
          x1={PADDING.left}
          y1={scoreToY(MIN_SCORE)}
          x2={WIDTH - PADDING.right}
          y2={scoreToY(MIN_SCORE)}
          className="stroke-slate-300"
          strokeWidth={1}
        />

        {/* Score line (only meaningful with 2+ points) */}
        {count > 1 && (
          <polyline
            points={polylinePoints}
            fill="none"
            className="stroke-brand"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Dot per point */}
        {coords.map((c, index) => (
          <circle
            key={index}
            cx={c.x}
            cy={c.y}
            r={3.5}
            className="fill-brand"
          >
            <title>{`${new Date(c.point.date).toLocaleDateString()}: ${c.point.score}/100`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-2 text-center text-xs text-slate-400">
        Overall score per evaluated answer (oldest → newest)
      </figcaption>
    </figure>
  );
}
