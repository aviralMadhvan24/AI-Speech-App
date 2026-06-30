/**
 * Pure rating logic for the Mock Interview MVP polish features.
 *
 * Like `scoring.ts` and `stats.ts`, these functions are intentionally free of
 * any I/O (no DB, file, or network access) so they can be exhaustively
 * property-tested in isolation and reused by the leaderboard and dashboard
 * routers layered on top of them.
 *
 * A student's per-submission "overall score" (0–100) is treated as the
 * percentage value that feeds these aggregate measures:
 *
 *   - `consistencyScore`  — how stable a student's scores are (low spread → high).
 *   - `improvementScore`  — whether later scores trend above earlier ones.
 *   - `overallRating`     — weighted blend of average / consistency / improvement.
 *   - `improvementTrend`  — coarse up/down/steady label derived from improvement.
 */

/** Clamp a number to the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Arithmetic mean of a non-empty list of numbers. */
function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Population standard deviation of a non-empty list of numbers. */
function populationStdDev(values: number[]): number {
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute a 0–100 consistency score from a student's overall scores.
 *
 * With fewer than 2 scores there is no spread to measure, so the result is 0.
 * Otherwise the score is `100 - 2 * populationStdDev(scores)`, clamped to
 * [0, 100]. When all scores are equal (and there are at least 2), the standard
 * deviation is 0 and the result is exactly 100.
 *
 * @param scores The student's evaluated overall scores (0–100).
 * @returns A consistency score in the inclusive range 0–100.
 */
export function consistencyScore(scores: number[]): number {
  if (scores.length < 2) return 0;
  return clamp(100 - 2 * populationStdDev(scores), 0, 100);
}

/**
 * Compute a 0–100 improvement score from a student's chronological scores.
 *
 * With fewer than 2 scores there is no trend to measure, so the result is 0.
 * Otherwise the chronologically ordered scores are partitioned into an earlier
 * half and a later half; when the count is odd, the middle element goes to the
 * LATER half. The delta is `mean(laterHalf) - mean(earlierHalf)`, and the score
 * is `clamp(50 + delta, 0, 100)`. When the two halves' means are equal, the
 * result is exactly 50 (no measurable change).
 *
 * @param scoresChrono The student's evaluated overall scores in chronological order.
 * @returns An improvement score in the inclusive range 0–100.
 */
export function improvementScore(scoresChrono: number[]): number {
  if (scoresChrono.length < 2) return 0;

  // Middle element joins the later half when the count is odd, so the split
  // point is the floor of half the length.
  const splitIndex = Math.floor(scoresChrono.length / 2);
  const earlierHalf = scoresChrono.slice(0, splitIndex);
  const laterHalf = scoresChrono.slice(splitIndex);

  const delta = mean(laterHalf) - mean(earlierHalf);
  return clamp(50 + delta, 0, 100);
}

/** Weights for blending the three components into an overall rating. */
export interface RatingWeights {
  /** Weight applied to the average overall score. */
  average: number;
  /** Weight applied to the consistency score. */
  consistency: number;
  /** Weight applied to the improvement score. */
  improvement: number;
}

/** Default rating weights: 70% average, 20% consistency, 10% improvement. */
export const DEFAULT_RATING_WEIGHTS: RatingWeights = {
  average: 70,
  consistency: 20,
  improvement: 10,
};

/**
 * Blend a student's average, consistency, and improvement into one 0–100 rating.
 *
 * The rating is the weighted sum
 * `(average*wAvg + consistency*wCons + improvement*wImpr) / 100`, clamped to
 * [0, 100]. With the default weights (which sum to 100) and inputs already in
 * [0, 100], the result is a convex blend that stays within [0, 100].
 *
 * @param average     The student's average overall score (0–100).
 * @param consistency The student's consistency score (0–100).
 * @param improvement The student's improvement score (0–100).
 * @param weights     The component weights (defaults to {average:70, consistency:20, improvement:10}).
 * @returns The overall rating in the inclusive range 0–100.
 */
export function overallRating(
  average: number,
  consistency: number,
  improvement: number,
  weights: RatingWeights = DEFAULT_RATING_WEIGHTS,
): number {
  const weighted =
    (average * weights.average +
      consistency * weights.consistency +
      improvement * weights.improvement) /
    100;
  return clamp(weighted, 0, 100);
}

/** Coarse trend label derived from an improvement score. */
export type ImprovementTrend = 'up' | 'down' | 'steady';

/**
 * Map an improvement score to a coarse trend label.
 *
 * An improvement above 50 trends `up`, below 50 trends `down`, and exactly 50
 * is `steady`.
 *
 * @param improvement An improvement score (typically 0–100).
 * @returns `'up'`, `'down'`, or `'steady'`.
 */
export function improvementTrend(improvement: number): ImprovementTrend {
  if (improvement > 50) return 'up';
  if (improvement < 50) return 'down';
  return 'steady';
}

/** Per-student input to the overall-rating ranking. */
export interface StudentRatingInput {
  studentId: string;
  name: string;
  /** The student's evaluated overall scores in chronological order. */
  scoresChrono: number[];
}

/** A student's computed rating metrics, used for ranking and the row payloads. */
export interface RatedStudent {
  studentId: string;
  name: string;
  /** Weighted overall rating (0–100) — the value rows are ranked by. */
  overallRating: number;
  /** Mean of the student's evaluated overall scores. */
  averageOverallScore: number;
  /** Highest evaluated overall score. */
  bestScore: number;
  /** Count of the student's evaluated submissions. */
  totalInterviews: number;
  /** Consistency component (0–100). */
  consistency: number;
  /** Improvement component (0–100). */
  improvement: number;
  /** Coarse trend label derived from the improvement component. */
  improvementTrend: ImprovementTrend;
}

/**
 * Compute and rank students by their Overall Rating (shared by the leaderboard
 * and the student dashboard so both agree on rank).
 *
 * Students with no evaluated scores are excluded. For each remaining student
 * the average, consistency, improvement, improvement trend, best score, and
 * overall rating are computed from their chronological scores. Rows are sorted
 * descending by `overallRating`, breaking ties first by higher
 * `averageOverallScore` and then by greater `totalInterviews`. Ranks are 1-based
 * positions in the returned list (assigned by the caller after this sort).
 *
 * @param students Per-student chronological evaluated scores.
 * @returns Rated students ordered from highest to lowest overall rating.
 */
export function rankByOverallRating(students: StudentRatingInput[]): RatedStudent[] {
  return students
    .filter((student) => student.scoresChrono.length > 0)
    .map((student) => {
      const average = mean(student.scoresChrono);
      const consistency = consistencyScore(student.scoresChrono);
      const improvement = improvementScore(student.scoresChrono);
      return {
        studentId: student.studentId,
        name: student.name,
        overallRating: overallRating(average, consistency, improvement),
        averageOverallScore: average,
        bestScore: Math.max(...student.scoresChrono),
        totalInterviews: student.scoresChrono.length,
        consistency,
        improvement,
        improvementTrend: improvementTrend(improvement),
      };
    })
    .sort((a, b) => {
      if (b.overallRating !== a.overallRating) return b.overallRating - a.overallRating;
      if (b.averageOverallScore !== a.averageOverallScore) {
        return b.averageOverallScore - a.averageOverallScore;
      }
      return b.totalInterviews - a.totalInterviews;
    });
}
