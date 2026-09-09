// src/measure/drawingTools.js
/**
 * Draw a shape on the map, measure it, and count what is inside.
 *
 * The maths lives in measureGeometry.js and the state machine in
 * drawingSession.js, both free of Cesium and the DOM. What is left here is the
 * wiring: turning clicks into coordinates, coordinates into geometry, and
 * geometry into a readout.
 *
 * CLICK OWNERSHIP. While a tool is armed this registers itself in the shared
 * pick registry with a predicate that claims EVERYTHING. Five layers already
 * consult that registry and leave picks alone that belong to someone else, so
 * clicking an aircraft to place a polygon corner no longer starts tracking it
 * and flies the camera away mid-draw — and not one of those layers had to
 * change. A click on bare terrain still reaches them, and a layer that is
 * tracking something will drop it; that is the same thing a map click has
 * always meant, so it is left alone.
 *
 * WHAT IS INSIDE comes from the layers' own `getAnalystRecords()` — the seam
 * the voice agent already uses for "how many flights over Texas". It reports
 * only ENABLED layers, and says so, because a count that silently omitted the
 * layers you had switched off would be a wrong answer rather than a partial one.
 *
 * @module measure/drawingTools
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from '../data/pickRegistry.js';
import {
  DRAWING_MODES,
  addPoint,
  chooseShape,
  clearDrawing,
  createSession,
  finish,
  modeFor,
  promptFor,
  toShape,
  undo,
} from './drawingSession.js';
import {
  formatArea,
  formatDistance,
  measureShape,
  shapeContains,
} from './measureGeometry.js';

/** Registry id used to claim clicks while a tool is armed. */
const PICK_OWNER_ID = 'drawing-tools';
/** Cap on records pulled from any one layer for an inside-count. */
const RECORDS_PER_LAYER = 2000;

const SHAPE_COLOR = Cesium.Color.fromCssColorString('#00d4ff');

/**
 * The world point under a screen position, or null.
 *
 * Same cascade the rest of the app uses: the depth buffer first (so a click on
 * a building lands on the building), then the ellipsoid. A miss returns null
 * and the session drops the click rather than inventing a coordinate.
 */
function pickGround(viewer, windowPosition) {
  const scene = viewer.scene;
  let cartesian = null;
  if (scene.pickPositionSupported) {
    try { cartesian = scene.pickPosition(windowPosition); } catch { cartesian = null; }
  }
  if (!cartesian || !Number.isFinite(cartesian.x)) {
    try {
      cartesian = viewer.camera.pickEllipsoid(windowPosition, Cesium.Ellipsoid.WGS84);
    } catch { cartesian = null; }
  }
  if (!cartesian || !Number.isFinite(cartesian.x)) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  if (!carto) return null;
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
  };
}

/**
 * Count the records of every ENABLED layer that fall inside ANY of these shapes.
 *
 * Takes a LIST rather than one shape for two reasons. Several AOIs can be on
 * the map at once and the readout is about all of them; and the shape being
 * drawn has to be included, or the count would vanish at the moment the shape
 * was finished and the live session cleared — which is exactly what happened
 * before this took a list.
 *
 * A record inside two overlapping AOIs is counted ONCE. Two circles over the
 * same city must not report twice the aircraft that are there.
 *
 * @param {object} dataManager
 * @param {object|Array<object>} shapes One shape, or several.
 * @returns {{total: number, byLayer: Array<{id: string, name: string, count: number}>,
 *   layersConsidered: number}}
 */
export function countInside(dataManager, shapes) {
  const list = (Array.isArray(shapes) ? shapes : [shapes]).filter(Boolean);
  const byLayer = [];
  let total = 0;
  let layersConsidered = 0;
  if (!list.length || !dataManager?.layers) return { total, byLayer, layersConsidered };

  for (const [id, entry] of dataManager.layers) {
    if (!dataManager.isEnabled?.(id)) continue;
    const module = entry?.module;
    if (typeof module?.getAnalystRecords !== 'function') continue;
    layersConsidered += 1;
    let records = [];
    try {
      records = module.getAnalystRecords(RECORDS_PER_LAYER) || [];
    } catch {
      // One layer throwing must not blank the whole count.
      continue;
    }
    let count = 0;
    const seen = new Set();
    for (const record of records) {
      // Identity within this layer, so overlapping AOIs cannot double-count.
      // An id-less record falls back to its own object identity, which is
      // still stable across the shapes of a single pass.
      const key = record?.id ?? record;
      if (seen.has(key)) continue;
      if (list.some((shape) => shapeContains(shape, record))) {
        seen.add(key);
        count += 1;
      }
    }
    if (count > 0) {
      byLayer.push({ id, name: module.name || id, count });
      total += count;
    }
  }
  byLayer.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { total, byLayer, layersConsidered };
}

/**
 * Everything the panel needs, derived from a session and the committed shapes.
 * Pure, so the readout can be tested without a scene.
 */
export function readoutFor(session, committed, inside) {
  const shape = toShape(session);
  const live = shape ? measureShape(shape) : null;
  const committedPerimeter = committed.reduce((sum, entry) => sum + entry.measured.perimeterKm, 0);
  const committedArea = committed.reduce((sum, entry) => sum + entry.measured.areaKm2, 0);
  // The live shape counts toward the readout while it is being drawn, so the
  // numbers move as you click rather than appearing only at the end.
  const areaKm2 = committedArea + (live?.measurable ? live.areaKm2 : 0);
  const perimeterKm = committedPerimeter + (live?.measurable ? live.perimeterKm : 0);
  return {
    area: formatArea(areaKm2),
    aois: committed.length,
    perimeter: formatDistance(perimeterKm),
    prompt: live && !live.measurable && live.reason && session.points.length >= 2
      ? `Cannot measure: ${live.reason}.`
      : promptFor(session),
    inside,
  };
}

/**
 * Mount the drawing tools.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {object} options.dataManager
 * @param {HTMLElement} [options.container] Where to mount; defaults to #drawing-tools.
 * @returns {object} Controller with `destroy()`.
 */
export function initDrawingTools({ viewer, dataManager, container = null }) {
  const root = container || document.getElementById('drawing-tools');
  if (!root || !viewer) return { destroy() {} };

  let session = createSession();
  /** Finished shapes, kept so several AOIs can be measured together. */
  let committed = [];
  let inside = { total: 0, byLayer: [], layersConsidered: 0 };

  const dataSource = new Cesium.CustomDataSource('drawing-tools');
  viewer.dataSources.add(dataSource);

  root.innerHTML = `
    <div class="draw-readouts">
      <div class="draw-readout"><span class="draw-readout-label">TRACKED AREA</span><span class="draw-readout-value" data-draw-area>0 km²</span></div>
      <div class="draw-readout"><span class="draw-readout-label">AOIS / PERIM</span><span class="draw-readout-value" data-draw-perim>0 / 0 km</span></div>
    </div>
    <div class="draw-step">STEP 1 — CHOOSE A SHAPE</div>
    <div class="draw-shapes">
      ${DRAWING_MODES.map((mode) => `
        <button type="button" class="draw-shape" data-draw-mode="${mode.id}" aria-pressed="false">
          <span class="draw-shape-label">${mode.label}</span>
          <span class="draw-shape-hint">${mode.hint}</span>
        </button>`).join('')}
    </div>
    <div class="draw-prompt" data-draw-prompt></div>
    <div class="draw-inside" data-draw-inside hidden></div>
    <div class="draw-actions">
      <button type="button" class="draw-action" data-draw-action="undo">UNDO</button>
      <button type="button" class="draw-action" data-draw-action="clear">CLEAR ALL</button>
    </div>
  `;

  const ui = {
    area: root.querySelector('[data-draw-area]'),
    perim: root.querySelector('[data-draw-perim]'),
    prompt: root.querySelector('[data-draw-prompt]'),
    inside: root.querySelector('[data-draw-inside]'),
  };

  function renderShapes() {
    dataSource.entities.removeAll();
    const draw = (shape, id, live) => {
      if (!shape) return;
      const alpha = live ? 0.18 : 0.28;
      if (shape.kind === 'circle') {
        dataSource.entities.add({
          id: `draw:${id}`,
          position: Cesium.Cartesian3.fromDegrees(shape.center.lon, shape.center.lat),
          ellipse: {
            semiMajorAxis: shape.radiusKm * 1000,
            semiMinorAxis: shape.radiusKm * 1000,
            material: SHAPE_COLOR.withAlpha(alpha),
            outline: true,
            outlineColor: SHAPE_COLOR,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
        return;
      }
      const positions = shape.points.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
      if (shape.kind === 'path') {
        dataSource.entities.add({
          id: `draw:${id}`,
          polyline: {
            positions, width: 3, material: SHAPE_COLOR, clampToGround: true,
          },
        });
        return;
      }
      dataSource.entities.add({
        id: `draw:${id}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: SHAPE_COLOR.withAlpha(alpha),
          outline: true,
          outlineColor: SHAPE_COLOR,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    };

    committed.forEach((entry, index) => draw(entry.shape, `aoi-${index}`, false));
    draw(toShape(session), 'live', true);

    // Vertices, so a half-drawn shape shows where its corners went.
    session.points.forEach((point, index) => {
      dataSource.entities.add({
        id: `draw:vertex-${index}`,
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
        point: {
          pixelSize: 8,
          color: SHAPE_COLOR,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });
    governorRequestRender('drawing-tools');
  }

  function render() {
    const readout = readoutFor(session, committed, inside);
    ui.area.textContent = readout.area;
    ui.perim.textContent = `${readout.aois} / ${readout.perimeter}`;
    ui.prompt.textContent = readout.prompt;

    for (const button of root.querySelectorAll('[data-draw-mode]')) {
      button.setAttribute('aria-pressed', button.dataset.drawMode === session.mode ? 'true' : 'false');
    }

    if (inside.total > 0) {
      ui.inside.hidden = false;
      const parts = inside.byLayer.map((entry) => `${entry.count} ${entry.name}`);
      // Named scope, always — the count covers ENABLED layers only, and a bare
      // number would read as "everything there is".
      ui.inside.textContent = `Inside: ${parts.join(' · ')} (enabled layers only)`;
    } else {
      ui.inside.hidden = true;
      ui.inside.textContent = '';
    }
    renderShapes();
  }

  /**
   * Recount against every committed AOI plus whatever is being drawn.
   *
   * Paths are excluded: a line encloses nothing, and asking what is "inside"
   * one would return whatever happened to sit on it.
   */
  function recount() {
    const live = toShape(session);
    const liveMeasured = live ? measureShape(live) : null;
    const shapes = committed
      .map((entry) => entry.shape)
      .filter((shape) => shape.kind !== 'path');
    if (live && live.kind !== 'path' && liveMeasured?.measurable) shapes.push(live);
    inside = shapes.length
      ? countInside(dataManager, shapes)
      : { total: 0, byLayer: [], layersConsidered: 0 };
  }

  function commitIfComplete() {
    if (!session.complete) return;
    const shape = toShape(session);
    const measured = shape ? measureShape(shape) : null;
    if (shape && measured?.measurable) committed = [...committed, { shape, measured }];
    // Keep the tool armed so the next AOI needs no re-arming.
    session = clearDrawing(session);
    recount();
  }

  // ── Clicks ───────────────────────────────────────────────────────────────
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((event) => {
    if (!session.mode) return;
    const point = pickGround(viewer, event.position);
    const before = session;
    session = addPoint(session, point);
    if (session === before) return; // a miss, or a repeat of the last point
    recount();
    commitIfComplete();
    render();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(() => {
    if (!session.mode || session.complete) return;
    const finished = finish(session);
    if (finished === session) return; // below the minimum — nothing to finish
    session = finished;
    recount();
    commitIfComplete();
    render();
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  // ── Panel ────────────────────────────────────────────────────────────────
  const onClick = (event) => {
    const modeButton = event.target.closest?.('[data-draw-mode]');
    if (modeButton) {
      session = chooseShape(session, modeButton.dataset.drawMode);
      // Claim clicks only while a tool is armed, so the map behaves normally
      // the rest of the time.
      if (session.mode) registerPickOwner(PICK_OWNER_ID, () => true);
      else unregisterPickOwner(PICK_OWNER_ID);
      recount();
      render();
      return;
    }
    const action = event.target.closest?.('[data-draw-action]')?.dataset.drawAction;
    if (action === 'undo') {
      session = undo(session);
      recount();
      render();
    } else if (action === 'clear') {
      committed = [];
      session = createSession();
      unregisterPickOwner(PICK_OWNER_ID);
      recount();
      render();
    }
  };
  root.addEventListener('click', onClick);

  render();

  return {
    /** Test/QA seam: the state the panel is drawn from. */
    getState() {
      return { session, committed: committed.length, inside, readout: readoutFor(session, committed, inside) };
    },
    destroy() {
      root.removeEventListener('click', onClick);
      handler.destroy();
      unregisterPickOwner(PICK_OWNER_ID);
      viewer.dataSources.remove(dataSource, true);
    },
  };
}

export { DRAWING_MODES, modeFor };
