/*
 * Why the trackpad needed its own zoom.
 *
 * Cesium turns a wheel event into a zoom distance through
 *
 *     rangeWindowRatio = delta / canvas.clientHeight
 *
 * and it takes `delta` straight from the event when the event is measured in
 * PIXELS, which is what a trackpad sends. A mouse wheel usually reports LINES
 * instead and Cesium multiplies those by 40. So one wheel notch arrives as
 * about 120 while a trackpad gesture arrives as about 5 — roughly a
 * twenty-fold difference in how far the same physical effort moves the camera.
 * That is the whole of "zoom feels heavy": the gesture works, it just asks for
 * almost nothing.
 *
 * Raising Cesium's own zoom factor was not an option, because it is shared: a
 * setting that makes the trackpad usable makes a mouse wheel violent. So
 * trackpad-sized events are handled here and everything else is left to Cesium
 * untouched.
 *
 * The zoom is proportional to ALTITUDE rather than a fixed number of metres.
 * A fixed step is unusable across this range — the same 500 m that crawls at
 * orbit slams into the ground over a street — while a proportional step feels
 * identical at every height, which is what people mean by smooth.
 */

/**
 * Above this many pixels a wheel event is a mouse notch, not a trackpad.
 *
 * Chrome on Windows reports a mouse wheel in pixels too, at roughly 100 per
 * notch, so the deltaMode alone cannot separate them. Trackpad gestures sit far
 * below this — commonly 1 to 10, often fractional — and the gap is wide enough
 * that the threshold does not need to be precise.
 */
export const TRACKPAD_DELTA_MAX = 50;

/** Fraction of the current altitude per pixel of gesture. */
export const TRACKPAD_ZOOM_SENSITIVITY = 0.012;

/**
 * Whether this wheel event came from a trackpad gesture.
 *
 * @param {{deltaMode: number, deltaY: number}} event
 * @returns {boolean}
 */
export function isTrackpadWheel(event) {
  // 0 is DOM_DELTA_PIXEL. A mouse reporting LINE or PAGE is never a trackpad,
  // and is left to Cesium, whose x40 scaling is tuned for exactly that.
  if (!event || event.deltaMode !== 0) return false;
  const delta = Number(event.deltaY);
  if (!Number.isFinite(delta) || delta === 0) return false;
  return Math.abs(delta) <= TRACKPAD_DELTA_MAX;
}

/**
 * The altitude a gesture should leave the camera at.
 *
 * Exponential in the gesture, so zooming out and back in by the same amount
 * returns to where it started, and so the felt speed is the same at every
 * altitude. A negative deltaY — fingers spreading, or a scroll upward — zooms
 * IN, matching every other map.
 *
 * @param {number} height - Current camera altitude in metres.
 * @param {number} deltaY - Wheel delta in pixels.
 * @param {{min?: number, max?: number}} [limits] - Zoom distance clamps.
 * @returns {number} The altitude to move to, clamped.
 */
export function nextZoomHeight(height, deltaY, limits = {}) {
  const current = Number(height);
  const delta = Number(deltaY);
  if (!Number.isFinite(current) || current <= 0) return current;
  if (!Number.isFinite(delta)) return current;

  const min = Number.isFinite(limits.min) && limits.min > 0 ? limits.min : 1;
  const max = Number.isFinite(limits.max) && limits.max > 0 ? limits.max : Number.MAX_VALUE;
  const scaled = current * Math.exp(delta * TRACKPAD_ZOOM_SENSITIVITY);
  if (!Number.isFinite(scaled)) return current;
  return Math.min(Math.max(scaled, min), max);
}

/**
 * Take trackpad zoom away from Cesium, and leave the mouse with it.
 *
 * Listens on the CONTAINER in the capture phase, which is what lets this run
 * before Cesium: its own listener sits on the canvas, and at the canvas itself
 * listeners fire in registration order regardless of the capture flag — Cesium
 * registered first, when the viewer was built. A capture listener one level up
 * is reached earlier in the propagation path, so it can stop the event there.
 *
 * @param {object} viewer - Cesium viewer.
 * @param {HTMLElement} container - The element the canvas lives in.
 * @param {() => void} [requestRender] - Ask the render governor for a frame.
 * @returns {() => void} Removal function.
 */
export function installTrackpadZoom(viewer, container, requestRender = null) {
  const canvas = viewer?.scene?.canvas;
  if (!canvas || !container?.addEventListener) return () => {};

  const onWheel = (event) => {
    if (!isTrackpadWheel(event)) return; // a mouse: Cesium keeps it
    const controller = viewer.scene?.screenSpaceCameraController;
    // Modes that take the camera away from the pointer (cockpit, the CCTV
    // calibration gizmo) switch inputs off wholesale; this must respect that or
    // it becomes the one control that still moves the camera in them.
    if (controller && controller.enableInputs === false) return;

    event.preventDefault();
    // Cesium's listener is downstream on the canvas, so stopping here is what
    // prevents the same gesture being zoomed twice, at two different rates.
    event.stopPropagation();

    const camera = viewer.camera;
    const height = camera?.positionCartographic?.height;
    if (!Number.isFinite(height)) return;
    const target = nextZoomHeight(height, event.deltaY, {
      min: controller?.minimumZoomDistance,
      max: controller?.maximumZoomDistance,
    });
    const move = height - target;
    if (!Number.isFinite(move) || move === 0) return;
    if (move > 0) camera.zoomIn(move);
    else camera.zoomOut(-move);
    // The scene renders on demand, so a camera moved outside Cesium's own input
    // path has to ask for the frame that shows it.
    if (typeof requestRender === 'function') requestRender();
  };

  container.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => container.removeEventListener('wheel', onWheel, { capture: true });
}
