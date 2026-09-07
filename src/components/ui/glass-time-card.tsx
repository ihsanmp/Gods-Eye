import { useMemo } from 'react';

/**
 * The wall clock at a place on the map.
 *
 * Adapted from the supplied glass time card, which read the BROWSER's clock and
 * zone. This console's clock has to answer a different question - what time is
 * it where the camera is looking - so the zone arrives as a prop and every
 * field is formatted in it.
 *
 * That changes more than the hour. The original built its date line from
 * `getDate()` / `getDay()` / `getMonth()`, which are the viewer's local
 * calendar: with the map on New York and the operator in Jakarta it would have
 * printed Jakarta's date above New York's time, and for half the day those are
 * genuinely different days - the card now reads "Tuesday | September 8" over
 * Auckland while Jakarta is still on the 7th. Both lines come from the same
 * formatters here, so the card is internally consistent.
 */

interface GlassTimeCardProps {
  /** IANA zone at the map location, e.g. `Asia/Jakarta`. */
  timeZone: string;
  /** Short offset label, e.g. `GMT+7`. */
  offset?: string;
  showSeconds?: boolean;
  showTimezone?: boolean;
  /** The instant to render. Owned by the caller so there is ONE ticker. */
  now: Date;
}

interface ZoneFormatters {
  time: Intl.DateTimeFormat | null;
  weekday: Intl.DateTimeFormat | null;
  monthDay: Intl.DateTimeFormat | null;
}

/**
 * Build the three formatters for a zone, or nulls if the zone is not one.
 *
 * An unknown zone name makes `Intl` throw, which inside render would blank the
 * whole overlay rather than just this card, so construction is guarded once
 * here instead of at each use.
 */
function buildFormatters(timeZone: string, showSeconds: boolean): ZoneFormatters {
  try {
    return {
      time: new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: showSeconds ? '2-digit' : undefined,
        hour12: false,
      }),
      weekday: new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long' }),
      monthDay: new Intl.DateTimeFormat(undefined, { timeZone, month: 'long', day: 'numeric' }),
    };
  } catch {
    return { time: null, weekday: null, monthDay: null };
  }
}

export function GlassTimeCard(props: GlassTimeCardProps) {
  const { timeZone, offset = '', showSeconds = false, showTimezone = false, now } = props;

  /*
   * Formatters are built once per zone, not once per second.
   *
   * This renders every second by design, and `new Intl.DateTimeFormat(...)`
   * is not a cheap constructor: measured in this app on the 155H, building the
   * three of them costs 0.356 ms against 0.0056 ms to reuse them - 64x, for an
   * object whose inputs change only when the camera crosses into another zone.
   * Small either way, but it is a main-thread cost on a machine with no
   * discrete GPU, and useMemo removes it outright.
   */
  const formatters = useMemo(
    () => buildFormatters(timeZone, showSeconds),
    [timeZone, showSeconds],
  );

  const time = formatters.time ? formatters.time.format(now) : '';
  const weekday = formatters.weekday ? formatters.weekday.format(now) : '';
  const monthDay = formatters.monthDay ? formatters.monthDay.format(now) : '';
  const date = weekday && monthDay ? `${weekday} | ${monthDay}` : '';

  // The zone line reads "Asia/Jakarta GMT+7". The underscores IANA uses for
  // multi-word cities are noise on screen, so New_York renders as New York.
  const zoneLabel = [timeZone.replace(/_/g, ' '), offset].filter(Boolean).join(' ');

  if (!time) return null;

  return (
    <div className="gev-map-clock">
      <div className="gev-map-clock-inner">
        <div className="gev-map-clock-date">{date}</div>
        {/*
          aria-live is deliberately off: a clock that announced itself every
          second would make a screen reader unusable.
        */}
        <div className="gev-map-clock-time" aria-live="off">{time}</div>
        {showTimezone && zoneLabel ? <div className="gev-map-clock-zone">{zoneLabel}</div> : null}
      </div>
    </div>
  );
}
