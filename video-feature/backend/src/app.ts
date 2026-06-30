import express, { type Express, type Request, type Response } from 'express';
import { createAuthRouter } from './auth';
import { createQuestionsRouter } from './questionsRouter';
import { createSubmissionsRouter } from './submissionsRouter';
import { createEvaluationsRouter } from './evaluationsRouter';
import { createLeaderboardRouter } from './leaderboardRouter';
import { createStudentDashboardRouter, createTeacherDashboardRouter } from './dashboardRouter';
import { requireAuth } from './authMiddleware';
import { LocalVideoStore } from './videoStore';

/**
 * Builds the Express application.
 *
 * The auth router (register/login) is public; the questions and submissions
 * routers are mounted behind `requireAuth`. Per-route role guards
 * (`requireRole`) live inside the submissions router. The remaining routers
 * (evaluations, leaderboard) are mounted in later tasks.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Single shared video store injected into the submissions router so the
  // storage backend can be swapped without touching route logic.
  const videoStore = new LocalVideoStore();

  // Health check — confirms the backend is up (Task 1).
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'mock-interview-mvp', timestamp: new Date().toISOString() });
  });

  // Auth: register + login (Task 6.1, Requirements 1.1–1.4).
  app.use('/auth', createAuthRouter());

  // Questions: any authenticated user (Task 7.1, Requirement 2.2).
  app.use('/questions', requireAuth, createQuestionsRouter());

  // Submissions: upload/list/playback (Task 7.2, Requirements 3.4–3.6, 4.1, 4.2, 6.1, 6.3).
  app.use('/submissions', requireAuth, createSubmissionsRouter(videoStore));

  // Evaluations: teacher submits an evaluation for a submission
  // (Task 8.1, Requirements 4.3–4.5, 5.1). Mounted at /submissions alongside the
  // submissions router; the teacher role guard lives inside the router.
  app.use('/submissions', requireAuth, createEvaluationsRouter());

  // Leaderboard: ranked students by average overall score
  // (Task 8.2, Requirements 7.1–7.3). Any authenticated user.
  app.use('/leaderboard', requireAuth, createLeaderboardRouter());

  // Student dashboard: the signed-in student's stats, rank, badges, and
  // progress timeline. The student role guard lives inside the router.
  app.use('/students', requireAuth, createStudentDashboardRouter());

  // Teacher dashboard: pending/completed review counts for the signed-in
  // teacher. The teacher role guard lives inside the router.
  app.use('/teacher', requireAuth, createTeacherDashboardRouter());

  return app;
}
