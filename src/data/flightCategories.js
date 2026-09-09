// src/data/flightCategories.js
/**
 * The four buckets the Flights row filters by.
 *
 * `aircraftClass.js` sorts airframes into ten classes — the vocabulary the
 * RENDERER needs, because a widebody and a helicopter want different icons,
 * scales and 3D models. Ten checkboxes is not a control anyone wants. These
 * four are the vocabulary a PERSON uses: airliners, small aircraft, business
 * jets, and military types.
 *
 * TWO RULES MAKE THIS SAFE.
 *
 * Every class maps to exactly one category, and an unrecognised class maps to
 * one too. Nothing may fall through into a state with no visible control:
 * a contact that is hidden by a filter the user cannot see is a contact they
 * have lost, and this app's whole job is not losing contacts.
 *
 * An empty selection means EVERYTHING IS SHOWN, not nothing. Turning off the
 * last chip should read as "no filter", not as "blank the sky" — the row's own
 * on/off toggle is how you turn the layer off, and having two different ways to
 * empty the screen is how someone ends up staring at an empty globe wondering
 * which control did it.
 *
 * @module data/flightCategories
 */

/** Ordered, for the chip row. `id` is what `setParams({ categories })` takes. */
export const FLIGHT_CATEGORIES = Object.freeze([
  Object.freeze({
    id: 'commercial',
    label: 'COMMERCIAL',
    title: 'Airliners, widebodies and turboprops',
    classes: Object.freeze(['airliner', 'widebody', 'quadjet', 'turboprop']),
  }),
  Object.freeze({
    id: 'private',
    label: 'PRIVATE',
    title: 'Light aircraft, helicopters and gliders',
    classes: Object.freeze(['light', 'helicopter', 'glider']),
  }),
  Object.freeze({
    id: 'jets',
    label: 'PRIVATE JETS',
    title: 'Business jets',
    classes: Object.freeze(['bizjet']),
  }),
  Object.freeze({
    id: 'military',
    // Deliberately NOT the same thing as the Military Flights layer below it in
    // the panel. That row is a separate feed (adsb.lol military). This chip
    // filters military-TYPE airframes that appear on the civil OpenSky feed —
    // fast jets and large UAVs squawking like anyone else. The title says so,
    // because two controls sharing a word is exactly how a filter gets blamed
    // for hiding something the other one hid.
    label: 'MILITARY',
    title: 'Fast jets and large UAVs on the civil feed (the Military Flights layer is a separate source)',
    classes: Object.freeze(['fastjet', 'uav']),
  }),
]);

export const FLIGHT_CATEGORY_IDS = Object.freeze(FLIGHT_CATEGORIES.map((c) => c.id));

/**
 * The bucket an unrecognised class lands in.
 *
 * `classifyAircraft` already falls back to 'airliner' for a known type code it
 * has no special rule for, so COMMERCIAL is where an unknown airframe belongs —
 * and, more importantly, it is a bucket with a visible chip.
 */
export const FALLBACK_CATEGORY = 'commercial';

const CLASS_TO_CATEGORY = new Map();
for (const category of FLIGHT_CATEGORIES) {
  for (const klass of category.classes) CLASS_TO_CATEGORY.set(klass, category.id);
}

/**
 * Which category an aircraft class belongs to.
 *
 * Total by construction: anything unknown, blank, or not a string comes back as
 * {@link FALLBACK_CATEGORY} rather than null, so no contact can end up
 * uncontrollable.
 *
 * @param {unknown} klass A class id from aircraftClass.js.
 * @returns {string} One of FLIGHT_CATEGORY_IDS.
 */
export function categoryForClass(klass) {
  const key = typeof klass === 'string' ? klass.trim().toLowerCase() : '';
  return CLASS_TO_CATEGORY.get(key) || FALLBACK_CATEGORY;
}

/**
 * Normalize a requested category selection.
 *
 * @param {unknown} requested Ids from params, a chip click, or a share link.
 * @returns {Array<string>} Known ids, in FLIGHT_CATEGORIES order, no
 *   duplicates. An input naming nothing valid returns every category — see the
 *   module header on why empty means "show everything".
 */
export function normalizeCategories(requested) {
  if (!Array.isArray(requested)) return [...FLIGHT_CATEGORY_IDS];
  const asked = new Set(
    requested
      .filter((id) => typeof id === 'string')
      .map((id) => id.trim().toLowerCase()),
  );
  const kept = FLIGHT_CATEGORY_IDS.filter((id) => asked.has(id));
  return kept.length ? kept : [...FLIGHT_CATEGORY_IDS];
}

/**
 * Should an aircraft of this class be drawn?
 *
 * @param {unknown} klass Class id from aircraftClass.js.
 * @param {Array<string>|null} categories Active selection; null/empty = all.
 * @returns {boolean}
 */
export function isClassVisible(klass, categories) {
  const active = normalizeCategories(categories);
  // Every category on is the common case and means "no filtering at all" —
  // short-circuit it so the per-tick fleet pass does no set work for the
  // configuration almost everyone runs.
  if (active.length === FLIGHT_CATEGORY_IDS.length) return true;
  return active.includes(categoryForClass(klass));
}

/**
 * Flip one category in a selection, for a chip click.
 *
 * Turning the LAST one off restores all of them rather than emptying the sky,
 * which keeps the chip row from having a state that looks identical to the
 * layer being switched off.
 *
 * @param {Array<string>|null} categories Current selection.
 * @param {string} id Category to toggle.
 * @returns {Array<string>} The new selection.
 */
export function toggleCategory(categories, id) {
  const active = normalizeCategories(categories);
  if (!FLIGHT_CATEGORY_IDS.includes(id)) return active;
  const next = active.includes(id)
    ? active.filter((entry) => entry !== id)
    : [...active, id];
  return normalizeCategories(next);
}

/**
 * Chip descriptors for the layer row.
 *
 * When every category is on, no chip reads as "active": that state is "not
 * filtering", and lighting all four would suggest four filters are engaged.
 *
 * @param {Array<string>|null} categories Current selection.
 * @param {(id: string) => Array<string>} nextFor Selection a click should write.
 * @returns {Array<object>} Descriptors in the manager's chip shape.
 */
export function categoryChips(categories, nextFor = (id) => toggleCategory(categories, id)) {
  const active = normalizeCategories(categories);
  const filtering = active.length !== FLIGHT_CATEGORY_IDS.length;
  return FLIGHT_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    active: filtering && active.includes(category.id),
    state: filtering && active.includes(category.id) ? 'active' : 'idle',
    title: filtering
      ? category.title
      : `${category.title} — click to show only these`,
    params: { categories: nextFor(category.id) },
  }));
}
