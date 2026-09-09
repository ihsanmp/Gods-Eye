// src/data/cctvProjectionStatus.js
/**
 * The one line of status on the monitor plane's "nothing to show yet" card.
 *
 * THE BUG THIS FIXES. The card fell back to `camera.feedType`, so a camera whose
 * health was simply unknown put the word **HLS** where a status belongs. Someone
 * looking at a screen-filling dark rectangle labelled HLS learns the transport
 * and nothing else: not whether it is still connecting, not whether it failed,
 * not whether it is about to work. A field that answers "what is wrong" must
 * never be filled with the answer to "what protocol is this".
 *
 * The transport still has a home — the panel's own SOURCE badge — which is a
 * label, not a status.
 *
 * @module data/cctvProjectionStatus
 */

/** Nothing has arrived yet, and nothing has failed. The honest default. */
export const PROJECTION_CONNECTING = 'CONNECTING…';
/** Something did fail: the media errored, or the provider went away. */
export const PROJECTION_NO_FEED = 'NO FEED';

/**
 * What the placeholder should say.
 *
 * @param {object} [input]
 * @param {{message?:string, status?:string}|null} [input.health] The layer's health entry, if any.
 * @param {string} [input.fallback] What to say when health has nothing to add.
 * @returns {string} Upper-case, ready to draw.
 */
export function projectionStatusText({ health, fallback = PROJECTION_CONNECTING } = {}) {
  /*
   * A health entry is only worth quoting when it actually says something. An
   * empty string, and any non-string a caller might hand over, fall through to
   * the caller's own fallback rather than printing "" or "[OBJECT OBJECT]".
   */
  for (const candidate of [health?.message, health?.status, fallback]) {
    if (typeof candidate !== 'string') continue;
    const text = candidate.trim();
    if (text) return text.toUpperCase();
  }
  return PROJECTION_NO_FEED;
}
