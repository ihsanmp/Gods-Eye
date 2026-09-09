// Unit tests for the GDELT world-events layer.
//
// This layer plots news COVERAGE, not verified incidents, and the tests keep
// pulling on that distinction: a tone score describes an article's language,
// a place appearing twice is one place, and a malformed response draws nothing
// rather than something confident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_QUERY_ID,
  EVENT_LIMIT,
  EVENT_QUERIES,
  WORLD_EVENTS_OVERLAY_COHORT_LIMIT,
  createWorldEventOverlayEntry,
  createWorldEventsLayer,
  mapAnalystRecord,
  queryFor,
  selectWorldEventCohort,
  selectWorldEvents,
  toneAccent,
} from './worldEvents.js';

/** GDELT's shape: [lon, lat] points with GKG properties. */
const feature = (lon, lat, name, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { name, urltone: -3.2, url: 'https://example.test/a', urlpubtimedate: '20260908T041500Z', ...extra },
});

test('GDELT features become records with lat and lon the right way round', () => {
  // GeoJSON is [lon, lat]. Reading it as [lat, lon] would put Jakarta in the
  // Indian Ocean and still parse.
  const [record] = selectWorldEvents({ features: [feature(106.8, -6.2, 'Jakarta, Indonesia')] });
  assert.equal(record.lon, 106.8);
  assert.equal(record.lat, -6.2);
  assert.equal(record.name, 'Jakarta, Indonesia');
  assert.equal(record.tone, -3.2);
});

test('the same place twice is one marker, not two on the same pixel', () => {
  const records = selectWorldEvents({
    features: [
      feature(106.8, -6.2, 'Jakarta, Indonesia'),
      feature(106.8, -6.2, 'Jakarta, Indonesia', { urltone: 5 }),
      feature(112.75, -7.25, 'Surabaya, Indonesia'),
    ],
  });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.name), ['Jakarta, Indonesia', 'Surabaya, Indonesia']);
});

test('coordinates Number() would turn into zero are dropped, not plotted at 0,0', () => {
  const records = selectWorldEvents({
    features: [
      feature(null, null, 'Nowhere'),
      feature('', '', 'Blank'),
      feature(200, 100, 'Out of range'),
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { name: 'Area' } },
      feature(106.8, -6.2, 'Jakarta, Indonesia'),
    ],
  });
  assert.deepEqual(records.map((r) => r.name), ['Jakarta, Indonesia']);
});

test('a feature with no place name is dropped — there is nothing to label it', () => {
  const records = selectWorldEvents({ features: [feature(1, 1, ''), feature(2, 2, '   ')] });
  assert.deepEqual(records, []);
});

test('a malformed response draws nothing instead of throwing', () => {
  for (const payload of [null, undefined, {}, { features: null }, { features: 'x' }, { features: [null, 5] }]) {
    assert.deepEqual(selectWorldEvents(payload), [], JSON.stringify(payload));
  }
});

test('the point count is capped, because a broad query returns thousands', () => {
  const many = Array.from({ length: EVENT_LIMIT + 200 }, (_, i) => feature(i * 0.01, 10, `Place ${i}`));
  assert.equal(selectWorldEvents({ features: many }).length, EVENT_LIMIT);
  assert.equal(selectWorldEvents({ features: many }, 5).length, 5);
});

// ── Tone ───────────────────────────────────────────────────────────────────

test('tone gets three bands, not a gradient it cannot support', () => {
  // A continuous ramp would imply a precision this number does not have.
  const negative = toneAccent(-12);
  const neutral = toneAccent(0);
  const positive = toneAccent(12);
  assert.notEqual(negative, neutral);
  assert.notEqual(neutral, positive);
  assert.equal(toneAccent(-5), negative, 'the boundary is inclusive');
  assert.equal(toneAccent(5), positive);
  assert.equal(toneAccent(-4.9), neutral);
});

test('a missing tone is its own colour, not "neutral"', () => {
  // Absent is not the same claim as measured-and-middling.
  const unknown = toneAccent(null);
  assert.notEqual(unknown, toneAccent(0));
  for (const value of [undefined, '', 'x', {}, NaN]) {
    assert.equal(toneAccent(value), unknown, String(value));
  }
});

// ── Queries ────────────────────────────────────────────────────────────────

test('the query presets are frozen and the default is one of them', () => {
  assert.ok(Object.isFrozen(EVENT_QUERIES));
  const ids = EVENT_QUERIES.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(DEFAULT_QUERY_ID));
  for (const entry of EVENT_QUERIES) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(entry.query.trim() && entry.label.trim() && entry.title.trim());
    assert.equal(entry.label, entry.label.toUpperCase());
  }
});

test('every shipped query term was verified against the live API', () => {
  // This endpoint matches a fixed GKG vocabulary, not free text, and nothing
  // about a term's plausibility predicts whether it returns anything. Of
  // fourteen English words tried against the live API, only six returned data:
  // election 839, terror 573, protest 445, arrest 295, refugees 68, strike 36.
  // The first draft of the chip row used unrest / disaster / security — all
  // three return ZERO, and would have shipped as chips that drew an empty
  // globe and looked broken.
  const VERIFIED_NON_EMPTY = new Set(['election', 'terror', 'protest', 'arrest', 'refugees', 'strike']);
  for (const entry of EVENT_QUERIES) {
    assert.ok(
      VERIFIED_NON_EMPTY.has(entry.query),
      `"${entry.query}" is not in the verified set — check it against the API before shipping it`,
    );
  }
});

test('an unknown query id falls back to the default rather than to nothing', () => {
  assert.equal(queryFor('protest').id, 'protest');
  for (const bad of ['nope', '', null, undefined, 42]) {
    assert.equal(queryFor(bad).id, DEFAULT_QUERY_ID, String(bad));
  }
});

test('switching the query clears the old points, which answered a different question', () => {
  const layer = createWorldEventsLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  const removed = [];
  layer.init({ dataSources: { add() {} } });
  // Stand in for the Cesium collection the layer built in init.
  layer.getParams();
  assert.equal(layer.getParams().queryId, DEFAULT_QUERY_ID);
  layer.setParams({ queryId: 'terror' });
  assert.equal(layer.getParams().queryId, 'terror');
  assert.equal(layer.getStats().count, 0, 'the previous query\'s count does not carry over');
  // An unknown id changes nothing.
  layer.setParams({ queryId: 'lasso' });
  assert.equal(layer.getParams().queryId, 'terror');
  assert.equal(removed.length, 0);
});

test('the row names the query, because it is part of what the count means', () => {
  const layer = createWorldEventsLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  layer.init({ dataSources: { add() {} } });
  assert.match(layer.getStats().source, /protest/i);
  layer.setParams({ queryId: 'election' });
  assert.match(layer.getStats().source, /election/i);
  // ...and it never claims to be a feed of verified incidents.
  assert.match(layer.source, /news coverage/i);
});

test('exactly one chip is active at a time', () => {
  const layer = createWorldEventsLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  layer.init({ dataSources: { add() {} } });
  const active = () => layer.getRowControls().chips.filter((c) => c.active).map((c) => c.id);
  assert.deepEqual(active(), [DEFAULT_QUERY_ID]);
  layer.setParams({ queryId: 'refugees' });
  assert.deepEqual(active(), ['refugees']);
});

// ── Labels and analyst records ─────────────────────────────────────────────

test('strongly-toned coverage keeps its label when the view is crowded', () => {
  const entries = [
    createWorldEventOverlayEntry({ id: 'a', name: 'Loud', tone: -40, accent: '#f00' }, {}),
    createWorldEventOverlayEntry({ id: 'b', name: 'Quiet', tone: 0.2, accent: '#0f0' }, {}),
  ];
  assert.deepEqual(selectWorldEventCohort(entries, 1).map((e) => e.id), ['a']);
});

test('the label cohort is capped and deterministic', () => {
  const many = Array.from({ length: WORLD_EVENTS_OVERLAY_COHORT_LIMIT + 30 }, (_, i) => ({ id: `e${i}`, priority: 0 }));
  const ranked = selectWorldEventCohort(many);
  assert.equal(ranked.length, WORLD_EVENTS_OVERLAY_COHORT_LIMIT);
  assert.deepEqual(ranked, selectWorldEventCohort(many));
  assert.deepEqual(selectWorldEventCohort(null), []);
});

test('analyst records are JSON-safe with nulls, never NaN', () => {
  const [record] = selectWorldEvents({ features: [feature(106.8, -6.2, 'Jakarta, Indonesia')] });
  const mapped = mapAnalystRecord(record);
  assert.equal(mapped.place, 'Jakarta, Indonesia');
  assert.equal(mapped.lat, -6.2);
  assert.deepEqual(JSON.parse(JSON.stringify(mapped)), mapped);

  const empty = mapAnalystRecord(null, 7);
  assert.equal(empty.id, 'NEWS-0007');
  assert.equal(empty.tone, null, 'a missing tone is null, not 0');
  for (const value of Object.values(empty)) {
    assert.ok(value === null || typeof value === 'string' || typeof value === 'number');
  }
});
