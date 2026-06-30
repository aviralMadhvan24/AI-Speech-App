/**
 * Pure analytics logic for the Mock Interview MVP dashboard polish features.
 *
 * Like `scoring.ts`, `stats.ts`, and `rating.ts`, these functions are
 * intentionally free of any I/O (no DB, file, or network access) so they can be
 * exhaustively property-tested in isolation and reused by the dashboard routers
 * layered on top of them.
 *
 *   - `skillTrend`             — per-parameter earlier/later split deltas plus
 *                                the most-improved and weakest parameters.
 *   - `improvementSuggestions` — friendly, actionable tips for weak parameters.
 *   - `scoreDistribution`      — bucket 0–100 scores into fixed display bands.
 */

import { SOFT_SKILL_PARAMETERS, type SoftSkillParameter } from './questions';

/** Arithmetic mean of a list of numbers; an empty list averages to 0. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** One parameter's earlier/later split averages and their delta. */
export interface ParameterTrend {
  /** The soft-skill parameter this row describes. */
  parameter: SoftSkillParameter;
  /** Mean of the parameter's scores over the earlier half of evaluations. */
  earlierAvg: number;
  /** Mean of the parameter's scores over the later half of evaluations. */
  laterAvg: number;
  /** `laterAvg - earlierAvg`: positive means the parameter improved over time. */
  delta: number;
}

/** Per-parameter trend rows plus the most-improved and weakest parameters. */
export interface SkillTrend {
  /** One trend row per soft-skill parameter, in canonical order. */
  perParameter: ParameterTrend[];
  /** Parameter with the highest positive delta, or null when none qualifies. */
  mostImproved: SoftSkillParameter | null;
  /** Parameter with the lowest overall average, or null when no evaluations. */
  weakest: SoftSkillParameter | null;
}

/**
 * Compute per-parameter improvement trends from chronological evaluations.
 *
 * Each input row is one evaluation's 8 soft-skill parameter scores, ordered
 * oldest-first. For every parameter the chronologically ordered scores are
 * partitioned into an earlier half and a later half; when the count is odd, the
 * middle element joins the LATER half (the same split rule as `rating.ts`). The
 * delta is `mean(laterHalf) - mean(earlierHalf)`.
 *
 * `mostImproved` is the parameter with the highest positive delta, or null when
 * there are fewer than 2 evaluations or no parameter has a positive delta.
 * `weakest` is the parameter with the lowest overall average across all
 * evaluations, or null when there are no evaluations. Both resolve ties stably
 * by the canonical `SOFT_SKILL_PARAMETERS` order.
 *
 * When the input is empty every per-parameter row is all-zeros and both
 * `mostImproved` and `weakest` are null.
 *
 * @param evaluationsChrono One row of 8 parameter scores per evaluation, oldest first.
 * @returns The per-parameter trends plus the most-improved and weakest parameters.
 */
export function skillTrend(
  evaluationsChrono: Array<Record<SoftSkillParameter, number>>,
): SkillTrend {
  // Middle element joins the later half on odd counts, so the split point is
  // the floor of half the length (matching `improvementScore` in rating.ts).
  const splitIndex = Math.floor(evaluationsChrono.length / 2);

  // Index each parameter by its canonical order for a stable tie-break.
  const order = new Map<SoftSkillParameter, number>(
    SOFT_SKILL_PARAMETERS.map((parameter, index) => [parameter, index]),
  );

  const overallAverages = {} as Record<SoftSkillParameter, number>;

  const perParameter: ParameterTrend[] = SOFT_SKILL_PARAMETERS.map((parameter) => {
    const series = evaluationsChrono.map((evaluation) => evaluation[parameter]);
    const earlierAvg = mean(series.slice(0, splitIndex));
    const laterAvg = mean(series.slice(splitIndex));
    overallAverages[parameter] = mean(series);
    return { parameter, earlierAvg, laterAvg, delta: laterAvg - earlierAvg };
  });

  // Most improved: highest positive delta, requires at least 2 evaluations.
  let mostImproved: SoftSkillParameter | null = null;
  if (evaluationsChrono.length >= 2) {
    for (const row of perParameter) {
      if (row.delta <= 0) continue;
      if (
        mostImproved === null ||
        row.delta > deltaOf(perParameter, mostImproved) ||
        (row.delta === deltaOf(perParameter, mostImproved) &&
          order.get(row.parameter)! < order.get(mostImproved)!)
      ) {
        mostImproved = row.parameter;
      }
    }
  }

  // Weakest: lowest overall average, requires at least 1 evaluation.
  let weakest: SoftSkillParameter | null = null;
  if (evaluationsChrono.length >= 1) {
    weakest = SOFT_SKILL_PARAMETERS[0];
    for (const parameter of SOFT_SKILL_PARAMETERS) {
      if (overallAverages[parameter] < overallAverages[weakest]) {
        weakest = parameter;
      }
    }
  }

  return { perParameter, mostImproved, weakest };
}

/** Look up the delta of a parameter within a computed trend list. */
function deltaOf(rows: ParameterTrend[], parameter: SoftSkillParameter): number {
  return rows.find((row) => row.parameter === parameter)!.delta;
}

/**
 * Friendly, actionable tip for each of the 8 soft-skill parameters. One helpful
 * sentence per parameter, surfaced to students for their weak areas.
 */
export const SUGGESTIONS: Record<SoftSkillParameter, string> = {
  confidence:
    'Practice answering aloud beforehand so you can speak with steady, assured delivery.',
  communication:
    'Structure each answer with a clear beginning, middle, and end so your points are easy to follow.',
  fluency:
    'Slow down slightly and pause to breathe instead of rushing, which keeps your speech smooth.',
  clarity:
    'Lead with your main point first, then add supporting detail so your message stays clear.',
  vocabularyGrammar:
    'Read widely and review common phrasing to broaden your vocabulary and tighten your grammar.',
  bodyLanguage:
    'Sit upright with open shoulders and use natural hand gestures to look engaged and at ease.',
  eyeContact:
    'Look directly at the camera lens instead of the screen to build eye contact.',
  professionalism:
    'Dress the part, greet the interviewer warmly, and keep your tone courteous throughout.',
};

/**
 * Map each weak-area parameter to its concrete improvement tip.
 *
 * Tips are returned in the same order as the provided `weakAreas`, one tip per
 * parameter, drawn from the `SUGGESTIONS` constant.
 *
 * @param weakAreas The parameters a student should focus on improving.
 * @returns One friendly tip per weak area, in the given order.
 */
export function improvementSuggestions(weakAreas: SoftSkillParameter[]): string[] {
  return weakAreas.map((parameter) => SUGGESTIONS[parameter]);
}

/** One score band and how many scores fell into it. */
export interface ScoreBand {
  /** The band label (e.g. '0-49', '90-100'). */
  band: string;
  /** Count of scores that landed in this band. */
  count: number;
}

/** The fixed display bands, in order. The final band is inclusive of 100. */
const SCORE_BANDS: ReadonlyArray<{ band: string; min: number; max: number }> = [
  { band: '0-49', min: 0, max: 49 },
  { band: '50-59', min: 50, max: 59 },
  { band: '60-69', min: 60, max: 69 },
  { band: '70-79', min: 70, max: 79 },
  { band: '80-89', min: 80, max: 89 },
  { band: '90-100', min: 90, max: 100 },
] as const;

/**
 * Bucket 0–100 overall scores into the six fixed display bands.
 *
 * All six bands are always returned in order, with a count of 0 when no score
 * falls in them. Band boundaries are inclusive on both ends within each band;
 * the final `90-100` band includes a perfect score of 100. Scores are assigned
 * to exactly one band, so the band counts always sum to the input length.
 *
 * @param scores Evaluated overall scores (expected to be within 0–100).
 * @returns The six bands in order, each with its count.
 */
export function scoreDistribution(scores: number[]): ScoreBand[] {
  const counts = SCORE_BANDS.map(() => 0);

  for (const score of scores) {
    const index = SCORE_BANDS.findIndex(({ min, max }) => score >= min && score <= max);
    if (index !== -1) counts[index] += 1;
  }

  return SCORE_BANDS.map(({ band }, index) => ({ band, count: counts[index] }));
}
