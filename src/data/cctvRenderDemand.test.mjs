import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * CCTV's continuous-render hold, and why it is now conditional.
 *
 * Enabling the layer used to pin the WHOLE scene into continuous rendering:
 * startProjectionLoop took `holdContinuousRender('cctv-projection')` the moment
 * it armed, and the loop is armed for as long as CCTV is on. Every camera
 * marker, every label and the entire basemap were therefore redrawn at the
 * target frame rate for as long as the layer was enabled.
 *
 * Measured on a Core Ultra 7 155H (Arc iGPU): the 3D engine sat at 96-100% with
 * the Copy engine at 0% — nothing streaming, everything redrawing — while the
 * projection's own video element was PAUSED at currentTime 0. The frames bought
 * nothing at all.
 *
 * This is the same regression detection.js already had and already fixed; see
 * detectionRenderDemand.test.mjs for that one. These assertions are source-text
 * because the loop needs a Cesium viewer and a live rAF, which this suite has
 * neither of.
 */

const cctvSource = await readFile(new URL('./cctv.js', import.meta.url), 'utf8');

test('the hold follows the work, not the loop', () => {
  // The hold must be decided inside the tick from actual playback state, never
  // taken unconditionally when the loop arms.
  assert.match(cctvSource, /function projectionNeedsPerFrameRender\(\) \{/,
    'there must be a predicate saying when per-frame rendering is genuinely needed');
  assert.match(
    cctvSource,
    /const wantsContinuous = projectionNeedsPerFrameRender\(\);\s*\n\s*if \(wantsContinuous !== _projectionHoldsRender\) \{/,
    'the tick compares the need against the current hold and only acts on a change',
  );

  const loop = cctvSource.slice(
    cctvSource.indexOf('function startProjectionLoop()'),
    cctvSource.indexOf('const tick = () => {'),
  );
  assert.doesNotMatch(loop, /holdContinuousRender/,
    'arming the loop must NOT take a hold — that is the regression');
});

test('only a video that is actually running earns a per-frame hold', () => {
  const predicate = cctvSource.slice(
    cctvSource.indexOf('function projectionNeedsPerFrameRender()'),
    cctvSource.indexOf('function startProjectionLoop()'),
  );
  // A still-image projection swaps at 1 Hz and a paused, ended or unready video
  // changes nothing — neither is worth redrawing the globe for.
  assert.match(predicate, /runtime\.mode !== 'video'/, 'still-image projections do not hold');
  assert.match(predicate, /!video\.paused/, 'a paused video does not hold');
  assert.match(predicate, /!video\.ended/, 'an ended video does not hold');
  assert.match(predicate, /video\.readyState >= 2/, 'a video with no frames does not hold');
  assert.match(predicate, /if \(!_enabled \|\| !_showProjection\) return false;/,
    'projection switched off does not hold');
});

test('everything that is not held asks for a single frame instead', () => {
  assert.match(cctvSource, /if \(!_projectionHoldsRender && changed\) governorRequestRender\('cctv-projection'\);/,
    'a change with no hold must request exactly one render');
  // Requesting while held would be noise: the scene is already drawing.
  assert.match(cctvSource, /governorRequestRender/, 'the on-demand path must exist');

  // The two reporters that feed `changed` have to actually report.
  assert.match(cctvSource, /if \(refreshProjectionTextures\(active\)\) changed = true;/);
  assert.match(cctvSource, /return result\.writes > 0 \|\| result\.transitioning === true;/,
    'the focus pass reports whether it wrote anything');
});

test('cancelling the loop clears the hold flag, not just the hold', () => {
  const stop = cctvSource.slice(
    cctvSource.indexOf('function stopProjectionLoop()'),
    cctvSource.indexOf('function stopProjectionLoop()') + 500,
  );
  // cancelAnimationFrame means the tick cannot run to drop its own hold. If the
  // flag survived, a restarted loop would believe it was already holding and
  // never take the hold again — a video that then plays would stutter.
  assert.match(stop, /_projectionHoldsRender = false;/);
  assert.match(stop, /releaseContinuousRender\('cctv-projection'\)/);
});
