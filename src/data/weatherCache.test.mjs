import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherCacheLifetimeMs } from '../../vite.config.js';

/*
 * How often it is worth asking for the weather.
 *
 * Open-Meteo advances its `current` block on 15-MINUTE boundaries aligned to
 * the clock, not to when you ask. Measured 2026-09-08: Yogyakarta, Jakarta,
 * London, New York and Tokyo all reported the same observedAt of 06:00:00Z, and
 * the sample before it was 05:45:00Z. Asking more often returns identical
 * bytes; asking on a fixed timer drifts off the boundary.
 */

const MINUTE = 60_000;
const at = (iso) => Date.parse(iso);
const WEATHER_MIN_HOLD = 2 * MINUTE;
const payload = (observedAt) => ({ weather: { observedAt, temperatureC: 30 } });

test('a fresh reading is held until the next one is due, not for a fixed span', () => {
  // Fetched at 06:05:55 holding the 06:00 observation: the 06:15 reading is due
  // at 06:16:30 once publication lag is allowed for, so about 10.5 minutes.
  const life = weatherCacheLifetimeMs(payload('2026-09-08T06:00:00Z'), at('2026-09-08T06:05:55Z'));
  assert.ok(Math.abs(life - 10.58 * MINUTE) < MINUTE, `${(life / MINUTE).toFixed(2)} min`);
});

test('a reading fetched late is held only briefly, so the next one is not missed', () => {
  /*
   * This is what a flat fifteen-minute TTL gets wrong. Fetch at 06:14 and a
   * fixed timer would hold until 06:29 — fourteen minutes after the 06:15
   * reading appeared. Following the DATA's clock instead, this expires almost
   * immediately and picks the new one up.
   */
  const life = weatherCacheLifetimeMs(payload('2026-09-08T06:00:00Z'), at('2026-09-08T06:14:00Z'));
  assert.ok(life <= 3 * MINUTE, `${(life / MINUTE).toFixed(2)} min`);
});

test('an already-stale reading cannot cause a request per request', () => {
  /*
   * If the upstream publishes late, the computed expiry is in the PAST. Left
   * unclamped that means a fresh fetch on every single request — a hot loop
   * against a service that is, by definition, already struggling.
   */
  const life = weatherCacheLifetimeMs(payload('2026-09-08T05:00:00Z'), at('2026-09-08T06:10:00Z'));
  assert.ok(life >= 2 * MINUTE, `a floor must hold: got ${(life / MINUTE).toFixed(2)} min`);
});

test('a timestamp from the future cannot freeze the cache', () => {
  // A clock skew or a bad payload must not buy an hour of silence.
  const life = weatherCacheLifetimeMs(payload('2026-09-08T09:00:00Z'), at('2026-09-08T06:00:00Z'));
  assert.ok(life <= 15 * MINUTE, `${(life / MINUTE).toFixed(2)} min`);
});

test('no usable timestamp falls back to a plain interval rather than to zero', () => {
  // Zero would mean never caching at all, which is worse than a rough guess.
  for (const bad of [null, undefined, {}, { weather: {} }, { weather: { observedAt: 'x' } }]) {
    const life = weatherCacheLifetimeMs(bad, at('2026-09-08T06:00:00Z'));
    assert.ok(life >= 2 * MINUTE && life <= 15 * MINUTE, `${JSON.stringify(bad)} -> ${life}`);
  }
  assert.ok(weatherCacheLifetimeMs(payload('2026-09-08T06:00:00Z'), NaN) > 0);
});

test('the cadence never asks for something that cannot have changed', () => {
  /*
   * The whole point. Sampling every minute across a period, the cache must
   * never expire twice inside one 15-minute window — anything more often is a
   * request for bytes that are already known to be identical.
   */
  const observed = '2026-09-08T06:00:00Z';
  for (let minute = 0; minute <= 14; minute += 1) {
    const fetchedAt = at(observed) + minute * MINUTE;
    const expiresAt = fetchedAt + weatherCacheLifetimeMs(payload(observed), fetchedAt);
    assert.ok(
      expiresAt >= at(observed) + WEATHER_MIN_HOLD,
      `fetched at +${minute}min expires too early`,
    );
  }
});

