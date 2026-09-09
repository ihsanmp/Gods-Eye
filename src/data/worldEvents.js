// src/data/worldEvents.js
/**
 * Geocoded world news events, from GDELT.
 *
 * GDELT reads global news and records WHERE each story is about. This layer
 * plots the last 24 hours of that for one query, so the globe shows where
 * something is being reported rather than only where a sensor is.
 *
 * ONE LAYER, NOT TWO. The panel this was modelled on has separate GLOBAL
 * INCIDENTS and GDELT EVENTS rows. Both would be the same upstream API, and
 * GDELT allows one request every five seconds SERVER-wide — two pollers would
 * spend the allowance on each other. So there is a single layer with query
 * chips, which gives the same views for one poll instead of two.
 *
 * TONE IS NOT SENTIMENT ABOUT A PLACE. GDELT's `urltone` scores the ARTICLE's
 * language, not the truth of what happened there, so it colours the marker and
 * is never presented as a fact about the location. See `toneAccent`.
 *
 * WHAT THIS LAYER IS NOT: a feed of verified incidents. It is a map of where
 * news coverage is pointing, which is a different and much weaker claim. The
 * row's own source line says "news coverage" for exactly that reason.
 *
 * @module data/worldEvents
 */

import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

const API_URL = '/api/gdelt';

/**
 * The query presets offered as row chips.
 *
 * THESE FOUR TERMS ARE NOT A DESIGN CHOICE, THEY ARE A MEASUREMENT. This
 * endpoint matches a fixed GKG vocabulary, not free text, and the difference is
 * invisible until you try it: `protest` returns 445 places and `disaster`
 * returns zero. Of fourteen terms tried against the live API, only six returned
 * anything at all —
 *
 *   election 839 · terror 573 · protest 445 · arrest 295 · refugees 68 · strike 36
 *   unrest, disaster, security forces, police, flood, earthquake,
 *   epidemic, wildfire, conflict, storm — all ZERO
 *
 * — so the first draft of this list (unrest / disaster / security) would have
 * shipped three chips that silently drew an empty globe. Do not add a term here
 * without checking it against the API first; a plausible English word is not
 * evidence of anything.
 *
 * `id` is what setParams takes.
 */
export const EVENT_QUERIES = Object.freeze([
  Object.freeze({ id: 'protest', label: 'PROTEST', query: 'protest', title: 'Demonstrations and marches' }),
  Object.freeze({ id: 'election', label: 'ELECTION', query: 'election', title: 'Elections and campaigns' }),
  Object.freeze({ id: 'terror', label: 'TERROR', query: 'terror', title: 'Terrorism coverage' }),
  Object.freeze({ id: 'refugees', label: 'REFUGEES', query: 'refugees', title: 'Displacement and refugees' }),
]);

export const DEFAULT_QUERY_ID = 'protest';
const QUERY_BY_ID = new Map(EVENT_QUERIES.map((entry) => [entry.id, entry]));

/** Most points one poll may draw. GDELT can return thousands for a broad term. */
export const EVENT_LIMIT = 400;

export const WORLD_EVENTS_OVERLAY_SOURCE_ID = 'world-events';
export const WORLD_EVENTS_OVERLAY_COHORT_LIMIT = 48;
export const WORLD_EVENTS_OVERLAY_COLLISION_CAPACITY = 24;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** A real number, or null — `Number(null)` is 0 and would place a point at 0,0. */
function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The preset for an id, falling back to the default rather than to nothing. */
export function queryFor(id) {
  return QUERY_BY_ID.get(String(id || '').toLowerCase()) || QUERY_BY_ID.get(DEFAULT_QUERY_ID);
}

/**
 * Colour for an article's tone.
 *
 * GDELT's tone runs roughly -100..+100 and describes the ARTICLE's language.
 * Three bands only, because a continuous gradient would imply a precision this
 * number does not have: clearly negative coverage, clearly positive, and the
 * broad middle that is most of it.
 *
 * @param {unknown} tone
 * @returns {string} CSS colour.
 */
export function toneAccent(tone) {
  const value = finiteNumber(tone);
  if (value === null) return '#9e9e9e';
  if (value <= -5) return '#ff7043';
  if (value >= 5) return '#66bb6a';
  return '#ffca28';
}

/**
 * Normalize GDELT's GeoJSON into the records this layer draws.
 *
 * Returns [] for anything malformed: an upstream shape change should draw
 * nothing rather than break the globe.
 *
 * @param {object} payload Parsed GeoJSON FeatureCollection.
 * @param {number} [limit]
 * @returns {Array<object>}
 */
export function selectWorldEvents(payload, limit = EVENT_LIMIT) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const cap = Math.max(0, Math.min(EVENT_LIMIT, Math.floor(Number(limit) || 0)));
  const records = [];
  const seen = new Set();

  for (const feature of features) {
    if (records.length >= cap) break;
    const coordinates = feature?.geometry?.type === 'Point'
      ? feature.geometry.coordinates
      : null;
    if (!Array.isArray(coordinates)) continue;
    const lon = finiteNumber(coordinates[0]);
    const lat = finiteNumber(coordinates[1]);
    if (lon === null || lat === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    const properties = feature.properties || {};
    const name = String(properties.name || '').trim();
    if (!name) continue;

    // GDELT returns one feature per PLACE, and a busy place can appear more
    // than once across a response. Keeping both would stack two markers on the
    // same pixel and double the count.
    const key = `${name}@${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tone = finiteNumber(properties.urltone);
    records.push({
      id: key,
      name,
      lat,
      lon,
      tone,
      accent: toneAccent(tone),
      url: typeof properties.url === 'string' ? properties.url : null,
      publishedAt: typeof properties.urlpubtimedate === 'string' ? properties.urlpubtimedate : null,
      themes: typeof properties.mentionedthemes === 'string' ? properties.mentionedthemes : '',
    });
  }
  return records;
}

/** Ambient label entry for one event. */
export function createWorldEventOverlayEntry(record, position) {
  return {
    id: record.id,
    position,
    variant: 'label',
    title: record.name,
    accent: record.accent,
    // Strongly-toned coverage outranks neutral, so the labels that survive a
    // crowded view are the ones a reader is most likely to want.
    priority: Math.round(Math.abs(finiteNumber(record.tone) ?? 0) * 100),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the highest-priority labels, with stable identity as the tie-break. */
export function selectWorldEventCohort(entries, limit = WORLD_EVENTS_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    WORLD_EVENTS_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/** JSON-safe analyst record. Missing fields are null, never NaN. */
export function mapAnalystRecord(raw, index = 0) {
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `NEWS-${String(index).padStart(4, '0')}`,
    place: text(raw?.name),
    lat: finiteNumber(raw?.lat),
    lon: finiteNumber(raw?.lon),
    tone: finiteNumber(raw?.tone),
    url: text(raw?.url),
    publishedAt: text(raw?.publishedAt),
  };
}

export function createWorldEventsLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let _dataSource = null;
  let _records = [];
  let _queryId = DEFAULT_QUERY_ID;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _rowControlsListener = null;

  const layer = {
    id: 'world-events',
    name: 'World News Events',
    icon: '◎',
    source: 'GDELT · news coverage',
    group: 'threats-intel',
    // GDELT's GKG window is the last 24 hours and turns over slowly; the proxy
    // caches for ten minutes, so anything faster than this would be asking the
    // proxy for its own cache.
    updateInterval: 15 * 60 * 1000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('world-events');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _records = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(WORLD_EVENTS_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(WORLD_EVENTS_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(WORLD_EVENTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(WORLD_EVENTS_OVERLAY_SOURCE_ID, false);
    },

    setParams(params = {}) {
      if (typeof params.queryId === 'string' && QUERY_BY_ID.has(params.queryId)
        && params.queryId !== _queryId) {
        _queryId = params.queryId;
        // The old query's points describe a different question; leaving them on
        // screen under a new chip would misattribute them.
        _records = [];
        _count = 0;
        _dataSource?.entities.removeAll();
        overlayHost.clearSource(WORLD_EVENTS_OVERLAY_SOURCE_ID);
        _rowControlsListener?.();
        if (_enabled) void layer.update();
      }
      return true;
    },

    getParams() {
      return { queryId: _queryId };
    },

    getRowControls() {
      return {
        chips: EVENT_QUERIES.map((entry) => ({
          id: entry.id,
          label: entry.label,
          active: entry.id === _queryId,
          state: entry.id === _queryId ? 'active' : 'idle',
          title: entry.title,
          params: { queryId: entry.id },
        })),
      };
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    async update() {
      const preset = queryFor(_queryId);
      try {
        const response = await fetch(`${API_URL}?query=${encodeURIComponent(preset.query)}`);
        if (!response.ok) {
          _lastError = response.status === 429 ? 'GDELT rate limited' : `GDELT HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        const records = selectWorldEvents(payload);

        _dataSource.entities.removeAll();
        const overlayEntries = [];
        for (const record of records) {
          const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
          const color = Cesium.Color.fromCssColorString(record.accent);
          _dataSource.entities.add({
            id: `world-events:${record.id}`,
            position,
            point: {
              pixelSize: 7,
              color: color.withAlpha(0.8),
              outlineColor: color,
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              place: record.name,
              tone: record.tone,
              url: record.url,
              publishedAt: record.publishedAt,
            },
          });
          overlayEntries.push(createWorldEventOverlayEntry(record, position));
        }

        if (_enabled) {
          overlayHost.setEntries(
            WORLD_EVENTS_OVERLAY_SOURCE_ID,
            selectWorldEventCohort(overlayEntries),
            {
              cohortLimit: WORLD_EVENTS_OVERLAY_COHORT_LIMIT,
              collisionCapacity: WORLD_EVENTS_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _records = records;
        _count = records.length;
        _lastUpdate = Date.now();
        // A genuinely empty answer is not an error, but a bare 0 on the row
        // reads as a broken feed. Say which it is.
        _lastError = records.length === 0 ? 'no coverage in the last 24h' : null;
        return true;
      } catch {
        _lastError = 'GDELT network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(WORLD_EVENTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(WORLD_EVENTS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _records = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      return _records.slice(0, limit).map(mapAnalystRecord);
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        // The query is part of what the number MEANS: "312" answers a question,
        // and the row has to say which one.
        source: `GDELT · ${queryFor(_queryId).label.toLowerCase()} coverage`,
      };
    },
  };
  return layer;
}

const worldEventsLayer = createWorldEventsLayer();

export default worldEventsLayer;
