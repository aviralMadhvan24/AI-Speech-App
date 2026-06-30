import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateEvaluation,
  MIN_PARAMETER_SCORE,
  MAX_PARAMETER_SCORE,
} from './validateEvaluation';
import { SOFT_SKILL_PARAMETERS, PARAMETER_COUNT } from './questions';

const NUM_RUNS = 300;

/**
 * Independent reference oracle for "is this payload a valid evaluation?".
 *
 * This deliberately re-derives the acceptance rule straight from the spec
 * (Requirements 4.3, 4.4) rather than calling the implementation, so the
 * accept-iff-valid property is a real cross-check and not a tautology. A
 * payload is valid *if and only if* it is an object whose `scores` is an object
 * carrying exactly the 8 soft-skill parameters — each an integer in
 * [MIN, MAX] with no extra keys — plus a `overallFeedback` string that is
 * non-empty after trimming.
 */
function isValidEvaluation(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const obj = payload as Record<string, unknown>;

  const scores = obj.scores;
  if (typeof scores !== 'object' || scores === null || Array.isArray(scores)) {
    return false;
  }
  const scoreObj = scores as Record<string, unknown>;

  // Exactly the 8 expected keys: every parameter present, valid, and in range.
  for (const parameter of SOFT_SKILL_PARAMETERS) {
    const value = scoreObj[parameter];
    if (typeof value !== 'number' || !Number.isInteger(value)) return false;
    if (value < MIN_PARAMETER_SCORE || value > MAX_PARAMETER_SCORE) return false;
  }
  // No unexpected/extra keys.
  const allowed = new Set<string>(SOFT_SKILL_PARAMETERS);
  for (const key of Object.keys(scoreObj)) {
    if (!allowed.has(key)) return false;
  }

  const feedback = obj.overallFeedback;
  if (typeof feedback !== 'string' || feedback.trim().length === 0) return false;

  return true;
}

/**
 * A score value spanning the full boundary space: valid in-range integers,
 * out-of-range integers (both sides), non-integer numbers, and wrong-typed
 * values. This guarantees the generator straddles the accept/reject boundary.
 */
const scoreValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: MIN_PARAMETER_SCORE, max: MAX_PARAMETER_SCORE }), // valid
  fc.integer({ min: -50, max: MIN_PARAMETER_SCORE - 1 }), // below range
  fc.integer({ min: MAX_PARAMETER_SCORE + 1, max: 100 }), // above range
  fc.double({ min: -20, max: 20, noNaN: true }), // possibly non-integer
  fc.string(),
  fc.boolean(),
  fc.constant(null),
);

/** Feedback spanning valid non-empty strings, blank strings, and non-strings. */
const feedbackArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ minLength: 1 }).map((s) => `${s}x`), // guaranteed non-empty content
  fc.constant(''),
  fc.constantFrom(' ', '   ', '\t', '\n  '), // whitespace-only -> empty after trim
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
);

/**
 * A `scores` object where each of the 8 parameters is independently optional
 * (may be omitted -> "missing score") and, when present, may hold any value
 * from `scoreValueArb`. Optionally augmented with extra/unrecognized keys.
 */
const scoresObjectArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.record(
      Object.fromEntries(SOFT_SKILL_PARAMETERS.map((p) => [p, scoreValueArb])),
      { requiredKeys: [] }, // every parameter key is optional
    ),
    // Extra keys not part of the 8 recognized parameters.
    fc.dictionary(
      fc.string({ minLength: 1 }).filter((k) => !SOFT_SKILL_PARAMETERS.includes(k as never)),
      scoreValueArb,
      { maxKeys: 3 },
    ),
  )
  .map(([base, extra]) => ({ ...base, ...extra }));

/**
 * A candidate evaluation payload spanning the whole input space: well-formed
 * objects with possibly-invalid scores/feedback, plus malformed shapes where
 * `scores`/`overallFeedback` are wrong-typed or the whole payload is not an
 * object.
 */
const candidatePayloadArb: fc.Arbitrary<unknown> = fc.oneof(
  // Structured payloads (the common, interesting case).
  fc.record(
    {
      scores: fc.oneof(scoresObjectArb, fc.string(), fc.integer(), fc.constant(null)),
      overallFeedback: feedbackArb,
    },
    { requiredKeys: [] },
  ),
  // Entirely malformed top-level shapes.
  fc.string(),
  fc.integer(),
  fc.constant(null),
  fc.array(scoreValueArb),
);

/** Arbitrary that always yields a fully valid evaluation payload. */
const validPayloadArb = fc.record({
  scores: fc.record(
    Object.fromEntries(
      SOFT_SKILL_PARAMETERS.map((p) => [
        p,
        fc.integer({ min: MIN_PARAMETER_SCORE, max: MAX_PARAMETER_SCORE }),
      ]),
    ),
  ),
  overallFeedback: fc.string({ minLength: 1 }).map((s) => `${s}.`),
});

describe('validateEvaluation', () => {
  // Feature: mock-interview-mvp, Property 2: Evaluation validation accepts exactly the valid inputs
  it('Property 2: Evaluation validation accepts exactly the valid inputs', () => {
    fc.assert(
      fc.property(candidatePayloadArb, (payload) => {
        const result = validateEvaluation(payload);
        const expectedValid = isValidEvaluation(payload);

        // Accept if and only if the payload meets the spec's acceptance rule.
        expect(result.ok).toBe(expectedValid);

        if (result.ok) {
          // On acceptance the validator must surface exactly the 8 scores and
          // non-empty, trimmed feedback.
          expect(Object.keys(result.value.scores).length).toBe(PARAMETER_COUNT);
          expect(result.value.overallFeedback.length).toBeGreaterThan(0);
        } else {
          // On rejection there must be at least one explanatory detail.
          expect(result.details.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, Property 2: Evaluation validation accepts exactly the valid inputs
  it('Property 2: well-formed payloads (8 in-range integer scores + non-empty feedback) are always accepted', () => {
    fc.assert(
      fc.property(validPayloadArb, (payload) => {
        const result = validateEvaluation(payload);
        expect(result.ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
