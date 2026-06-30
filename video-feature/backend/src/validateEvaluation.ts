/**
 * Evaluation input validation for the Mock Interview MVP (Task 4.1).
 *
 * A Teacher's Evaluation is accepted *if and only if* it contains exactly the 8
 * Soft_Skill_Parameter scores, each an integer in [1, 10], plus a non-empty
 * written overall feedback (Requirements 4.3, 4.4). Any other input — a missing
 * or extra parameter, a non-integer, an out-of-range value, or empty/blank
 * feedback — is rejected with a validation error that identifies the problem.
 *
 * This module is a pure function with no I/O: it inspects an untrusted boundary
 * payload and returns a discriminated result the evaluations router (Task 8.1)
 * consumes before scoring and persistence.
 */

import {
  SOFT_SKILL_PARAMETERS,
  PARAMETER_COUNT,
  type SoftSkillParameter,
} from './questions';
import type { ParameterScores } from './types';

/** Inclusive lower/upper bounds for a single Parameter_Score (Requirement 4.3). */
export const MIN_PARAMETER_SCORE = 1;
export const MAX_PARAMETER_SCORE = 10;

/** The validated, well-typed evaluation produced on success. */
export interface ValidatedEvaluation {
  /** The 8 parameter scores, each a verified integer in [1, 10]. */
  scores: ParameterScores;
  /** The trimmed, guaranteed non-empty overall feedback text. */
  overallFeedback: string;
}

/**
 * Discriminated result of validation. On success the caller receives a fully
 * typed `ValidatedEvaluation`; on failure it receives a human-readable `error`
 * plus a `details` list naming each offending field/problem.
 */
export type ValidationResult =
  | { ok: true; value: ValidatedEvaluation }
  | { ok: false; error: string; details: string[] };

/** True for plain (non-null, non-array) objects we can index by string key. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a raw, untrusted evaluation payload.
 *
 * Accepts `unknown` so the function is safe to call directly on a request body.
 * Returns `{ ok: true, value }` only when the payload contains exactly the 8
 * required parameter scores (each an integer in [1, 10]) and a non-empty
 * feedback string; otherwise `{ ok: false, error, details }` where `details`
 * identifies every problem found.
 */
export function validateEvaluation(payload: unknown): ValidationResult {
  const details: string[] = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      error: 'Invalid evaluation payload',
      details: ['payload must be an object with "scores" and "overallFeedback"'],
    };
  }

  // --- Validate scores --------------------------------------------------
  const rawScores = payload.scores;
  const validatedScores: Partial<Record<SoftSkillParameter, number>> = {};

  if (!isPlainObject(rawScores)) {
    details.push('scores must be an object mapping each parameter to its score');
  } else {
    // Every required parameter must be present and a valid integer in range.
    for (const parameter of SOFT_SKILL_PARAMETERS) {
      const value = rawScores[parameter];
      if (value === undefined || value === null) {
        details.push(`scores.${parameter} is required`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        details.push(`scores.${parameter} must be an integer`);
        continue;
      }
      if (value < MIN_PARAMETER_SCORE || value > MAX_PARAMETER_SCORE) {
        details.push(
          `scores.${parameter} must be between ${MIN_PARAMETER_SCORE} and ${MAX_PARAMETER_SCORE}`,
        );
        continue;
      }
      validatedScores[parameter] = value;
    }

    // Reject any unexpected/extra keys so the payload contains *exactly* the 8.
    const allowed = new Set<string>(SOFT_SKILL_PARAMETERS);
    for (const key of Object.keys(rawScores)) {
      if (!allowed.has(key)) {
        details.push(`scores.${key} is not a recognized parameter`);
      }
    }
  }

  // --- Validate feedback ------------------------------------------------
  const feedback = payload.overallFeedback;
  let trimmedFeedback = '';
  if (typeof feedback !== 'string') {
    details.push('overallFeedback must be a non-empty string');
  } else {
    trimmedFeedback = feedback.trim();
    if (trimmedFeedback.length === 0) {
      details.push('overallFeedback must not be empty');
    }
  }

  if (details.length > 0) {
    return { ok: false, error: 'Invalid evaluation payload', details };
  }

  // All 8 parameters validated above, so the partial map is now complete.
  const scores = validatedScores as ParameterScores;
  // Defensive invariant check: exactly PARAMETER_COUNT scores were collected.
  /* istanbul ignore next */
  if (Object.keys(scores).length !== PARAMETER_COUNT) {
    return {
      ok: false,
      error: 'Invalid evaluation payload',
      details: [`expected exactly ${PARAMETER_COUNT} parameter scores`],
    };
  }

  return { ok: true, value: { scores, overallFeedback: trimmedFeedback } };
}
