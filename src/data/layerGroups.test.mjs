// Unit tests for the DATA LAYERS sectioning.
//
// This module is pure presentation, and the one thing presentation must never
// do is lose a working layer. Most of what follows pins that: every input layer
// comes out in exactly one section, whatever it claims its group is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYER_GROUPS,
  UNGROUPED_TITLE,
  groupLayers,
  isKnownLayerGroup,
} from './layerGroups.js';

const hazard = (id) => ({ id, group: 'natural-hazards' });
const plain = (id) => ({ id });

test('a known group becomes its own section, in registry order', () => {
  const sections = groupLayers([
    plain('radio'),
    hazard('earthquakes'),
    plain('traffic'),
    hazard('severe-weather'),
  ]);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].id, 'natural-hazards');
  assert.equal(sections[0].title, 'NATURAL HAZARDS');
  assert.deepEqual(sections[0].layers.map((l) => l.id), ['earthquakes', 'severe-weather']);
  assert.equal(sections[1].id, null);
  assert.equal(sections[1].title, UNGROUPED_TITLE);
  assert.deepEqual(sections[1].layers.map((l) => l.id), ['radio', 'traffic']);
});

test('within a section the given order is preserved', () => {
  // The caller hands over canonical registry order; re-sorting here would make
  // the panel shuffle whenever a layer was added.
  const sections = groupLayers([hazard('z'), hazard('a'), hazard('m')]);
  assert.deepEqual(sections[0].layers.map((l) => l.id), ['z', 'a', 'm']);
});

test('EVERY layer lands in exactly one section, whatever it claims', () => {
  // The failure this guards against is a typo'd group id silently removing a
  // working layer from the panel.
  const layers = [
    plain('a'),
    hazard('b'),
    { id: 'c', group: 'natural-hazrds' },   // typo
    { id: 'd', group: '' },
    { id: 'e', group: null },
    { id: 'f', group: 42 },
    { id: 'g', group: 'threats-intel' },    // a group that does not exist yet
  ];
  const sections = groupLayers(layers);
  const placed = sections.flatMap((section) => section.layers.map((l) => l.id));
  assert.deepEqual(placed.sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(new Set(placed).size, placed.length, 'no layer appears twice');
});

test('an empty section leaves no orphan heading', () => {
  // Every registered group is rendered only if something is in it, so a group
  // whose layers all failed to register does not show as an empty header.
  const sections = groupLayers([plain('radio')]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, null);
  assert.deepEqual(groupLayers([]), []);
});

test('groupLayers is total for junk input', () => {
  assert.deepEqual(groupLayers(null), []);
  assert.deepEqual(groupLayers(undefined), []);
  assert.deepEqual(groupLayers('nope'), []);
  // A null entry must not throw — it just belongs to no group.
  const sections = groupLayers([null, hazard('b')]);
  const placed = sections.flatMap((s) => s.layers);
  assert.equal(placed.length, 2);
});

test('isKnownLayerGroup only accepts registered string ids', () => {
  assert.equal(isKnownLayerGroup('natural-hazards'), true);
  for (const value of ['', 'nope', null, undefined, 42, {}, ['natural-hazards']]) {
    assert.equal(isKnownLayerGroup(value), false, JSON.stringify(value));
  }
});

test('the group registry is well formed', () => {
  const ids = LAYER_GROUPS.map((group) => group.id);
  assert.equal(new Set(ids).size, ids.length, 'group ids are unique');
  for (const group of LAYER_GROUPS) {
    assert.match(group.id, /^[a-z0-9-]+$/, `${group.id} is a clean id`);
    assert.ok(group.title.trim(), `${group.id} has a title`);
    assert.equal(group.title, group.title.toUpperCase(), 'headings are rendered uppercase');
    assert.ok(Object.isFrozen(group), `${group.id} is frozen`);
  }
  assert.ok(Object.isFrozen(LAYER_GROUPS));
});
