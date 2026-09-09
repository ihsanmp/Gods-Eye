// Unit tests for the search bar's category-shortcut visibility rule.
//
// These four buttons float OVER THE MAP, so every case where they appear has to
// be one where the operator has asked for nothing. The regression that prompted
// this: a route in progress leaves the search field empty, so the old
// `hovered && !searchValue` rule popped them out over the drawn route whenever
// the pointer crossed the panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowShortcuts } from './spotlightShortcuts.js';

test('an idle bar under the pointer offers them', () => {
  assert.equal(shouldShowShortcuts({ hovered: true, searchValue: '', hasPanel: false }), true);
});

test('they are a hover affordance, so an untouched bar shows nothing', () => {
  assert.equal(shouldShowShortcuts({ hovered: false, searchValue: '', hasPanel: false }), false);
});

test('a route in progress hides them even though the search field is empty', () => {
  // THE REGRESSION. The destination lives in the route panel's own KE field, so
  // `searchValue` stays empty for the whole journey; only the panel says a task
  // is under way.
  assert.equal(shouldShowShortcuts({ hovered: true, searchValue: '', hasPanel: true }), false);
});

test('a panel outranks everything else about the bar', () => {
  for (const searchValue of ['', 'uii', '   ']) {
    assert.equal(
      shouldShowShortcuts({ hovered: true, searchValue, hasPanel: true }),
      false,
      JSON.stringify(searchValue),
    );
  }
});

test('a query being typed hides them', () => {
  assert.equal(shouldShowShortcuts({ hovered: true, searchValue: 'pakuwon', hasPanel: false }), false);
  // Whitespace is a query being composed, not an empty bar.
  assert.equal(shouldShowShortcuts({ hovered: true, searchValue: ' ', hasPanel: false }), false);
});

test('a missing value reads as an empty field, not as text', () => {
  // React can hand over undefined before the first keystroke; that is an idle
  // bar and must behave like one.
  assert.equal(shouldShowShortcuts({ hovered: true }), true);
  assert.equal(shouldShowShortcuts({ hovered: true, searchValue: null }), true);
});

test('called with nothing at all, it shows nothing', () => {
  // Failing closed here means a missing prop costs a hover affordance, not four
  // buttons stuck over the map.
  assert.equal(shouldShowShortcuts(), false);
  assert.equal(shouldShowShortcuts({}), false);
});
