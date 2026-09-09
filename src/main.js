import * as Cesium from 'cesium';
import { StyleManager } from './ui.js';
import { flyToIndonesia } from './camera.js';
import { DataLayerManager } from './data/manager.js';
import flightsLayer from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
import earthquakesLayer from './data/earthquakes.js';
import severeWeatherLayer from './data/severeWeather.js';
import dayNightLayer from './data/dayNight.js';
import worldEventsLayer from './data/worldEvents.js';
import satellitesLayer from './data/satellites.js';
import rocketLaunchesLayer from './data/rocketLaunches.js';
import trafficLayer from './data/traffic.js';
import cctvLayer from './data/cctv.js';
import radioLayer from './data/radio.js';
import bikeshareLayer from './data/bikeshare.js';
import aisLiveVesselsLayer from './data/aisLiveVessels.js';
import militaryInstallationsLayer from './data/militaryInstallations.js';
import militaryAwarenessLayer from './data/militaryAwareness.js';
import localDataLayers from './data/localLayers.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { initVoiceCommands } from './voice/voiceRealtime.js';
import { MapStackController } from './mapStackController.js';
import { initAnnotations } from './annotations/index.js';
import { initDrawingTools } from './measure/drawingTools.js';
import { perfSnapshot } from './perfSnapshot.js';
import { initLogoGaze } from './logoGaze.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask } from './scopeMask.js';
import { initFirstRunExperience } from './firstRunExperience.js';
import { probeGpu, setGpuProfile } from './gpuProfile.js';
import { installTrackpadZoom } from './trackpadZoom.js';

/**
 * Tile screen-space error used until the first tile queue drains. Coarser than
 * every quality preset, so the globe reaches first paint on far fewer tiles and
 * then sharpens to the configured target. See the progressive-LOD block below.
 */
const STARTUP_SCREEN_SPACE_ERROR = 6;


initLogoGaze();

// React spotlight overlay (Ctrl/Cmd-K, or clicking the search bar). Loaded
// lazily so React, framer-motion and lucide stay off the startup critical path
// of a session that never opens it.
/*
 * legacy-chrome.css hides the old LOCATION tray and the collapsed panel chips from
 * the first style resolution, so the console never opens wearing the old
 * interface. That is only safe while the replacements actually arrive: if a
 * mount fails, marking the body here releases the `body:not(...)` guard on
 * those rules and the old control comes straight back, rather than leaving a
 * console with no search bar and no way to open a panel.
 */
const legacyFallback = (marker) => (error) => {
  document.body.classList.add(marker);
  console.warn(`[${marker}] mount failed, restoring the old control:`, error);
};

import('./spotlightMount.tsx')
  .then(({ mountSpotlight }) => mountSpotlight())
  .catch(legacyFallback('mm-spotlight-unavailable'));

// One fluid menu in place of the scattered panel chips. Mounted after the
// app so the panels it toggles already exist in the DOM.
window.addEventListener('load', () => {
  import('./fluidMenuMount.tsx')
    .then(({ mountFluidMenu }) => mountFluidMenu())
    .catch(legacyFallback('mm-fluid-menu-unavailable'));

  // Top-right clock reading the time where the camera is looking. Lazy for the
  // same reason as the menu - it carries a 72 KB timezone dataset that a
  // session is no worse for loading after first paint - and it waits for the
  // viewer itself, so mounting here does not race the globe.
  import('./mapClockMount.tsx')
    .then(({ mountMapClock }) => mountMapClock())
    .catch((error) => console.warn('[map-clock] unavailable:', error));
});

/**
 * Extract a human-readable error message from any thrown value.
 * Handles Error objects, strings, and plain objects with message/error fields.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || 'Initialization error';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}

/**
 * MAP MONITORING — Main Entry Point
 * Initializes CesiumJS with Google Photorealistic 3D Tiles,
 * style system, intelligence HUD, location presets, and share links.
 */
async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');

  try {
    loaderStatus.textContent = 'Configuring viewer...';

    // Set Cesium Ion token for World Terrain
    const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
    if (cesiumToken) {
      Cesium.Ion.defaultAccessToken = cesiumToken;
    }

    /**
     * Which basemap this install boots on. `osm` is the default because it is
     * the only stack that costs nothing and needs no key at all — Cesium's
     * OpenStreetMapImageryProvider straight off tile.openstreetmap.org.
     *
     * `photoreal` is the Google Photorealistic 3D Tiles globe, and it is billed
     * per session: a page refresh starts a new one. It is therefore OPT-IN, so
     * an install that does not want that bill never issues the request in the
     * first place — rather than issuing it and falling back after it fails,
     * which is what the catch block below is for.
     */
    const requestedMapStack = String(import.meta.env.MM_MAP_STACK || 'osm').toLowerCase();
    const wantsPhotoreal = requestedMapStack === 'photoreal';

    // Google Maps key. Optional: it buys the photoreal globe and the Google
    // geocoder, and the app is fully functional without either — searches fall
    // through to the keyless Nominatim proxy.
    const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
    if (googleApiKey) {
      Cesium.GoogleMaps.defaultApiKey = googleApiKey;
      // Read by locations.js for geocoding. That is a separate, per-request SKU
      // from the 3D tiles, so it stays available even when photoreal is off.
      window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;
    }
    if (wantsPhotoreal && !googleApiKey) {
      throw new Error('MM_MAP_STACK=photoreal needs GOOGLE_MAPS_API_KEY. Set the key, or use MM_MAP_STACK=osm.');
    }

    // Create the Cesium viewer with minimal chrome
    const viewer = new Cesium.Viewer('cesiumContainer', {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      // Visible attribution container — Google Maps / 3D Tiles credits are
      // required by Google's Terms of Service, so they must be shown (styled
      // subtly via #cesium-credits). The credit line stays visible in
      // clean-view AND recording modes too (ToS requires attribution while the
      // content is displayed — those are the exact modes used to record
      // demos), including the "Data attribution" link that opens the per-layer
      // license popover.
      creditContainer: (() => {
        const el = document.createElement('div');
        el.id = 'cesium-credits';
        document.body.appendChild(el);
        return el;
      })(),
      msaaSamples: 4,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
    });

    // Cap the default render loop at 60 fps. Cesium's loop otherwise runs at
    // the display's refresh rate — 120 Hz on ProMotion panels — doubling GPU
    // and CPU burn for zero visual benefit in a map app whose animation
    // cadences (poll interpolation, trail fades, style crossfades) are all
    // designed against wall-clock time, not frame count. Measured on the
    // 2026-08-05 perf investigation as a strict halving of idle burn on
    // 120 Hz hardware; a no-op on 60 Hz displays. (perf item 2)
    viewer.targetFrameRate = 60;

    // Render fidelity. Cesium defaults to "browser recommended" resolution, which
    // rasterizes at CSS pixels and ignores devicePixelRatio — on a HiDPI panel the
    // globe is upscaled from roughly a quarter of the pixels the display can show,
    // which is the single biggest source of softness in the keyless stacks (there
    // are no Google 3D Tiles to carry detail). maximumScreenSpaceError is the tile
    // LOD knob: lower loads finer imagery/terrain at the same camera distance.
    // Both cost GPU, so MM_RENDER_QUALITY dials them back without a code edit.
    //
    // `msaa` and `targetFps` were added after measuring the running app: MSAA
    // was 4x and the frame rate was uncapped at 60, and those two were the
    // largest GPU costs on the console with nothing else changed. 4x MSAA on a
    // full-screen globe is the single most expensive setting here, and an
    // uncapped 60 fps burns nearly double the GPU of 30 while the render
    // governor is held in continuous mode by an active layer - which is exactly
    // when the machine is under load. (When no layer is on, the governor idles
    // and renders on demand, so the cap costs nothing there.)
    const RENDER_QUALITY_PRESETS = {
      high: { pixelRatioCap: 2, screenSpaceError: 1.5, tileCache: 300, msaa: 4, targetFps: 60 },
      balanced: { pixelRatioCap: 1.5, screenSpaceError: 2, tileCache: 200, msaa: 2, targetFps: 45 },
      performance: { pixelRatioCap: 1, screenSpaceError: 3, tileCache: 100, msaa: 1, targetFps: 30 },
    };
    // Default is BALANCED, not high. The brief was to reduce this machine's
    // load, and balanced is the honest reading of that: half the MSAA, a 45 fps
    // cap, a lighter tile cache and pixel ratio, for a difference most eyes
    // cannot pick out against the cost it saves. MM_RENDER_QUALITY=high opts
    // back into the maximum for a machine that wants it.
    /*
     * Pinch to zoom, on a trackpad.
     *
     * A trackpad pinch is not a touch gesture as far as a desktop browser is
     * concerned: it arrives as a `wheel` event with `ctrlKey` set. Cesium keys
     * every wheel listener by MODIFIER — getKey(WHEEL, modifier) — so that is a
     * different event from the plain WHEEL in zoomEventTypes, and it was mapped
     * to nothing at all.
     *
     * The browser's own page zoom is NOT involved, though it looks like it
     * should be: Cesium's aggregator registers a wheel listener for every
     * modifier at construction, so ctrl+wheel is always consumed and always
     * preventDefault'd. The gesture was simply collected and never used —
     * aggregated under a key that no camera behaviour was listening for, and so
     * inert. (Checked at runtime before claiming otherwise: ctrl+wheel came
     * back defaultPrevented both with and without this entry.)
     *
     * Plain WHEEL is left in place, so a mouse wheel and a two-finger scroll
     * both keep zooming exactly as before. Dragging is untouched: the standard
     * tap-tap-hold-drag produces an ordinary left drag, which is already how the
     * map is moved.
     */
    const cameraInput = viewer.scene.screenSpaceCameraController;
    cameraInput.zoomEventTypes = [
      ...cameraInput.zoomEventTypes,
      { eventType: Cesium.CameraEventType.WHEEL, modifier: Cesium.KeyboardEventModifier.CTRL },
    ];

    /*
     * Mapping the gesture was only half of it — it then felt heavy, and for a
     * measurable reason. Cesium scales a wheel event by 40 when the browser
     * reports it in LINES, which is a mouse, and uses it RAW when reported in
     * pixels, which is a trackpad. One mouse notch therefore arrives as about
     * 120 and a trackpad gesture as about 5, so the same effort moved the
     * camera roughly twenty times less far. Trackpad-sized events are taken
     * over here; a mouse is left entirely to Cesium. See trackpadZoom.js.
     */
    installTrackpadZoom(
      viewer,
      document.getElementById('cesiumContainer'),
      () => governorRequestRender('trackpad-zoom'),
    );

    const qualityKey = String(import.meta.env.MM_RENDER_QUALITY || 'balanced').toLowerCase();
    const quality = RENDER_QUALITY_PRESETS[qualityKey] || RENDER_QUALITY_PRESETS.balanced;
    // Turning this off makes Cesium adopt devicePixelRatio as its pixel ratio;
    // resolutionScale then multiplies ON TOP of that, so the cap has to be
    // expressed as a ratio or a 2x display renders 4x and burns 16x the pixels.
    viewer.useBrowserRecommendedResolution = false;
    const devicePixels = window.devicePixelRatio || 1;
    viewer.resolutionScale = Math.min(devicePixels, quality.pixelRatioCap) / devicePixels;

    // The two GPU levers the measurement turned up. msaaSamples is read live by
    // the renderer, and targetFrameRate throttles the render loop - harmless in
    // idle (render-on-demand) mode, a near-halving of GPU while a layer holds
    // the scene in continuous mode.
    //
    // On an INTEGRATED GPU these are clamped below the preset, because that is
    // where 4x MSAA at 60 fps actually hurts: the iGPU shares memory bandwidth
    // and the thermal budget with the CPU, so the heavy combo throttles the
    // whole machine rather than just the frame. Measured target here is the
    // Intel Arc iGPU of a Core Ultra 7 155H with no discrete card. The clamp
    // only ever LOWERS from the preset - a machine set to performance is left
    // alone - and the preset stays the ceiling the operator asked for.
    const gpu = probeGpu(viewer.scene.context._gl || viewer.scene.context.gl);
    setGpuProfile(gpu);
    /*
     * MSAA OFF on an integrated GPU, not merely halved.
     *
     * The first pass clamped 4x to 2x and the machine was still saturated.
     * Multisampling multiplies the work of every covered pixel in the geometry
     * pass, and a globe covers the entire screen — there is no small part of
     * the frame for it to be cheap on. What it buys is smoother edges on
     * coastlines and label boxes, which is a real but small gain against a chip
     * that cannot finish the frame at all.
     *
     * A discrete card keeps whatever the preset asked for.
     */
    const msaa = gpu.integrated ? 1 : quality.msaa;
    const targetFps = gpu.integrated ? Math.min(quality.targetFps, 30) : quality.targetFps;
    viewer.scene.msaaSamples = msaa;
    viewer.targetFrameRate = targetFps;

    /*
     * The GPU budget, and what it can honestly promise.
     *
     * "Use 70% of the GPU" is not a setting any browser exposes - utilisation is
     * an outcome, not a dial, and nothing here can cap it directly. What IS
     * controllable is the work each frame asks for, and on an integrated GPU
     * running a full-screen globe that work is dominated by fragment shading:
     * cost tracks the PIXEL COUNT almost linearly. Pixels scale with the square
     * of resolutionScale, so rendering at sqrt(0.70) of full resolution asks the
     * GPU for roughly 70% of the shading work it was doing before.
     *
     * That is the claim being made: 70% of the rendering work. Whether Task
     * Manager then reads 70% depends on what else is competing for the chip -
     * tile decode, the compositor, everything outside this process - so the
     * number to watch is that the globe stops pegging, not that a gauge lands on
     * a particular value.
     *
     * Full resolution is kept for a discrete card, which does not need the help.
     * MM_GPU_BUDGET overrides either way; the floor is 40 because below that
     * the globe is soft enough to look broken rather than economical.
     */
    const budgetRaw = Number(import.meta.env.MM_GPU_BUDGET);
    const gpuBudget = Number.isFinite(budgetRaw)
      ? Math.min(100, Math.max(40, budgetRaw))
      : (gpu.integrated ? 70 : 100);
    const budgetScale = gpuBudget < 100 ? Math.sqrt(gpuBudget / 100) : 1;
    const baseResolutionScale = viewer.resolutionScale * budgetScale;

    /*
     * A percentage of a big panel is still a big number.
     *
     * The budget above is RELATIVE, and that is not enough on its own. These
     * laptops ship 2.8K and 3K screens: 70% of 2880x1800 is still 3.6 million
     * pixels per frame, which is why the GPU kept reading 100% after the budget
     * landed. The relative cut was real and did nothing that mattered, because
     * the thing it was a fraction OF was the problem.
     *
     * So an integrated GPU also gets an ABSOLUTE ceiling, in pixels drawn. Two
     * megapixels is a little over 1080p, which is what this class of chip can
     * actually push through a full-screen globe. On a 1080p panel the ceiling
     * never binds and only the budget applies; on a 3K panel it is what does
     * the work.
     *
     * Recomputed on resize because resolutionScale is a RATIO: Cesium keeps it
     * across a resize, so a scale chosen for one window is the wrong absolute
     * pixel count in the next.
     */
    const MAX_INTEGRATED_PIXELS = 2_000_000;
    const applyResolutionCeiling = () => {
      const canvas = viewer.scene?.canvas;
      const cssWidth = canvas?.clientWidth || 0;
      const cssHeight = canvas?.clientHeight || 0;
      if (!cssWidth || !cssHeight) {
        viewer.resolutionScale = baseResolutionScale;
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      let scale = baseResolutionScale;
      if (gpu.integrated) {
        const pixels = (cssWidth * dpr * scale) * (cssHeight * dpr * scale);
        if (pixels > MAX_INTEGRATED_PIXELS) {
          scale *= Math.sqrt(MAX_INTEGRATED_PIXELS / pixels);
        }
      }
      // Never upscale past what the budget asked for, and never to nothing.
      viewer.resolutionScale = Math.max(0.1, Math.min(scale, baseResolutionScale));
    };
    applyResolutionCeiling();
    window.addEventListener('resize', applyResolutionCeiling);

    /*
     * Tile detail and cache are clamped for the same reason MSAA and frame rate
     * are, and were the levers the first pass left out. MM_RENDER_QUALITY=high
     * asks for a screen-space error of 1.5 - a very sharp globe, and a great
     * many more tiles drawn, decoded and uploaded per frame. That is a discrete
     * card's setting. On the shared memory bandwidth of an iGPU it is the
     * heaviest thing on screen during the opening descent, which crosses every
     * LOD level in four seconds.
     *
     * As before the clamp only ever LOWERS: a machine already set to performance
     * keeps its coarser value, and the preset stays the ceiling.
     */
    const screenSpaceError = gpu.integrated
      ? Math.max(quality.screenSpaceError, 2.5)
      : quality.screenSpaceError;
    const tileCache = gpu.integrated ? Math.min(quality.tileCache, 200) : quality.tileCache;
    viewer.scene.globe.tileCacheSize = tileCache;

    if (gpu.integrated) {
      // eslint-disable-next-line no-console
      console.info(
        `[mm] integrated GPU detected (${gpu.renderer || 'unknown'}); `
        + `MSAA ${msaa === 1 ? "off" : msaa}, sharpen off, ${targetFps} fps, ${gpuBudget}% pixel budget `
        + `(resolutionScale ${viewer.resolutionScale.toFixed(3)}), SSE>=${screenSpaceError}, cache<=${tileCache}. `
        // The number that actually decides whether this chip copes. A ratio
        // hides it: 70% of a 3K panel and 70% of a 1080p one are very
        // different workloads, and only this says which one is being drawn.
        + `Drawing ${((viewer.scene.canvas.width * viewer.scene.canvas.height) / 1e6).toFixed(2)} MP/frame `
        + `(panel dpr ${(window.devicePixelRatio || 1).toFixed(2)}).`,
      );
    }

    // Progressive LOD. The quality preset's screen-space error is a STEADY-STATE
    // target: applying it from frame zero multiplies the tiles that must arrive
    // before anything is on screen, so a sharper globe also means a slower one to
    // first paint. Startup therefore runs coarse and tightens to the preset once
    // the first tile queue drains. Sibling preloading — extra neighbour tiles that
    // make panning smooth — waits for the same moment rather than competing with
    // the tiles actually in view.
    viewer.scene.globe.maximumScreenSpaceError = Math.max(STARTUP_SCREEN_SPACE_ERROR, screenSpaceError);
    viewer.scene.globe.preloadSiblings = false;

    /*
     * Two gates, and the second one is why the opening flight is affordable.
     *
     * Draining the tile queue is not enough on its own. The opening descent
     * falls through every LOD level in two seconds, and the queue can reach
     * zero at any point along the way; tightening there would sharpen the globe
     * MID-FLIGHT, at the exact moment the GPU is already drawing the most it
     * ever will. That is a measured symptom, not a theory - the 3D engine sat
     * at 100% through launch.
     *
     * So detail waits for the flight to be over as well. Coarse is the right
     * setting while the camera is moving fast: nobody can resolve fine tiles
     * through a descent, and the frames it saves are the frames that were
     * pegging the chip.
     */
    let openingFlightSettled = false;
    let queuedTiles = Number.POSITIVE_INFINITY;
    const applySteadyStateQuality = (queued) => {
      if (Number.isFinite(queued)) queuedTiles = queued;
      if (!openingFlightSettled || queuedTiles > 0) return;
      viewer.scene.globe.maximumScreenSpaceError = screenSpaceError;
      viewer.scene.globe.preloadSiblings = true;
      viewer.scene.globe.tileLoadProgressEvent.removeEventListener(applySteadyStateQuality);
    };
    viewer.scene.globe.tileLoadProgressEvent.addEventListener(applySteadyStateQuality);
    /** Open the detail gate once the opening flight is done (or never ran). */
    const releaseOpeningFlightGate = () => {
      openingFlightSettled = true;
      applySteadyStateQuality(queuedTiles);
    };

    // Register per-layer data attribution into the "Data attribution" popover.
    // Required by each source's license (ODbL, CC BY-NC-SA, NASA FIRMS, etc.);
    // strings are verbatim from DATA_SOURCES.md. Static + always-present in the
    // expandable bottom-left credit lightbox (showOnScreen=false), so they never
    // clutter the on-globe attribution line.
    registerDataCredits(viewer);

    // Hide Cesium's default globe — Google Photorealistic 3D Tiles provide their own
    // globe at all LODs (street level → orbital). The default globe's 2D imagery
    // clips through 3D tile buildings at close range.
    viewer.scene.globe.show = false;

    // Keep a sky behind Google 3D Tiles, but soften Cesium's high-intensity
    // default atmosphere. With the globe hidden its bright limb otherwise
    // reads as a hard cyan seam where distant photoreal tiles meet the sky.
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    let tileset = null;
    if (wantsPhotoreal) {
      loaderStatus.textContent = 'Loading Google 3D Tiles...';
      try {
        // Load Google Photorealistic 3D Tiles
        tileset = await Cesium.createGooglePhotorealistic3DTileset({
          onlyUsingWithGoogleGeocoder: true,
        });
        viewer.scene.primitives.add(tileset);
        // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
        // Google Photorealistic 3D Tiles provide their own terrain/elevation.
        viewer.scene.globe.show = false;
      } catch (tileError) {
        console.warn('[Init] Google 3D Tiles unavailable, falling back to Cesium globe:', tileError);
        const tileErrorDetail = describeError(tileError);
        loaderStatus.textContent = `Google 3D Tiles unavailable (${tileErrorDetail}). Continuing in fallback mode...`;
        // Keep Cesium globe visible as fallback instead of aborting the app.
        viewer.scene.globe.show = true;
      }
    } else {
      // No tileset means the ellipsoid globe carries the imagery, so it has to
      // be visible — the photoreal path is the only one that hides it.
      viewer.scene.globe.show = true;
    }

    loaderStatus.textContent = 'Initializing systems...';

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      cesiumToken,
      initialStack: tileset ? 'photoreal' : 'osm',
      // Task 5 (height-datum fix): rebroadcast stack changes as a window
      // CustomEvent so data layers (CCTV per-regime ground resolution) can
      // react without coupling MapStackController to layer modules. Fires on
      // 'switching'/'ready'/'error'; listeners derive the surface regime from
      // live scene state, so intermediate emissions are harmless.
      onChange: (state) => {
        window.dispatchEvent(new CustomEvent('mm:map-stack-changed', { detail: state }));
      },
      onError: (message) => console.warn('[MapStack]', message),
    });
    await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });

    // Initialize the style manager (post-processing, HUD, locations, share links)
    const styleManager = new StyleManager(viewer, { mapStackController });
    // The previous multi-canvas weather compositor remains disabled. Cockpit
    // clouds use a separate, capped low-resolution GPU pass that never attaches
    // Cesium fog or post-process stages and is fully stopped in map mode.
    const weatherEffects = null;
    const cockpitCloudEffects = initCockpitCloudEffects(viewer);

    // If no share link state, open where this console actually works.
    if (!styleManager.hasShareState) {
      loaderStatus.textContent = 'Menuju Indonesia...';
      // The globe stays at its coarse startup detail until this settles — see
      // the two gates above. A share link does not fly, so it opens the gate at
      // once and keeps the behaviour it always had.
      void flyToIndonesia(viewer).then(releaseOpeningFlightGate);
    } else {
      loaderStatus.textContent = 'Restoring shared view...';
      releaseOpeningFlightGate();
    }

    // Initialize data layer manager
    const dataManager = new DataLayerManager(viewer, {
      allowQaRegistration: import.meta.env.DEV,
    });
    dataManager.register(flightsLayer);
    dataManager.register(militaryFlightsLayer);
    dataManager.register(earthquakesLayer);
    dataManager.register(severeWeatherLayer);
    dataManager.register(dayNightLayer);
    dataManager.register(worldEventsLayer);
    dataManager.register(satellitesLayer);
    dataManager.register(rocketLaunchesLayer);
    rocketLaunchesLayer.attachDataManager(dataManager);
    dataManager.register(trafficLayer);
    dataManager.register(cctvLayer);
    dataManager.register(radioLayer);
    dataManager.register(bikeshareLayer);
    dataManager.register(aisLiveVesselsLayer);
    dataManager.register(militaryInstallationsLayer);
    dataManager.register(militaryAwarenessLayer);
    militaryAwarenessLayer.attachDataManager(dataManager);
    for (const layer of localDataLayers) {
      dataManager.register(layer);
    }
    // Restoration starts only after the complete production registry is sealed.
    dataManager.finalizeRegistrations(LAYER_STATE_REGISTRY);
    if (import.meta.env.DEV) {
      window.__gevQaRegisterLayer = (targetManager, layerModule) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.registerForQa(layerModule);
      };
      window.__gevQaUnregisterLayer = (targetManager, layerId) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.unregisterForQa(layerId);
      };
    }
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    styleManager.attachDataManager(dataManager);

    // Initialize deterministic scene playback for social clip capture
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // Initialize the voice "whiteboard" annotation engine (world-space renderer)
    const annotations = initAnnotations({ viewer, tileset });
    // The Route panel draws through the same engine the voice route tool uses,
    // so there is one routing path and one way a route can look on the map.
    styleManager.attachAnnotations(annotations);

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    void Promise.all([
      styleManager.initialRestorePromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]).finally(() => {
      loadingScreen.classList.add('hidden');
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        initFirstRunExperience({ styleManager, dataManager });
      };
      loadingScreen.addEventListener('transitionend', revealFirstRun, { once: true });
      setTimeout(revealFirstRun, 900);
    });

    // Expose for debugging
    // Idle render governor: flips the scene into requestRenderMode whenever
    // nothing animates per frame. Installed AFTER every module above has had
    // its chance to register pre-install holds. (perf wave 2)
    installRenderGovernor(viewer);

    // The explicit scope mask replaces the emergent six-pass artifact —
    // see src/scopeMask.js. Installed before the UI so the DISPLAY-rail
    // toggle finds it live.
    installScopeMask(viewer);

    // The follow camera recomputes the tracked target's dead-reckon position
    // every frame — tracking anything is a per-frame animation. (perf wave 2)
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    });

    // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
    // stop the default render loop outright — a hidden canvas repaints for
    // nobody, and browser rAF throttling still lets throttled frames burn
    // GPU. Holder/data state is untouched, so return is seamless: restore
    // the loop, refresh the one DOM surface we gated, render a frame.
    const syncVisibilitySuspension = () => {
      const hidden = document.hidden;
      viewer.useDefaultRenderLoop = !hidden;
      cockpitCloudEffects?.setSuspended?.(hidden);
      if (!hidden) {
        if (dataManager._panelRefreshPendingOnVisible) {
          dataManager._panelRefreshPendingOnVisible = false;
          dataManager._refreshTogglePanel();
        }
        governorRequestRender('visibility-restore');
      }
    };
    document.addEventListener('visibilitychange', syncVisibilitySuspension);
    // Apply the CURRENT state too — bootstrap can complete while the tab is
    // already hidden, and waiting for the next transition would leave the
    // loop burning behind a hidden tab. (perf wave 2 fix)
    syncVisibilitySuspension();

    window.__mapMonitoring = {
      viewer,
      styleManager,
      tileset,
      dataManager,
      sceneDirector,
      mapStackController,
      annotations,
      weatherEffects,
      cockpitCloudEffects,
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    window.__mapMonitoring.voiceCommands = initVoiceCommands({ viewer, styleManager, dataManager, sceneDirector, annotations });
    window.__mapMonitoring.drawingTools = initDrawingTools({ viewer, dataManager });

    /*
     * One command for "why is this heavy", run ON the machine that is heavy:
     *
     *   window.__mapMonitoring.perfSnapshot().then(console.log)
     *
     * The costs that matter here are GPU costs, and none of them can be
     * measured from a hidden or headless browser — the canvas never composites
     * and rAF never ticks, so every timing comes back small and means nothing.
     * This samples REAL frames and reports the state needed to read them.
     */
    window.__mapMonitoring.perfSnapshot = () => perfSnapshot({
      viewer,
      dataManager,
      governorDiagnostics: getRenderGovernorDiagnostics,
    });

  } catch (error) {
    console.error('Map Monitoring initialization failed:', error);
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  }
}

init();
