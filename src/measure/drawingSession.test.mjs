// Unit tests for the drawing-tool state machine.
//
// The bugs this shape of code attracts are all about WHEN a shape is finished:
// a box that waits for a gesture it does not need, a polygon that completes
// itself into a triangle the operator did not want, a click on empty sky that
// appends a null vertex. Each has a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureShape } from './measureGeometry.js';
import {
  DRAWING_MODES,
  DRAWING_MODE_IDS,
  addPoint,
  chooseShape,
  clearDrawing,
  createSession,
  finish,
  modeFor,
  promptFor,
  toShape,
  undo,
} from './drawingSession.js';

const P = (lat, lon) => ({ lat, lon });
/** Apply a run of clicks. */
const clicks = (state, ...points) => points.reduce((s, p) => addPoint(s, p), state);

test('a fresh session has no tool and nothing drawn', () => {
  const state = createSession();
  assert.equal(state.mode, null);
  assert.deepEqual(state.points, []);
  assert.equal(state.complete, false);
  assert.equal(toShape(state), null);
});

test('clicks are ignored until a shape is chosen', () => {
  const state = addPoint(createSession(), P(0, 0));
  assert.deepEqual(state.points, [], 'a click with no tool armed does nothing');
});

// ── Two-click shapes complete themselves ───────────────────────────────────

test('a box completes on its second corner, with no extra gesture', () => {
  let state = chooseShape(createSession(), 'box');
  state = addPoint(state, P(-8, 105));
  assert.equal(state.complete, false, 'one corner is not a box');
  state = addPoint(state, P(-6, 115));
  assert.equal(state.complete, true, 'the second corner finishes it');

  const shape = toShape(state);
  assert.equal(shape.kind, 'box');
  assert.equal(shape.points.length, 4, 'two corners become four');
});

test('a radius is measured from the two clicks, not typed anywhere', () => {
  let state = chooseShape(createSession(), 'radius');
  state = clicks(state, P(-7.8, 110.4), P(-7.25, 112.75));
  assert.equal(state.complete, true);
  const shape = toShape(state);
  assert.equal(shape.kind, 'circle');
  assert.deepEqual(shape.center, P(-7.8, 110.4));
  // Yogyakarta to Surabaya, about 260 km.
  assert.ok(shape.radiusKm > 250 && shape.radiusKm < 275, `radius ${shape.radiusKm}`);
});

test('a completed shape ignores further clicks', () => {
  let state = chooseShape(createSession(), 'box');
  state = clicks(state, P(0, 0), P(1, 1), P(2, 2), P(3, 3));
  assert.equal(state.points.length, 2, 'clicks after completion are dropped');
});

// ── Open-ended shapes wait to be told ──────────────────────────────────────

test('a polygon never completes itself, however many corners are clicked', () => {
  let state = chooseShape(createSession(), 'area');
  state = clicks(state, P(0, 0), P(0, 1), P(1, 1), P(1, 0), P(0.5, -0.5));
  assert.equal(state.complete, false, 'the operator decides when an area is done');
  assert.equal(state.points.length, 5);
  state = finish(state);
  assert.equal(state.complete, true);
});

test('finishing below the minimum is refused rather than producing a flat shape', () => {
  // Two points "finished" as an area would measure zero, which reads as a
  // broken measurement rather than an unfinished one.
  let state = chooseShape(createSession(), 'area');
  state = clicks(state, P(0, 0), P(0, 1));
  assert.equal(finish(state).complete, false);
  assert.equal(toShape(state), null, 'and there is nothing to measure yet');

  state = addPoint(state, P(1, 1));
  assert.equal(finish(state).complete, true);
});

test('a path needs two points and encloses nothing', () => {
  let state = chooseShape(createSession(), 'path');
  state = addPoint(state, P(-6.2, 106.8));
  assert.equal(finish(state).complete, false, 'one point is not a route');
  state = addPoint(state, P(-7.25, 112.75));
  state = finish(state);
  assert.equal(state.complete, true);

  const measured = measureShape(toShape(state));
  assert.equal(measured.areaKm2, 0);
  assert.ok(measured.perimeterKm > 600, `route length ${measured.perimeterKm}`);
});

// ── Click hygiene ──────────────────────────────────────────────────────────

test('a click that picked nothing does not append a null vertex', () => {
  // Clicking empty sky picks no world position, and the handler passes that on
  // as-is rather than inventing a coordinate.
  let state = chooseShape(createSession(), 'area');
  for (const junk of [null, undefined, {}, { lat: null, lon: null }, { lat: 'x', lon: 5 }, { lat: 91, lon: 0 }]) {
    state = addPoint(state, junk);
  }
  assert.deepEqual(state.points, [], JSON.stringify(state.points));
});

test('clicking the same spot twice does not create a zero-size shape', () => {
  // A double-click that lands as two identical points would otherwise finish a
  // box with no extent and report 0 km² as a measurement.
  let state = chooseShape(createSession(), 'box');
  state = clicks(state, P(-7.8, 110.4), P(-7.8, 110.4));
  assert.equal(state.points.length, 1);
  assert.equal(state.complete, false);
});

// ── Getting out of trouble ─────────────────────────────────────────────────

test('re-choosing the same tool restarts the drawing', () => {
  // How someone recovers from a misclick. A no-op here would leave them stuck
  // with a shape they can only escape by finishing it.
  let state = chooseShape(createSession(), 'area');
  state = clicks(state, P(0, 0), P(0, 1), P(1, 1));
  state = chooseShape(state, 'area');
  assert.deepEqual(state.points, []);
  assert.equal(state.mode, 'area');
});

test('undo removes the last point and re-opens a finished shape', () => {
  let state = chooseShape(createSession(), 'box');
  state = clicks(state, P(0, 0), P(1, 1));
  assert.equal(state.complete, true);
  state = undo(state);
  assert.equal(state.complete, false, 'an over-click can be taken back');
  assert.equal(state.points.length, 1);
  state = undo(state);
  assert.deepEqual(state.points, []);
  assert.equal(undo(state).points.length, 0, 'undo on an empty drawing is safe');
});

test('clearing keeps the tool armed', () => {
  let state = chooseShape(createSession(), 'path');
  state = clicks(state, P(0, 0), P(1, 1));
  state = clearDrawing(state);
  assert.equal(state.mode, 'path', 'the next shape needs no re-arming');
  assert.deepEqual(state.points, []);
});

test('an unknown tool returns to idle instead of throwing', () => {
  assert.equal(chooseShape(createSession(), 'lasso').mode, null);
  assert.equal(chooseShape(createSession(), '').mode, null);
  assert.equal(modeFor('lasso'), null);
});

// ── State is never mutated in place ────────────────────────────────────────

test('every transition returns a new frozen state', () => {
  // The renderer diffs against the previous state to decide what to redraw; a
  // mutated-in-place state would always compare a thing to itself.
  const first = chooseShape(createSession(), 'area');
  const second = addPoint(first, P(0, 0));
  assert.notEqual(first, second);
  assert.deepEqual(first.points, [], 'the earlier state is untouched');
  assert.ok(Object.isFrozen(second));
  assert.ok(Object.isFrozen(second.points));
  assert.throws(() => { second.points.push(P(9, 9)); }, TypeError);
});

// ── The prompt line ────────────────────────────────────────────────────────

test('the prompt says what each state is waiting for', () => {
  assert.match(promptFor(createSession()), /choose a shape/i);

  let box = chooseShape(createSession(), 'box');
  assert.match(promptFor(box), /one corner/i);
  box = addPoint(box, P(0, 0));
  assert.match(promptFor(box), /opposite corner/i);
  box = addPoint(box, P(1, 1));
  assert.match(promptFor(box), /complete/i);

  let radius = chooseShape(createSession(), 'radius');
  assert.match(promptFor(radius), /centre/i);
  radius = addPoint(radius, P(0, 0));
  assert.match(promptFor(radius), /distance/i);

  let area = chooseShape(createSession(), 'area');
  area = addPoint(area, P(0, 0));
  assert.match(promptFor(area), /2 more corners/i);
  area = clicks(area, P(0, 1), P(1, 1));
  assert.match(promptFor(area), /double-click to finish/i);
});

test('the mode registry is frozen and matches the panel', () => {
  assert.ok(Object.isFrozen(DRAWING_MODES));
  assert.deepEqual(DRAWING_MODE_IDS, ['area', 'box', 'radius', 'path']);
  for (const mode of DRAWING_MODES) {
    assert.ok(Object.isFrozen(mode));
    assert.ok(mode.label.trim() && mode.hint.trim(), `${mode.id} needs a label and a hint`);
    assert.ok(mode.minPoints >= 2);
    assert.ok(mode.exactPoints === null || mode.exactPoints === mode.minPoints);
  }
});
