// Guards on the bundled Indonesian CCTV catalogue.
//
// This file is assembled by harvesting public ATCS portals, and the failure
// that matters is a camera that LOOKS fine in the data and shows nothing on
// screen: a marker with no picture gives an operator no way to tell "switched
// off" from "broken". Every entry here was fetched and had to return a live
// HLS playlist before it was written down, and these tests pin the properties
// that a later hand edit could quietly break.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CAMERAS = JSON.parse(readFileSync(
  new URL('../../config/cctv_sources.indonesia.json', import.meta.url),
  'utf8',
));

test('the catalogue spans several publishers, not just the original one', () => {
  // It was 544 cameras in one city from one publisher. The point of the
  // expansion is breadth, so breadth is what is asserted.
  assert.ok(CAMERAS.length > 550, `only ${CAMERAS.length} cameras`);
  const cities = new Set(CAMERAS.map((c) => c.city));
  assert.ok(cities.size >= 4, `only ${cities.size} cities: ${[...cities].join(', ')}`);
  const providers = new Set(CAMERAS.map((c) => c.provider));
  assert.ok(providers.size >= 3, `only ${providers.size} providers`);
});

test('every camera has a usable identity, stream and position', () => {
  const ids = new Set();
  for (const camera of CAMERAS) {
    assert.ok(camera.id?.trim(), 'a camera has no id');
    assert.ok(!ids.has(camera.id), `duplicate id ${camera.id}`);
    ids.add(camera.id);

    assert.ok(camera.name?.trim(), `${camera.id} has no name`);
    assert.ok(camera.city?.trim(), `${camera.id} has no city`);
    assert.ok(camera.cityId?.trim(), `${camera.id} has no cityId`);
    // cityId drives the region switches, so it has to be a clean key.
    assert.match(camera.cityId, /^[a-z0-9-]+$/, `${camera.id} cityId "${camera.cityId}"`);

    assert.match(camera.url, /^https:\/\//, `${camera.id} is not an https stream`);
    assert.equal(camera.feedType, 'hls', `${camera.id} is not HLS`);
  }
});

test('no camera sits at 0,0 or outside Indonesia', () => {
  // Number(null) is 0, and 0,0 is in the Gulf of Guinea — the lost-coordinate
  // signature. Indonesia's real bounds catch a swapped lat/lon too.
  for (const camera of CAMERAS) {
    assert.equal(typeof camera.lat, 'number', `${camera.id} lat`);
    assert.equal(typeof camera.lon, 'number', `${camera.id} lon`);
    assert.ok(Number.isFinite(camera.lat) && Number.isFinite(camera.lon), `${camera.id} is not finite`);
    assert.ok(
      camera.lat > -12 && camera.lat < 7,
      `${camera.id} latitude ${camera.lat} is outside Indonesia`,
    );
    assert.ok(
      camera.lon > 94 && camera.lon < 142,
      `${camera.id} longitude ${camera.lon} is outside Indonesia — a swapped pair looks exactly like this`,
    );
  }
});

test('every stream is https, because an http feed will not load in the app', () => {
  // The app is served over https in every deployment; a mixed-content stream
  // is blocked by the browser and shows as a camera that never loads.
  for (const camera of CAMERAS) {
    assert.doesNotMatch(camera.url, /^http:\/\//, `${camera.id} is plain http`);
  }
});

test('nothing points at the expired-certificate host', () => {
  // 37 Bina Marga cameras stream from apps.ptbtu.com, whose TLS certificate
  // has expired. The streams are live, but using them means disabling
  // certificate verification for that host — a decision for the repo owner,
  // not something a data file should smuggle in.
  for (const camera of CAMERAS) {
    assert.doesNotMatch(camera.url, /ptbtu\.com/, `${camera.id} uses the expired-certificate host`);
  }
});

test('every camera names where its feed came from', () => {
  // These are other people's public feeds. Provenance travels with each entry
  // so the source is answerable rather than anonymous.
  for (const camera of CAMERAS) {
    assert.ok(camera.provider?.trim(), `${camera.id} has no provider`);
    assert.ok(camera.license?.trim(), `${camera.id} has no license note`);
    // The licence line should name the host the feed is actually published on.
    const host = new URL(camera.url).host.replace(/:\d+$/, '');
    const rootish = host.split('.').slice(-3).join('.');
    assert.ok(
      camera.license.includes(rootish) || camera.license.includes(host),
      `${camera.id} licence does not name ${host}`,
    );
  }
});

test('each camera carries the pose the renderer needs', () => {
  for (const camera of CAMERAS) {
    assert.ok(Number.isFinite(camera.fovDeg) && camera.fovDeg > 0, `${camera.id} fov`);
    assert.ok(Number.isFinite(camera.rangeM) && camera.rangeM > 0, `${camera.id} range`);
    assert.ok(Number.isFinite(camera.pitchDeg), `${camera.id} pitch`);
    assert.ok(Number.isFinite(camera.mountHeightM), `${camera.id} mount height`);
  }
});
