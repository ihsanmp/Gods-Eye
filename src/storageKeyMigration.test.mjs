import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyStorageKey, readMigratedItem } from './storageKeyMigration.js';

/*
 * Renaming a STORAGE key is not like renaming a variable.
 *
 * The old value is still in the browser of everyone who has used this app, and a
 * reader that only knows the new name does not fail — it finds nothing and hands
 * back a default. The layers someone had switched on come back off; the launcher
 * they dismissed returns. These keys were swept from `gev:` to `mm:` by the
 * project rename, which is exactly how that damage happens quietly.
 */

function store(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('the new key wins when it exists', () => {
  const s = store({ 'mm:layer-state:v2': 'new', 'gev:layer-state:v2': 'old' });
  assert.equal(readMigratedItem(s, 'mm:layer-state:v2'), 'new');
});

test('state written before the rename is still found, and copied forward', () => {
  const s = store({ 'gev:layer-state:v2': 'the layers I had on' });
  assert.equal(readMigratedItem(s, 'mm:layer-state:v2'), 'the layers I had on');
  assert.equal(s.map.get('mm:layer-state:v2'), 'the layers I had on', 'copied forward on first read');
  // The old key is deliberately LEFT: another tab on an older build may still be
  // reading it, and deleting it under that tab buys nothing.
  assert.equal(s.map.get('gev:layer-state:v2'), 'the layers I had on');
});

test('nothing stored under either name is null, not a guess', () => {
  assert.equal(readMigratedItem(store(), 'mm:layer-state:v2'), null);
});

test('a falsy stored value is still a value', () => {
  // '' and '0' are legitimate settings; a truthiness check here would discard
  // them and silently fall through to a default.
  const empty = store({ 'gev:thing': '' });
  assert.equal(readMigratedItem(empty, 'mm:thing'), '');
  const zero = store({ 'gev:thing': '0' });
  assert.equal(readMigratedItem(zero, 'mm:thing'), '0');
});

test('a storage that refuses WRITES still returns the old value', () => {
  // Private mode and quota exhaustion both throw on setItem. The copy-forward is
  // an optimisation; the read is the point, and it must not be lost with it.
  const s = {
    getItem: (k) => (k === 'gev:thing' ? 'kept' : null),
    setItem: () => { throw new Error('quota'); },
  };
  assert.equal(readMigratedItem(s, 'mm:thing'), 'kept');
});

test('a hostile or absent storage never throws', () => {
  const hostile = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(readMigratedItem(hostile, 'mm:thing'), null);
  assert.equal(readMigratedItem(null, 'mm:thing'), null);
  assert.equal(readMigratedItem(undefined, 'mm:thing'), null);
  assert.equal(readMigratedItem({}, 'mm:thing'), null);
});

test('keys outside the renamed namespace are read once, not twice', () => {
  // A key that never carried the prefix has no old spelling to look for.
  assert.equal(legacyStorageKey('mm:layer-state:v2'), 'gev:layer-state:v2');
  assert.equal(legacyStorageKey('godsEyeView.cctv.regions.v1'), 'godsEyeView.cctv.regions.v1');
  let reads = 0;
  const s = { getItem: (k) => { reads += 1; return null; } };
  readMigratedItem(s, 'plain-key');
  assert.equal(reads, 1, 'no second lookup for a key with no legacy form');
});
