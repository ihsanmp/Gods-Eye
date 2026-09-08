import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

/*
 * The GPU budget on an integrated chip.
 *
 * These are source-text assertions because the code under test runs inside
 * viewer construction against a live WebGL context, which no unit test here
 * has. What they defend is narrow and worth defending: the target machine is a
 * Core Ultra 7 155H with an Arc iGPU and no discrete card, and its .env asks for
 * GEV_RENDER_QUALITY=high — so every one of these clamps is the only thing
 * standing between that preset and a pegged GPU.
 *
 * The first pass clamped MSAA and frame rate and left tile detail, tile cache
 * and resolution alone; the globe still ran the GPU flat out through the
 * opening descent. That is the regression these lock out.
 */

test('an integrated GPU renders 70% of the pixels, and the maths is the square', () => {
  // Fragment shading dominates a full-screen globe and tracks pixel COUNT, which
  // scales with the square of resolutionScale. sqrt(0.70) is what makes "70%"
  // mean 70% of the work rather than 70% of the width — the linear version would
  // quietly ask for 49%.
  assert.match(main, /Math\.sqrt\(gpuBudget \/ 100\)/,
    'the budget must be applied as a square root, not linearly');
  assert.match(main, /gpu\.integrated \? 70 : 100/,
    'integrated defaults to a 70% pixel budget; a discrete card is left alone');
  assert.match(main, /const baseResolutionScale = viewer\.resolutionScale \* budgetScale;/,
    'the budget MULTIPLIES the pixel-ratio cap rather than replacing it');
});

test('an absolute pixel ceiling backs the relative budget, and follows resizes', () => {
  /*
   * The relative budget alone did not fix a pegged GPU, and could not: 70% of a
   * 2880x1800 panel is still 3.6 megapixels a frame. A percentage of a big
   * number is a big number. The ceiling is what binds on a high-resolution
   * screen; on a 1080p one it never does and only the budget applies.
   */
  assert.match(main, /const MAX_INTEGRATED_PIXELS = 2_000_000;/);
  assert.match(main, /Math\.sqrt\(MAX_INTEGRATED_PIXELS \/ pixels\)/,
    'the ceiling is also applied as a square root — it is a pixel COUNT');
  assert.match(main, /if \(gpu\.integrated\) \{[\s\S]*?MAX_INTEGRATED_PIXELS/,
    'the ceiling applies to integrated GPUs only');

  // resolutionScale is a RATIO that Cesium keeps across a resize, so a scale
  // chosen for one window is the wrong absolute pixel count in the next.
  assert.match(main, /window\.addEventListener\('resize', applyResolutionCeiling\)/,
    'the ceiling must be recomputed when the window changes size');

  // It may never magnify past the budget, and never collapse the canvas.
  assert.match(main, /Math\.max\(0\.1, Math\.min\(scale, baseResolutionScale\)\)/,
    'the ceiling only ever lowers, and never to nothing');
});

test('the budget is overridable and floored, never zeroed by a bad value', () => {
  assert.match(main, /Number\(import\.meta\.env\.GEV_GPU_BUDGET\)/);
  // A typo or an empty env var must not resolve to a 0% budget and a zero-pixel
  // canvas; Number.isFinite gates it and the clamp floors it.
  assert.match(main, /Number\.isFinite\(budgetRaw\)/);
  assert.match(main, /Math\.min\(100, Math\.max\(40, budgetRaw\)\)/,
    'the budget is clamped to 40-100');
});

test('tile detail and cache are clamped on an iGPU, and only ever downward', () => {
  // GEV_RENDER_QUALITY=high asks for a screen-space error of 1.5 - a discrete
  // card's setting, and the heaviest thing on screen during a descent that
  // crosses every LOD level in four seconds.
  assert.match(main, /Math\.max\(quality\.screenSpaceError, 2\.5\)/,
    'screen-space error is FLOORED upward (coarser) on an iGPU');
  assert.match(main, /Math\.min\(quality\.tileCache, 200\)/,
    'the tile cache is capped downward on an iGPU');
  assert.match(main, /Math\.min\(quality\.msaa, 2\)/);
  assert.match(main, /Math\.min\(quality\.targetFps, 30\)/);

  // The clamped values must be what actually reaches the globe. Reading
  // `quality.screenSpaceError` again at the assignment would silently restore
  // the unclamped preset, which is exactly how this was missed the first time.
  assert.match(main, /maximumScreenSpaceError = Math\.max\(STARTUP_SCREEN_SPACE_ERROR, screenSpaceError\)/);
  assert.match(main, /maximumScreenSpaceError = screenSpaceError;/);
  assert.match(main, /tileCacheSize = tileCache;/);
  assert.doesNotMatch(main, /tileCacheSize = quality\.tileCache/,
    'the unclamped preset value must not be assigned to the globe');
});

test('a GPU that cannot be read is never quietly throttled', () => {
  // probeGpu treats an unknown renderer as NOT integrated, so a machine whose
  // driver blocks WEBGL_debug_renderer_info keeps the quality it asked for
  // rather than being silently downgraded on a guess.
  assert.match(main, /const integrated = !discrete &&/,
    'integrated is derived from NOT discrete, so an unknown string falls through as discrete');
  // Discrete parts are matched first and win over the integrated families —
  // "Radeon RX" must not be read as the "radeon(tm) graphics" iGPU beside it.
  const discreteLine = main.slice(main.indexOf('const discrete ='), main.indexOf('const integrated ='));
  for (const part of ['nvidia', 'geforce', 'rtx', 'radeon rx']) {
    assert.ok(discreteLine.includes(part), `${part} must count as discrete`);
  }
});
