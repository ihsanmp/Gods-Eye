// Guards on the two bundled maritime datasets.
//
// These files are hand-built, which means the failure mode is a plausible-
// looking dot in the wrong ocean. Every coordinate was resolved through
// Nominatim before it was written down — that check caught a fast-food shop in
// Guernsey returned for "Port of Hong Kong" — but a later hand edit gets no
// such check, so the shape and the sanity of the data are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(
  new URL(`./local_data/maritime/${name}`, import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.trim())
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${name} line ${index + 1} is not JSON: ${error.message}`);
    }
  });

const PORTS = read('ports.geojsonl');
const CHOKEPOINTS = read('chokepoints.geojsonl');
const ALL = [...PORTS, ...CHOKEPOINTS];

test('both datasets are non-empty GeoJSON point features', () => {
  assert.ok(PORTS.length >= 25, `only ${PORTS.length} ports`);
  assert.ok(CHOKEPOINTS.length >= 15, `only ${CHOKEPOINTS.length} chokepoints`);
  for (const feature of ALL) {
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'Point');
    assert.equal(feature.geometry.coordinates.length, 2);
  }
});

test('every coordinate is a real number in range, and none sits at 0,0', () => {
  for (const feature of ALL) {
    const [lon, lat] = feature.geometry.coordinates;
    assert.equal(typeof lon, 'number', `${feature.id} longitude`);
    assert.equal(typeof lat, 'number', `${feature.id} latitude`);
    assert.ok(Number.isFinite(lon) && Number.isFinite(lat), `${feature.id} is not finite`);
    assert.ok(Math.abs(lat) <= 90, `${feature.id} latitude out of range`);
    assert.ok(Math.abs(lon) <= 180, `${feature.id} longitude out of range`);
    // Null Island is where a dropped or mistyped coordinate lands, and every
    // entry in these files is a real place that is not in the Gulf of Guinea.
    assert.ok(
      Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01,
      `${feature.id} sits at 0,0 — a lost coordinate, not a place`,
    );
  }
});

test('GeoJSON coordinate order is [lon, lat], not the other way round', () => {
  // The classic silent error: a swapped pair puts Rotterdam in Somalia and
  // still parses, still renders, still looks like data.
  const named = new Map(ALL.map((f) => [f.id, f.geometry.coordinates]));
  const expectations = [
    ['port-tanjung-priok', -6.11, 106.88],      // Jakarta: south of the equator, east
    ['port-rotterdam', 51.90, 4.43],            // Netherlands: far north, just east
    ['port-los-angeles', 33.74, -118.26],       // California: north, far WEST
    ['chokepoint-panama-canal', 9.06, -79.66],  // Panama: just north, west
    ['chokepoint-lombok-strait', -8.56, 115.81],// Indonesia: south, far east
  ];
  for (const [id, lat, lon] of expectations) {
    const coords = named.get(id);
    assert.ok(coords, `${id} is missing from the dataset`);
    assert.ok(Math.abs(coords[0] - lon) < 0.05, `${id} longitude is ${coords[0]}, expected ~${lon}`);
    assert.ok(Math.abs(coords[1] - lat) < 0.05, `${id} latitude is ${coords[1]}, expected ~${lat}`);
  }
});

test('ids are unique and derived from the name', () => {
  const ids = ALL.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate feature id');
  for (const feature of ALL) {
    assert.match(feature.id, /^(port|chokepoint)-[a-z0-9-]+$/, feature.id);
    assert.equal(feature.id.startsWith(feature.properties.kind), true);
  }
});

test('every feature carries a name and a note worth reading aloud', () => {
  for (const feature of ALL) {
    assert.ok(feature.properties.name?.trim(), `${feature.id} has no name`);
    assert.ok(feature.properties.note?.trim(), `${feature.id} has no note`);
    assert.ok(['port', 'chokepoint'].includes(feature.properties.kind));
  }
});

test('the Indonesian passages and ports this console exists for are present', () => {
  const ids = new Set(ALL.map((f) => f.id));
  // Malacca, Sunda, Lombok and Makassar are Indonesian water, and Tanjung
  // Priok and Tanjung Perak are where the country's containers actually move.
  for (const id of [
    'chokepoint-strait-of-malacca',
    'chokepoint-sunda-strait',
    'chokepoint-lombok-strait',
    'chokepoint-makassar-strait',
    'port-tanjung-priok',
    'port-tanjung-perak',
  ]) {
    assert.ok(ids.has(id), `${id} is missing`);
  }
});

test('no two features occupy the same spot', () => {
  // Los Angeles and Long Beach are genuinely adjacent, so the threshold is
  // tight — this catches a copy-pasted row, not real neighbours.
  const seen = new Map();
  for (const feature of ALL) {
    const key = feature.geometry.coordinates.map((n) => n.toFixed(4)).join(',');
    assert.ok(!seen.has(key), `${feature.id} shares a coordinate with ${seen.get(key)}`);
    seen.set(key, feature.id);
  }
});
