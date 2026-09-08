import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

/*
 * Trackpad pinch-to-zoom.
 *
 * A trackpad pinch is not a touch gesture to a desktop browser: it arrives as a
 * `wheel` event with `ctrlKey` set. Cesium keys every wheel listener by
 * MODIFIER — getKey(WHEEL, modifier) — so ctrl+wheel is a different event from
 * the plain WHEEL that zoomEventTypes carries by default, and it was mapped to
 * no camera behaviour at all: aggregated every time, consumed never.
 *
 * Source assertions, because the mapping is applied to a live Cesium viewer at
 * startup and this suite has none. Verified in the running app: zoomEventTypes
 * came back carrying WHEEL+CTRL after the change.
 */

const cameraInput = main.slice(
  main.indexOf('const cameraInput = viewer.scene.screenSpaceCameraController;'),
  main.indexOf('const qualityKey ='),
);

test('a trackpad pinch is mapped to zoom', () => {
  assert.ok(cameraInput, 'the camera input block must exist');
  assert.match(
    cameraInput,
    /\{ eventType: Cesium\.CameraEventType\.WHEEL, modifier: Cesium\.KeyboardEventModifier\.CTRL \}/,
    'ctrl+wheel — which is what a trackpad pinch actually is — must zoom',
  );
});

test('the existing zoom inputs are added to, never replaced', () => {
  /*
   * The mouse is the thing to protect here. A plain wheel is both a mouse wheel
   * AND a two-finger scroll, and the owner chose to keep that zooming rather
   * than lose the mouse to a heuristic that cannot tell the two apart. So the
   * new entry is appended to whatever Cesium already had.
   */
  assert.match(cameraInput, /cameraInput\.zoomEventTypes = \[\s*\n\s*\.\.\.cameraInput\.zoomEventTypes,/,
    'the default zoom inputs must be spread back in, not overwritten');
});

test('dragging is left exactly as it was', () => {
  /*
   * The pan gesture is tap-tap-hold-then-slide, which a precision trackpad
   * already delivers as an ordinary left drag — the same events a click-drag
   * sends. Cesium's default LEFT_DRAG already moves the map with it, so there
   * is nothing to add, and adding something would only risk breaking the mouse.
   * This test exists to keep that decision deliberate rather than forgotten.
   */
  assert.doesNotMatch(cameraInput, /rotateEventTypes|translateEventTypes|tiltEventTypes|lookEventTypes/,
    'drag, tilt and look mappings are Cesium defaults and stay untouched');
  assert.doesNotMatch(cameraInput, /enableRotate|enableTranslate|enableLook/,
    'no input is disabled to make the trackpad work');
});
