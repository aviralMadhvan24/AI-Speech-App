/**
 * Shared API DTO shapes for the student flow (Task 11).
 *
 * These mirror the backend response shapes:
 *   - `GET /questions`        → { questions: Question[] }
 *   - `GET /submissions/mine` → { submissions: SubmissionDto[] }
 *   - `POST /submissions`     → SubmissionDto
 */

/** Difficulty level of an interview question. */
export type QuestionDifficulty = 'Easy' | 'Medium' | 'Hard';

/** A single seeded interview question (matches the backend `Question`). */
export interface Question {
  id: number;
  prompt: string;
  category: string;
  difficulty: QuestionDifficulty;
  expectedDurationSeconds: number;
}

/** Response body for `GET /questions`. */
export interface QuestionsResponse {
  questions: Question[];
}

/** Lifecycle state of a submission. */
export type SubmissionStatus = 'pending' | 'evaluated';

/**
 * A single submission as returned by the backend. `overallScore` and
 * `overallFeedback` are only populated once the submission is `evaluated`
 * (Req 6.3).
 */
export interface SubmissionDto {
  id: string;
  studentId: string;
  questionId: number;
  status: SubmissionStatus;
  createdAt: string;
  overallScore: number | null;
  overallFeedback: string | null;
}

/** Response body for `GET /submissions/mine`. */
export interface MySubmissionsResponse {
  submissions: SubmissionDto[];
}

/* ------------------------------------------------------------------ *
 * Teacher review + leaderboard shapes (Task 12).
 * ------------------------------------------------------------------ */

/** Response body for `GET /submissions/pending` (teacher review queue). */
export interface PendingSubmissionsResponse {
  submissions: SubmissionDto[];
}

/**
 * The 8 soft-skill parameter keys a teacher scores, in canonical order
 * (mirrors the backend `SOFT_SKILL_PARAMETERS`). The evaluation payload must
 * contain exactly these 8 keys.
 */
export const SOFT_SKILL_PARAMETERS = [
  'confidence',
  'communication',
  'fluency',
  'clarity',
  'vocabularyGrammar',
  'bodyLanguage',
  'eyeContact',
  'professionalism',
] as const;

/** Union of the 8 soft-skill parameter keys. */
export type SoftSkillParameter = (typeof SOFT_SKILL_PARAMETERS)[number];

/** Human-friendly labels for each soft-skill parameter (for form rendering). */
export const SOFT_SKILL_LABELS: Record<SoftSkillParameter, string> = {
  confidence: 'Confidence',
  communication: 'Communication Skills',
  fluency: 'Fluency',
  clarity: 'Clarity',
  vocabularyGrammar: 'Vocabulary & Grammar',
  bodyLanguage: 'Body Language',
  eyeContact: 'Eye Contact',
  professionalism: 'Professionalism',
};

/** The 8 parameter scores, keyed by parameter name (each an integer 1–10). */
export type ParameterScores = Record<SoftSkillParameter, number>;

/** Request body for `POST /submissions/:id/evaluation`. */
export interface EvaluationPayload {
  scores: ParameterScores;
  overallFeedback: string;
}

/** Response body for a successfully created evaluation. */
export interface EvaluationResponse {
  id: string;
  submissionId: string;
  teacherId: string;
  overallScore: number;
  overallFeedback: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Badges (polish features).
 * ------------------------------------------------------------------ */

/** The badge identifiers a student can earn (mirrors the backend `BadgeType`). */
export type BadgeType =
  | 'first_answer'
  | 'high_scorer'
  | 'consistent_performer'
  | 'top_performer';

/** Human-friendly labels (with a small icon prefix) for each badge. */
export const BADGE_LABELS: Record<BadgeType, string> = {
  first_answer: '🎬 First Answer',
  high_scorer: '⭐ High Scorer',
  consistent_performer: '🎯 Consistent Performer',
  top_performer: '🏆 Top Performer',
};

/** Direction of a student's recent score trend. */
export type ImprovementTrend = 'up' | 'down' | 'steady';

/** A single ranked row from `GET /leaderboard`. */
export interface LeaderboardRow {
  studentId: string;
  name: string;
  overallRating: number;
  averageOverallScore: number;
  bestScore: number;
  totalInterviews: number;
  improvementTrend: ImprovementTrend;
  badges: BadgeType[];
}

/** Response body for `GET /leaderboard`. */
export interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
}

/* ------------------------------------------------------------------ *
 * Dashboards (polish features).
 * ------------------------------------------------------------------ */

/** A single point on the student progress timeline. */
export interface TimelinePoint {
  /** ISO date string of the evaluated submission. */
  date: string;
  /** Overall score (0–100) for that submission. */
  score: number;
}

/** A single category's aggregate performance for a student. */
export interface CategoryPerformance {
  category: string;
  averageScore: number;
  count: number;
}

/** Average soft-skill score (1–10) for a single parameter. */
export interface SkillBreakdownRow {
  parameter: SoftSkillParameter;
  average: number;
}

/** A single parameter's earlier-vs-later average comparison. */
export interface ParameterTrend {
  parameter: SoftSkillParameter;
  earlierAvg: number;
  laterAvg: number;
  delta: number;
}

/** Aggregate soft-skill trend, highlighting the most improved and weakest. */
export interface SkillTrend {
  perParameter: ParameterTrend[];
  mostImproved: SoftSkillParameter | null;
  weakest: SoftSkillParameter | null;
}

/** Response body for `GET /students/me/dashboard`. */
export interface StudentDashboardResponse {
  /** 1-based leaderboard rank, or null when the student is unranked. */
  rank: number | null;
  /** Total number of ranked students. */
  totalRanked: number;
  /** Average overall score across evaluated answers, or null when none. */
  averageOverallScore: number | null;
  /** Best overall score, or null when none. */
  bestScore: number | null;
  /** Worst overall score, or null when none. */
  worstScore: number | null;
  /** Number of evaluated submissions. */
  totalEvaluated: number;
  /** Total number of submissions (evaluated + pending). */
  totalSubmissions: number;
  /** Composite overall rating (0–100), or null when none. */
  overallRating: number | null;
  /** Consistency score (0–100), or null when none. */
  consistencyScore: number | null;
  /** Improvement score (0–100), or null when none. */
  improvementScore: number | null;
  /** Direction of the student's recent trend, or null when none. */
  improvementTrend: ImprovementTrend | null;
  /** Soft-skill parameter keys the student performs strongest in. */
  strengths: SoftSkillParameter[];
  /** Soft-skill parameter keys the student needs to improve. */
  weakAreas: SoftSkillParameter[];
  /** Per-category aggregate performance. */
  categoryPerformance: CategoryPerformance[];
  /** Badges the student has earned. */
  badges: BadgeType[];
  /** Chronological score timeline for the progress chart. */
  timeline: TimelinePoint[];
  /** Average soft-skill score (1–10) for all 8 parameters. */
  skillBreakdown: SkillBreakdownRow[];
  /** Soft-skill trend with most-improved and weakest highlights. */
  skillTrend: SkillTrend;
  /** Actionable tips to help the student improve. */
  improvementSuggestions: string[];
}

/** A compact student reference with their average overall score. */
export interface StudentScoreRef {
  studentId: string;
  name: string;
  averageOverallScore: number;
}

/** Per-question aggregate analytics for the teacher dashboard. */
export interface QuestionAnalyticsRow {
  questionId: number;
  prompt: string;
  category: string;
  averageScore: number | null;
  attempts: number;
}

/** A single overall-score distribution band (one of 6). */
export interface ScoreBand {
  band: string;
  count: number;
}

/** Response body for `GET /teacher/dashboard`. */
export interface TeacherDashboardResponse {
  /** Submissions awaiting review. */
  pending: number;
  /** Evaluations authored by this teacher. */
  completed: number;
  /** Average overall score across all evaluated answers, or null when none. */
  averageScore: number | null;
  /** Highest-scoring students. */
  topStudents: StudentScoreRef[];
  /** Lowest-scoring students (needing attention). */
  weakStudents: StudentScoreRef[];
  /** Per-question aggregate analytics. */
  questionAnalytics: QuestionAnalyticsRow[];
  /** Overall-score distribution across 6 bands. */
  scoreDistribution: ScoreBand[];
}
