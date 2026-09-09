// Guards on the three hand-built point datasets: ports, chokepoints, and
// nuclear sites.
//
// Hand-built means the failure mode is a plausible-looking dot in the wrong
// country. Every coordinate was resolved through Nominatim before it was
// written down — that check caught a fast-food shop in Guernsey returned for
// "Port of Hong Kong", and found that six nuclear sites only resolve under
// their local-language names — but a later hand edit gets no such check, so
// the shape and the sanity of the data are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(
  new URL(`./local_data/${path}`, import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.trim())
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      // `path`, not `name`: this said ${name}, which is not in scope here and
      // would have thrown a ReferenceError while reporting a parse error.
      throw new Error(`${path} line ${index + 1} is not JSON: ${error.message}`);
    }
  });

const PORTS = read('maritime/ports.geojsonl');
const CHOKEPOINTS = read('maritime/chokepoints.geojsonl');
const NUCLEAR = read('nuclear/sites.geojsonl');
const VOLCANOES = read('volcanoes/gvp-holocene.geojsonl');
const ALL = [...PORTS, ...CHOKEPOINTS, ...NUCLEAR, ...VOLCANOES];

test('every dataset is non-empty GeoJSON point features', () => {
  assert.ok(PORTS.length >= 25, `only ${PORTS.length} ports`);
  assert.ok(CHOKEPOINTS.length >= 15, `only ${CHOKEPOINTS.length} chokepoints`);
  assert.ok(NUCLEAR.length >= 30, `only ${NUCLEAR.length} nuclear sites`);
  assert.ok(VOLCANOES.length >= 1000, `only ${VOLCANOES.length} volcanoes`);
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
    assert.match(feature.id, /^(port|chokepoint|nuclear|volcano)-[a-z0-9-]+$/, feature.id);
    assert.equal(feature.id.startsWith(feature.properties.kind), true);
  }
});

test('every feature carries a name and a note worth reading aloud', () => {
  for (const feature of ALL) {
    assert.ok(feature.properties.name?.trim(), `${feature.id} has no name`);
    assert.ok(feature.properties.note?.trim(), `${feature.id} has no note`);
    assert.ok(['port', 'chokepoint', 'nuclear', 'volcano'].includes(feature.properties.kind));
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

test('nuclear sites carry an operating status, since a dot cannot say one', () => {
  // Chornobyl and Barakah are not the same kind of thing on a map, and an
  // unlabelled marker would claim they were.
  const statuses = new Set(NUCLEAR.map((f) => f.properties.status));
  assert.ok(statuses.has('operational'));
  assert.ok(statuses.has('decommissioned') || statuses.has('decommissioning'));
  for (const feature of NUCLEAR) {
    assert.ok(feature.properties.status?.trim(), `${feature.id} has no status`);
    assert.ok(feature.properties.country?.trim(), `${feature.id} has no country`);
    // The note is what the label shows, so it must name both.
    assert.ok(feature.properties.note.includes(feature.properties.country));
    assert.ok(feature.properties.note.includes(feature.properties.status));
  }
});

test('the nuclear sites whose names only OSM-resolve in their own language are present', () => {
  // Six of these needed 福島第一原子力発電所, Olkiluodon ydinvoimalaitos,
  // 고리원자력발전소 and Central Nuclear Atucha before OSM would find them. An
  // English-only pass would have shipped the dataset with these simply missing.
  const ids = new Set(NUCLEAR.map((f) => f.id));
  for (const id of [
    'nuclear-fukushima-daiichi', 'nuclear-kashiwazaki-kariwa',
    'nuclear-olkiluoto', 'nuclear-ringhals', 'nuclear-kori', 'nuclear-atucha',
  ]) {
    assert.ok(ids.has(id), `${id} is missing`);
  }
});

test('the volcano set covers Indonesia, which is why it is not from EONET', () => {
  // EONET's volcano category had 14 open events worldwide and ZERO in
  // Indonesia — the country with more active volcanoes than any other. That
  // absence is the whole reason this dataset comes from the Smithsonian
  // instead, so it is the thing worth asserting.
  const indonesian = VOLCANOES.filter((f) => f.properties.country === 'Indonesia');
  assert.ok(indonesian.length >= 90, `only ${indonesian.length} Indonesian volcanoes`);
  const names = new Set(indonesian.map((f) => f.properties.name));
  for (const name of ['Sinabung', 'Merapi', 'Krakatau', 'Semeru']) {
    assert.ok(names.has(name), `${name} is missing`);
  }
});

test('a pre-Common-Era eruption year is written BCE, not as a negative number', () => {
  // GVP stores these as negatives, and "last erupted -8300" on a label reads
  // as a bug rather than as 8300 BCE.
  const ancient = VOLCANOES.filter((f) => (f.properties.lastEruption ?? 0) < 0);
  assert.ok(ancient.length > 0, 'the dataset should contain pre-CE eruptions');
  for (const feature of ancient) {
    assert.match(feature.properties.note, /BCE/, feature.id);
    assert.doesNotMatch(feature.properties.note, /erupted -/, feature.id);
  }
  // And a volcano with no dated eruption says so rather than showing nothing.
  const undated = VOLCANOES.filter((f) => f.properties.lastEruption === null);
  for (const feature of undated.slice(0, 20)) {
    assert.match(feature.properties.note, /no dated eruption/, feature.id);
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
