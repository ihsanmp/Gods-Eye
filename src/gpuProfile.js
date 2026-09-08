/*
 * What the GPU underneath actually is, shared by everything that spends it.
 *
 * The quality preset in .env is a stated intent; this is the hardware it lands
 * on. A full-screen 3D globe is fill-rate and memory-bandwidth bound, and an
 * integrated GPU shares both its bandwidth and its power budget with the CPU
 * beside it — so settings a discrete card shrugs off are what make an iGPU
 * laptop run hot, throttled, and slow.
 *
 * main.js probes once, at viewer construction, because that is where the WebGL
 * context is. ui.js reads the answer when it applies the first-load
 * post-processing defaults, which is much later. Hence a module rather than a
 * parameter: the two are far apart and neither owns the other.
 */

let _profile = { renderer: '', integrated: false, probed: false };

/**
 * Read the real GPU string and classify it.
 *
 * WEBGL_debug_renderer_info gives the unmasked renderer, e.g.
 * "ANGLE (Intel, Intel(R) Arc(TM) Graphics ... D3D11)". A discrete part names
 * itself (NVIDIA / GeForce / RTX, or AMD's discrete Radeon RX); the integrated
 * families are Intel (UHD, Iris, Arc-on-die), AMD Vega/RDNA iGPUs, Apple, and
 * the software fallbacks.
 *
 * An UNKNOWN renderer is treated as NOT integrated, so a GPU whose driver
 * blocks the extension keeps the quality it was asked for rather than being
 * quietly downgraded on a guess.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext|null} gl
 * @returns {{renderer: string, integrated: boolean}}
 */
export function probeGpu(gl) {
  let renderer = '';
  try {
    const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch { /* some contexts block the extension; treat as unknown */ }

  const r = renderer.toLowerCase();
  const discrete = /nvidia|geforce|rtx|gtx|quadro|radeon rx|arc a\d/.test(r);
  const integrated = !discrete
    && /intel|uhd|iris|arc|apple|adreno|mali|vega|radeon\(tm\) graphics|llvmpipe|swiftshader|microsoft basic/.test(r);
  return { renderer, integrated };
}

/**
 * Record the probe so later code can read it.
 * @param {{renderer: string, integrated: boolean}} profile
 * @returns {void}
 */
export function setGpuProfile(profile) {
  _profile = {
    renderer: String(profile?.renderer || ''),
    integrated: profile?.integrated === true,
    probed: true,
  };
}

/** @returns {{renderer: string, integrated: boolean, probed: boolean}} */
export function getGpuProfile() {
  return _profile;
}

/**
 * Whether this machine should skip effects that cost a full-screen pass.
 *
 * False until the probe has run, so nothing is disabled on a guess during the
 * window before the viewer exists.
 *
 * @returns {boolean}
 */
export function shouldSkipExpensiveEffects() {
  return _profile.probed && _profile.integrated;
}
