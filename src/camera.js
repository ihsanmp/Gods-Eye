import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * Phase 1 default: fly to Austin, TX on load.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Where the console opens: Indonesia, with a cinematic descent into Jakarta.
 *
 * It used to open over Austin, Texas, which is where the upstream project was
 * built. Everything this fork has been pointed at since is Indonesian - the
 * CCTV catalogue, the place categories, the route panel's own language - so
 * opening a hemisphere away meant the first thing the operator did every
 * session was travel.
 *
 * Two steps, kept from the original: the archipelago is framed first so the
 * country is what you see, then the camera descends into the capital. Arriving
 * already zoomed in would answer "where am I" before the eye has had a chance
 * to ask it.
 */
export function flyToIndonesia(viewer) {
  // The whole archipelago, from Sabang to Merauke, in one frame.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(118.0, -2.5, 4200000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  /*
   * Cinematic fly-in after a brief pause: Monas, central Jakarta.
   *
   * Two seconds, halved from four (owner request, 2026-09-08). This descent is
   * the heaviest moment the console has: it falls from 4,200 km to 2,200 m and
   * crosses every level of detail on the way down, drawing tiles at each one
   * while holding the render governor in continuous mode.
   *
   * Halving it does NOT halve the work - the same LOD levels are crossed either
   * way - so on its own it makes the peak TALLER rather than smaller, which is
   * what a 100% GPU reading after the change showed. What keeps that peak down
   * is the caller: this returns a promise that settles when the flight is over,
   * and main.js holds the globe at its coarse startup detail until then. The
   * descent is fast AND cheap only because those two things are paired.
   *
   * The promise settles on completion or cancellation, and a timer guarantees
   * it settles regardless - a flight that somehow reported neither would
   * otherwise leave the globe coarse for the rest of the session.
   *
   * @param {Cesium.Viewer} viewer
   * @returns {Promise<void>} Settles once the opening flight is done.
   */
  return new Promise((resolve) => {
    const durationSec = 2.0;
    const pauseMs = 500;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // Belt to the braces below: pause + duration + a second of slack.
    const fallback = setTimeout(settle, pauseMs + durationSec * 1000 + 1000);
    const finish = () => {
      clearTimeout(fallback);
      settle();
    };

    setTimeout(() => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(106.8272, -6.1754, 2200),
        orientation: {
          heading: Cesium.Math.toRadians(15),
          pitch: Cesium.Math.toRadians(-35),
          roll: 0.0,
        },
        duration: durationSec,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: finish,
        cancel: finish,
      });
    }, pauseMs);
  });
}
