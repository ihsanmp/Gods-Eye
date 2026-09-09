// src/perfSnapshot.js
/**
 * A one-command performance report, taken on the machine that is struggling.
 *
 * WHY THIS EXISTS. The heavy costs in this app are GPU costs — globe shading,
 * texture uploads, per-frame passes — and none of them can be measured from a
 * headless or hidden browser: the canvas never composites and rAF never ticks,
 * so every timing comes back reassuringly small and tells you nothing. Every
 * previous performance hunt here was solved by measuring on the real machine,
 * and twice by finding a layer holding the render loop continuous.
 *
 * So this is a REAL rAF measurement plus the state needed to interpret it:
 *
 *   window.__mapMonitoring.perfSnapshot().then(console.log)
 *
 * Read `governor.mode` FIRST. `continuous` means something is pinning the
 * render loop and the frame budget is being spent whether or not anything moved
 * — `governor.holds` names who. That has been the answer twice, and it costs
 * nothing to rule out before looking at anything else.
 *
 * @module perfSnapshot
 */

/** How long to watch real frames. Long enough to see a slow one, short enough to wait through. */
const SAMPLE_MS = 3000;

/**
 * Measure real frame intervals via requestAnimationFrame.
 *
 * Reports the 95th percentile as well as the mean, because a stutter is what a
 * person notices and a mean hides it: sixty good frames and one 200 ms freeze
 * average out to something that looks fine.
 *
 * @param {number} durationMs
 * @returns {Promise<{frames:number, fps:number, meanMs:number, p95Ms:number, worstMs:number}>}
 */
export function sampleFrames(durationMs = SAMPLE_MS) {
  return new Promise((resolve) => {
    const gaps = [];
    let last = performance.now();
    const started = last;
    let settled = false;

    const finish = (note) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      const sorted = [...gaps].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
      const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
      resolve({
        frames: gaps.length,
        fps: gaps.length ? +(1000 / (mean || 1)).toFixed(1) : 0,
        meanMs: +mean.toFixed(2),
        p95Ms: +at(0.95).toFixed(2),
        worstMs: +(sorted[sorted.length - 1] || 0).toFixed(2),
        ...(note ? { note } : {}),
      });
    };

    /*
     * A wall-clock guard, because rAF can stop entirely.
     *
     * A minimised or hidden window gets NO frames at all, and without this the
     * promise simply never settled — a diagnostic that hangs when the thing it
     * measures is at its most unusual. `frames: 0` is itself the finding: the
     * window was not being drawn, so nothing measured here describes the app.
     */
    const guard = setTimeout(
      () => finish('no frames were delivered — the window was hidden or minimised, so nothing here is a measurement of the app'),
      durationMs + 2000,
    );

    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (now - started < durationMs) requestAnimationFrame(tick);
      else finish(null);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Everything worth knowing when the app feels heavy.
 *
 * @param {object} deps
 * @param {object} deps.viewer
 * @param {object} deps.dataManager
 * @param {() => object} deps.governorDiagnostics
 * @returns {Promise<object>}
 */
export async function perfSnapshot({ viewer, dataManager, governorDiagnostics }) {
  const frames = await sampleFrames();
  const scene = viewer?.scene;
  const governor = typeof governorDiagnostics === 'function' ? governorDiagnostics() : null;

  const layers = (dataManager?.getAll?.() || [])
    .filter((layer) => layer.enabled)
    .map((layer) => ({ id: layer.id, count: layer.stats?.count ?? null }));

  // Entity totals per source: the cheapest proxy for how much geometry the
  // scene is carrying, and it survives the fact that Cesium batches draw calls.
  const sources = [];
  for (let i = 0; i < (viewer?.dataSources?.length || 0); i += 1) {
    const source = viewer.dataSources.get(i);
    const entities = source?.entities?.values?.length || 0;
    if (entities) sources.push({ name: source.name, entities, shown: source.show });
  }

  const cctv = dataManager?.layers?.get?.('cctv')?.module?.getUIState?.() || null;

  return {
    // Read this first. `continuous` means the loop never idles.
    governor: governor && {
      mode: governor.mode,
      holds: governor.holds,
    },
    frames,
    display: {
      // `globalThis`, not `window`: this module is imported by its own tests,
      // and a bare `window` made the report throw everywhere but a browser.
      devicePixelRatio: globalThis.devicePixelRatio ?? null,
      canvas: scene ? `${scene.canvas.clientWidth}x${scene.canvas.clientHeight}` : null,
      drawingBuffer: scene ? `${scene.drawingBufferWidth}x${scene.drawingBufferHeight}` : null,
      // Resolution scale multiplies every fragment the GPU shades, so it is the
      // first dial to look at on a machine that cannot keep up.
      resolutionScale: viewer?.resolutionScale ?? null,
      msaa: scene?.msaaSamples ?? null,
      targetFrameRate: viewer?.targetFrameRate ?? null,
      requestRenderMode: scene?.requestRenderMode ?? null,
    },
    globe: {
      // Lighting is a per-fragment shader cost across the whole globe.
      lighting: scene?.globe?.enableLighting ?? null,
      shown: scene?.globe?.show ?? null,
      maximumScreenSpaceError: scene?.globe?.maximumScreenSpaceError ?? null,
      fog: scene?.fog?.enabled ?? null,
      skyAtmosphere: scene?.skyAtmosphere?.show ?? null,
    },
    enabledLayers: layers,
    entitySources: sources,
    // The CCTV card wall is the heaviest thing this app can do: each card is a
    // live thumbnail fetch and a texture upload.
    cctv: cctv && {
      cameras: cctv.count,
      ambientCards: cctv.ambientCards,
      projection: cctv.showProjection,
      coverage: cctv.coverageMode,
    },
    memory: globalThis.performance?.memory ? {
      usedMB: Math.round(globalThis.performance.memory.usedJSHeapSize / 1e6),
      limitMB: Math.round(globalThis.performance.memory.jsHeapSizeLimit / 1e6),
    } : null,
  };
}
