// src/routeSummaryPlacement.js
/**
 * Where the route report goes once it leaves the search bar.
 *
 * WHY IT LEAVES. The report — the distance headline, the traffic figures, the
 * nearest camera, the weather at the destination — used to hang under the route
 * form inside the search pill. That made the pill tall enough to cover most of
 * the left half of the map, so reading the answer meant covering the route the
 * answer was about.
 *
 * WHERE IT GOES. The strip of map beside the bar is empty on a wide window, and
 * it is the one place the report can sit without landing on something. The
 * caller names what else is up there - the clock, the right context rail - and
 * the strip ends at whichever of them comes first.
 *
 * WHEN THERE IS NO STRIP. On a narrow window the bar and the clock leave no gap
 * worth using, and a card squeezed into 90 px is not a smaller version of the
 * report, it is an unreadable one. The answer then is `null`, and the caller
 * leaves the report exactly where it has always been — inside the bar. A layout
 * that does not fit is not an invitation to invent somewhere to put it.
 *
 * Pure geometry, no DOM: the caller passes measured rectangles.
 *
 * @module routeSummaryPlacement
 */

/** Breathing room between the card and whatever it sits next to. */
export const ROUTE_SUMMARY_GAP = 16;
/** Distance kept from the window edge when no clock was measured. */
export const ROUTE_SUMMARY_EDGE = 22;
/**
 * Below this the report stops being readable.
 *
 * The narrowest line it must hold without wrapping into nonsense is the traffic
 * card's "19 menit · 12.5 km" over its explanatory note. Measured at 200 px the
 * note wraps to three lines and still reads; under that the numbers themselves
 * start breaking across lines.
 */
export const ROUTE_SUMMARY_MIN_WIDTH = 200;
/** Wider than this only adds white space; the report is a column of short rows. */
export const ROUTE_SUMMARY_MAX_WIDTH = 360;

/** A rectangle usable for layout: present, numeric, and not collapsed. */
function usable(rect) {
  if (!rect) return false;
  // Every field must be a real number. `Number(null)` is 0, so a missing edge
  // would otherwise read as "the left of the screen" and place the card there.
  for (const value of [rect.left, rect.right, rect.top]) {
    if (!Number.isFinite(value)) return false;
  }
  return rect.right > rect.left;
}

/**
 * Place the route report beside the search bar.
 *
 * @param {object} input
 * @param {{left:number, right:number, top:number}} input.bar The search pill.
 * @param {Array<{left:number, right:number, top:number}|null|undefined>} [input.obstacles]
 *   Everything else living in the top band — the clock, the right context rail.
 *   Order does not matter; the nearest one wins.
 * @param {{width:number}} input.viewport
 * @returns {{left:number, top:number, width:number}|null} `null` means "no room — leave it in the bar".
 */
export function placeRouteSummary({ bar, obstacles = [], viewport } = {}) {
  if (!usable(bar)) return null;
  const viewportWidth = Number(viewport?.width);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return null;

  /*
   * The strip ends at the nearest thing to the right of the bar, or at the
   * window edge when there is nothing.
   *
   * An obstacle bounds the strip only when it is ACTUALLY to the right of the
   * bar. A panel that has not been laid out yet measures as a zero-size box at
   * the origin, and reading that as the right-hand wall would leave a negative
   * strip and hide the report on every screen.
   */
  let wall = viewportWidth - ROUTE_SUMMARY_EDGE;
  for (const obstacle of obstacles) {
    if (!usable(obstacle) || obstacle.left <= bar.right) continue;
    if (obstacle.left < wall) wall = obstacle.left;
  }

  const left = bar.right + ROUTE_SUMMARY_GAP;
  const available = wall - ROUTE_SUMMARY_GAP - left;
  if (available < ROUTE_SUMMARY_MIN_WIDTH) return null;

  return {
    left,
    /*
     * Aligned with the top of the bar, so the two read as one row of chrome
     * across the top of the map rather than as two floating things.
     *
     * Never above the window edge, though. The bar animates in from slightly
     * above its resting place, and a card that copied a negative top mid-flight
     * would have its first line cut off by the top of the screen.
     */
    top: Math.max(bar.top, ROUTE_SUMMARY_EDGE),
    width: Math.min(ROUTE_SUMMARY_MAX_WIDTH, available),
  };
}
