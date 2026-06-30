/**
 * Questions router for the Mock Interview MVP (Requirement 2.2).
 *
 * Exposes:
 *   - GET /questions — returns the 10 fixed, code-seeded interview questions to
 *     any authenticated user.
 *
 * Questions are immutable constants (see `questions.ts`); there is deliberately
 * no create/edit/delete interface (Requirement 2.3). This router is mounted
 * behind `requireAuth` in `createApp`, so it is reachable only with a valid JWT.
 */

import { Router, type Request, type Response } from 'express';
import { QUESTIONS } from './questions';

/** Builds the questions router (mounted at `/questions`). */
export function createQuestionsRouter(): Router {
  const router = Router();

  // GET /questions — return all 10 seeded questions (Req 2.2).
  router.get('/', (_req: Request, res: Response) => {
    res.status(200).json({ questions: QUESTIONS });
  });

  return router;
}
