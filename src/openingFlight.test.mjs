import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flyToIndonesia } from './camera.js';

/*
 * The opening flight now gates the globe's detail: main.js holds the coarse
 * startup screen-space error until this promise settles, because tightening
 * mid-descent sharpens the globe at the exact moment the GPU is drawing the
 * most it ever will (measured: the 3D engine pegged at 100% through launch).
 *
 * The hazard that buys is a promise that never settles — the globe would then
 * stay coarse for the whole session and nobody would connect it to a camera
 * flight. These tests exist for that, not for the flight itself.
 */

function fakeViewer(onFlyTo) {
  const calls = [];
  return {
    calls,
    camera: {
      setView(options) { calls.push({ kind: 'setView', options }); },
      flyTo(options) { calls.push({ kind: 'flyTo', options }); onFlyTo?.(options); },
    },
  };
}

test('the archipelago is framed at once, then the descent is two seconds', () => {
  const viewer = fakeViewer();
  flyToIndonesia(viewer);
  assert.equal(viewer.calls.length, 1, 'the framing view is immediate, the flight is not');
  assert.equal(viewer.calls[0].kind, 'setView');
});

test('settles when the flight completes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = fakeViewer((options) => {
    assert.equal(options.duration, 2.0, 'the descent is two seconds');
    options.complete();
  });
  const settled = flyToIndonesia(viewer);
  t.mock.timers.tick(500); // the pause before the flight starts
  await settled; // resolves, or this test times out
  assert.equal(viewer.calls.at(-1).kind, 'flyTo');
});

test('settles when the flight is cancelled, so an interrupted descent still sharpens', async (t) => {
  // Touching the camera during the opening flight cancels it. The globe must
  // still leave coarse mode; a cancelled flight that never settled would be
  // indistinguishable from one still in progress.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = fakeViewer((options) => options.cancel());
  const settled = flyToIndonesia(viewer);
  t.mock.timers.tick(500);
  await settled;
});

test('settles on its own if the flight reports neither outcome', async (t) => {
  // The belt to the braces. Without it, a flight that silently reported nothing
  // would leave the globe at startup detail for the rest of the session.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = fakeViewer(() => { /* never calls complete or cancel */ });
  const settled = flyToIndonesia(viewer);
  t.mock.timers.tick(500 + 2000 + 1000);
  await settled;
});

test('main.js holds coarse detail until BOTH the flight and the tile queue settle', () => {
  // The gate is only worth anything if both conditions are actually checked,
  // and if a share link — which does not fly — still opens it.
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(!openingFlightSettled \|\| queuedTiles > 0\) return;/,
    'detail must wait for the flight AND a drained queue');
  assert.match(main, /flyToIndonesia\(viewer\)\.then\(releaseOpeningFlightGate\)/,
    'the flight opens the gate when it settles');
  assert.match(main, /loaderStatus\.textContent = 'Restoring shared view\.\.\.';\s*\n\s*releaseOpeningFlightGate\(\);/,
    'a share link does not fly, so it must open the gate itself');
});
