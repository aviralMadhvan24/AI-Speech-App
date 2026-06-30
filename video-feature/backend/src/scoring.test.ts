import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { scoreSubmission, rankLeaderboard } from './scoring';
import type { StudentEvaluated } from './types';

const NUM_RUNS = 100;

/**
 * Arbitrary for a single valid Parameter_Score: an integer in [1, 10].
 */
const parameterScore = fc.integer({ min: 1, max: 10 });

/**
 * Arbitrary for a full set of exactly 8 valid Parameter_Scores.
 */
const eightScores = fc.array(parameterScore, { minLength: 8, maxLength: 8 });

/**
 * Arbitrary for a student's list of evaluated overall scores (0–100).
 */
const overallScore = fc.integer({ min: 0, max: 100 });

/**
 * Arbitrary for a single student row. `allowEmpty` controls whether the student
 * may have zero evaluated submissions (an empty overallScores list).
 */
function studentArb(allowEmpty: boolean): fc.Arbitrary<StudentEvaluated> {
  return fc.record({
    studentId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 20 }),
    overallScores: fc.array(overallScore, {
      minLength: allowEmpty ? 0 : 1,
      maxLength: 6,
    }),
  });
}

/** A mixed list of students, some of which may have no evaluated submissions. */
const studentsArb = fc.array(studentArb(true), { maxLength: 12 });

describe('scoreSubmission', () => {
  // Feature: mock-interview-mvp, Property 1: Overall score equals scaled mean and stays in range
  it('Property 1: Overall score equals scaled mean and stays in range', () => {
    fc.assert(
      fc.property(eightScores, (scores) => {
        const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        const result = scoreSubmission(scores);

        expect(result).toBe(Math.round(mean * 10));
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(100);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('rankLeaderboard', () => {
  // Feature: mock-interview-mvp, Property 3: Leaderboard average equals each student's mean overall score
  it("Property 3: Leaderboard average equals each student's mean overall score", () => {
    fc.assert(
      fc.property(studentsArb, (students) => {
        const rows = rankLeaderboard(students);

        for (const row of rows) {
          const source = students.find((s) => s.studentId === row.studentId);
          expect(source).toBeDefined();
          const expectedAverage =
            source!.overallScores.reduce((sum, s) => sum + s, 0) /
            source!.overallScores.length;
          expect(row.averageOverallScore).toBeCloseTo(expectedAverage, 10);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, Property 4: Leaderboard is ordered by descending average
  it('Property 4: Leaderboard is ordered by descending average', () => {
    fc.assert(
      fc.property(studentsArb, (students) => {
        const rows = rankLeaderboard(students);

        for (let i = 1; i < rows.length; i++) {
          expect(rows[i - 1].averageOverallScore).toBeGreaterThanOrEqual(
            rows[i].averageOverallScore,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, Property 5: Students with no evaluated submissions are excluded
  it('Property 5: Students with no evaluated submissions are excluded', () => {
    fc.assert(
      fc.property(studentsArb, (students) => {
        const rows = rankLeaderboard(students);
        const rankedIds = new Set(rows.map((r) => r.studentId));

        const withEval = students.filter((s) => s.overallScores.length > 0);
        const withoutEval = students.filter((s) => s.overallScores.length === 0);

        // Every student with no evaluated submissions is excluded.
        for (const s of withoutEval) {
          // A student id absent from withEval must not appear in the ranking.
          const hasEvaluatedTwin = withEval.some(
            (e) => e.studentId === s.studentId,
          );
          if (!hasEvaluatedTwin) {
            expect(rankedIds.has(s.studentId)).toBe(false);
          }
        }

        // Every student with at least one evaluated submission is included.
        for (const s of withEval) {
          expect(rankedIds.has(s.studentId)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
