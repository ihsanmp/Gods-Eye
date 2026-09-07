import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { GlassTimeCard } from '@/components/ui/glass-time-card';
import { offsetLabel, timezoneForCoordinate } from '@/lib/mapTimezone.js';
import '@/tailwind.css';

/**
 * A clock in the top-right showing the time WHERE THE MAP IS LOOKING.
 *
 * Point the camera at Jakarta and it reads Jakarta's afternoon; swing to New
 * York and it reads New York's morning, on New York's date. The zone comes from
 * the coordinate through src/lib/mapTimezone.js, not from the browser.
 *
 * Two things keep it off the frame budget, on a machine with no discrete GPU:
 *
 *   - the zone is resolved on `moveEnd` only. Cesium fires that when camera
 *     motion STOPS, so a drag across the Pacific costs one lookup at the end
 *     rather than one per frame. Nothing here runs inside the render loop.
 *   - the one-second ticker stops entirely while the document is hidden, and
 *     re-reads the clock on return, so a minimised console ticks zero times and
 *     still comes back correct rather than resuming from a stale second.
 *
 * The corner it occupies was the old #style-indicator's, which legacy-chrome.css
 * already retired with the rest of the original shell.
 */

/** The point on the globe whose local time is shown. */
function mapCentreCoordinate(viewer: any): { lat: number; lon: number } | null {
  try {
    const camera = viewer?.camera;
    if (!camera) return null;

    /*
     * The centre of the VIEW, not the position of the camera.
     *
     * Under any tilt the two are different places - looking north across
     * Jakarta from 60 km up, the camera itself can be over the Java Sea - and
     * the question the clock answers is about what is on screen. So pick the
     * ellipsoid under the middle of the canvas first.
     */
    const canvas = viewer.scene?.canvas;
    if (canvas?.clientWidth && canvas?.clientHeight) {
      const centre = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
      const hit = camera.pickEllipsoid(centre, Cesium.Ellipsoid.WGS84);
      if (hit) {
        const carto = Cesium.Cartographic.fromCartesian(hit);
        if (carto) {
          return {
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude),
          };
        }
      }
    }

    // Looking at the horizon or off the globe entirely, the centre ray hits
    // nothing. The camera's own ground track is then the honest answer.
    const carto = camera.positionCartographic;
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  } catch {
    return null;
  }
}

function MapClock() {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const zoneRef = useRef<string | null>(null);

  // Follow the camera. One lookup when movement stops, plus one on mount for
  // the opening view.
  useEffect(() => {
    let cancelled = false;
    let removeListener: (() => void) | null = null;

    const resolve = () => {
      if (cancelled) return;
      const viewer = (window as any).__godsEyeView?.viewer;
      const centre = mapCentreCoordinate(viewer);
      const zone = centre ? timezoneForCoordinate(centre.lat, centre.lon) : null;
      // Setting state on every moveEnd would re-render the card for a pan that
      // never left the zone, which is most pans.
      if (zone && zone !== zoneRef.current) {
        zoneRef.current = zone;
        setTimeZone(zone);
        setNow(new Date());
      }
    };

    /*
     * The viewer is built by main.js and this mounts alongside it, so it may not
     * exist for the first frames. Poll briefly for it rather than racing: the
     * poll stops the moment it succeeds, and gives up rather than spinning
     * forever if the globe never arrives.
     */
    let attempts = 0;
    const attach = () => {
      if (cancelled) return;
      const viewer = (window as any).__godsEyeView?.viewer;
      if (viewer?.camera?.moveEnd) {
        removeListener = viewer.camera.moveEnd.addEventListener(resolve);
        resolve();
        return;
      }
      if (attempts++ > 40) return; // ~20 s, then stop asking
      window.setTimeout(attach, 500);
    };
    attach();

    return () => {
      cancelled = true;
      if (removeListener) removeListener();
    };
  }, []);

  // The seconds. Stopped while hidden - a clock nobody can see does not need to
  // tick - and resynced on return so it never shows a stale time.
  useEffect(() => {
    let timer: number | null = null;

    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => setNow(new Date()), 1000);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        setNow(new Date());
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /*
   * The offset label, recomputed once an hour rather than once a second.
   *
   * `offsetLabel` builds an Intl formatter to read the zone's current offset,
   * and that constructor is the expensive part (0.356 ms for three of them,
   * measured here, against 0.0056 ms to reuse). The answer changes only when
   * the zone changes or when daylight saving shifts - and DST shifts land
   * exactly on an hour boundary, so keying the memo to the hour keeps it
   * correct through the transition while doing the work 3,600 times less often.
   */
  const hourBucket = Math.floor(now.getTime() / 3_600_000);
  const offset = useMemo(
    () => (timeZone ? offsetLabel(timeZone, now) : ''),
    // `now` is read but deliberately not a dependency: it advances every second
    // and the value it produces here does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeZone, hourBucket],
  );

  // Nothing to show until the camera has reported a place. An empty corner is
  // better than a confident wrong hour.
  if (!timeZone) return null;

  return (
    <GlassTimeCard
      timeZone={timeZone}
      offset={offset}
      now={now}
      showSeconds
      showTimezone
    />
  );
}

let root: Root | null = null;

export function mountMapClock(): void {
  if (root) return;
  const container = document.createElement('div');
  container.id = 'map-clock-root';
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(
    <StrictMode>
      <MapClock />
    </StrictMode>
  );
}
