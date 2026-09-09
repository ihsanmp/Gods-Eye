// src/data/dayNight.js
/**
 * The day/night terminator — real sunlight on the globe.
 *
 * Cesium already knows where the sun is; it derives that from `viewer.clock`
 * and shades the globe when `globe.enableLighting` is on. So this layer holds
 * almost no logic. What it holds instead is a decision about COST, and one
 * about honesty.
 *
 * COST. Sunlight only moves if the clock moves, and a clock that moves every
 * frame means the render loop can never idle — which is precisely the burn this
 * app spent several rounds getting rid of. So the clock is stepped once a
 * MINUTE, from the layer's ordinary update tick, and one render is requested
 * per step. The terminator creeps in 60-second increments: fifteen arc-seconds
 * of rotation, far below what anyone can see, for one frame a minute instead of
 * sixty a second.
 *
 * HONESTY. Lighting shades the GLOBE. On the photorealistic 3D-tile stacks the
 * globe is hidden entirely (main.js sets `globe.show = false`), so the setting
 * is real, applied, and invisible. Rather than let someone toggle a control
 * that appears to do nothing, the row says so.
 *
 * This is not a data layer — there is no feed and nothing is fetched. It lives
 * in the layer registry because that is where a person looks for a thing to
 * switch on, and the lifecycle contract (init/enable/disable/update) happens to
 * be exactly the four hooks it needs.
 *
 * @module data/dayNight
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * How often the sun is moved.
 *
 * The earth turns 0.25° per minute. At any zoom where a terminator is legible,
 * that is a sub-pixel shift — so a minute buys a continuously-correct sun for
 * one frame's worth of work, where animating it would cost every frame.
 */
export const SUN_STEP_MS = 60_000;

/** Source label for the row, and what it becomes when the globe is hidden. */
export const SOURCE_LABEL = 'Sun position';
export const SOURCE_LABEL_HIDDEN = 'Sun position · hidden under 3D tiles';

/**
 * Is the terminator actually visible right now?
 *
 * False on the photorealistic stacks, whose tiles carry their own baked
 * lighting and whose globe is hidden. Written as a total function over a
 * viewer-shaped object so it can be tested without a scene.
 *
 * @param {object|null} viewer
 * @returns {boolean}
 */
export function lightingIsVisible(viewer) {
  return viewer?.scene?.globe?.show !== false;
}

/**
 * The row's source line, which doubles as the explanation for an invisible
 * terminator.
 *
 * @param {boolean} enabled Is the layer on?
 * @param {boolean} visible Is the globe being drawn?
 * @returns {string}
 */
export function sourceLabel(enabled, visible) {
  return enabled && !visible ? SOURCE_LABEL_HIDDEN : SOURCE_LABEL;
}

export function createDayNightLayer() {
  let _viewer = null;
  let _enabled = false;
  /** Whatever the scene had before this layer touched it. */
  let _previousLighting = false;
  let _lastUpdate = null;

  /** Point the clock at real now, so the sun is where the sun is. */
  function syncClock() {
    const clock = _viewer?.clock;
    if (!clock) return false;
    clock.currentTime = Cesium.JulianDate.fromDate(new Date());
    return true;
  }

  const layer = {
    id: 'day-night',
    name: 'Day / Night',
    icon: '☀',
    source: SOURCE_LABEL,
    // Deliberately UNGROUPED. It is not a hazard and it is not a feed — it is a
    // property of how the globe is drawn — so it belongs in the trailing
    // section rather than borrowing a heading it would make less true.
    updateInterval: SUN_STEP_MS,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _previousLighting = !!viewer?.scene?.globe?.enableLighting;
      _lastUpdate = null;
    },

    enable(viewer) {
      const scene = (viewer || _viewer)?.scene;
      if (!scene?.globe) return;
      _viewer = viewer || _viewer;
      // Remember what was there rather than assuming it was off, so disabling
      // restores the scene instead of imposing a default on it.
      _previousLighting = !!scene.globe.enableLighting;
      scene.globe.enableLighting = true;
      _enabled = true;
      layer.update();
    },

    disable(viewer) {
      const scene = (viewer || _viewer)?.scene;
      if (scene?.globe) scene.globe.enableLighting = _previousLighting;
      _enabled = false;
      governorRequestRender('day-night:off');
    },

    /**
     * Step the sun. Called on the manager's ordinary tick — once a minute.
     * @returns {Promise<boolean>}
     */
    async update() {
      if (!_enabled) return false;
      const moved = syncClock();
      if (moved) {
        // Nothing else marks the scene dirty for a sun move, and in idle render
        // mode the terminator would simply never advance.
        governorRequestRender('day-night:sun');
        _lastUpdate = Date.now();
      }
      return moved;
    },

    destroy(viewer) {
      const scene = (viewer || _viewer)?.scene;
      if (scene?.globe) scene.globe.enableLighting = _previousLighting;
      _enabled = false;
      _viewer = null;
      _lastUpdate = null;
    },

    getStats() {
      const visible = lightingIsVisible(_viewer);
      return {
        // There is nothing to count. `null` reads as an em dash in the panel,
        // which is the honest thing for a layer that draws no objects — a 0
        // would suggest it found none.
        count: null,
        lastUpdate: _lastUpdate,
        error: null,
        source: sourceLabel(_enabled, visible),
      };
    },
  };
  return layer;
}

const dayNightLayer = createDayNightLayer();

export default dayNightLayer;
