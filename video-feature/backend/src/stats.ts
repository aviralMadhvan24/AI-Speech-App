/**
 * Pure logic core for the Mock Interview MVP student statistics and badges.
 *
 * Like `scoring.ts`, these functions are intentionally free of any I/O (no DB,
 * file, or network access) so they can be exhaustively property-tested in
 * isolation and reused by the dashboard and leaderboard routers layered on top
 * of them.
 *
 * - `studentStats`  aggregates a student's evaluated overall scores into
 *                   average / best / worst / count summary figures.
 * - `computeBadges` derives the set of earned achievement badges from a
 *                   student's aggregate stats and leaderboard rank.
 */

import { SOFT_SKILL_PARAMETERS, type SoftSkillParameter } from './questions';

/** Summary statistics over a student's evaluated overall scores. */
export interface StudentStats {
  /** Mean of the evaluated overall scores (not rounded), or null when none. */
  averageOverallScore: number | null;
  /** Highest evaluated overall score, or null when none. */
  bestScore: number | null;
  /** Lowest evaluated overall score, or null when none. */
  worstScore: number | null;
  /** Count of evaluated submissions contributing to the stats. */
  totalEvaluated: number;
}

/**
 * The achievement badges a student can earn. The union order is significant and
 * defines the stable order in which `computeBadges` returns earned badges.
 */
export type BadgeType =
  | 'first_answer'
  | 'high_scorer'
  | 'consistent_performer'
  | 'top_performer';

/** Stable, union-ordered list of all badge types. */
const BADGE_ORDER: readonly BadgeType[] = [
  'first_answer',
  'high_scorer',
  'consistent_performer',
  'top_performer',
] as const;

/** Friendly, user-facing labels for each badge type. */
export const BADGE_LABELS: Record<BadgeType, string> = {
  first_answer: 'First Answer',
  high_scorer: 'High Scorer',
  consistent_performer: 'Consistent Performer',
  top_performer: 'Top Performer',
};

/**
 * Aggregate a student's evaluated overall scores into summary statistics.
 *
 * When the list is empty, the score figures are `null` and `totalEvaluated` is
 * 0. Otherwise `averageOverallScore` is the (unrounded) mean, `bestScore` is
 * the maximum, and `worstScore` is the minimum.
 *
 * @param overallScores The student's evaluated Overall_Scores.
 * @returns The aggregate statistics for the student.
 */
export function studentStats(overallScores: number[]): StudentStats {
  if (overallScores.length === 0) {
    return {
      averageOverallScore: null,
      bestScore: null,
      worstScore: null,
      totalEvaluated: 0,
    };
  }

  const sum = overallScores.reduce((acc, score) => acc + score, 0);

  return {
    averageOverallScore: sum / overallScores.length,
    bestScore: Math.max(...overallScores),
    worstScore: Math.min(...overallScores),
    totalEvaluated: overallScores.length,
  };
}

/** Inputs to `computeBadges`: a student's aggregate stats plus their rank. */
export interface BadgeInput {
  /** Count of the student's evaluated submissions. */
  totalEvaluated: number;
  /** Mean of the student's evaluated overall scores, or null when none. */
  averageOverallScore: number | null;
  /** Highest evaluated overall score, or null when none. */
  bestScore: number | null;
  /** The student's 1-based leaderboard rank, or null if unranked. */
  rank: number | null;
}

/**
 * Derive the set of earned badges from a student's aggregate stats and rank.
 *
 * Rules (each evaluated independently):
 *   - `first_answer`         — totalEvaluated >= 1
 *   - `high_scorer`          — bestScore !== null && bestScore >= 85
 *   - `consistent_performer` — totalEvaluated >= 3 && averageOverallScore !== null
 *                              && averageOverallScore >= 70
 *   - `top_performer`        — rank !== null && rank <= 3
 *
 * Earned badges are returned in the stable union order (see `BADGE_ORDER`).
 *
 * @param input The student's aggregate stats and 1-based rank.
 * @returns The earned badges, in stable union order.
 */
export function computeBadges(input: BadgeInput): BadgeType[] {
  const earned: Record<BadgeType, boolean> = {
    first_answer: input.totalEvaluated >= 1,
    high_scorer: input.bestScore !== null && input.bestScore >= 85,
    consistent_performer:
      input.totalEvaluated >= 3 &&
      input.averageOverallScore !== null &&
      input.averageOverallScore >= 70,
    top_performer: input.rank !== null && input.rank <= 3,
  };

  return BADGE_ORDER.filter((badge) => earned[badge]);
}

/**
 * Compute the mean of each of the 8 soft-skill parameters across evaluations.
 *
 * Each input row is one evaluation's parameter scores (keyed by the 8 canonical
 * parameter names). The result maps every parameter to the mean of its values
 * across all rows. When the input is empty there are no values to average, so
 * every parameter is reported as 0 (documented sensible default).
 *
 * @param evaluations One row of 8 parameter scores per evaluation.
 * @returns A record mapping each parameter to its mean across evaluations (0 when empty).
 */
export function parameterAverages(
  evaluations: Array<Record<SoftSkillParameter, number>>,
): Record<SoftSkillParameter, number> {
  const averages = {} as Record<SoftSkillParameter, number>;

  for (const parameter of SOFT_SKILL_PARAMETERS) {
    if (evaluations.length === 0) {
      averages[parameter] = 0;
      continue;
    }
    const sum = evaluations.reduce((acc, evaluation) => acc + evaluation[parameter], 0);
    averages[parameter] = sum / evaluations.length;
  }

  return averages;
}

/** A student's strongest and weakest soft-skill parameters. */
export interface StrengthsAndWeaknesses {
  /** The 2 highest-averaging parameters (strongest first). */
  strengths: SoftSkillParameter[];
  /** The 2 lowest-averaging parameters (weakest first). */
  weakAreas: SoftSkillParameter[];
}

/**
 * Derive the top-2 strengths and bottom-2 weak areas from parameter averages.
 *
 * Parameters are ranked by their average. Ties are broken stably by the
 * canonical parameter order (`SOFT_SKILL_PARAMETERS`), so equal averages always
 * resolve deterministically. `strengths` holds the 2 highest-averaging
 * parameters (highest first) and `weakAreas` holds the 2 lowest-averaging
 * parameters (lowest first).
 *
 * @param averages A record mapping each parameter to its average score.
 * @returns The top-2 strengths and bottom-2 weak areas.
 */
export function strengthsAndWeaknesses(
  averages: Record<SoftSkillParameter, number>,
): StrengthsAndWeaknesses {
  // Index each parameter by its canonical order for a stable tie-break.
  const order = new Map<SoftSkillParameter, number>(
    SOFT_SKILL_PARAMETERS.map((parameter, index) => [parameter, index]),
  );

  const params = [...SOFT_SKILL_PARAMETERS];

  // Descending by average; ties resolve to the earlier canonical order.
  const byHighest = [...params].sort((a, b) => {
    const diff = averages[b] - averages[a];
    return diff !== 0 ? diff : order.get(a)! - order.get(b)!;
  });

  // Ascending by average; ties resolve to the earlier canonical order.
  const byLowest = [...params].sort((a, b) => {
    const diff = averages[a] - averages[b];
    return diff !== 0 ? diff : order.get(a)! - order.get(b)!;
  });

  return {
    strengths: byHighest.slice(0, 2),
    weakAreas: byLowest.slice(0, 2),
  };
}
