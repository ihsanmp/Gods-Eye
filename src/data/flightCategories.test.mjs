// Unit tests for the Flights category filter.
//
// This is a control that HIDES aircraft, so almost everything below pins the
// same property from a different angle: a contact must never end up hidden by
// something the operator cannot see and cannot switch back on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAircraft } from './aircraftClass.js';
import {
  FALLBACK_CATEGORY,
  FLIGHT_CATEGORIES,
  FLIGHT_CATEGORY_IDS,
  categoryChips,
  categoryForClass,
  isClassVisible,
  normalizeCategories,
  toggleCategory,
} from './flightCategories.js';

/** Every class aircraftClass.js can return. */
const ALL_CLASSES = [
  'airliner', 'widebody', 'quadjet', 'turboprop',
  'light', 'helicopter', 'glider',
  'bizjet',
  'fastjet', 'uav',
];

test('every aircraft class lands in exactly one category', () => {
  const seen = new Map();
  for (const category of FLIGHT_CATEGORIES) {
    for (const klass of category.classes) {
      assert.ok(!seen.has(klass), `${klass} is claimed by two categories`);
      seen.set(klass, category.id);
    }
  }
  // And the map covers the whole renderer vocabulary — a class added to
  // aircraftClass.js without a home here would silently become "commercial".
  for (const klass of ALL_CLASSES) {
    assert.ok(seen.has(klass), `${klass} has no category`);
  }
});

test('an unknown class is still controllable, never orphaned', () => {
  // A contact hidden by a filter with no visible chip is a contact lost.
  for (const klass of ['spaceship', '', '   ', null, undefined, 42, {}, ['airliner']]) {
    const category = categoryForClass(klass);
    assert.ok(FLIGHT_CATEGORY_IDS.includes(category), `${JSON.stringify(klass)} -> ${category}`);
  }
  assert.equal(categoryForClass('spaceship'), FALLBACK_CATEGORY);
  // Case and padding are the caller's mistake, not the contact's.
  assert.equal(categoryForClass('  WIDEBODY '), 'commercial');
});

test('the fallback matches what classifyAircraft itself falls back to', () => {
  // classifyAircraft returns 'airliner' for a known type code with no special
  // rule, so COMMERCIAL is where an unrecognised airframe genuinely belongs.
  assert.equal(categoryForClass(classifyAircraft({ typeCode: 'ZZZZ' })), FALLBACK_CATEGORY);
});

test('an empty or nonsense selection shows EVERYTHING, not nothing', () => {
  // The row's own toggle is how you turn the layer off. A filter that can also
  // blank the sky gives two controls the same effect and one of them no label.
  for (const input of [[], null, undefined, 'commercial', {}, ['nope'], [42, null]]) {
    assert.deepEqual(
      normalizeCategories(input),
      [...FLIGHT_CATEGORY_IDS],
      JSON.stringify(input),
    );
  }
});

test('normalizeCategories keeps registry order and drops duplicates', () => {
  assert.deepEqual(normalizeCategories(['jets', 'commercial', 'jets']), ['commercial', 'jets']);
  assert.deepEqual(normalizeCategories(['  JETS  ']), ['jets']);
});

test('with every category on, everything is visible', () => {
  for (const klass of [...ALL_CLASSES, 'unknown-thing', null]) {
    assert.equal(isClassVisible(klass, FLIGHT_CATEGORY_IDS), true, String(klass));
    assert.equal(isClassVisible(klass, null), true, String(klass));
    assert.equal(isClassVisible(klass, []), true, String(klass));
  }
});

test('a narrowed selection hides exactly the classes it excludes', () => {
  const onlyCommercial = ['commercial'];
  assert.equal(isClassVisible('widebody', onlyCommercial), true);
  assert.equal(isClassVisible('turboprop', onlyCommercial), true);
  assert.equal(isClassVisible('bizjet', onlyCommercial), false);
  assert.equal(isClassVisible('helicopter', onlyCommercial), false);
  assert.equal(isClassVisible('fastjet', onlyCommercial), false);
  // An unknown class follows its fallback, so it stays visible here.
  assert.equal(isClassVisible('mystery', onlyCommercial), true);
});

test('turning the last chip off restores everything instead of emptying the sky', () => {
  let selection = ['commercial'];
  selection = toggleCategory(selection, 'commercial');
  assert.deepEqual(selection, [...FLIGHT_CATEGORY_IDS]);
});

test('toggling walks from all, down, and back', () => {
  // Starting from "no filter", the first click narrows rather than doing
  // nothing visible.
  let selection = toggleCategory(FLIGHT_CATEGORY_IDS, 'military');
  assert.deepEqual(selection, ['commercial', 'private', 'jets']);
  selection = toggleCategory(selection, 'jets');
  assert.deepEqual(selection, ['commercial', 'private']);
  selection = toggleCategory(selection, 'jets');
  assert.deepEqual(selection, ['commercial', 'private', 'jets']);
});

test('toggling an id that does not exist changes nothing', () => {
  assert.deepEqual(toggleCategory(['jets'], 'spaceships'), ['jets']);
  assert.deepEqual(toggleCategory(null, ''), [...FLIGHT_CATEGORY_IDS]);
});

test('no chip reads as engaged while nothing is being filtered', () => {
  // Lighting all four would suggest four filters are on, when the truth is
  // that none is.
  const chips = categoryChips(FLIGHT_CATEGORY_IDS);
  assert.equal(chips.length, 4);
  assert.ok(chips.every((chip) => chip.active === false), 'no chip is active');
  assert.ok(chips.every((chip) => chip.state === 'idle'));
  assert.ok(chips.every((chip) => /click to show only these/i.test(chip.title)));
});

test('a narrowed selection lights exactly its own chips', () => {
  const chips = categoryChips(['jets']);
  const active = chips.filter((chip) => chip.active).map((chip) => chip.id);
  assert.deepEqual(active, ['jets']);
});

test('each chip carries the selection its click should write', () => {
  const chips = categoryChips(FLIGHT_CATEGORY_IDS);
  const jets = chips.find((chip) => chip.id === 'jets');
  assert.deepEqual(jets.params.categories, ['commercial', 'private', 'military']);
});

test('the MILITARY chip says it is not the Military Flights layer', () => {
  // Two controls sharing a word is exactly how a filter gets blamed for hiding
  // something the other one hid.
  const military = FLIGHT_CATEGORIES.find((c) => c.id === 'military');
  assert.match(military.title, /separate source/i);
  assert.match(military.title, /civil feed/i);
});

test('the registry is frozen and well formed', () => {
  assert.ok(Object.isFrozen(FLIGHT_CATEGORIES));
  const ids = FLIGHT_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const category of FLIGHT_CATEGORIES) {
    assert.ok(Object.isFrozen(category), `${category.id} is frozen`);
    assert.ok(Object.isFrozen(category.classes));
    assert.ok(category.classes.length > 0, `${category.id} claims no classes`);
    assert.equal(category.label, category.label.toUpperCase());
    assert.ok(category.title.trim());
  }
});
