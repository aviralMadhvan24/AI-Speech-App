import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  consistencyScore,
  improvementScore,
  overallRating,
  improvementTrend,
  DEFAULT_RATING_WEIGHTS,
} from './rating';

const NUM_RUNS = 200;

/** Arbitrary for a single evaluated overall score (0–100). */
const overallScore = fc.integer({ min: 0, max: 100 });

/** Arbitrary for any list of overall scores (0–20 elements). */
const anyScores = fc.array(overallScore, { minLength: 0, maxLength: 20 });

/** Arbitrary for a list of at least two overall scores. */
const twoOrMoreScores = fc.array(overallScore, { minLength: 2, maxLength: 20 });

describe('consistencyScore', () => {
  // Feature: mock-interview-mvp, polish: consistency is always within [0, 100]
  it('always lies within [0, 100]', () => {
    fc.assert(
      fc.property(anyScores, (scores) => {
        const result = consistencyScore(scores);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(100);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: fewer than 2 scores yield consistency 0
  it('returns 0 when there are fewer than 2 scores', () => {
    fc.assert(
      fc.property(fc.array(overallScore, { minLength: 0, maxLength: 1 }), (scores) => {
        expect(consistencyScore(scores)).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: equal scores (>=2) yield consistency 100
  it('returns 100 when all scores are equal and there are at least 2', () => {
    fc.assert(
      fc.property(
        overallScore,
        fc.integer({ min: 2, max: 20 }),
        (value, count) => {
          const scores = Array.from({ length: count }, () => value);
          expect(consistencyScore(scores)).toBe(100);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('improvementScore', () => {
  // Feature: mock-interview-mvp, polish: improvement is always within [0, 100]
  it('always lies within [0, 100]', () => {
    fc.assert(
      fc.property(anyScores, (scores) => {
        const result = improvementScore(scores);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(100);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: fewer than 2 scores yield improvement 0
  it('returns 0 when there are fewer than 2 scores', () => {
    fc.assert(
      fc.property(fc.array(overallScore, { minLength: 0, maxLength: 1 }), (scores) => {
        expect(improvementScore(scores)).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: equal-mean halves yield improvement 50
  it('returns 50 when the two halves have equal means (constant scores)', () => {
    fc.assert(
      fc.property(
        overallScore,
        fc.integer({ min: 2, max: 20 }),
        (value, count) => {
          const scores = Array.from({ length: count }, () => value);
          expect(improvementScore(scores)).toBe(50);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: improving sequences score above 50, declining below
  it('scores strictly improving sequences above 50 and declining below 50', () => {
    expect(improvementScore([10, 20, 30, 40])).toBeGreaterThan(50);
    expect(improvementScore([40, 30, 20, 10])).toBeLessThan(50);
  });
});

describe('overallRating', () => {
  // Feature: mock-interview-mvp, polish: overall rating is always within [0, 100]
  it('always lies within [0, 100] for in-range component inputs', () => {
    fc.assert(
      fc.property(overallScore, overallScore, overallScore, (avg, cons, impr) => {
        const result = overallRating(avg, cons, impr);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(100);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: mock-interview-mvp, polish: equal components collapse to that value
  it('returns the shared value when all components are equal (default weights sum to 100)', () => {
    fc.assert(
      fc.property(overallScore, (value) => {
        expect(overallRating(value, value, value)).toBeCloseTo(value, 10);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('applies the default weights as a weighted average', () => {
    const result = overallRating(80, 60, 40, DEFAULT_RATING_WEIGHTS);
    // (80*70 + 60*20 + 40*10) / 100 = (5600 + 1200 + 400) / 100 = 72
    expect(result).toBeCloseTo(72, 10);
  });
});

describe('improvementTrend', () => {
  // Feature: mock-interview-mvp, polish: trend label matches the improvement value
  it('maps >50 to up, <50 to down, and ==50 to steady', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (improvement) => {
        const trend = improvementTrend(improvement);
        if (improvement > 50) expect(trend).toBe('up');
        else if (improvement < 50) expect(trend).toBe('down');
        else expect(trend).toBe('steady');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('labels the boundary value 50 as steady', () => {
    expect(improvementTrend(50)).toBe('steady');
  });
});
