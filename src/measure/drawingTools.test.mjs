// Unit tests for the drawing tools' non-Cesium logic: counting what falls
// inside a shape, and the readout the panel prints.
//
// The count is the part that can mislead. It sees only ENABLED layers, so the
// number is always partial — the tests pin that it says so, and that one broken
// layer cannot blank the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countInside, readoutFor } from './drawingTools.js';
import { boxRing } from './measureGeometry.js';
import { addPoint, chooseShape, createSession, finish } from './drawingSession.js';

const P = (lat, lon) => ({ lat, lon });
/** A box over Java: roughly 105-115E, 6-8S. */
const JAVA = { kind: 'box', points: boxRing(P(-8, 105), P(-6, 115)) };

/** A dataManager stand-in holding layers with fixed analyst records. */
function fakeManager(layers) {
  return {
    layers: new Map(layers.map((l) => [l.id, { module: l }])),
    isEnabled: (id) => layers.find((l) => l.id === id)?.enabled !== false,
  };
}

const layer = (id, name, records, extra = {}) => ({
  id, name, enabled: true,
  getAnalystRecords: () => records,
  ...extra,
});

test('records inside the shape are counted, and those outside are not', () => {
  const manager = fakeManager([
    layer('flights', 'Live Flights', [
      { id: 'a', lat: -7.8, lon: 110.4 },   // Yogyakarta, inside
      { id: 'b', lat: -6.2, lon: 106.8 },   // Jakarta, inside
      { id: 'c', lat: 1.35, lon: 103.8 },   // Singapore, outside
      { id: 'd', lat: 35.6, lon: 139.7 },   // Tokyo, outside
    ]),
  ]);
  const result = countInside(manager, JAVA);
  assert.equal(result.total, 2);
  assert.deepEqual(result.byLayer, [{ id: 'flights', name: 'Live Flights', count: 2 }]);
});

test('a DISABLED layer is not counted', () => {
  // The count has to match what the operator can see. Including a layer they
  // switched off would be a wrong answer, not a generous one.
  const manager = fakeManager([
    layer('flights', 'Live Flights', [{ id: 'a', lat: -7.8, lon: 110.4 }]),
    { ...layer('military', 'Military Flights', [{ id: 'm', lat: -7.0, lon: 110.0 }]), enabled: false },
  ]);
  const result = countInside(manager, JAVA);
  assert.equal(result.total, 1);
  assert.equal(result.byLayer.length, 1);
  assert.equal(result.layersConsidered, 1);
});

test('layers with nothing inside are omitted rather than listed as zero', () => {
  const manager = fakeManager([
    layer('flights', 'Live Flights', [{ id: 'a', lat: -7.8, lon: 110.4 }]),
    layer('quakes', 'Earthquakes', [{ id: 'q', lat: 60, lon: 20 }]),
  ]);
  const result = countInside(manager, JAVA);
  assert.deepEqual(result.byLayer.map((e) => e.id), ['flights']);
});

test('one layer throwing does not blank the whole count', () => {
  const manager = fakeManager([
    { id: 'broken', name: 'Broken', enabled: true, getAnalystRecords() { throw new Error('boom'); } },
    layer('flights', 'Live Flights', [{ id: 'a', lat: -7.8, lon: 110.4 }]),
  ]);
  const result = countInside(manager, JAVA);
  assert.equal(result.total, 1, 'the working layer still reports');
});

test('layers with no analyst seam are skipped silently', () => {
  const manager = fakeManager([
    { id: 'cables', name: 'Submarine Cables', enabled: true },
    layer('flights', 'Live Flights', [{ id: 'a', lat: -7.8, lon: 110.4 }]),
  ]);
  assert.equal(countInside(manager, JAVA).total, 1);
});

test('records with unusable coordinates are not counted as inside', () => {
  // Number(null) is 0, and 0,0 is in the Gulf of Guinea — but a shape drawn
  // near there must still not swallow every record with a missing fix.
  const nullIsland = { kind: 'box', points: boxRing(P(-1, -1), P(1, 1)) };
  const manager = fakeManager([
    layer('flights', 'Live Flights', [
      { id: 'nofix', lat: null, lon: null },
      { id: 'blank', lat: '', lon: '' },
      { id: 'real', lat: 0.5, lon: 0.5 },
    ]),
  ]);
  assert.equal(countInside(manager, nullIsland).total, 1);
});

test('a record inside two overlapping AOIs is counted once', () => {
  // Two boxes over the same city must not report twice the aircraft there.
  const west = { kind: 'box', points: boxRing(P(-8, 105), P(-6, 111)) };
  const east = { kind: 'box', points: boxRing(P(-8, 109), P(-6, 115)) };
  const manager = fakeManager([
    layer('flights', 'Live Flights', [{ id: 'overlap', lat: -7, lon: 110 }]),
  ]);
  assert.equal(countInside(manager, [west]).total, 1);
  assert.equal(countInside(manager, [east]).total, 1);
  assert.equal(countInside(manager, [west, east]).total, 1, 'the overlap is not double-counted');
});

test('counting takes a list, so a finished AOI keeps its count', () => {
  // The bug this pins: the count was recomputed from the LIVE session, which is
  // cleared the instant a shape completes — so the number vanished at exactly
  // the moment the operator finished drawing.
  const manager = fakeManager([
    layer('flights', 'Live Flights', [{ id: 'a', lat: -7.8, lon: 110.4 }]),
  ]);
  const committedOnly = countInside(manager, [JAVA]);
  assert.equal(committedOnly.total, 1, 'a committed shape still counts with no live shape');
  // A single shape passed bare still works, for callers that have only one.
  assert.equal(countInside(manager, JAVA).total, 1);
});

test('counting is total for junk input', () => {
  assert.deepEqual(countInside(null, JAVA).total, 0);
  assert.deepEqual(countInside(fakeManager([]), null).total, 0);
  assert.deepEqual(countInside({}, JAVA).total, 0);
});

// ── The readout ────────────────────────────────────────────────────────────

const emptyInside = { total: 0, byLayer: [], layersConsidered: 0 };

test('the readout starts at zero and asks for a shape', () => {
  const readout = readoutFor(createSession(), [], emptyInside);
  assert.equal(readout.area, '0 km²');
  assert.equal(readout.aois, 0);
  assert.equal(readout.perimeter, '0 km');
  assert.match(readout.prompt, /choose a shape/i);
});

test('the numbers move while a shape is still being drawn', () => {
  // Waiting until the shape is finished would leave the readouts at zero
  // through the whole gesture, which reads as broken.
  let session = chooseShape(createSession(), 'box');
  session = addPoint(session, P(-8, 105));
  assert.equal(readoutFor(session, [], emptyInside).area, '0 km²', 'one corner is not an area yet');
  session = addPoint(session, P(-6, 115));
  const readout = readoutFor(session, [], emptyInside);
  assert.notEqual(readout.area, '0 km²');
  assert.match(readout.area, /km²/);
});

test('committed AOIs accumulate area and perimeter', () => {
  const one = { shape: JAVA, measured: { areaKm2: 100, perimeterKm: 40, measurable: true } };
  const two = { shape: JAVA, measured: { areaKm2: 150, perimeterKm: 60, measurable: true } };
  const readout = readoutFor(createSession(), [one, two], emptyInside);
  assert.equal(readout.aois, 2);
  // Both totals cross the 100 threshold where the formatter drops the decimal.
  assert.equal(readout.area, '250 km²');
  assert.equal(readout.perimeter, '100 km');

  // And below it, the decimal is kept — a 12 km² AOI reading "12 km²" would
  // lose the precision that matters at that size.
  const small = readoutFor(createSession(), [
    { shape: JAVA, measured: { areaKm2: 12.34, perimeterKm: 8.5, measurable: true } },
  ], emptyInside);
  assert.equal(small.area, '12.3 km²');
  assert.equal(small.perimeter, '8.5 km');
});

test('an unmeasurable shape says why instead of showing a zero', () => {
  // A date-line-crossing box would otherwise print "0 km²", which looks like a
  // measurement of nothing rather than a refusal to guess.
  let session = chooseShape(createSession(), 'box');
  session = addPoint(session, P(-10, 179));
  session = addPoint(session, P(10, -179));
  const readout = readoutFor(session, [], emptyInside);
  assert.match(readout.prompt, /cannot measure/i);
  assert.match(readout.prompt, /antimeridian/i);
});

test('a half-drawn shape is not called unmeasurable', () => {
  // "Cannot measure: needs three points" would be scolding someone mid-click.
  let session = chooseShape(createSession(), 'area');
  session = addPoint(session, P(0, 0));
  assert.doesNotMatch(readoutFor(session, [], emptyInside).prompt, /cannot measure/i);
});

test('a finished path reports its length as perimeter and no area', () => {
  let session = chooseShape(createSession(), 'path');
  session = addPoint(session, P(-6.2, 106.8));
  session = addPoint(session, P(-7.25, 112.75));
  session = finish(session);
  const readout = readoutFor(session, [], emptyInside);
  assert.equal(readout.area, '0 km²');
  assert.match(readout.perimeter, /^6[0-9][0-9] km$/, `got ${readout.perimeter}`);
});
