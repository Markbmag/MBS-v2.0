// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { linearFit, nextDates, trendValues } from '../src/viz/stats.ts';

describe('trend line', () => {
  test('least squares through the points, gaps skipped', () => {
    const fit = linearFit([1, 2, null, 4])!;
    const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
    close(fit.slope, 1); // y = x + 1
    close(fit.intercept, 1);
    close(fit.r2, 1);
    assert.deepEqual(trendValues([1, 2, null, 4], 2), [1, 2, 3, 4, 5, 6]);
  });
  test('needs two values and some spread', () => {
    assert.equal(linearFit([5]), null);
    assert.equal(trendValues([null, 3], 1), null);
  });
});

describe('forecast dates', () => {
  test('continue the step: months, quarters, days', () => {
    assert.deepEqual(nextDates(['2026-01-01', '2026-02-01', '2026-03-01'], 2), ['2026-04-01', '2026-05-01']);
    assert.deepEqual(nextDates(['2025-01-01', '2025-04-01', '2025-07-01'], 1), ['2025-10-01']);
    assert.deepEqual(nextDates(['2026-01-30', '2026-01-31'], 2), ['2026-02-01', '2026-02-02']);
    assert.equal(nextDates(['EU', 'US'], 2), null);
  });
});
