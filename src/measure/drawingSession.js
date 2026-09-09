// src/measure/drawingSession.js
/**
 * The drawing tools' state machine, with no Cesium and no DOM in it.
 *
 * Four shapes, each with its own idea of when it is finished, and that
 * difference is the whole reason this is a module rather than a few flags on a
 * click handler:
 *
 *   BOX and RADIUS take exactly two clicks and complete THEMSELVES. Waiting for
 *   a double-click after the second corner would be asking for a gesture that
 *   adds nothing.
 *
 *   AREA and PATH take as many clicks as the operator wants, so only they can
 *   say when they are done. They complete on an explicit finish.
 *
 * Every transition returns a NEW state object. The renderer diffs against the
 * previous one to decide what to redraw, and a mutated-in-place state would
 * make that diff always compare a thing to itself.
 *
 * @module measure/drawingSession
 */

import { boxRing, normalizePoint, haversineKm } from './measureGeometry.js';

/** The four tools, in panel order. */
export const DRAWING_MODES = Object.freeze([
  Object.freeze({
    id: 'area',
    label: 'AREA',
    hint: 'Any shape, corner by corner',
    shape: 'polygon',
    minPoints: 3,
    /** null = the operator decides when it is finished. */
    exactPoints: null,
  }),
  Object.freeze({
    id: 'box',
    label: 'BOX',
    hint: 'Two clicks, opposite corners',
    shape: 'box',
    minPoints: 2,
    exactPoints: 2,
  }),
  Object.freeze({
    id: 'radius',
    label: 'RADIUS',
    hint: 'Centre, then distance out',
    shape: 'circle',
    minPoints: 2,
    exactPoints: 2,
  }),
  Object.freeze({
    id: 'path',
    label: 'PATH',
    hint: 'Measure a route',
    shape: 'path',
    minPoints: 2,
    exactPoints: null,
  }),
]);

export const DRAWING_MODE_IDS = Object.freeze(DRAWING_MODES.map((m) => m.id));

const MODE_BY_ID = new Map(DRAWING_MODES.map((mode) => [mode.id, mode]));

/** The mode descriptor for an id, or null. */
export function modeFor(id) {
  return MODE_BY_ID.get(String(id || '').toLowerCase()) || null;
}

/** A session with no shape chosen and nothing drawn. */
export function createSession() {
  return Object.freeze({ mode: null, points: [], complete: false });
}

/**
 * Choose (or re-choose) a shape.
 *
 * Re-choosing the SAME mode clears the drawing rather than doing nothing:
 * clicking AREA again while half-way through a polygon is how someone restarts
 * after a misclick, and a no-op there would leave them stuck with a shape they
 * cannot get rid of except by drawing it.
 *
 * An unknown mode returns to idle rather than throwing.
 *
 * @param {object} state
 * @param {string} modeId
 * @returns {object} A new state.
 */
export function chooseShape(state, modeId) {
  const mode = modeFor(modeId);
  if (!mode) return createSession();
  return Object.freeze({ mode: mode.id, points: [], complete: false });
}

/**
 * Add a clicked point.
 *
 * Ignored when no shape is chosen, when the session is already complete, or
 * when the point is not a usable coordinate — a click on empty sky picks
 * nothing, and that must not append a null vertex.
 *
 * @param {object} state
 * @param {object} point `{lat, lon}`.
 * @returns {object} A new state, or the same one when the click is ignored.
 */
export function addPoint(state, point) {
  const mode = modeFor(state?.mode);
  if (!mode || state.complete) return state;
  const normalized = normalizePoint(point);
  if (!normalized) return state;

  // A second click in the same spot cannot define a box or a radius, and would
  // report a zero-area shape as if it were a measurement.
  const previous = state.points[state.points.length - 1];
  if (previous && haversineKm(previous, normalized) === 0) return state;

  const points = [...state.points, normalized];
  const complete = mode.exactPoints !== null && points.length >= mode.exactPoints;
  return Object.freeze({ mode: mode.id, points: Object.freeze(points), complete });
}

/**
 * Finish a shape the operator controls the length of.
 *
 * Refused below the minimum: finishing a two-point "area" would produce a line
 * the panel would then report an area of zero for, which reads as a broken
 * measurement rather than an unfinished one.
 *
 * @param {object} state
 * @returns {object}
 */
export function finish(state) {
  const mode = modeFor(state?.mode);
  if (!mode || state.complete) return state;
  if (state.points.length < mode.minPoints) return state;
  return Object.freeze({ ...state, complete: true });
}

/** Remove the last point. Also un-completes a finished shape, so an over-click can be taken back. */
export function undo(state) {
  const mode = modeFor(state?.mode);
  if (!mode || !state.points.length) return state;
  const points = state.points.slice(0, -1);
  return Object.freeze({ mode: mode.id, points: Object.freeze(points), complete: false });
}

/** Clear the drawing but KEEP the chosen tool, so the next shape needs no re-arming. */
export function clearDrawing(state) {
  const mode = modeFor(state?.mode);
  if (!mode) return createSession();
  return Object.freeze({ mode: mode.id, points: [], complete: false });
}

/**
 * The shape this session describes, in the form `measureShape` takes.
 *
 * Returns null while there is not yet enough to measure, so callers never have
 * to distinguish "no shape" from "a shape worth zero".
 *
 * @param {object} state
 * @returns {object|null}
 */
export function toShape(state) {
  const mode = modeFor(state?.mode);
  if (!mode) return null;
  const points = state.points || [];

  if (mode.shape === 'circle') {
    if (points.length < 2) return null;
    // The first click is the centre and the second sets the distance, so the
    // radius is a measurement rather than a number typed anywhere.
    return { kind: 'circle', center: points[0], radiusKm: haversineKm(points[0], points[1]) };
  }
  if (mode.shape === 'box') {
    if (points.length < 2) return null;
    return { kind: 'box', points: boxRing(points[0], points[1]) };
  }
  if (mode.shape === 'path') {
    if (points.length < 2) return null;
    return { kind: 'path', points: [...points] };
  }
  if (points.length < 3) return null;
  return { kind: 'polygon', points: [...points] };
}

/**
 * What the panel should say right now.
 *
 * One sentence per state, because the panel's instruction line is the only
 * thing telling someone what a half-drawn shape is waiting for.
 *
 * @param {object} state
 * @returns {string}
 */
export function promptFor(state) {
  const mode = modeFor(state?.mode);
  if (!mode) return 'Choose a shape above, then click the map to measure an area and see what is inside it.';
  const count = state.points?.length || 0;
  if (state.complete) return `${mode.label} complete — click a shape to start another.`;

  if (mode.id === 'box') {
    return count === 0 ? 'Click one corner of the box.' : 'Click the opposite corner.';
  }
  if (mode.id === 'radius') {
    return count === 0 ? 'Click the centre.' : 'Click to set the distance out.';
  }
  if (mode.id === 'path') {
    if (count === 0) return 'Click the start of the route.';
    if (count === 1) return 'Click the next point. Double-click to finish.';
    return `${count} points — double-click to finish.`;
  }
  if (count === 0) return 'Click the first corner.';
  if (count < mode.minPoints) {
    const need = mode.minPoints - count;
    return `${need} more ${need === 1 ? 'corner' : 'corners'} needed.`;
  }
  return `${count} corners — double-click to finish.`;
}
