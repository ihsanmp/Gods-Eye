import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetLabel, timezoneForCoordinate, wrapLongitude } from './mapTimezone.js';

// ---------------------------------------------------------------------------
// The clock reads the map, so the zone must come from the coordinate
// ---------------------------------------------------------------------------

test('resolves the real IANA zone across the archipelago, all three Indonesian offsets', () => {
  // WIB / WITA / WIT. The point of using a real dataset rather than lon/15 is
  // that the boundaries are the actual provincial ones, not meridians.
  const cases = [
    [[-6.1754, 106.8272], 'Asia/Jakarta'],    // Jakarta
    [[-7.2575, 112.7521], 'Asia/Jakarta'],    // Surabaya
    [[3.5952, 98.6722], 'Asia/Jakarta'],      // Medan
    [[-5.45, 105.2668], 'Asia/Jakarta'],      // Bandar Lampung
    [[-0.0263, 109.3425], 'Asia/Pontianak'],  // Pontianak
    [[-8.6705, 115.2126], 'Asia/Makassar'],   // Denpasar
    [[-5.1477, 119.4327], 'Asia/Makassar'],   // Makassar
    [[1.4748, 124.8421], 'Asia/Makassar'],    // Manado
    [[-3.6954, 128.1814], 'Asia/Jayapura'],   // Ambon
    [[-8.4932, 140.4018], 'Asia/Jayapura'],   // Merauke
  ];
  for (const [[lat, lon], expected] of cases) {
    assert.equal(timezoneForCoordinate(lat, lon), expected, `${lat},${lon}`);
  }
});

test('a whole-hour meridian guess would be wrong where the dataset is right', () => {
  // The failure this module exists to avoid: India is +5:30, so no `lon / 15`
  // rounding can express it at all.
  assert.equal(timezoneForCoordinate(22.5726, 88.3639), 'Asia/Kolkata');
  assert.equal(offsetLabel('Asia/Kolkata'), 'GMT+5:30');
  assert.equal(timezoneForCoordinate(27.7172, 85.324), 'Asia/Kathmandu');
  assert.equal(offsetLabel('Asia/Kathmandu'), 'GMT+5:45');

  // Shanghai and Ürümqi are 34 degrees apart - well over two meridian hours -
  // and the dataset keeps them distinct rather than splitting them by longitude.
  // (Xinjiang keeps its own IANA zone even though Beijing time is official
  // countrywide, so this is a case where the dataset is finer than a guess AND
  // finer than the political story.)
  assert.equal(timezoneForCoordinate(31.2304, 121.4737), 'Asia/Shanghai');
  assert.equal(timezoneForCoordinate(43.8256, 87.6168), 'Asia/Urumqi');
});

test('Jayapura reads Indonesian time, not Papua New Guinean', () => {
  // The raster blurs the 141°E border by one cell, putting the provincial
  // capital an hour ahead in Port Moresby. Corrected in mapTimezone.js.
  assert.equal(timezoneForCoordinate(-2.5337, 140.7181), 'Asia/Jayapura');
  assert.equal(offsetLabel('Asia/Jayapura'), 'GMT+9');

  // The whole blurred strip, down the length of the island.
  for (const lat of [-1.5, -2.5, -4, -6, -8]) {
    assert.equal(timezoneForCoordinate(lat, 140.75), 'Asia/Jayapura', `lat ${lat}`);
  }
});

test('the border correction does not annex Papua New Guinea', () => {
  // East of the border meridian is genuinely another country, and stays it.
  assert.equal(timezoneForCoordinate(-9.4438, 147.1803), 'Pacific/Port_Moresby'); // Port Moresby
  assert.equal(timezoneForCoordinate(-2.5, 141.5), 'Pacific/Port_Moresby');
  // And the correction is bounded in latitude: it must not reach the Pacific.
  assert.notEqual(timezoneForCoordinate(20, 140.75), 'Asia/Jayapura');
});

test('reads major cities on other continents', () => {
  assert.equal(timezoneForCoordinate(40.7128, -74.006), 'America/New_York');
  assert.equal(timezoneForCoordinate(51.5074, -0.1278), 'Europe/London');
  assert.equal(timezoneForCoordinate(35.6762, 139.6503), 'Asia/Tokyo');
  assert.equal(timezoneForCoordinate(-33.8688, 151.2093), 'Australia/Sydney');
});

// ---------------------------------------------------------------------------
// A camera is not a well-behaved coordinate source
// ---------------------------------------------------------------------------

test('longitudes that have wrapped past the antimeridian still resolve', () => {
  // Cesium hands back a wrapped value, but a caller accumulating rotation can
  // hold 466.8° and mean 106.8°. Both must land in Jakarta.
  assert.equal(wrapLongitude(466.8272), wrapLongitude(106.8272));
  assert.equal(timezoneForCoordinate(-6.1754, 106.8272 + 360), 'Asia/Jakarta');
  assert.equal(timezoneForCoordinate(-6.1754, 106.8272 - 360), 'Asia/Jakarta');
  assert.equal(wrapLongitude(180), -180, 'the wrap is half-open, so 180 folds to -180');
});

test('an unusable coordinate yields null, never a plausible wrong time', () => {
  // The clock hides itself on null. Showing "14:05" for a NaN camera would be
  // worse than showing nothing, because nothing about it looks wrong.
  //
  // null, '', [] and false are the dangerous half of this list: `Number()`
  // turns every one of them into 0, so a naive guard would accept a missing
  // coordinate as the equator and the prime meridian and answer with a real
  // zone. Passing null as the LATITUDE next to a live longitude is the exact
  // shape of that bug - it used to return Asia/Jakarta.
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, '', '  ', 'x', {}, [], false, true]) {
    assert.equal(timezoneForCoordinate(bad, 106.8272), null, `lat ${String(bad)}`);
    assert.equal(timezoneForCoordinate(-6.1754, bad), null, `lon ${String(bad)}`);
  }

  // Numeric strings are still a coordinate: they arrive from dataset attributes
  // and query params, and rejecting them would be a different bug.
  assert.equal(timezoneForCoordinate('-6.1754', '106.8272'), 'Asia/Jakarta');
});

test('a camera over the poles is a real view and must not throw', () => {
  // Latitude is clamped rather than passed through, because the library throws
  // out of range and a pole is a legitimate place to point the camera.
  for (const lat of [90, -90, 91, -95]) {
    assert.doesNotThrow(() => timezoneForCoordinate(lat, 0));
    assert.equal(typeof timezoneForCoordinate(lat, 0), 'string');
  }
});

// ---------------------------------------------------------------------------
// Offsets follow daylight saving without a table in this repo
// ---------------------------------------------------------------------------

test('the offset label tracks daylight saving on its own', () => {
  const july = new Date(Date.UTC(2026, 6, 1, 12));
  const january = new Date(Date.UTC(2026, 0, 1, 12));
  assert.equal(offsetLabel('America/New_York', july), 'GMT-4');
  assert.equal(offsetLabel('America/New_York', january), 'GMT-5');
  // Indonesia observes none, so it reads the same in both.
  assert.equal(offsetLabel('Asia/Jakarta', july), 'GMT+7');
  assert.equal(offsetLabel('Asia/Jakarta', january), 'GMT+7');
});

test('an unknown zone degrades to an empty label rather than throwing', () => {
  assert.equal(offsetLabel('Not/AZone'), '');
  assert.equal(offsetLabel(''), '');
  assert.equal(offsetLabel(null), '');
});
