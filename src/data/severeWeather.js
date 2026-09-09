import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/**
 * NASA EONET severe-weather events — storms, floods, drought, dust, snow.
 *
 * EONET is a curated event catalogue rather than a sensor feed: a named
 * cyclone, a flood, a dust storm, each with a TRACK of dated points. That
 * shape drives two decisions here.
 *
 * WHAT IS EXCLUDED, and why it matters. EONET also carries wildfires and
 * earthquakes, and this app ALREADY has both from better sources — NASA FIRMS
 * (`local-firms`, satellite hotspots refreshed hourly) and USGS
 * (`earthquakes`, M2.5+ within 24 hours). Including EONET's versions would
 * double-plot the same real-world events from a slower, coarser catalogue, and
 * an operator counting fires would get two different numbers for the same
 * ground. At the time of writing wildfires are 92 of EONET's 108 open events,
 * so this exclusion is most of the feed — which is exactly why it must be
 * deliberate and not left to look like an oversight.
 *
 * GEOMETRY IS STATIC. Every value written to an entity below is a plain
 * number, never a `CallbackProperty`. `earthquakes.js` documents what happens
 * otherwise: a per-frame property on clamped ground geometry re-tessellates it
 * every frame, and measured there at 32.4 ms/frame against 1.4 ms for the same
 * scene with static values. A storm that visibly pulses is not worth 30 fps,
 * and with no per-frame animator this layer never holds the render governor
 * continuous either.
 *
 * @module data/severeWeather
 */

const API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
/**
 * How far back to look.
 *
 * EONET events stay `open` until a curator closes them, and a cyclone that
 * made landfall three weeks ago is no longer weather anyone is monitoring.
 * 30 days keeps slow events (drought, sea ice) while letting stale storms age
 * out on their own.
 */
const WINDOW_DAYS = 30;
/** Hard ceiling on what one poll may return, so a catalogue surge cannot flood the globe. */
const EVENT_LIMIT = 400;

/**
 * The categories this layer claims.
 *
 * `wildfires` and `earthquakes` are deliberately absent — see the module
 * header. `volcanoes`, `landslides` and `seaLakeIce` are absent for a
 * different reason: they are natural hazards but they are not WEATHER, and a
 * row labelled "Severe Weather" that quietly includes erupting volcanoes is
 * lying to the person reading the count. They belong in rows of their own.
 */
export const SEVERE_WEATHER_CATEGORIES = Object.freeze([
  'severeStorms',
  'floods',
  'drought',
  'dustHaze',
  'tempExtremes',
  'snow',
]);

/** Per-category accent, so a dust storm and a flood are not the same dot. */
const CATEGORY_COLOR = Object.freeze({
  severeStorms: '#4fc3f7',
  floods: '#2979ff',
  drought: '#ffb300',
  dustHaze: '#bcaaa4',
  tempExtremes: '#ff7043',
  snow: '#e1f5fe',
});
const FALLBACK_COLOR = '#9e9e9e';

export const SEVERE_WEATHER_OVERLAY_SOURCE_ID = 'severe-weather';
export const SEVERE_WEATHER_OVERLAY_COHORT_LIMIT = 64;
export const SEVERE_WEATHER_OVERLAY_COLLISION_CAPACITY = 32;

/** Longest track drawn behind a moving event, in points. */
export const TRACK_MAX_POINTS = 40;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * A real number, or null.
 *
 * `Number(null)` and `Number('')` are both 0 and `Number.isFinite(0)` is true,
 * so the obvious guard accepts a missing coordinate and plots the event off
 * the coast of Ghana. Same reasoning as `toDegrees` in lib/mapTimezone.js.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Pull the ordered lon/lat track out of one EONET event.
 *
 * EONET gives every event an array of dated geometries; for a cyclone that is
 * its path. Polygon geometries (used for some floods) are skipped rather than
 * approximated — a centroid invented from a polygon would place a flood
 * somewhere no source ever said it was.
 *
 * @param {object} event
 * @returns {Array<{lon:number, lat:number, date:string|null, magnitude:number|null, magnitudeUnit:string}>}
 */
export function eventTrack(event) {
  const geometry = Array.isArray(event?.geometry) ? event.geometry : [];
  const track = [];
  for (const step of geometry) {
    if (step?.type !== 'Point') continue;
    const coordinates = Array.isArray(step.coordinates) ? step.coordinates : [];
    const lon = finiteNumber(coordinates[0]);
    const lat = finiteNumber(coordinates[1]);
    if (lon === null || lat === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    track.push({
      lon,
      lat,
      date: typeof step.date === 'string' ? step.date : null,
      magnitude: finiteNumber(step.magnitudeValue),
      magnitudeUnit: String(step.magnitudeUnit || '').trim(),
    });
  }
  return track;
}

/**
 * Normalize the EONET payload into the records this layer draws.
 *
 * Returns [] for anything malformed rather than throwing: a catalogue that
 * changes shape upstream should quietly draw nothing, not break the globe.
 *
 * @param {object} payload Parsed EONET /events response.
 * @param {Array<string>} [categories] Category allowlist.
 * @returns {Array<object>}
 */
export function selectSevereWeatherEvents(payload, categories = SEVERE_WEATHER_CATEGORIES) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const allowed = new Set(categories);
  const records = [];

  for (const event of events) {
    const eventCategories = Array.isArray(event?.categories) ? event.categories : [];
    const category = eventCategories.find((entry) => allowed.has(entry?.id));
    if (!category) continue;

    const track = eventTrack(event);
    if (!track.length) continue;

    // The LAST dated point is where the event is now; the earlier ones are
    // where it has been. Taking the first would draw every cyclone at the spot
    // it was named, days and hundreds of kilometres ago.
    const current = track[track.length - 1];
    const id = String(event?.id || '').trim();
    if (!id) continue;

    records.push({
      id,
      title: String(event?.title || '').trim() || id,
      categoryId: category.id,
      categoryTitle: String(category.title || category.id),
      lon: current.lon,
      lat: current.lat,
      date: current.date,
      magnitude: current.magnitude,
      magnitudeUnit: current.magnitudeUnit,
      // Trimmed from the END, so a long-lived storm keeps its RECENT path
      // rather than a stale opening segment.
      track: track.slice(-TRACK_MAX_POINTS),
      accent: CATEGORY_COLOR[category.id] || FALLBACK_COLOR,
    });
  }
  return records;
}

/**
 * The spoken/label form of an event's strength, or null when it has none.
 *
 * Most EONET categories carry no magnitude at all, and a label reading
 * "Flooding — null" is worse than one reading "Flooding".
 */
export function magnitudeLabel(record) {
  const value = finiteNumber(record?.magnitude);
  if (value === null) return null;
  const unit = String(record?.magnitudeUnit || '').trim();
  return unit ? `${value} ${unit}` : String(value);
}

/** Build the ambient label entry for one event. */
export function createSevereWeatherOverlayEntry(record, position) {
  const strength = magnitudeLabel(record);
  return {
    id: String(record.id),
    position,
    variant: 'label',
    title: strength ? `${record.title} · ${strength}` : record.title,
    accent: record.accent,
    // Storms outrank slow events, and a stronger storm outranks a weaker one,
    // so the collision resolver drops the least urgent label first.
    priority: (record.categoryId === 'severeStorms' ? 100000 : 0)
      + Math.round(finiteNumber(record.magnitude) ?? 0),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the highest-priority events, with stable identity as the tie-break. */
export function selectSevereWeatherCohort(
  entries,
  limit = SEVERE_WEATHER_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(0, Math.min(
    SEVERE_WEATHER_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one event to a JSON-safe analyst record (the analyst-query seam).
 * Pure, no Cesium types, missing fields null rather than NaN/undefined.
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (finiteNumber(v));
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `EONET-${String(index).padStart(4, '0')}`,
    title: text(raw?.title),
    category: text(raw?.categoryTitle),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    magnitude: num(raw?.magnitude),
    magnitudeUnit: text(raw?.magnitudeUnit),
    observedAt: text(raw?.date),
  };
}

export function createSevereWeatherLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let _dataSource = null;
  let _records = [];
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'severe-weather',
    name: 'Severe Weather',
    icon: '🌀',
    source: 'NASA EONET',
    group: 'natural-hazards',
    // EONET is curated by hand and turns over in hours, not seconds. Polling it
    // hard would be rude to a public NASA endpoint and would change nothing on
    // screen.
    updateInterval: 15 * 60 * 1000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('severe-weather');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _records = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SEVERE_WEATHER_OVERLAY_SOURCE_ID, false);
      console.log('[Data:SevereWeather] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SEVERE_WEATHER_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SEVERE_WEATHER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SEVERE_WEATHER_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        const url = `${API_URL}?status=open&days=${WINDOW_DAYS}&limit=${EVENT_LIMIT}`;
        const response = await fetch(url);
        if (!response.ok) {
          _lastError = `EONET HTTP ${response.status}`;
          console.warn(`[Data:SevereWeather] API returned ${response.status}`);
          return false;
        }
        const payload = await response.json();
        const records = selectSevereWeatherEvents(payload);

        _dataSource.entities.removeAll();
        const overlayEntries = [];

        for (const record of records) {
          const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
          const color = Cesium.Color.fromCssColorString(record.accent);

          // The track, when the event has moved. Drawn first so the current
          // position sits on top of its own history.
          if (record.track.length > 1) {
            _dataSource.entities.add({
              id: `severe-weather:track:${record.id}`,
              polyline: {
                positions: record.track.map(
                  (step) => Cesium.Cartesian3.fromDegrees(step.lon, step.lat),
                ),
                width: 2,
                material: color.withAlpha(0.45),
                clampToGround: false,
                arcType: Cesium.ArcType.GEODESIC,
              },
            });
          }

          _dataSource.entities.add({
            id: `severe-weather:${record.id}`,
            position,
            point: {
              pixelSize: record.categoryId === 'severeStorms' ? 12 : 9,
              color: color.withAlpha(0.85),
              outlineColor: color,
              outlineWidth: 2,
              // Weather sits ON the world, not inside the terrain: without
              // this a cyclone over a mountain range disappears behind it.
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              eonetId: record.id,
              title: record.title,
              categoryId: record.categoryId,
              categoryTitle: record.categoryTitle,
              magnitude: record.magnitude,
              magnitudeUnit: record.magnitudeUnit,
              observedAt: record.date,
            },
          });

          overlayEntries.push(createSevereWeatherOverlayEntry(record, position));
        }

        if (_enabled) {
          overlayHost.setEntries(
            SEVERE_WEATHER_OVERLAY_SOURCE_ID,
            selectSevereWeatherCohort(overlayEntries),
            {
              cohortLimit: SEVERE_WEATHER_OVERLAY_COHORT_LIMIT,
              collisionCapacity: SEVERE_WEATHER_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _records = records;
        _count = records.length;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:SevereWeather] Updated: ${_count} events`);
        return true;
      } catch (e) {
        console.warn('[Data:SevereWeather] Fetch error:', e);
        _lastError = 'EONET network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(SEVERE_WEATHER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SEVERE_WEATHER_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _records = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /** Snapshot for the analyst query engine. Empty while disabled. */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      return _records.slice(0, limit).map(mapAnalystRecord);
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}

const severeWeatherLayer = createSevereWeatherLayer();

export default severeWeatherLayer;
