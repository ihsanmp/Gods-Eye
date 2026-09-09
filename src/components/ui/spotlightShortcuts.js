// src/components/ui/spotlightShortcuts.js
/**
 * When the search bar's category shortcuts are allowed on screen.
 *
 * The shortcuts — TEMPAT MAKAN, SPBU, KAFE, SUPERMARKET — are the bar's
 * "nothing is happening yet" affordance: four things worth looking for when you
 * have not asked for anything. They are round buttons that float OVER THE MAP
 * beside the bar, which is fine on an empty bar and wrong the moment the bar is
 * busy.
 *
 * THE BUG THIS FIXES. The rule used to be `hovered && !searchValue`. A route in
 * progress leaves the search field EMPTY — the destination lives in the route
 * panel's own KE field, not in the search input — so planning a journey kept
 * satisfying `!searchValue`, and simply moving the pointer across the route
 * panel popped four buttons out over the map. They covered the ground the route
 * was drawn on and offered a new search next to a journey already being
 * planned.
 *
 * So a mounted panel hides them, exactly as it already hides the results list.
 * A panel means the operator has stopped browsing and started a task — routing,
 * an identifier lookup, a chosen place — and a task should not be interrupted by
 * an invitation to begin a different one.
 *
 * @module components/ui/spotlightShortcuts
 */

/**
 * Should the category shortcuts be rendered?
 *
 * @param {object} state
 * @param {boolean} state.hovered   Pointer is over the bar. They are a hover affordance.
 * @param {string} [state.searchValue] Text in the search field.
 * @param {boolean} [state.hasPanel] A panel (route bar, lookup card, chosen place) is mounted.
 * @returns {boolean}
 */
export function shouldShowShortcuts({ hovered, searchValue, hasPanel } = {}) {
  if (!hovered) return false;
  // A panel outranks an empty field: the field being empty is not evidence that
  // nothing is going on.
  if (hasPanel) return false;
  // Anything typed, whitespace included, means a query is being composed.
  return !String(searchValue ?? '').length;
}
