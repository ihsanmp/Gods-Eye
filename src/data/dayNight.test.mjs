// Unit tests for the day/night terminator layer.
//
// Two things are worth pinning here and neither is the lighting itself, which
// is Cesium's: that switching the layer OFF puts the scene back exactly as it
// was found, and that the sun is stepped on a slow tick rather than animated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_LABEL,
  SOURCE_LABEL_HIDDEN,
  SUN_STEP_MS,
  createDayNightLayer,
  lightingIsVisible,
  sourceLabel,
} from './dayNight.js';

/** A viewer stub with just the surface this layer touches. */
function fakeViewer({ enableLighting = false, globeShown = true } = {}) {
  return {
    clock: { currentTime: 'ORIGINAL' },
    scene: { globe: { enableLighting, show: globeShown } },
  };
}

test('enabling turns lighting on and disabling puts back what was there', () => {
  const layer = createDayNightLayer();
  const viewer = fakeViewer({ enableLighting: false });
  layer.init(viewer);

  layer.enable(viewer);
  assert.equal(viewer.scene.globe.enableLighting, true);

  layer.disable(viewer);
  assert.equal(viewer.scene.globe.enableLighting, false);
});

test('disabling restores a scene that already had lighting on', () => {
  // The failure this guards: assuming the previous value was `false` and
  // switching off a setting the app (or another feature) had deliberately set.
  const layer = createDayNightLayer();
  const viewer = fakeViewer({ enableLighting: true });
  layer.init(viewer);

  layer.enable(viewer);
  assert.equal(viewer.scene.globe.enableLighting, true);
  layer.disable(viewer);
  assert.equal(viewer.scene.globe.enableLighting, true, 'the scene keeps what it came with');
});

test('destroy also restores the scene', () => {
  const layer = createDayNightLayer();
  const viewer = fakeViewer({ enableLighting: false });
  layer.init(viewer);
  layer.enable(viewer);
  layer.destroy(viewer);
  assert.equal(viewer.scene.globe.enableLighting, false);
});

test('the sun steps on a slow tick, and not at all while the layer is off', async () => {
  const layer = createDayNightLayer();
  const viewer = fakeViewer();
  layer.init(viewer);

  // Off: the clock must not be touched. Animating the sun is what would keep
  // the render loop from ever idling.
  assert.equal(await layer.update(), false);
  assert.equal(viewer.clock.currentTime, 'ORIGINAL');

  layer.enable(viewer);
  assert.notEqual(viewer.clock.currentTime, 'ORIGINAL', 'enabling places the sun immediately');
  const afterEnable = viewer.clock.currentTime;

  assert.equal(await layer.update(), true);
  assert.notEqual(viewer.clock.currentTime, afterEnable);
});

test('the step interval is a minute, not a frame', () => {
  // 0.25 degrees of rotation — sub-pixel at any zoom where a terminator reads.
  assert.equal(SUN_STEP_MS, 60_000);
  assert.equal(createDayNightLayer().updateInterval, SUN_STEP_MS);
});

test('a viewer with no scene never throws', () => {
  const layer = createDayNightLayer();
  assert.doesNotThrow(() => layer.init(null));
  assert.doesNotThrow(() => layer.enable(null));
  assert.doesNotThrow(() => layer.disable(null));
  assert.doesNotThrow(() => layer.destroy(null));
  assert.doesNotThrow(() => layer.getStats());
});

test('an invisible terminator says so instead of looking broken', () => {
  // On the photorealistic stacks the globe is hidden, so lighting is applied
  // and invisible. A control that appears to do nothing is worse than one that
  // explains itself.
  assert.equal(lightingIsVisible(fakeViewer({ globeShown: true })), true);
  assert.equal(lightingIsVisible(fakeViewer({ globeShown: false })), false);
  assert.equal(lightingIsVisible(null), true, 'unknown is not a claim of hiddenness');

  assert.equal(sourceLabel(true, false), SOURCE_LABEL_HIDDEN);
  assert.equal(sourceLabel(true, true), SOURCE_LABEL);
  // While OFF it is not hidden, it is off — the row must not blame the basemap.
  assert.equal(sourceLabel(false, false), SOURCE_LABEL);
});

test('the row reports no count rather than a zero', () => {
  const layer = createDayNightLayer();
  const viewer = fakeViewer({ globeShown: false });
  layer.init(viewer);
  layer.enable(viewer);
  const stats = layer.getStats();
  // This layer draws no objects. A 0 would read as "found none".
  assert.equal(stats.count, null);
  assert.equal(stats.error, null);
  assert.equal(stats.source, SOURCE_LABEL_HIDDEN);
  assert.ok(Number.isFinite(stats.lastUpdate));
});
