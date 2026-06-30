/**
 * Pure logic core for the Mock Interview MVP scoring and leaderboard.
 *
 * These functions are intentionally free of any I/O (no DB, file, or network
 * access) so they can be exhaustively property-tested in isolation and reused
 * by the evaluation and leaderboard routers layered on top of them.
 *
 * - `scoreSubmission` computes the single Overall_Score for one Submission.
 * - `rankLeaderboard` produces the college-wide ranking of Students.
 */

import type { LeaderboardRow, StudentEvaluated } from './types';

/**
 * Compute the Overall_Score for a single Submission (Requirements 5.1, 5.2).
 *
 * The score is the mean of the 8 Parameter_Scores multiplied by 10, rounded to
 * the nearest integer. For valid inputs (exactly 8 integers in [1, 10]) the
 * result lands in [10, 100]; the documented overall range is [0, 100].
 *
 * @param scores Exactly 8 soft-skill Parameter_Scores, each an integer in [1, 10].
 * @returns The rounded Overall_Score in the inclusive range 0–100.
 */
export function scoreSubmission(scores: number[]): number {
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(mean * 10);
}

/**
 * Rank Students for the college-wide Leaderboard (Requirements 7.1, 7.2, 7.3).
 *
 * For each Student with at least one evaluated Submission, the
 * Average_Overall_Score is the mean of that Student's evaluated Overall_Scores.
 * Students with no evaluated Submissions are excluded, and the resulting rows
 * are ordered from highest to lowest Average_Overall_Score.
 *
 * @param students The per-student evaluated overall scores.
 * @returns Ranked leaderboard rows, descending by Average_Overall_Score.
 */
export function rankLeaderboard(students: StudentEvaluated[]): LeaderboardRow[] {
  return students
    .filter((student) => student.overallScores.length > 0)
    .map((student) => ({
      studentId: student.studentId,
      name: student.name,
      averageOverallScore:
        student.overallScores.reduce((sum, score) => sum + score, 0) /
        student.overallScores.length,
    }))
    .sort((a, b) => b.averageOverallScore - a.averageOverallScore);
}
