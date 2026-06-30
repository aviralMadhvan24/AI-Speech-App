/**
 * Submissions router for the Mock Interview MVP
 * (Requirements 3.4, 3.5, 3.6, 4.1, 4.2, 6.1, 6.3).
 *
 * Endpoints (all mounted behind `requireAuth` in `createApp`):
 *   - POST   /submissions            (student) multipart video upload; saves the
 *                                     video via the injected `VideoStore` and
 *                                     creates a `pending` Submission linked to
 *                                     the authenticated student and the chosen
 *                                     question (Req 3.4, 3.5).
 *   - GET    /submissions/mine        (student) the student's own submissions
 *                                     with status and, when evaluated, the
 *                                     overall score + feedback (Req 6.1, 6.3).
 *   - GET    /submissions/pending     (teacher) all `pending` submissions
 *                                     awaiting review (Req 4.1).
 *   - GET    /submissions/:id/video   (any authenticated user) streams the
 *                                     stored video for playback (Req 4.2).
 *
 * The router talks to storage only through the `VideoStore` interface, so the
 * filesystem backend can be swapped (e.g. S3) without touching route logic.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { prisma } from './prisma';
import { QUESTIONS } from './questions';
import { requireRole } from './authMiddleware';
import type { VideoStore } from './videoStore';

/**
 * Map of stored-video file extensions to MIME types for the playback route.
 * Browser `MediaRecorder` uploads are typically WebM; a small map keeps the
 * served `Content-Type` accurate without pulling in a mime dependency.
 */
const VIDEO_CONTENT_TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
};

/** Resolve a Content-Type from a stored video path, defaulting to WebM. */
function contentTypeFor(storedPath: string): string {
  const ext = path.extname(storedPath).toLowerCase();
  return VIDEO_CONTENT_TYPES[ext] ?? 'video/webm';
}

/** Shape returned to clients for a single submission. */
function toSubmissionDto(submission: {
  id: string;
  studentId: string;
  questionId: number;
  status: string;
  createdAt: Date;
  evaluation?: { overallScore: number; overallFeedback: string } | null;
}) {
  return {
    id: submission.id,
    studentId: submission.studentId,
    questionId: submission.questionId,
    status: submission.status,
    createdAt: submission.createdAt,
    // Only surface the score/feedback once the submission is evaluated (Req 6.3).
    overallScore: submission.evaluation?.overallScore ?? null,
    overallFeedback: submission.evaluation?.overallFeedback ?? null,
  };
}

/**
 * Builds the submissions router (mounted at `/submissions`).
 *
 * @param videoStore Storage boundary used to persist and stream videos.
 */
export function createSubmissionsRouter(videoStore: VideoStore): Router {
  const router = Router();

  // In-memory multipart parsing; the buffer is handed straight to VideoStore.
  const upload = multer({ storage: multer.memoryStorage() });

  // POST /submissions — upload a video and create a pending submission (Req 3.4, 3.5).
  router.post(
    '/',
    requireRole('student'),
    upload.single('video'),
    async (req: Request, res: Response) => {
      const studentId = req.user!.id;

      // Validate the question against the seeded list (Req 2.x / 400 on unknown).
      const questionId = Number(req.body?.questionId);
      if (!Number.isInteger(questionId) || !QUESTIONS.some((q) => q.id === questionId)) {
        return res.status(400).json({ error: 'A valid, known questionId is required.' });
      }

      // A video file is mandatory (400 if missing).
      if (!req.file) {
        return res.status(400).json({ error: 'A video file is required.' });
      }

      try {
        const videoPath = await videoStore.save({
          originalname: req.file.originalname,
          buffer: req.file.buffer,
        });

        const submission = await prisma.submission.create({
          data: { studentId, questionId, videoPath, status: 'pending' },
        });

        return res.status(201).json(toSubmissionDto(submission));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to create submission:', err);
        return res.status(500).json({ error: 'Failed to create submission.' });
      }
    },
  );

  // GET /submissions/mine — the student's own submissions + statuses (Req 6.1, 6.3).
  router.get('/mine', requireRole('student'), async (req: Request, res: Response) => {
    try {
      const submissions = await prisma.submission.findMany({
        where: { studentId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        include: { evaluation: true },
      });
      return res.status(200).json({ submissions: submissions.map(toSubmissionDto) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to list submissions:', err);
      return res.status(500).json({ error: 'Failed to list submissions.' });
    }
  });

  // GET /submissions/pending — all pending submissions for teachers (Req 4.1).
  router.get('/pending', requireRole('teacher'), async (_req: Request, res: Response) => {
    try {
      const submissions = await prisma.submission.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });
      return res.status(200).json({ submissions: submissions.map(toSubmissionDto) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to list pending submissions:', err);
      return res.status(500).json({ error: 'Failed to list pending submissions.' });
    }
  });

  // GET /submissions/:id/video — stream the stored video for playback (Req 4.2).
  router.get('/:id/video', async (req: Request, res: Response) => {
    let submission;
    try {
      submission = await prisma.submission.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to load submission for playback:', err);
      return res.status(500).json({ error: 'Failed to load submission.' });
    }

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    res.setHeader('Content-Type', contentTypeFor(submission.videoPath));

    const stream = videoStore.getStream(submission.videoPath);
    stream.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to stream video:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream video.' });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  });

  return router;
}
