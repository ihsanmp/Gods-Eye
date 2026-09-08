import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getGpuProfile, probeGpu, setGpuProfile, shouldSkipExpensiveEffects } from './gpuProfile.js';

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
  // MSAA is OFF, not halved. Clamping 4x to 2x left the machine saturated, and
  // multisampling multiplies the work of every covered pixel — on a globe that
  // is the whole screen, so there is no cheap part of the frame for it.
  assert.match(main, /const msaa = gpu\.integrated \? 1 : quality\.msaa;/);
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

// The probe is its own module now, so these call it rather than reading main.js
// for the shape of it. It moved because ui.js needs the same answer when it
// applies the post-processing defaults, long after the viewer was built.

const fakeGl = (renderer) => ({
  getExtension: (name) => (name === 'WEBGL_debug_renderer_info'
    ? { UNMASKED_RENDERER_WEBGL: 37446 }
    : null),
  getParameter: () => renderer,
});

test('the target hardware is recognised, and discrete cards are left alone', () => {
  assert.equal(
    probeGpu(fakeGl('ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)')).integrated,
    true,
    'the Core Ultra 7 155H iGPU this was tuned for',
  );
  for (const r of ['Intel(R) UHD Graphics 620', 'Apple M2', 'Mali-G78', 'AMD Radeon(TM) Graphics']) {
    assert.equal(probeGpu(fakeGl(r)).integrated, true, r);
  }
  // Discrete is matched FIRST and wins, so "Radeon RX" is never read as the
  // "Radeon(TM) Graphics" iGPU whose name it resembles.
  for (const r of ['NVIDIA GeForce RTX 4070', 'AMD Radeon RX 7900 XTX', 'Quadro P2000']) {
    assert.equal(probeGpu(fakeGl(r)).integrated, false, r);
  }
});

test('a GPU that cannot be read is never quietly throttled', () => {
  // A driver that blocks WEBGL_debug_renderer_info, or no context at all, keeps
  // the quality it was asked for rather than being downgraded on a guess.
  assert.equal(probeGpu({ getExtension: () => null }).integrated, false);
  assert.equal(probeGpu(null).integrated, false);
  assert.equal(probeGpu(undefined).integrated, false);
  assert.equal(probeGpu({ getExtension: () => { throw new Error('blocked'); } }).integrated, false);
});

test('effects are skipped only once the probe has actually run', () => {
  // Read before the viewer exists, this must be false: nothing may be disabled
  // on a default, only on a reading.
  assert.equal(shouldSkipExpensiveEffects(), false, 'unprobed means no downgrade');
  setGpuProfile(probeGpu(fakeGl('NVIDIA GeForce RTX 4070')));
  assert.equal(shouldSkipExpensiveEffects(), false);
  setGpuProfile(probeGpu(fakeGl('Intel(R) Arc(TM) Graphics')));
  assert.equal(shouldSkipExpensiveEffects(), true);
});

test('the sharpen default is skipped on an iGPU, and is a default not a lock', () => {
  /*
   * Sharpen is a nine-tap unsharp mask over the whole screen, every frame — of
   * the order of half a billion texture fetches a second at two megapixels and
   * 30 fps. That is a large slice of an iGPU's frame for an edge-contrast lift.
   *
   * It must remain reversible: the Display panel's toggle and a share link's
   * saved state both land after this baseline.
   */
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /const wantSharpen = defaults\.sharpen\.enabled && !shouldSkipExpensiveEffects\(\);/);
  assert.match(ui, /this\._setSharpenEnabled\(wantSharpen\);/);
  // The stored default stays true, so a discrete machine is unaffected and the
  // toggle still has something to restore to.
  assert.match(ui, /sharpen: \{ enabled: true, intensity: 49 \}/);
});
