import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CCTV_RANGE_DEFAULT,
  CCTV_RANGE_STEPS,
  atMaxRange,
  atMinRange,
  nextRangeStep,
  normalizeRangeScale,
  rangeLabel,
} from './cctvRangePolicy.js';

test('the stops stay inside the layer clamp, so no step can be rejected', () => {
  // normalizeCalibration in data/cctv.js bounds rangeScale to 0.35-3.0. A stop
  // outside that would be silently clamped on arrival and the readout would
  // then disagree with the cone on screen.
  assert.equal(CCTV_RANGE_STEPS[0], 0.35);
  assert.equal(CCTV_RANGE_STEPS.at(-1), 3);
  assert.ok(CCTV_RANGE_STEPS.includes(CCTV_RANGE_DEFAULT),
    'RESET returns to a value stepping can also reach');
  for (let i = 1; i < CCTV_RANGE_STEPS.length; i += 1) {
    assert.ok(CCTV_RANGE_STEPS[i] > CCTV_RANGE_STEPS[i - 1], 'stops ascend');
  }
});

test('steps move one stop from a value that is already a stop', () => {
  assert.equal(nextRangeStep(1, 1), 1.5);
  assert.equal(nextRangeStep(1, -1), 0.75);
  assert.equal(nextRangeStep(2, 1), 2.5);
});

test('a value between stops steps PAST the stop it rounds to', () => {
  /*
   * The case this function exists for. An ADJUST drag leaves a continuous
   * value, so 1.2 rounds to 1 — and pressing + must go to 1.5, not back down to
   * the 1 it rounded to, which would look like the button shrank the cone.
   * Verified against the live layer: 1.2 then + gave 1.5.
   */
  assert.equal(nextRangeStep(1.2, 1), 1.5);
  assert.equal(nextRangeStep(1.2, -1), 1);
  // And symmetrically just below a stop.
  assert.equal(nextRangeStep(1.4, -1), 1);
  assert.equal(nextRangeStep(1.4, 1), 1.5);
});

test('the ends return null rather than wrapping or clamping silently', () => {
  assert.equal(nextRangeStep(0.35, -1), null);
  assert.equal(nextRangeStep(3, 1), null);
  // Past the ends is still the end, not an index off the array.
  assert.equal(nextRangeStep(0.1, -1), null);
  assert.equal(nextRangeStep(99, 1), null);
});

test('a direction that is not one stop is refused', () => {
  // Only a single stop in one direction. A delta of 2 is not "two stops" —
  // it is a caller that has misunderstood, and moving anyway would be worse
  // than doing nothing.
  for (const bad of [0, 2, -2, NaN, Infinity, null, undefined, 'x', {}]) {
    assert.equal(nextRangeStep(1, bad), null, String(bad));
  }
  // A numeric string IS a direction, matching normalizeRangeScale's treatment
  // of numeric strings elsewhere in this module.
  assert.equal(nextRangeStep(1, '1'), 1.5);
  assert.equal(nextRangeStep(1, '-1'), 0.75);
});

test('the end predicates survive the quantised value the layer stores', () => {
  /*
   * The bug this was written after: the layer quantizes what it stores, so
   * 0.35 comes back as 0.35000000000000003, which is NOT `<= 0.35`. The minus
   * button therefore stayed enabled at the bottom stop and did nothing when
   * pressed. Found by driving the buttons to both ends in the running app.
   */
  assert.equal(atMinRange(0.35000000000000003), true);
  assert.equal(atMinRange(0.35), true);
  assert.equal(atMinRange(0.5), false);
  assert.equal(atMaxRange(2.9999999999999996), true);
  assert.equal(atMaxRange(3), true);
  assert.equal(atMaxRange(2.5), false);
});

test('an unusable scale falls back to the surveyed range, never to zero', () => {
  // A camera with no calibration yet reads undefined. Treating that as 0 would
  // collapse the cone to nothing and read "JANGKAUAN 0%".
  for (const bad of [undefined, null, NaN, 0, -1, 'x', {}]) {
    assert.equal(normalizeRangeScale(bad), CCTV_RANGE_DEFAULT, String(bad));
  }
  assert.equal(normalizeRangeScale(1.5), 1.5);
  assert.equal(normalizeRangeScale('1.5'), 1.5, 'numeric strings are a scale');
});

test('the readout says what the cone is doing', () => {
  assert.equal(rangeLabel(1), 'JANGKAUAN 100%');
  assert.equal(rangeLabel(0.35), 'JANGKAUAN 35%');
  assert.equal(rangeLabel(3), 'JANGKAUAN 300%');
  assert.equal(rangeLabel(0.35000000000000003), 'JANGKAUAN 35%', 'no 35.000000001%');
  assert.equal(rangeLabel(undefined), 'JANGKAUAN 100%');
});
