import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  skillTrend,
  improvementSuggestions,
  scoreDistribution,
  SUGGESTIONS,
} from './analytics';
import { SOFT_SKILL_PARAMETERS, type SoftSkillParameter } from './questions';

const NUM_RUNS = 100;

/** Arbitrary for one evaluation's 8 parameter scores (1–10 each). */
const evaluationRecord = fc.record(
  Object.fromEntries(
    SOFT_SKILL_PARAMETERS.map((p) => [p, fc.integer({ min: 1, max: 10 })]),
  ) as Record<SoftSkillParameter, fc.Arbitrary<number>>,
) as fc.Arbitrary<Record<SoftSkillParameter, number>>;

/** Arbitrary for a single evaluated overall score (0–100). */
const overallScore = fc.integer({ min: 0, max: 100 });

/** Local mean helper mirroring the module (empty → 0). */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe('skillTrend', () => {
  // Feature: mock-interview-mvp, polish: per-parameter deltas equal laterAvg - earlierAvg over the split halves
  it('reports deltas equal to later-half minus earlier-half means per parameter', () => {
    fc.assert(
      fc.property(
        fc.array(evaluationRecord, { minLength: 2, maxLength: 20 }),
        (evaluations) => {
          const trend = skillTrend(evaluations);
          const splitIndex = Math.floor(evaluations.length / 2);

          expect(trend.perParameter).toHaveLength(SOFT_SKILL_PARAMETERS.length);

          for (const parameter of SOFT_SKILL_PARAMETERS) {
            const row = trend.perParameter.find((r) => r.parameter === parameter)!;
            const series = evaluations.map((e) => e[parameter]);
            const earlierAvg = mean(series.slice(0, splitIndex));
            const laterAvg = mean(series.slice(splitIndex));

            expect(row.earlierAvg).toBeCloseTo(earlierAvg, 10);
            expect(row.laterAvg).toBeCloseTo(laterAvg, 10);
            expect(row.delta).toBeCloseTo(laterAvg - earlierAvg, 10);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: perParameter is always in canonical order
  it('returns perParameter rows in canonical parameter order', () => {
    fc.assert(
      fc.property(
        fc.array(evaluationRecord, { minLength: 0, maxLength: 20 }),
        (evaluations) => {
          const trend = skillTrend(evaluations);
          expect(trend.perParameter.map((r) => r.parameter)).toEqual([
            ...SOFT_SKILL_PARAMETERS,
          ]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: mostImproved (when set) has a positive delta and is the maximum
  it('selects a mostImproved with a positive, maximal delta or null', () => {
    fc.assert(
      fc.property(
        fc.array(evaluationRecord, { minLength: 2, maxLength: 20 }),
        (evaluations) => {
          const trend = skillTrend(evaluations);
          const maxDelta = Math.max(...trend.perParameter.map((r) => r.delta));

          if (maxDelta > 0) {
            expect(trend.mostImproved).not.toBeNull();
            const chosen = trend.perParameter.find(
              (r) => r.parameter === trend.mostImproved,
            )!;
            expect(chosen.delta).toBeGreaterThan(0);
            expect(chosen.delta).toBeCloseTo(maxDelta, 10);
          } else {
            expect(trend.mostImproved).toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: weakest (when set) has the minimum overall average
  it('selects a weakest with the minimum overall average', () => {
    fc.assert(
      fc.property(
        fc.array(evaluationRecord, { minLength: 1, maxLength: 20 }),
        (evaluations) => {
          const trend = skillTrend(evaluations);
          expect(trend.weakest).not.toBeNull();

          const overallAverages = SOFT_SKILL_PARAMETERS.map((p) =>
            mean(evaluations.map((e) => e[p])),
          );
          const minAverage = Math.min(...overallAverages);
          const weakestAverage = mean(
            evaluations.map((e) => e[trend.weakest as SoftSkillParameter]),
          );
          expect(weakestAverage).toBeCloseTo(minAverage, 10);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: empty input yields null mostImproved/weakest and all-zero rows
  it('empty input yields null mostImproved/weakest and all-zero per-parameter rows', () => {
    const trend = skillTrend([]);
    expect(trend.mostImproved).toBeNull();
    expect(trend.weakest).toBeNull();
    expect(trend.perParameter).toHaveLength(SOFT_SKILL_PARAMETERS.length);
    for (const row of trend.perParameter) {
      expect(row.earlierAvg).toBe(0);
      expect(row.laterAvg).toBe(0);
      expect(row.delta).toBe(0);
    }
  });

  // Feature: mock-interview-mvp, polish: a single evaluation cannot be "most improved"
  it('returns null mostImproved for a single evaluation', () => {
    fc.assert(
      fc.property(evaluationRecord, (evaluation) => {
        expect(skillTrend([evaluation]).mostImproved).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('breaks mostImproved ties by canonical parameter order', () => {
    // confidence and communication both improve by the same delta; confidence
    // is earlier in canonical order so it wins.
    const base = Object.fromEntries(
      SOFT_SKILL_PARAMETERS.map((p) => [p, 5]),
    ) as Record<SoftSkillParameter, number>;
    const later = { ...base, confidence: 8, communication: 8 };
    const trend = skillTrend([base, later]);
    expect(trend.mostImproved).toBe('confidence');
  });
});

describe('improvementSuggestions', () => {
  // Feature: mock-interview-mvp, polish: one tip is returned per weak area, in order
  it('returns exactly one tip per weak area, preserving order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...SOFT_SKILL_PARAMETERS), { minLength: 0, maxLength: 8 }),
        (weakAreas) => {
          const tips = improvementSuggestions(weakAreas);
          expect(tips).toHaveLength(weakAreas.length);
          weakAreas.forEach((parameter, index) => {
            expect(tips[index]).toBe(SUGGESTIONS[parameter]);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('provides a non-empty tip for all 8 parameters', () => {
    for (const parameter of SOFT_SKILL_PARAMETERS) {
      expect(typeof SUGGESTIONS[parameter]).toBe('string');
      expect(SUGGESTIONS[parameter].length).toBeGreaterThan(0);
    }
  });
});

describe('scoreDistribution', () => {
  const BANDS = ['0-49', '50-59', '60-69', '70-79', '80-89', '90-100'];

  // Feature: mock-interview-mvp, polish: always returns the 6 fixed bands in order
  it('always returns the 6 fixed bands in order', () => {
    fc.assert(
      fc.property(fc.array(overallScore, { minLength: 0, maxLength: 30 }), (scores) => {
        const distribution = scoreDistribution(scores);
        expect(distribution.map((b) => b.band)).toEqual(BANDS);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: band counts sum to the input length (each score lands in exactly one band)
  it('band counts sum to the input length', () => {
    fc.assert(
      fc.property(fc.array(overallScore, { minLength: 0, maxLength: 30 }), (scores) => {
        const distribution = scoreDistribution(scores);
        const total = distribution.reduce((sum, b) => sum + b.count, 0);
        expect(total).toBe(scores.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: each score increments exactly the band that contains it
  it('places each score in the band whose inclusive range contains it', () => {
    fc.assert(
      fc.property(overallScore, (score) => {
        const distribution = scoreDistribution([score]);
        const filled = distribution.filter((b) => b.count > 0);
        expect(filled).toHaveLength(1);
        const [min, maxRaw] = filled[0].band.split('-');
        expect(score).toBeGreaterThanOrEqual(Number(min));
        expect(score).toBeLessThanOrEqual(Number(maxRaw));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts a perfect score of 100 in the 90-100 band', () => {
    const distribution = scoreDistribution([100]);
    const band = distribution.find((b) => b.band === '90-100')!;
    expect(band.count).toBe(1);
  });

  it('returns all-zero counts for empty input', () => {
    const distribution = scoreDistribution([]);
    expect(distribution.every((b) => b.count === 0)).toBe(true);
    expect(distribution).toHaveLength(6);
  });
});
