/**
 * Seeded, fixed domain constants for the Mock Interview MVP.
 *
 * Per Requirement 2.1/2.3, the interview questions and the soft-skill
 * parameters are immutable, code-seeded constants — they are NOT stored in the
 * database and there is no interface to create, edit, or delete them.
 */

/** A single, fixed interview question a Student can answer. */
export interface Question {
  /** Stable 1-based identifier referenced by Submissions (`questionId`). */
  id: number;
  /** The interview prompt shown to the Student. */
  prompt: string;
  /** Thematic grouping (e.g. 'HR', 'Behavioural', 'Technical', 'Leadership'). */
  category: string;
  /** Relative difficulty of the question. */
  difficulty: 'Easy' | 'Medium' | 'Hard';
  /** Suggested answer length in seconds (60–120s). */
  expectedDurationSeconds: number;
}

/**
 * The fixed list of 10 interview Questions (Requirement 2.1).
 *
 * `readonly` + `as const` make the list immutable at the type level, reflecting
 * the design decision that questions cannot be created, edited, or deleted.
 */
export const QUESTIONS: readonly Question[] = [
  {
    id: 1,
    prompt: 'Tell me about yourself and walk me through your background.',
    category: 'HR',
    difficulty: 'Easy',
    expectedDurationSeconds: 90,
  },
  {
    id: 2,
    prompt: 'Why are you interested in this role, and what attracts you to our company?',
    category: 'HR',
    difficulty: 'Easy',
    expectedDurationSeconds: 75,
  },
  {
    id: 3,
    prompt: 'What are your greatest strengths, and how have they helped you succeed?',
    category: 'Behavioural',
    difficulty: 'Medium',
    expectedDurationSeconds: 90,
  },
  {
    id: 4,
    prompt: 'Describe a significant weakness and what you are doing to improve it.',
    category: 'Behavioural',
    difficulty: 'Medium',
    expectedDurationSeconds: 90,
  },
  {
    id: 5,
    prompt: 'Tell me about a challenging problem you solved and the approach you took.',
    category: 'Technical',
    difficulty: 'Hard',
    expectedDurationSeconds: 120,
  },
  {
    id: 6,
    prompt: 'Describe a time you worked in a team to achieve a shared goal.',
    category: 'Behavioural',
    difficulty: 'Medium',
    expectedDurationSeconds: 90,
  },
  {
    id: 7,
    prompt: 'Tell me about a time you faced failure or made a mistake. What did you learn?',
    category: 'Behavioural',
    difficulty: 'Hard',
    expectedDurationSeconds: 105,
  },
  {
    id: 8,
    prompt: 'How do you prioritize tasks and manage your time when facing tight deadlines?',
    category: 'Technical',
    difficulty: 'Medium',
    expectedDurationSeconds: 90,
  },
  {
    id: 9,
    prompt: 'Where do you see yourself professionally in the next five years?',
    category: 'Leadership',
    difficulty: 'Medium',
    expectedDurationSeconds: 75,
  },
  {
    id: 10,
    prompt: 'Do you have any questions for us about the role or the company?',
    category: 'HR',
    difficulty: 'Easy',
    expectedDurationSeconds: 60,
  },
] as const;

/**
 * The 8 soft-skill parameters a Teacher scores from 1 to 10 (Requirement 4.3).
 * Order is significant and stable; it defines the canonical parameter list used
 * by evaluation validation and scoring.
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
] as const; // length 8

/** Union of the 8 soft-skill parameter keys, derived from the constant. */
export type SoftSkillParameter = (typeof SOFT_SKILL_PARAMETERS)[number];

/** The exact number of soft-skill parameters scored per Evaluation. */
export const PARAMETER_COUNT = SOFT_SKILL_PARAMETERS.length; // 8

/** Index of Questions by their 1-based `id` for O(1) lookup by `questionId`. */
const QUESTIONS_BY_ID: ReadonlyMap<number, Question> = new Map(
  QUESTIONS.map((question) => [question.id, question]),
);

/**
 * Look up a seeded Question by its id.
 *
 * @param id The 1-based question id (as stored on a Submission's `questionId`).
 * @returns The matching Question, or undefined when the id is unknown.
 */
export function getQuestionById(id: number): Question | undefined {
  return QUESTIONS_BY_ID.get(id);
}
