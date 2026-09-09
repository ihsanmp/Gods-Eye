// Unit tests for the NASA EONET severe-weather layer.
//
// The two failures that matter here are both about telling the user something
// false: plotting an event where it ISN'T (an old track point, or a coordinate
// that Number() turned into 0), and double-counting fires and quakes this app
// already draws from better sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEVERE_WEATHER_CATEGORIES,
  SEVERE_WEATHER_OVERLAY_COHORT_LIMIT,
  TRACK_MAX_POINTS,
  createSevereWeatherOverlayEntry,
  eventTrack,
  magnitudeLabel,
  mapAnalystRecord,
  selectSevereWeatherCohort,
  selectSevereWeatherEvents,
} from './severeWeather.js';

/** One EONET event with a two-point track. */
const cyclone = {
  id: 'EONET_23800',
  title: 'Cyclone Marie',
  categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
  geometry: [
    { type: 'Point', date: '2026-09-06T12:00:00Z', coordinates: [-120.0, 20.0], magnitudeValue: 25, magnitudeUnit: 'kts' },
    { type: 'Point', date: '2026-09-08T12:00:00Z', coordinates: [-127.1, 25.5], magnitudeValue: 35, magnitudeUnit: 'kts' },
  ],
};

const wildfire = {
  id: 'EONET_9001',
  title: 'Wildfire - Somewhere',
  categories: [{ id: 'wildfires', title: 'Wildfires' }],
  geometry: [{ type: 'Point', date: '2026-09-08T00:00:00Z', coordinates: [110.0, -7.0] }],
};

const quake = {
  id: 'EONET_9002',
  title: 'Earthquake - Somewhere',
  categories: [{ id: 'earthquakes', title: 'Earthquakes' }],
  geometry: [{ type: 'Point', date: '2026-09-08T00:00:00Z', coordinates: [111.0, -7.5] }],
};

const flood = {
  id: 'EONET_9003',
  title: 'Floods - Java',
  categories: [{ id: 'floods', title: 'Floods' }],
  geometry: [{ type: 'Point', date: '2026-09-08T00:00:00Z', coordinates: [110.4, -7.8] }],
};

test('an event is placed where it is NOW, not where it was named', () => {
  const [record] = selectSevereWeatherEvents({ events: [cyclone] });
  // A cyclone's first point can be days and hundreds of kilometres behind it.
  assert.equal(record.lon, -127.1);
  assert.equal(record.lat, 25.5);
  assert.equal(record.date, '2026-09-08T12:00:00Z');
  assert.equal(record.magnitude, 35);
  // ...and the earlier points survive as the track drawn behind it.
  assert.equal(record.track.length, 2);
  assert.equal(record.track[0].lon, -120.0);
});

test('wildfires and earthquakes are excluded — this app already draws both', () => {
  const records = selectSevereWeatherEvents({ events: [cyclone, wildfire, quake, flood] });
  const ids = records.map((r) => r.id);
  assert.deepEqual(ids.sort(), ['EONET_23800', 'EONET_9003']);
  // Including them would plot the same real fire twice, from FIRMS and from
  // EONET, and an operator counting fires would get two different numbers.
  assert.ok(!ids.includes('EONET_9001'), 'wildfires belong to local-firms');
  assert.ok(!ids.includes('EONET_9002'), 'earthquakes belong to the USGS layer');
});

test('the category allowlist is weather, and says so honestly', () => {
  // A row labelled "Severe Weather" that quietly included volcanoes would be
  // lying to whoever reads its count.
  for (const excluded of ['wildfires', 'earthquakes', 'volcanoes', 'landslides', 'seaLakeIce']) {
    assert.ok(!SEVERE_WEATHER_CATEGORIES.includes(excluded), `${excluded} must not be in this layer`);
  }
  for (const included of ['severeStorms', 'floods', 'drought', 'dustHaze']) {
    assert.ok(SEVERE_WEATHER_CATEGORIES.includes(included));
  }
});

test('a coordinate that Number() would turn into zero is dropped, not plotted at 0,0', () => {
  const broken = {
    events: [
      { id: 'a', title: 'Null coords', categories: [{ id: 'floods' }], geometry: [{ type: 'Point', coordinates: [null, null] }] },
      { id: 'b', title: 'Blank coords', categories: [{ id: 'floods' }], geometry: [{ type: 'Point', coordinates: ['', ''] }] },
      { id: 'c', title: 'Out of range', categories: [{ id: 'floods' }], geometry: [{ type: 'Point', coordinates: [200, 100] }] },
      { id: 'd', title: 'Real', categories: [{ id: 'floods' }], geometry: [{ type: 'Point', coordinates: [110, -7] }] },
    ],
  };
  const ids = selectSevereWeatherEvents(broken).map((r) => r.id);
  assert.deepEqual(ids, ['d'], 'only the real coordinate survives');
});

test('non-Point geometry is skipped rather than approximated', () => {
  // Inventing a centroid would place a flood somewhere no source ever said.
  const polygonOnly = {
    events: [{
      id: 'poly', title: 'Polygon flood', categories: [{ id: 'floods' }],
      geometry: [{ type: 'Polygon', coordinates: [[[110, -7], [111, -7], [111, -8]]] }],
    }],
  };
  assert.deepEqual(selectSevereWeatherEvents(polygonOnly), []);
});

test('a long-lived storm keeps its RECENT path, not its opening segment', () => {
  const long = {
    id: 'long', title: 'Long storm', categories: [{ id: 'severeStorms' }],
    geometry: Array.from({ length: TRACK_MAX_POINTS + 15 }, (_, i) => ({
      type: 'Point', date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
      coordinates: [100 + i * 0.1, 10],
    })),
  };
  const [record] = selectSevereWeatherEvents({ events: [long] });
  assert.equal(record.track.length, TRACK_MAX_POINTS);
  // Trimmed from the START: the last point must still be the current position.
  assert.equal(record.track[record.track.length - 1].lon, record.lon);
  assert.ok(record.track[0].lon > 100, 'the stale opening segment is what gets dropped');
});

test('a malformed payload draws nothing instead of throwing', () => {
  for (const payload of [null, undefined, {}, { events: null }, { events: 'nope' }, { events: [null, 42] }]) {
    assert.deepEqual(selectSevereWeatherEvents(payload), [], JSON.stringify(payload));
  }
});

test('an event with no id is dropped — it could not be updated or de-duplicated', () => {
  const anonymous = { events: [{ title: 'No id', categories: [{ id: 'floods' }], geometry: [{ type: 'Point', coordinates: [1, 1] }] }] };
  assert.deepEqual(selectSevereWeatherEvents(anonymous), []);
});

test('magnitudeLabel says nothing rather than "null"', () => {
  assert.equal(magnitudeLabel({ magnitude: 35, magnitudeUnit: 'kts' }), '35 kts');
  assert.equal(magnitudeLabel({ magnitude: 35, magnitudeUnit: '' }), '35');
  // Most EONET categories carry no magnitude at all.
  assert.equal(magnitudeLabel({ magnitude: null, magnitudeUnit: 'kts' }), null);
  assert.equal(magnitudeLabel({}), null);
  assert.equal(magnitudeLabel(null), null);
});

test('a label without a magnitude is just the title, with no trailing separator', () => {
  const [record] = selectSevereWeatherEvents({ events: [flood] });
  const entry = createSevereWeatherOverlayEntry(record, {});
  assert.equal(entry.title, 'Floods - Java');
  assert.ok(!entry.title.includes('·'));
});

test('storms outrank slow events so the weakest label is dropped first', () => {
  const records = selectSevereWeatherEvents({ events: [cyclone, flood] });
  const entries = records.map((r) => createSevereWeatherOverlayEntry(r, {}));
  const ranked = selectSevereWeatherCohort(entries, 1);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'EONET_23800', 'the cyclone outranks the flood');
});

test('the cohort is capped and deterministic', () => {
  const many = Array.from({ length: SEVERE_WEATHER_OVERLAY_COHORT_LIMIT + 20 }, (_, i) => ({
    id: `e${i}`, priority: 0,
  }));
  const ranked = selectSevereWeatherCohort(many);
  assert.equal(ranked.length, SEVERE_WEATHER_OVERLAY_COHORT_LIMIT);
  // Equal priorities tie-break on id, so two runs cannot disagree about which
  // labels are on screen.
  assert.deepEqual(ranked, selectSevereWeatherCohort(many));
  assert.deepEqual(selectSevereWeatherCohort(many, 0), []);
  assert.deepEqual(selectSevereWeatherCohort(null), []);
});

test('eventTrack is total for junk', () => {
  assert.deepEqual(eventTrack(null), []);
  assert.deepEqual(eventTrack({}), []);
  assert.deepEqual(eventTrack({ geometry: 'nope' }), []);
  assert.deepEqual(eventTrack({ geometry: [{ type: 'Point' }] }), []);
});

test('analyst records are JSON-safe with nulls, never NaN or undefined', () => {
  const [record] = selectSevereWeatherEvents({ events: [flood] });
  const mapped = mapAnalystRecord(record);
  assert.equal(mapped.id, 'EONET_9003');
  assert.equal(mapped.category, 'Floods');
  assert.equal(mapped.magnitude, null, 'a missing magnitude is null, not 0');
  assert.equal(mapped.magnitudeUnit, null);
  assert.equal(JSON.parse(JSON.stringify(mapped)).lat, -7.8);

  const empty = mapAnalystRecord(null, 3);
  assert.equal(empty.id, 'EONET-0003');
  for (const value of Object.values(empty)) {
    assert.ok(value === null || typeof value === 'string', `${value} must be null or a string`);
  }
});
