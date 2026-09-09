// src/data/layerGroups.js
/**
 * Sections for the DATA LAYERS panel.
 *
 * The panel was a flat list of every registered layer. That works at six rows
 * and stops working at seventeen: someone hunting for earthquakes reads past
 * submarine cables, bikeshare docks and internet radio to find it. Sections
 * restore what a flat list loses — that some of these layers answer the same
 * question and belong beside each other.
 *
 * ORDER IS OWNED HERE, not by registration order, so adding a layer cannot
 * silently reshuffle a panel someone has learned the shape of.
 *
 * A layer with no `group`, or one naming a group absent from this list, renders
 * in the trailing ungrouped section rather than vanishing. That property is the
 * point: this file is presentation, and a mistake in it must never be able to
 * hide a working layer.
 *
 * @module data/layerGroups
 */

/** Ordered sections. `id` is what a layer module puts in its `group` field. */
export const LAYER_GROUPS = Object.freeze([
  Object.freeze({
    id: 'flights',
    title: 'FLIGHTS',
    blurb: 'Civil traffic and military aircraft',
  }),
  Object.freeze({
    id: 'natural-hazards',
    title: 'NATURAL HAZARDS',
    blurb: 'Earthquakes, active fires and severe weather',
  }),
]);

/** Heading for layers that belong to no section. */
export const UNGROUPED_TITLE = 'ALL LAYERS';

const GROUP_IDS = new Set(LAYER_GROUPS.map((group) => group.id));

/**
 * Is `id` a section this panel knows how to render?
 * @param {unknown} id
 * @returns {boolean}
 */
export function isKnownLayerGroup(id) {
  return typeof id === 'string' && GROUP_IDS.has(id);
}

/**
 * Split layers into ordered sections.
 *
 * Within a section, layers keep the order they arrive in — the canonical
 * registry order — so the panel is stable across reloads.
 *
 * @param {Array<{id: string, group?: string}>} layers Layer projections.
 * @returns {Array<{id: string|null, title: string, blurb: string, layers: Array<object>}>}
 *   Sections in display order. Empty sections are omitted, so a group whose
 *   layers all failed to register leaves no orphan heading behind.
 */
export function groupLayers(layers) {
  const list = Array.isArray(layers) ? layers : [];
  const sections = [];

  for (const group of LAYER_GROUPS) {
    const members = list.filter((layer) => layer?.group === group.id);
    if (!members.length) continue;
    sections.push({ id: group.id, title: group.title, blurb: group.blurb, layers: members });
  }

  const ungrouped = list.filter((layer) => !isKnownLayerGroup(layer?.group));
  if (ungrouped.length) {
    sections.push({ id: null, title: UNGROUPED_TITLE, blurb: '', layers: ungrouped });
  }
  return sections;
}
