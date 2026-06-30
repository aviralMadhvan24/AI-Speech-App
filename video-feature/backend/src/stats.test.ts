import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  studentStats,
  computeBadges,
  parameterAverages,
  strengthsAndWeaknesses,
  type BadgeType,
} from './stats';
import { SOFT_SKILL_PARAMETERS, type SoftSkillParameter } from './questions';

const NUM_RUNS = 100;

/** Arbitrary for a single evaluated overall score (0–100). */
const overallScore = fc.integer({ min: 0, max: 100 });

/** Arbitrary for a non-empty list of evaluated overall scores. */
const nonEmptyScores = fc.array(overallScore, { minLength: 1, maxLength: 20 });

describe('studentStats', () => {
  // Feature: mock-interview-mvp, polish: student stats average lies within [min, max] and equals sum/length
  it('average equals sum/length and lies within [min, max] for non-empty inputs', () => {
    fc.assert(
      fc.property(nonEmptyScores, (scores) => {
        const stats = studentStats(scores);
        const sum = scores.reduce((acc, s) => acc + s, 0);
        const min = Math.min(...scores);
        const max = Math.max(...scores);

        expect(stats.totalEvaluated).toBe(scores.length);
        expect(stats.averageOverallScore).toBeCloseTo(sum / scores.length, 10);
        expect(stats.bestScore).toBe(max);
        expect(stats.worstScore).toBe(min);

        // Average must lie within [min, max].
        expect(stats.averageOverallScore!).toBeGreaterThanOrEqual(min);
        expect(stats.averageOverallScore!).toBeLessThanOrEqual(max);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: student stats on empty input yield nulls and zero
  it('empty input yields null scores and a zero count', () => {
    const stats = studentStats([]);
    expect(stats.averageOverallScore).toBeNull();
    expect(stats.bestScore).toBeNull();
    expect(stats.worstScore).toBeNull();
    expect(stats.totalEvaluated).toBe(0);
  });
});

describe('computeBadges', () => {
  /** Arbitrary for a badge input with realistic ranges (including nulls). */
  const badgeInput = fc.record({
    totalEvaluated: fc.integer({ min: 0, max: 10 }),
    averageOverallScore: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    bestScore: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    rank: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
  });

  // Feature: mock-interview-mvp, polish: each badge appears iff its independent rule holds
  it('returns a badge iff its rule holds (cross-checked per rule)', () => {
    fc.assert(
      fc.property(badgeInput, (input) => {
        const badges = new Set<BadgeType>(computeBadges(input));

        const expectFirstAnswer = input.totalEvaluated >= 1;
        const expectHighScorer = input.bestScore !== null && input.bestScore >= 85;
        const expectConsistent =
          input.totalEvaluated >= 3 &&
          input.averageOverallScore !== null &&
          input.averageOverallScore >= 70;
        const expectTopPerformer = input.rank !== null && input.rank <= 3;

        expect(badges.has('first_answer')).toBe(expectFirstAnswer);
        expect(badges.has('high_scorer')).toBe(expectHighScorer);
        expect(badges.has('consistent_performer')).toBe(expectConsistent);
        expect(badges.has('top_performer')).toBe(expectTopPerformer);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: earned badges are returned in stable union order
  it('returns earned badges in stable union order', () => {
    fc.assert(
      fc.property(badgeInput, (input) => {
        const order: BadgeType[] = [
          'first_answer',
          'high_scorer',
          'consistent_performer',
          'top_performer',
        ];
        const badges = computeBadges(input);
        const indices = badges.map((b) => order.indexOf(b));
        const sorted = [...indices].sort((a, b) => a - b);
        expect(indices).toEqual(sorted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('awards all badges when every rule is satisfied', () => {
    const badges = computeBadges({
      totalEvaluated: 5,
      averageOverallScore: 90,
      bestScore: 95,
      rank: 1,
    });
    expect(badges).toEqual([
      'first_answer',
      'high_scorer',
      'consistent_performer',
      'top_performer',
    ]);
  });

  it('awards no badges for an empty/unranked student', () => {
    const badges = computeBadges({
      totalEvaluated: 0,
      averageOverallScore: null,
      bestScore: null,
      rank: null,
    });
    expect(badges).toEqual([]);
  });
});

describe('parameterAverages', () => {
  /** Arbitrary for one evaluation's 8 parameter scores (1–10 each). */
  const evaluationRecord = fc.record(
    Object.fromEntries(
      SOFT_SKILL_PARAMETERS.map((p) => [p, fc.integer({ min: 1, max: 10 })]),
    ) as Record<SoftSkillParameter, fc.Arbitrary<number>>,
  ) as fc.Arbitrary<Record<SoftSkillParameter, number>>;

  // Feature: mock-interview-mvp, polish: parameter averages lie within [min, max] per parameter
  it('each parameter average lies within its observed [min, max]', () => {
    fc.assert(
      fc.property(
        fc.array(evaluationRecord, { minLength: 1, maxLength: 15 }),
        (evaluations) => {
          const averages = parameterAverages(evaluations);
          for (const p of SOFT_SKILL_PARAMETERS) {
            const values = evaluations.map((e) => e[p]);
            const sum = values.reduce((acc, v) => acc + v, 0);
            expect(averages[p]).toBeCloseTo(sum / values.length, 10);
            expect(averages[p]).toBeGreaterThanOrEqual(Math.min(...values));
            expect(averages[p]).toBeLessThanOrEqual(Math.max(...values));
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: empty input yields all-zero parameter averages
  it('returns all zeros for empty input', () => {
    const averages = parameterAverages([]);
    for (const p of SOFT_SKILL_PARAMETERS) {
      expect(averages[p]).toBe(0);
    }
  });
});

describe('strengthsAndWeaknesses', () => {
  // Feature: mock-interview-mvp, polish: strengths rank highest and weak areas rank lowest
  it('picks the top-2 highest and bottom-2 lowest averages', () => {
    const averages = {
      confidence: 9,
      communication: 1,
      fluency: 8,
      clarity: 2,
      vocabularyGrammar: 5,
      bodyLanguage: 6,
      eyeContact: 7,
      professionalism: 3,
    } satisfies Record<SoftSkillParameter, number>;

    const { strengths, weakAreas } = strengthsAndWeaknesses(averages);
    expect(strengths).toEqual(['confidence', 'fluency']);
    expect(weakAreas).toEqual(['communication', 'clarity']);
  });

  // Feature: mock-interview-mvp, polish: ties break stably by canonical parameter order
  it('breaks ties by canonical parameter order when all averages are equal', () => {
    const averages = Object.fromEntries(
      SOFT_SKILL_PARAMETERS.map((p) => [p, 5]),
    ) as Record<SoftSkillParameter, number>;

    const { strengths, weakAreas } = strengthsAndWeaknesses(averages);
    // All equal → strengths take the first two params in canonical order,
    // weak areas take the last two in canonical order.
    expect(strengths).toEqual([SOFT_SKILL_PARAMETERS[0], SOFT_SKILL_PARAMETERS[1]]);
    expect(weakAreas).toEqual([SOFT_SKILL_PARAMETERS[0], SOFT_SKILL_PARAMETERS[1]]);
  });
});
