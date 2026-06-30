/**
 * Leaderboard router for the Mock Interview MVP (Requirements 7.1, 7.2, 7.3).
 *
 * Endpoint (mounted behind `requireAuth` in `createApp`):
 *   - GET /leaderboard  (any authenticated user) — gathers each student's
 *     evaluated Submission Overall_Scores in chronological order, then ranks
 *     students by their Overall Rating via the shared pure `rankByOverallRating`
 *     helper. Ranks (1-based) are assigned after sorting and used to derive each
 *     student's badges via `computeBadges`.
 *
 * Ranking order (descending): Overall Rating, then higher average overall
 * score, then greater number of interviews. Students with no evaluated
 * submissions are excluded by `rankByOverallRating`.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from './prisma';
import { rankByOverallRating, type StudentRatingInput } from './rating';
import { computeBadges } from './stats';
import type { LeaderboardRatingRow } from './types';

/** Builds the leaderboard router (mounted at `/leaderboard`). */
export function createLeaderboardRouter(): Router {
  const router = Router();

  // GET /leaderboard — ranked students by Overall Rating (Req 7.1–7.3).
  router.get('/', async (_req: Request, res: Response) => {
    try {
      // Join students with their evaluated submissions, oldest first so the
      // overall scores are already in chronological order for improvement.
      const students = await prisma.user.findMany({
        where: { role: 'student' },
        include: {
          submissions: {
            where: { status: 'evaluated' },
            orderBy: { createdAt: 'asc' },
            include: { evaluation: true },
          },
        },
      });

      const inputs: StudentRatingInput[] = students.map((student) => ({
        studentId: student.id,
        name: student.name,
        scoresChrono: student.submissions
          .map((submission) => submission.evaluation?.overallScore)
          .filter((score): score is number => typeof score === 'number'),
      }));

      // Rank with the pure helper, then assign 1-based ranks and derive badges.
      const ranked = rankByOverallRating(inputs);

      const leaderboard: LeaderboardRatingRow[] = ranked.map((row, index) => {
        const rank = index + 1;
        return {
          studentId: row.studentId,
          name: row.name,
          overallRating: row.overallRating,
          averageOverallScore: row.averageOverallScore,
          bestScore: row.bestScore,
          totalInterviews: row.totalInterviews,
          improvementTrend: row.improvementTrend,
          badges: computeBadges({
            totalEvaluated: row.totalInterviews,
            averageOverallScore: row.averageOverallScore,
            bestScore: row.bestScore,
            rank,
          }),
        };
      });

      return res.status(200).json({ leaderboard });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to build leaderboard:', err);
      return res.status(500).json({ error: 'Failed to build leaderboard.' });
    }
  });

  return router;
}
