import tzLookup from 'tz-lookup';

/**
 * The wall-clock zone at a point on the globe.
 *
 * The console's map clock shows the time where the CAMERA is looking, not where
 * the operator is sitting, so it needs a real IANA zone for an arbitrary
 * latitude/longitude. The intel HUD's old approximation - `Math.round(lon / 15)`
 * - cannot do that job: it puts Kolkata an hour and a half out (+5:30 is not a
 * whole number of hours), collapses China's single zone onto five, and can only
 * ever produce "UTC+7", never "Asia/Jakarta". It stays where it is, as a HUD
 * readout; this module is what the clock uses.
 *
 * tz-lookup answers from a bundled raster (~72 KB, no network, no dependencies)
 * and is exact away from borders. Where it is not exact is documented and
 * corrected below.
 */

/**
 * Indonesia's border with Papua New Guinea IS the 141°E meridian - a straight
 * line, which is precisely the shape a raster blurs. Sampling the strip found
 * the error to be exactly one cell wide: at 140.75°E every latitude down the
 * island resolves to a PNG zone (or the bare `Etc/GMT-9` alias), so Papua's
 * provincial capital at 140.72°E reads UTC+10 instead of Indonesia's UTC+9.
 * That is a full hour wrong in a city of four hundred thousand people, on the
 * map this console is most often pointed at.
 *
 * The correction is deliberately narrow: only inside the island's own bounds,
 * only west of the border meridian, and only when the lookup actually returned
 * one of the zones the blur produces. A point genuinely in Papua New Guinea is
 * east of 141°E and is left alone.
 */
const PAPUA_BORDER_LON = 141;
const PAPUA_LAT_RANGE = Object.freeze({ south: -9.5, north: 0.5 });
const PAPUA_LON_WEST = 140.5;
const PAPUA_BLUR_ZONES = Object.freeze(['Pacific/Port_Moresby', 'Etc/GMT-9']);
const PAPUA_ZONE = 'Asia/Jayapura';

/**
 * A degree value, or null - rejecting the things `Number()` quietly turns into
 * zero.
 *
 * `Number(null)`, `Number('')`, `Number([])` and `Number(false)` are all 0, so a
 * plain `Number.isFinite(Number(x))` guard lets a missing coordinate through as
 * the equator/prime meridian. A camera that has not reported yet would then
 * resolve to a real zone off West Africa and the clock would show a confident,
 * wrong time. Only actual numbers and non-blank numeric strings pass.
 *
 * @param {unknown} value - Candidate degree value.
 * @returns {number|null} The number, or null if it is not one.
 */
function toDegrees(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Normalize a longitude onto [-180, 180) so wrapped camera values still map. */
export function wrapLongitude(lonDeg) {
  const raw = toDegrees(lonDeg);
  if (raw === null) return null;
  return ((((raw + 180) % 360) + 360) % 360) - 180;
}

/**
 * Resolve the IANA time zone at a geographic coordinate.
 *
 * @param {number} latDeg - Latitude in degrees.
 * @param {number} lonDeg - Longitude in degrees; wrapped, so a camera that has
 *   spun past the antimeridian still resolves.
 * @returns {string|null} IANA zone name, or `null` when the coordinate is not
 *   usable — the caller shows nothing rather than a plausible wrong time.
 */
export function timezoneForCoordinate(latDeg, lonDeg) {
  const lat = toDegrees(latDeg);
  const lon = wrapLongitude(lonDeg);
  if (lat === null || lon === null) return null;
  // tz-lookup throws on out-of-range input; a camera at a pole is a legitimate
  // view, so clamp rather than let it reach the library.
  const clampedLat = Math.max(-90, Math.min(90, lat));

  let zone;
  try {
    zone = tzLookup(clampedLat, lon);
  } catch {
    return null;
  }
  if (typeof zone !== 'string' || !zone) return null;

  if (
    PAPUA_BLUR_ZONES.includes(zone)
    && lon >= PAPUA_LON_WEST
    && lon < PAPUA_BORDER_LON
    && clampedLat >= PAPUA_LAT_RANGE.south
    && clampedLat <= PAPUA_LAT_RANGE.north
  ) {
    return PAPUA_ZONE;
  }
  return zone;
}

/**
 * The zone's current UTC offset, as a short label like `GMT+7`.
 *
 * Read from `Intl` rather than computed, so it follows daylight saving on its
 * own: New York is GMT-4 in July and GMT-5 in January without a table here.
 *
 * @param {string} timeZone - IANA zone name.
 * @param {Date} [at] - Instant to read the offset at; defaults to now.
 * @returns {string} e.g. `GMT+7`, or an empty string if the zone is unknown.
 */
export function offsetLabel(timeZone, at = new Date()) {
  if (!timeZone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at);
    return parts.find((part) => part.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}
