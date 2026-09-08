import test from 'node:test';
import assert from 'node:assert/strict';
import { describeWeatherCode, summarizeWeather } from './weatherWords.js';

/*
 * Shared because two surfaces now report conditions at a point — the Route
 * panel's destination card and the search bar's chosen place. A second copy of
 * the wording would drift, and the two would end up describing the same sky
 * differently in the same session.
 */

test('the WMO scale is grouped to distinctions a person acts on', () => {
  assert.equal(describeWeatherCode(0), 'Cerah');
  assert.equal(describeWeatherCode(2), 'Cerah berawan');
  assert.equal(describeWeatherCode(3), 'Berawan');
  assert.equal(describeWeatherCode(45), 'Berkabut');
  assert.equal(describeWeatherCode(53), 'Gerimis');
  assert.equal(describeWeatherCode(63), 'Hujan');
  assert.equal(describeWeatherCode(75), 'Salju');
  assert.equal(describeWeatherCode(82), 'Hujan deras');
  assert.equal(describeWeatherCode(95), 'Badai petir');
  // Every code in the scale must land on a word — an unhandled band would show
  // as blank next to a temperature, which reads as a broken card.
  for (let code = 0; code <= 99; code += 1) {
    assert.ok(describeWeatherCode(code).length > 0, `code ${code}`);
  }
});

test('an unreadable code says so rather than guessing at the sky', () => {
  for (const bad of [null, undefined, NaN, 'x', {}]) {
    assert.equal(describeWeatherCode(bad), 'Tidak diketahui', String(bad));
  }
});

test('a reading without a temperature is no reading at all', () => {
  // Wind and cloud with no temperature reads as broken rather than partial, so
  // the caller renders nothing.
  assert.equal(summarizeWeather(null), null);
  assert.equal(summarizeWeather({}), null);
  assert.equal(summarizeWeather({ windKph: 12, cloudCoverPct: 40 }), null);
  assert.equal(summarizeWeather({ temperatureC: null, windKph: 12 }), null);
});

test('the headline is the two things asked for: how hot, and what it is doing', () => {
  const summary = summarizeWeather({ temperatureC: 30.4, weatherCode: 3 });
  assert.equal(summary.headline, '30°C · Berawan');
});

test('"feels like" is dropped when it agrees with the thermometer', () => {
  // "30°C, terasa 30°C" is noise. A degree of rounding either way is not a
  // disagreement worth a line.
  const same = summarizeWeather({ temperatureC: 30, apparentTemperatureC: 30.4, weatherCode: 0 });
  assert.ok(!same.detail.includes('terasa'), same.detail);
  const humid = summarizeWeather({ temperatureC: 31.5, apparentTemperatureC: 35.8, weatherCode: 0 });
  assert.ok(humid.detail.includes('terasa 36°C'), humid.detail);
});

test('rain is shown only when it is actually raining', () => {
  const dry = summarizeWeather({ temperatureC: 30, precipitationMm: 0, weatherCode: 0 });
  assert.ok(!dry.detail.includes('hujan'), dry.detail);
  const wet = summarizeWeather({ temperatureC: 24, precipitationMm: 0.7, weatherCode: 63 });
  assert.ok(wet.detail.includes('hujan 0.7 mm'), wet.detail);
});

test('missing fields are dropped, never shown as a dash', () => {
  // Every figure on the line has to be real, so the line stays short and
  // trustworthy rather than padded with placeholders.
  const sparse = summarizeWeather({ temperatureC: 14.8, weatherCode: 3 });
  assert.equal(sparse.headline, '15°C · Berawan');
  assert.equal(sparse.detail, '', 'nothing else was known, so nothing else is said');
  assert.ok(!sparse.detail.includes('-'));
  assert.ok(!sparse.detail.includes('NaN'));

  const full = summarizeWeather({
    temperatureC: 30, apparentTemperatureC: 32.5, windKph: 9.4,
    precipitationMm: 0.1, cloudCoverPct: 94, weatherCode: 61,
  });
  assert.equal(full.headline, '30°C · Hujan');
  assert.equal(full.detail, 'terasa 33°C · angin 9 km/jam · hujan 0.1 mm · awan 94%');
});
