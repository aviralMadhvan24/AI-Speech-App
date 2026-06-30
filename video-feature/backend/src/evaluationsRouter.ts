/**
 * Evaluations router for the Mock Interview MVP
 * (Requirements 4.3, 4.4, 4.5, 5.1).
 *
 * Endpoint (mounted behind `requireAuth` in `createApp`):
 *   - POST /submissions/:id/evaluation  (teacher) — validates the submitted
 *     8 parameter scores + feedback via `validateEvaluation`, computes the
 *     Overall_Score via `scoreSubmission`, persists a single Evaluation linked
 *     to the Submission and the authenticated Teacher, and flips the
 *     Submission_Status to `evaluated` (Req 4.5, 5.1).
 *
 * Error handling (per the design's Error Handling table):
 *   - Invalid evaluation payload          → 400 with `{ error, details }` (Req 4.4)
 *   - Evaluating a non-existent submission → 404
 *   - Evaluating an already-evaluated one  → 409
 *
 * The Evaluation create + Submission status update run inside a single
 * transaction so the two writes are atomic (no half-evaluated state).
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from './prisma';
import { requireRole } from './authMiddleware';
import { validateEvaluation } from './validateEvaluation';
import { scoreSubmission } from './scoring';
import { SOFT_SKILL_PARAMETERS } from './questions';

/** Builds the evaluations router (mounted at `/submissions`). */
export function createEvaluationsRouter(): Router {
  const router = Router();

  // POST /submissions/:id/evaluation — teacher submits an evaluation (Req 4.3–4.5, 5.1).
  router.post('/:id/evaluation', requireRole('teacher'), async (req: Request, res: Response) => {
    const teacherId = req.user!.id;
    const submissionId = req.params.id;

    // Validate the untrusted payload first (Req 4.3, 4.4). On failure, surface
    // the structured details so the frontend can show field-level messages.
    const result = validateEvaluation(req.body);
    if (!result.ok) {
      return res.status(400).json({ error: result.error, details: result.details });
    }

    const { scores, overallFeedback } = result.value;

    // Convert the named score map to the canonical ordered array the pure
    // scoring function expects (SOFT_SKILL_PARAMETERS order), then compute the
    // single Overall_Score (Req 5.1).
    const orderedScores = SOFT_SKILL_PARAMETERS.map((parameter) => scores[parameter]);
    const overallScore = scoreSubmission(orderedScores);

    try {
      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: { evaluation: true },
      });

      // Reject evaluating a submission that does not exist (404).
      if (!submission) {
        return res.status(404).json({ error: 'Submission not found.' });
      }

      // Reject re-evaluating an already-evaluated submission (409).
      if (submission.status === 'evaluated' || submission.evaluation) {
        return res.status(409).json({ error: 'Submission has already been evaluated.' });
      }

      // Persist the evaluation and flip the submission status atomically so the
      // two writes never diverge.
      const [evaluation] = await prisma.$transaction([
        prisma.evaluation.create({
          data: {
            submissionId,
            teacherId,
            confidence: scores.confidence,
            communication: scores.communication,
            fluency: scores.fluency,
            clarity: scores.clarity,
            vocabularyGrammar: scores.vocabularyGrammar,
            bodyLanguage: scores.bodyLanguage,
            eyeContact: scores.eyeContact,
            professionalism: scores.professionalism,
            overallScore,
            overallFeedback,
          },
        }),
        prisma.submission.update({
          where: { id: submissionId },
          data: { status: 'evaluated' },
        }),
      ]);

      return res.status(201).json({
        id: evaluation.id,
        submissionId: evaluation.submissionId,
        teacherId: evaluation.teacherId,
        overallScore: evaluation.overallScore,
        overallFeedback: evaluation.overallFeedback,
        createdAt: evaluation.createdAt,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to create evaluation:', err);
      return res.status(500).json({ error: 'Failed to create evaluation.' });
    }
  });

  return router;
}
