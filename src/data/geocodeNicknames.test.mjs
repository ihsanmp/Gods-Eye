// Local place nicknames, and the fence that keeps them local.
//
// People search for what they call a place: "Amplaz", not "Plaza Ambarrukmo";
// "UII", not "Universitas Islam Indonesia". OSM carries some of these as
// alternate names and Amplaz resolves on its own, but the ones it does not know
// failed in two distinct ways against the live geocoder:
//
//   uii -> Aeropuerto de Utila, HONDURAS (UII is that airport's IATA code)
//   jec -> "JEC Soccer Field", a pitch that merely carries the letters
//
// Pure-function tests, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEOCODE_LOCAL_NICKNAMES,
  geocodeNicknameExpansion,
  geocodeQueryVariants,
  parseGeocodeBias,
} from '../../vite.config.js';

const JOGJA_VIEW = parseGeocodeBias('-7.90,110.25|-7.65,110.50');
const PARIS_VIEW = parseGeocodeBias('48.80,2.25|48.90,2.42');

test('a nickname expands only when the map is already in its region', () => {
  assert.equal(geocodeNicknameExpansion('uii', JOGJA_VIEW), 'Universitas Islam Indonesia');
  assert.equal(geocodeNicknameExpansion('amplaz', JOGJA_VIEW), 'Plaza Ambarrukmo');
  assert.equal(geocodeNicknameExpansion('jec', JOGJA_VIEW), 'Jogja Expo Center');
  // Same words, a viewport on the other side of the world: no expansion.
  assert.equal(geocodeNicknameExpansion('uii', PARIS_VIEW), null);
  assert.equal(geocodeNicknameExpansion('jec', PARIS_VIEW), null);
});

test('a search with no viewport gets no nicknames at all', () => {
  // This is what protects a worldwide geocoder. Without a viewport there is no
  // evidence the user means the local reading, so the raw query stands.
  for (const [alias] of GEOCODE_LOCAL_NICKNAMES) {
    assert.equal(geocodeNicknameExpansion(alias, null), null, alias);
  }
});

test('the table never claims a word the world already owns', () => {
  /*
   * The fence exists because the vernacular collides with real places and real
   * words. In Yogyakarta "Paris" is Jalan Parangtritis — a table that rewrote it
   * everywhere would break searching for the capital of France, which is
   * exactly the kind of silent damage a nickname list invites.
   *
   * `paris` is therefore deliberately ABSENT rather than fenced, because the
   * cost of getting it wrong is worse than the benefit of getting it right.
   */
  const aliases = GEOCODE_LOCAL_NICKNAMES.map(([alias]) => alias);
  assert.ok(!aliases.includes('paris'), 'paris must never be a nickname entry');
  assert.equal(geocodeNicknameExpansion('paris', JOGJA_VIEW), null);

  // Entries that DO collide with common words are fenced, and prove the fence
  // by refusing to fire outside the region.
  assert.equal(geocodeNicknameExpansion('concat', JOGJA_VIEW), 'Condongcatur');
  assert.equal(geocodeNicknameExpansion('concat', PARIS_VIEW), null);
  assert.equal(geocodeNicknameExpansion('jamal', PARIS_VIEW), null);
});

test('matching is on the whole query, trimmed and case-insensitive', () => {
  assert.equal(geocodeNicknameExpansion('  UII  ', JOGJA_VIEW), 'Universitas Islam Indonesia');
  assert.equal(geocodeNicknameExpansion('Amplaz', JOGJA_VIEW), 'Plaza Ambarrukmo');
  // A nickname inside a longer phrase is NOT rewritten: "jec soccer field" is a
  // different request from "jec", and the user's extra words are evidence.
  assert.equal(geocodeNicknameExpansion('jec soccer field', JOGJA_VIEW), null);
  assert.equal(geocodeNicknameExpansion('', JOGJA_VIEW), null);
  assert.equal(geocodeNicknameExpansion(null, JOGJA_VIEW), null);
});

test('the expansion is asked FIRST, with the raw query kept as a fallback', () => {
  const variants = geocodeQueryVariants('uii', JOGJA_VIEW);
  assert.equal(variants[0], 'Universitas Islam Indonesia',
    'the local reading is the strongest one and goes first');
  assert.ok(variants.includes('uii'), 'the raw query survives as a fallback');

  // Unchanged where no nickname applies — the same list as before this existed.
  assert.deepEqual(geocodeQueryVariants('Tokyo', JOGJA_VIEW), ['Tokyo']);
  assert.deepEqual(geocodeQueryVariants('uii', null), ['uii']);
});

test('every entry is a lowercase key mapping to a longer, different name', () => {
  const seen = new Set();
  for (const [alias, name, region] of GEOCODE_LOCAL_NICKNAMES) {
    assert.equal(alias, alias.toLowerCase(), `${alias} must be lowercase to match`);
    assert.ok(name.length > alias.length, `${alias} must expand to something longer`);
    assert.notEqual(alias.toLowerCase(), name.toLowerCase());
    assert.equal(region, 'jogja', 'every current entry belongs to the one region defined');
    assert.ok(!seen.has(alias), `${alias} is listed twice`);
    seen.add(alias);
  }
  assert.ok(seen.size >= 15, 'the table is worth having');
});
