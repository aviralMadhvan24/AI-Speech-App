/**
 * Dashboard routers for the Mock Interview MVP (polish features).
 *
 * Two role-scoped routers layer the pure stats/badge logic (`stats.ts`) and the
 * pure rating/ranking logic (`rating.ts`) over the database:
 *
 *   - `createStudentDashboardRouter` →
 *       GET /students/me/dashboard  (student) — the signed-in student's
 *       aggregate performance: rank (by Overall Rating, matching the
 *       leaderboard), score summary, overall rating + consistency + improvement,
 *       strengths/weak areas, category-wise performance, earned badges, and a
 *       chronological score timeline for the progress chart.
 *
 *   - `createTeacherDashboardRouter` →
 *       GET /teacher/dashboard  (teacher) — review workload counts plus
 *       platform-wide insights: average score, top students, and weak students.
 *
 * Per-route role guards (`requireRole`) live inside each router; both are
 * mounted behind `requireAuth` in `createApp`.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from './prisma';
import { requireRole } from './authMiddleware';
import {
  rankByOverallRating,
  consistencyScore,
  improvementScore,
  overallRating,
  improvementTrend,
  type StudentRatingInput,
} from './rating';
import {
  computeBadges,
  studentStats,
  parameterAverages,
  strengthsAndWeaknesses,
} from './stats';
import { skillTrend, improvementSuggestions, scoreDistribution } from './analytics';
import {
  getQuestionById,
  QUESTIONS,
  SOFT_SKILL_PARAMETERS,
  type SoftSkillParameter,
} from './questions';

/**
 * Builds the student dashboard router (mounted at `/students`).
 *
 * GET /students/me/dashboard returns the signed-in student's aggregate
 * performance, reusing the pure `studentStats`, `computeBadges`, the rating
 * functions, and the shared `rankByOverallRating` helper.
 */
export function createStudentDashboardRouter(): Router {
  const router = Router();

  router.get('/me/dashboard', requireRole('student'), handleStudentDashboard);

  return router;
}

/**
 * Core student-dashboard logic: load this student's submissions (with their
 * evaluation), aggregate the evaluated overall scores, compute the student's
 * rating metrics, rank (matching the leaderboard via `rankByOverallRating`),
 * strengths/weak areas, category-wise performance, badges, and a chronological
 * score timeline.
 */
async function handleStudentDashboard(req: Request, res: Response): Promise<Response> {
  const studentId = req.user!.id;

  try {
    // The signed-in student's submissions, oldest first so the timeline and the
    // improvement computation are already in ascending createdAt order.
    const submissions = await prisma.submission.findMany({
      where: { studentId },
      orderBy: { createdAt: 'asc' },
      include: { evaluation: true },
    });

    const totalSubmissions = submissions.length;

    // Evaluated submissions contribute their overall score to the stats and the
    // progress timeline.
    const evaluated = submissions.filter(
      (s): s is typeof s & { evaluation: NonNullable<typeof s.evaluation> } =>
        s.evaluation !== null && typeof s.evaluation.overallScore === 'number',
    );

    const overallScores = evaluated.map((s) => s.evaluation.overallScore);
    const stats = studentStats(overallScores);

    const timeline = evaluated.map((s) => ({
      date: s.createdAt.toISOString(),
      score: s.evaluation.overallScore,
    }));

    // Rating metrics from the student's chronological evaluated scores.
    const consistency = consistencyScore(overallScores);
    const improvement = improvementScore(overallScores);
    const average = stats.averageOverallScore ?? 0;
    const rating = overallScores.length > 0 ? overallRating(average, consistency, improvement) : 0;
    const trend = improvementTrend(improvement);

    // Strengths and weak areas from the per-parameter averages of this
    // student's evaluations.
    const parameterRecords = evaluated.map((s) =>
      buildParameterRecord(s.evaluation),
    );
    const averagesByParameter = parameterAverages(parameterRecords);
    const { strengths, weakAreas } = strengthsAndWeaknesses(averagesByParameter);

    // Per-parameter averages for ALL 8 params (canonical order) for the radar/
    // bar breakdown on the student dashboard.
    const skillBreakdown = SOFT_SKILL_PARAMETERS.map((parameter) => ({
      parameter,
      average: averagesByParameter[parameter],
    }));

    // Earlier/later split trend across this student's chronological evaluations.
    const trendByParameter = skillTrend(parameterRecords);

    // Concrete tips for the student's weak areas.
    const suggestions = improvementSuggestions(weakAreas);

    // Category-wise performance: map each evaluated submission's questionId to
    // its seeded question category and average the overall scores per category.
    const categoryPerformance = buildCategoryPerformance(
      evaluated.map((s) => ({ questionId: s.questionId, score: s.evaluation.overallScore })),
    );

    // Rank this student by the SAME overall-rating ordering as the leaderboard.
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

    const ranked = rankByOverallRating(inputs);
    const totalRanked = ranked.length;
    const rankIndex = ranked.findIndex((row) => row.studentId === studentId);
    const rank = rankIndex === -1 ? null : rankIndex + 1;

    const badges = computeBadges({
      totalEvaluated: stats.totalEvaluated,
      averageOverallScore: stats.averageOverallScore,
      bestScore: stats.bestScore,
      rank,
    });

    return res.status(200).json({
      rank,
      totalRanked,
      averageOverallScore: stats.averageOverallScore,
      bestScore: stats.bestScore,
      worstScore: stats.worstScore,
      totalEvaluated: stats.totalEvaluated,
      totalSubmissions,
      overallRating: stats.totalEvaluated > 0 ? rating : null,
      consistencyScore: stats.totalEvaluated > 0 ? consistency : null,
      improvementScore: stats.totalEvaluated > 0 ? improvement : null,
      improvementTrend: stats.totalEvaluated > 0 ? trend : null,
      strengths,
      weakAreas,
      skillBreakdown,
      skillTrend: trendByParameter,
      improvementSuggestions: suggestions,
      categoryPerformance,
      badges,
      timeline,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to build student dashboard:', err);
    return res.status(500).json({ error: 'Failed to build student dashboard.' });
  }
}

/** Extract the 8 soft-skill parameter scores from an evaluation row. */
function buildParameterRecord(
  evaluation: Record<SoftSkillParameter, number>,
): Record<SoftSkillParameter, number> {
  const record = {} as Record<SoftSkillParameter, number>;
  for (const parameter of SOFT_SKILL_PARAMETERS) {
    record[parameter] = evaluation[parameter];
  }
  return record;
}

/** One category's average overall score across a student's evaluated answers. */
interface CategoryPerformance {
  category: string;
  averageScore: number;
  count: number;
}

/**
 * Group evaluated answers by their question's category and average the overall
 * scores within each category. Categories appear in first-seen order.
 */
function buildCategoryPerformance(
  answers: Array<{ questionId: number; score: number }>,
): CategoryPerformance[] {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const { questionId, score } of answers) {
    const category = getQuestionById(questionId)?.category ?? 'Unknown';
    const bucket = totals.get(category) ?? { sum: 0, count: 0 };
    bucket.sum += score;
    bucket.count += 1;
    totals.set(category, bucket);
  }

  return [...totals.entries()].map(([category, { sum, count }]) => ({
    category,
    averageScore: sum / count,
    count,
  }));
}

/**
 * Builds the teacher dashboard router (mounted at `/teacher`).
 *
 * GET /teacher/dashboard returns the teacher's review workload (pending +
 * completed counts) plus platform-wide insights: the average overall score
 * across all evaluated submissions, the top 3 students, and the bottom 3
 * students by average overall score.
 */
export function createTeacherDashboardRouter(): Router {
  const router = Router();

  // GET /teacher/dashboard — counts + platform-wide insights for this teacher.
  router.get('/dashboard', requireRole('teacher'), async (req: Request, res: Response) => {
    const teacherId = req.user!.id;

    try {
      const [pending, completed, students] = await Promise.all([
        prisma.submission.count({ where: { status: 'pending' } }),
        prisma.evaluation.count({ where: { teacherId } }),
        prisma.user.findMany({
          where: { role: 'student' },
          include: {
            submissions: {
              where: { status: 'evaluated' },
              include: { evaluation: true },
            },
          },
        }),
      ]);

      // Per-student average overall scores (students with >=1 evaluated answer).
      const evaluatedStudents = students
        .map((student) => {
          const scores = student.submissions
            .map((submission) => submission.evaluation?.overallScore)
            .filter((score): score is number => typeof score === 'number');
          return { studentId: student.id, name: student.name, scores };
        })
        .filter((student) => student.scores.length > 0)
        .map((student) => ({
          studentId: student.studentId,
          name: student.name,
          averageOverallScore:
            student.scores.reduce((sum, score) => sum + score, 0) / student.scores.length,
        }));

      // Platform-wide average across ALL evaluated submissions (null if none).
      const allScores = students.flatMap((student) =>
        student.submissions
          .map((submission) => submission.evaluation?.overallScore)
          .filter((score): score is number => typeof score === 'number'),
      );
      const averageScore =
        allScores.length > 0
          ? allScores.reduce((sum, score) => sum + score, 0) / allScores.length
          : null;

      // Top 3 (descending) and bottom 3 (ascending) by average overall score.
      const byHighest = [...evaluatedStudents].sort(
        (a, b) => b.averageOverallScore - a.averageOverallScore,
      );
      const byLowest = [...evaluatedStudents].sort(
        (a, b) => a.averageOverallScore - b.averageOverallScore,
      );

      const topStudents = byHighest.slice(0, 3);
      const weakStudents = byLowest.slice(0, 3);

      // Per-question analytics across ALL evaluated submissions platform-wide.
      // attempts = evaluated submissions for that question; averageScore = mean
      // overall score of those (null when there are none).
      const evaluatedAnswers = students.flatMap((student) =>
        student.submissions
          .filter(
            (submission): submission is typeof submission & {
              evaluation: NonNullable<typeof submission.evaluation>;
            } => typeof submission.evaluation?.overallScore === 'number',
          )
          .map((submission) => ({
            questionId: submission.questionId,
            score: submission.evaluation.overallScore,
          })),
      );

      const answersByQuestion = new Map<number, number[]>();
      for (const { questionId, score } of evaluatedAnswers) {
        const bucket = answersByQuestion.get(questionId) ?? [];
        bucket.push(score);
        answersByQuestion.set(questionId, bucket);
      }

      const questionAnalytics = QUESTIONS.map((question) => {
        const scores = answersByQuestion.get(question.id) ?? [];
        return {
          questionId: question.id,
          prompt: question.prompt,
          category: question.category,
          averageScore:
            scores.length > 0
              ? scores.reduce((sum, score) => sum + score, 0) / scores.length
              : null,
          attempts: scores.length,
        };
      }).sort((a, b) => {
        if (b.attempts !== a.attempts) return b.attempts - a.attempts;
        return a.questionId - b.questionId;
      });

      // Platform-wide distribution of all evaluated overall scores.
      const distribution = scoreDistribution(allScores);

      return res.status(200).json({
        pending,
        completed,
        averageScore,
        topStudents,
        weakStudents,
        questionAnalytics,
        scoreDistribution: distribution,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to build teacher dashboard:', err);
      return res.status(500).json({ error: 'Failed to build teacher dashboard.' });
    }
  });

  // GET /teacher/report.csv — downloadable class report, one row per student
  // with >=1 evaluated submission, sorted by Overall Rating descending.
  router.get('/report.csv', requireRole('teacher'), handleTeacherReportCsv);

  return router;
}

/** A single field's worth of CSV text. */
type CsvCell = string | number;

/**
 * Escape a single CSV field per RFC 4180: wrap in double quotes and double any
 * embedded quotes when the value contains a comma, quote, or newline.
 */
function escapeCsvCell(value: CsvCell): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Join one row of cells into an escaped CSV line. */
function toCsvRow(cells: CsvCell[]): string {
  return cells.map(escapeCsvCell).join(',');
}

/**
 * Build and stream the teacher class report as CSV.
 *
 * Columns: Student Name, Total Interviews, Average Score, Best Score, Overall
 * Rating. Rows reuse the shared `rankByOverallRating` helper (which excludes
 * students with no evaluated submissions and orders by Overall Rating
 * descending), so the report agrees with the leaderboard ordering.
 */
async function handleTeacherReportCsv(req: Request, res: Response): Promise<void> {
  try {
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

    const ranked = rankByOverallRating(inputs);

    const header = ['Student Name', 'Total Interviews', 'Average Score', 'Best Score', 'Overall Rating'];
    const lines = [
      toCsvRow(header),
      ...ranked.map((row) =>
        toCsvRow([
          row.name,
          row.totalInterviews,
          row.averageOverallScore.toFixed(2),
          row.bestScore,
          row.overallRating.toFixed(2),
        ]),
      ),
    ];

    const csv = `${lines.join('\r\n')}\r\n`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="class-report.csv"');
    res.status(200).send(csv);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to build teacher report CSV:', err);
    res.status(500).json({ error: 'Failed to build teacher report.' });
  }
}
