import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKPAD_DELTA_MAX,
  TRACKPAD_ZOOM_SENSITIVITY,
  isTrackpadWheel,
  nextZoomHeight,
  installTrackpadZoom,
} from './trackpadZoom.js';

/*
 * Cesium scales a wheel event by 40 when the browser reports it in LINES (a
 * mouse) and uses it RAW when reported in pixels (a trackpad), then divides by
 * the canvas height. One mouse notch therefore arrives as about 120 and a
 * trackpad gesture as about 5, so the same effort moved the camera roughly
 * twenty times less far. That is what "zoom feels heavy" was.
 */

test('a mouse is left alone; only trackpad-sized pixel events are taken', () => {
  // deltaMode 0 is DOM_DELTA_PIXEL. Chrome on Windows reports a mouse wheel in
  // pixels too, at roughly 100 a notch, so deltaMode alone cannot separate them
  // and the magnitude has to.
  assert.equal(isTrackpadWheel({ deltaMode: 0, deltaY: -4 }), true);
  assert.equal(isTrackpadWheel({ deltaMode: 0, deltaY: 1.5 }), true, 'fractional deltas are typical');
  assert.equal(isTrackpadWheel({ deltaMode: 0, deltaY: -100 }), false, 'a mouse notch in pixels');
  assert.equal(isTrackpadWheel({ deltaMode: 1, deltaY: -3 }), false, 'LINE mode is a mouse');
  assert.equal(isTrackpadWheel({ deltaMode: 2, deltaY: -1 }), false, 'PAGE mode is a mouse');
  assert.equal(isTrackpadWheel({ deltaMode: 0, deltaY: 0 }), false, 'nothing happened');
  assert.equal(isTrackpadWheel({ deltaMode: 0, deltaY: NaN }), false);
  assert.equal(isTrackpadWheel(null), false);
  assert.equal(isTrackpadWheel({ deltaMode: 0, deltaY: TRACKPAD_DELTA_MAX }), true, 'the boundary is inclusive');
});

test('zooming is proportional to altitude, so it feels the same everywhere', () => {
  /*
   * A fixed step in metres is unusable across this range: the same 500 m that
   * crawls at orbit slams into the ground over a street. The ratio a given
   * gesture produces must therefore be identical at every height.
   */
  const gesture = -10;
  const ratioHigh = nextZoomHeight(1_000_000, gesture) / 1_000_000;
  const ratioLow = nextZoomHeight(500, gesture) / 500;
  assert.ok(Math.abs(ratioHigh - ratioLow) < 1e-9, 'the same gesture is the same ratio at any altitude');
  assert.ok(ratioHigh < 1, 'a negative delta — fingers spreading — zooms IN');
  assert.ok(nextZoomHeight(1000, 10) > 1000, 'a positive delta zooms out');
});

test('a gesture and its opposite return to where they started', () => {
  // Exponential, not linear, so the zoom is reversible. A linear step leaks
  // altitude on every in-and-out and the map drifts away under the fingers.
  const start = 4000;
  const out = nextZoomHeight(start, 12);
  const back = nextZoomHeight(out, -12);
  assert.ok(Math.abs(back - start) < 1e-6, `${back} should return to ${start}`);
});

test('the clamps hold, and nothing is ever zoomed to zero or infinity', () => {
  assert.equal(nextZoomHeight(100, -1000, { min: 50 }), 50, 'cannot dive through the floor');
  assert.equal(nextZoomHeight(100, 1000, { max: 500 }), 500, 'cannot fly past the ceiling');
  /*
   * A camera height that is not a usable altitude must never come back as one.
   * The contract is not "returns the input" — the input is coerced with
   * Number(), so null arrives as 0 — it is that nothing invents an altitude out
   * of nonsense. The caller checks Number.isFinite on the resulting move, so
   * anything non-positive or non-finite here is refused before it reaches the
   * camera.
   */
  for (const bad of [0, -5, NaN, Infinity, null, undefined, 'x', {}]) {
    const result = nextZoomHeight(bad, -5);
    assert.ok(
      !(Number.isFinite(result) && result > 0),
      `${String(bad)} must not resolve to a usable altitude, got ${String(result)}`,
    );
  }
  assert.equal(nextZoomHeight(1000, NaN), 1000, 'a NaN gesture moves nothing');
  assert.equal(nextZoomHeight(1000, undefined), 1000, 'a missing gesture moves nothing');
});

test('the sensitivity is a real step without being a leap', () => {
  // Sanity on the feel itself: a single small gesture should move the camera a
  // few per cent, not a fraction of a per cent (the old behaviour) and not a
  // third of the way to the ground.
  const step = 1 - nextZoomHeight(1000, -5) / 1000;
  assert.ok(step > 0.02 && step < 0.20, `a 5px gesture moves ${(step * 100).toFixed(1)}%`);
  assert.ok(TRACKPAD_ZOOM_SENSITIVITY > 0);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function fakeSetup({ enableInputs = true } = {}) {
  const listeners = [];
  const calls = { zoomIn: [], zoomOut: [], rendered: 0 };
  const container = {
    addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const viewer = {
    scene: {
      canvas: {},
      screenSpaceCameraController: { enableInputs, minimumZoomDistance: 1, maximumZoomDistance: 1e9 },
    },
    camera: {
      positionCartographic: { height: 1000 },
      zoomIn: (m) => calls.zoomIn.push(m),
      zoomOut: (m) => calls.zoomOut.push(m),
    },
  };
  const remove = installTrackpadZoom(viewer, container, () => { calls.rendered += 1; });
  return { listeners, calls, remove, viewer };
}

function wheel(deltaY, deltaMode = 0) {
  const event = { deltaY, deltaMode, prevented: false, stopped: false };
  event.preventDefault = () => { event.prevented = true; };
  event.stopPropagation = () => { event.stopped = true; };
  return event;
}

test('it listens on the container in CAPTURE, which is what beats Cesium to it', () => {
  /*
   * Cesium's own wheel listener is on the CANVAS, and at the canvas itself
   * listeners fire in registration order whatever their capture flag — Cesium
   * registered first, when the viewer was built. A capture listener one level
   * up is reached earlier in the propagation path, so it can stop the event
   * before the canvas ever sees it. Listening on the canvas would simply lose.
   */
  const { listeners } = fakeSetup();
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'wheel');
  assert.equal(listeners[0].opts.capture, true, 'must be the capture phase');
  assert.equal(listeners[0].opts.passive, false, 'preventDefault needs a non-passive listener');
});

test('a trackpad gesture zooms once, and is stopped from being zoomed twice', () => {
  const { listeners, calls } = fakeSetup();
  const event = wheel(-5);
  listeners[0].fn(event);
  assert.equal(calls.zoomIn.length, 1, 'spreading fingers zooms in');
  assert.equal(calls.zoomOut.length, 0);
  assert.ok(event.prevented, 'the browser must not also act on it');
  assert.ok(event.stopped, 'Cesium is downstream and must not zoom the same gesture again');
  assert.equal(calls.rendered, 1, 'the scene renders on demand, so the frame has to be asked for');
});

test('a mouse wheel passes straight through, untouched', () => {
  const { listeners, calls } = fakeSetup();
  const event = wheel(-100);
  listeners[0].fn(event);
  assert.deepEqual(calls.zoomIn, []);
  assert.ok(!event.prevented, 'Cesium keeps the mouse, at its own tuned rate');
  assert.ok(!event.stopped);
});

test('modes that switch the camera off are respected', () => {
  // Cockpit and the CCTV calibration gizmo set enableInputs = false. Without
  // this check, trackpad zoom would be the one control still moving the camera
  // in a mode built to hold it still.
  const { listeners, calls } = fakeSetup({ enableInputs: false });
  const event = wheel(-5);
  listeners[0].fn(event);
  assert.deepEqual(calls.zoomIn, []);
  assert.ok(!event.prevented);
});

test('it can be removed, and survives being handed nothing', () => {
  const { listeners, remove } = fakeSetup();
  remove();
  assert.equal(listeners.length, 0);
  assert.doesNotThrow(() => installTrackpadZoom(null, null));
  assert.doesNotThrow(() => installTrackpadZoom({}, {})());
});
