/**
 * Shared domain types for the Mock Interview MVP backend.
 *
 * These types describe the shapes consumed by the pure logic core
 * (`scoreSubmission`, `rankLeaderboard`, `validateEvaluation`) and the routers
 * layered on top of it in later tasks.
 */

import type { Question, SoftSkillParameter } from './questions';
import type { BadgeType } from './stats';
import type { ImprovementTrend } from './rating';

// Re-export the question types so consumers have a single types entrypoint.
export type { Question, SoftSkillParameter };

/** Role attached to a user account and carried in the JWT `role` claim. */
export type Role = 'student' | 'teacher';

/** Lifecycle state of a Submission (Submission_Status). */
export type SubmissionStatus = 'pending' | 'evaluated';

/**
 * One student's evaluated overall scores, the input row for the leaderboard
 * ranking (see `rankLeaderboard`).
 */
export interface StudentEvaluated {
  studentId: string;
  name: string;
  /** Overall scores (0–100) of that student's evaluated Submissions. */
  overallScores: number[];
}

/** One ranked row returned by the leaderboard (Average_Overall_Score per student). */
export interface LeaderboardRow {
  studentId: string;
  name: string;
  /** Mean of the student's evaluated overall scores. */
  averageOverallScore: number;
  /**
   * Achievement badges earned by the student, attached by the leaderboard
   * router after ranking. Optional so the pure `rankLeaderboard` (which does
   * not know about ranks) can omit it.
   */
  badges?: BadgeType[];
}

/**
 * One ranked row returned by the upgraded leaderboard, ordered by Overall
 * Rating. Built by the leaderboard router from the shared `rankByOverallRating`
 * helper plus `computeBadges` (rank-dependent), so it is not produced by the
 * legacy pure `rankLeaderboard` function.
 */
export interface LeaderboardRatingRow {
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
  /** Coarse improvement trend label ('up' | 'down' | 'steady'). */
  improvementTrend: ImprovementTrend;
  /** Achievement badges earned by the student, computed from the 1-based rank. */
  badges: BadgeType[];
}

/**
 * The 8 soft-skill parameter scores, keyed by parameter name. Each value is
 * expected to be an integer in [1, 10]; validation is enforced by
 * `validateEvaluation` (Task 4).
 */
export type ParameterScores = Record<SoftSkillParameter, number>;

/**
 * The raw payload a Teacher submits to evaluate a Submission (Requirement 4.3).
 * Fields are intentionally loosely typed (`unknown`) at the boundary so the
 * validator can reject malformed input (wrong count, non-integer, out-of-range,
 * missing feedback) rather than trusting the client.
 */
export interface EvaluationPayload {
  /** Map of the 8 soft-skill parameters to their scores (1–10). */
  scores: Partial<Record<SoftSkillParameter, unknown>>;
  /** Written overall feedback; must be non-empty. */
  overallFeedback: unknown;
}
