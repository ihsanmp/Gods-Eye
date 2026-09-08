/*
 * How big the CCTV cone is thrown across the map.
 *
 * This is the projection on the globe, not the video panel: the same quantity
 * ADJUST edits by dragging a range handle in the world. Pulling the stepping
 * rules out here keeps them testable, because the button wiring in ui.js needs
 * a live DOM and a Cesium viewer and this does not.
 */

/**
 * The stops, as multipliers on a camera's surveyed range.
 *
 * The ends are the layer's own clamp (`normalizeCalibration` bounds rangeScale
 * to 0.35-3.0), so no stop here can be rejected on arrival. 1 is deliberately a
 * stop, so RESET and stepping agree on what "as surveyed" means.
 */
export const CCTV_RANGE_STEPS = Object.freeze([0.35, 0.5, 0.75, 1, 1.5, 2, 2.5, 3]);

/** The surveyed range: what RESET returns to. */
export const CCTV_RANGE_DEFAULT = 1;

/**
 * Tolerance for comparing a stored scale against a stop.
 *
 * The layer quantizes what it stores, so 0.35 comes back as
 * 0.35000000000000003 — which is not `<= 0.35`. Comparing exactly left the
 * minus button live at the bottom stop, where pressing it did nothing.
 */
const EPSILON = 1e-6;

/** @param {unknown} value @returns {number} A usable scale, or the default. */
export function normalizeRangeScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : CCTV_RANGE_DEFAULT;
}

/**
 * The next stop in a direction, starting from wherever the camera actually is.
 *
 * The current scale is NOT necessarily a stop: ADJUST drags are continuous and
 * a saved calibration can hold anything in range. So the move is taken from the
 * NEAREST stop — and when the current value sits BETWEEN stops, stepping away
 * from it must pass the stop it rounded to rather than landing back on it.
 * Without that, the first press after a drag jumps somewhere with no relation
 * to the cone on screen.
 *
 * @param {number} current - Current range multiplier.
 * @param {number} delta - -1 to shrink, +1 to enlarge.
 * @returns {number|null} The next multiplier, or null at the end of the range.
 */
export function nextRangeStep(current, delta) {
  const from = normalizeRangeScale(current);
  const direction = Number(delta);
  if (direction !== 1 && direction !== -1) return null;

  let nearest = 0;
  for (let i = 1; i < CCTV_RANGE_STEPS.length; i += 1) {
    if (Math.abs(CCTV_RANGE_STEPS[i] - from) < Math.abs(CCTV_RANGE_STEPS[nearest] - from)) {
      nearest = i;
    }
  }

  const rounded = CCTV_RANGE_STEPS[nearest];
  let next = nearest + direction;
  // Rounding already moved in the direction asked for; take that stop instead.
  if (direction > 0 && rounded > from + EPSILON) next = nearest;
  if (direction < 0 && rounded < from - EPSILON) next = nearest;
  if (next < 0 || next >= CCTV_RANGE_STEPS.length) return null;
  return CCTV_RANGE_STEPS[next];
}

/** @param {number} scale @returns {boolean} At the smallest stop. */
export function atMinRange(scale) {
  return normalizeRangeScale(scale) <= CCTV_RANGE_STEPS[0] + EPSILON;
}

/** @param {number} scale @returns {boolean} At the largest stop. */
export function atMaxRange(scale) {
  return normalizeRangeScale(scale) >= CCTV_RANGE_STEPS[CCTV_RANGE_STEPS.length - 1] - EPSILON;
}

/** @param {number} scale @returns {string} Readout text, e.g. `JANGKAUAN 150%`. */
export function rangeLabel(scale) {
  return `JANGKAUAN ${Math.round(normalizeRangeScale(scale) * 100)}%`;
}
