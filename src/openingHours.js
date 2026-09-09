// src/openingHours.js
/**
 * Is the place we are flying to open right now?
 *
 * OpenStreetMap answers this in an `opening_hours` tag whose grammar is far
 * larger than it first looks: it can express "the second Monday of every month
 * except in August", "sunset to sunrise", "week 1-53/2", and school holidays.
 * A parser for ALL of it is a project in itself.
 *
 * So this module implements a deliberate SUBSET and is explicit about the edge:
 * anything it does not fully understand comes back as `unknown`, never as a
 * guess. That asymmetry is the whole design. The answer is spoken aloud to
 * someone deciding whether to drive somewhere, and "I don't know, the tag says
 * <x>" is a fine thing to hear — being told a shop is open when it is shut is
 * not.
 *
 * SUPPORTED
 *   24/7
 *   Mo-Fr 09:00-17:00
 *   Mo-Sa 10:00-22:00; Su 10:00-21:00
 *   Mo,We,Fr 08:00-12:00
 *   Mo-Fr 09:00-12:00,13:00-17:00      (a lunch break)
 *   Mo-Su 18:00-02:00                  (past midnight)
 *   Su off / Su closed
 *   10:00-22:00                        (no day selector: every day)
 *   PH off                             (recorded as a caveat, not evaluated)
 *
 * NOT SUPPORTED — every one of these yields `unknown`
 *   month or date ranges       Apr 01-Oct 31, Dec 25
 *   week selectors             week 1-53
 *   nth-weekday selectors      Mo[1], Su[-1]
 *   variable times             sunrise-sunset, dusk
 *   open-ended ranges          09:00+
 *   fallback rules             Mo-Fr 08:00-16:00 || Sa 10:00-14:00
 *
 * @module openingHours
 */

/** The three answers this module is allowed to give. */
export const OPEN = 'open';
export const CLOSED = 'closed';
export const UNKNOWN = 'unknown';

/** OSM's two-letter weekday codes, in `Date#getDay` order (Sunday first). */
const WEEKDAY_CODES = Object.freeze(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
const WEEKDAY_INDEX = Object.freeze(
  WEEKDAY_CODES.reduce((map, code, index) => ({ ...map, [code.toLowerCase()]: index }), {}),
);

/**
 * Constructs this module refuses to interpret.
 *
 * Matched BEFORE any rule is evaluated, so a spec that is 90% understandable
 * and 10% not is rejected whole. Partially applying a rule set is how you
 * confidently answer "open" for a shop that closes for the whole of Ramadan.
 */
const UNSUPPORTED_PATTERNS = Object.freeze([
  [/\|\|/, 'fallback rules'],
  [/\bweek\s/i, 'week selectors'],
  [/\b(sunrise|sunset|dawn|dusk)\b/i, 'variable (sun-based) times'],
  [/\[[-\d]+\]/, 'nth-weekday selectors'],
  [/\d{1,2}:\d{2}\s*\+/, 'open-ended ranges'],
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i, 'month or date ranges'],
  [/\b(easter|SH)\b/, 'holiday selectors'],
]);

/** `hh:mm` to minutes past midnight, or null when it is not a clock time. */
function toMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  // 24:00 is legal in this grammar and means end-of-day, so hours run 0..24.
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Expand a weekday selector into day indices.
 *
 * @param {string} selector e.g. "Mo-Fr", "Mo,We,Fr", "Sa-Su" (wrapping).
 * @returns {number[]|null} Day indices (0 = Sunday), or null if unparseable.
 */
function parseWeekdays(selector) {
  const days = new Set();
  for (const part of selector.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = /^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/.exec(token);
    if (range) {
      const from = WEEKDAY_INDEX[range[1].toLowerCase()];
      const to = WEEKDAY_INDEX[range[2].toLowerCase()];
      if (from === undefined || to === undefined) return null;
      // Sa-Su and Fr-Mo wrap around the end of the week.
      for (let index = from; ; index = (index + 1) % 7) {
        days.add(index);
        if (index === to) break;
      }
      continue;
    }
    const single = WEEKDAY_INDEX[token.toLowerCase()];
    if (single === undefined) return null;
    days.add(single);
  }
  return days.size ? [...days] : null;
}

/**
 * Parse one `hh:mm-hh:mm[,hh:mm-hh:mm]` list.
 *
 * @returns {Array<{from:number,to:number}>|null}
 */
function parseTimeRanges(text) {
  const ranges = [];
  for (const part of text.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(token);
    if (!match) return null;
    const from = toMinutes(match[1]);
    const to = toMinutes(match[2]);
    if (from === null || to === null) return null;
    ranges.push({ from, to });
  }
  return ranges.length ? ranges : null;
}

/**
 * Parse an `opening_hours` value.
 *
 * @param {unknown} spec Raw tag value.
 * @returns {{supported: boolean, reason: string, always?: boolean,
 *   rules?: Array<Object>, publicHolidayRule?: boolean}}
 */
export function parseOpeningHours(spec) {
  if (typeof spec !== 'string' || !spec.trim()) {
    return { supported: false, reason: 'no opening hours recorded' };
  }
  const text = spec.trim();

  for (const [pattern, label] of UNSUPPORTED_PATTERNS) {
    if (pattern.test(text)) {
      return { supported: false, reason: `hours use ${label}` };
    }
  }

  if (/^24\s*\/\s*7$/.test(text)) {
    return { supported: true, reason: 'open 24/7', always: true, rules: [] };
  }

  const rules = [];
  let publicHolidayRule = false;

  for (const chunk of text.split(';')) {
    const block = chunk.trim();
    if (!block) continue;

    // Public holidays are a calendar this module does not have. Note that the
    // place treats them specially and carry on — the caveat travels with the
    // answer instead of being silently dropped.
    if (/^PH\b/.test(block)) {
      publicHolidayRule = true;
      continue;
    }

    const closed = /\b(off|closed)\b/i.test(block);
    const head = block.replace(/\b(off|closed)\b/i, '').trim();

    // A leading weekday selector is optional: a bare "10:00-22:00" is every day.
    const split = /^([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s*(.*)$/.exec(head);
    let days = null;
    let timesText = head;
    if (split) {
      days = parseWeekdays(split[1]);
      if (!days) return { supported: false, reason: `unrecognised day selector "${split[1]}"` };
      timesText = split[2].trim();
    }

    if (closed) {
      if (timesText) return { supported: false, reason: `mixed closed rule "${block}"` };
      rules.push({ days, ranges: [], closed: true });
      continue;
    }

    const ranges = parseTimeRanges(timesText);
    if (!ranges) return { supported: false, reason: `unrecognised hours "${block}"` };
    rules.push({ days, ranges, closed: false });
  }

  if (!rules.length) {
    return publicHolidayRule
      ? { supported: false, reason: 'only public-holiday rules recorded' }
      : { supported: false, reason: 'no usable rules found' };
  }
  return { supported: true, reason: '', rules, publicHolidayRule };
}

/**
 * The local weekday and minute-of-day at a moment, in a given IANA zone.
 *
 * Read out of `Intl` rather than computed from a UTC offset, so daylight saving
 * is handled by the platform's own tz database instead of a table here.
 *
 * @returns {{day:number, minutes:number}|null}
 */
export function localClock(at, timeZone) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const day = WEEKDAY_CODES.findIndex(
      (code) => code.toLowerCase() === String(lookup.weekday || '').slice(0, 2).toLowerCase(),
    );
    // Intl renders midnight as "24" in some ICU versions under hour12:false.
    const hour = Number(lookup.hour) % 24;
    const minute = Number(lookup.minute);
    if (day < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return { day, minutes: hour * 60 + minute };
  } catch {
    return null; // an invalid zone must not throw into a voice turn
  }
}

/** Does `rule` apply on weekday `day`? A rule with no selector applies daily. */
function ruleCoversDay(rule, day) {
  return rule.days === null || rule.days.includes(day);
}

/**
 * Is `minutes` inside a range, allowing ranges that run past midnight?
 *
 * `18:00-02:00` is two intervals in wall-clock terms. `sameDay` distinguishes
 * "this rule's own day" from "yesterday's rule spilling into today", which is
 * what makes 01:00 on Tuesday count as still-open under a Monday rule.
 */
function inRange(range, minutes, sameDay) {
  if (range.to > range.from) return sameDay && minutes >= range.from && minutes < range.to;
  if (range.to === range.from) return false;
  // Overnight: open from `from` until midnight on its own day, and from
  // midnight until `to` on the following day.
  return sameDay ? minutes >= range.from : minutes < range.to;
}

/**
 * Open, closed, or honestly unknown.
 *
 * @param {unknown} spec The raw `opening_hours` tag.
 * @param {Object} [options]
 * @param {Date|number} [options.at] Moment to test; defaults to now.
 * @param {string} [options.timeZone] IANA zone AT THE PLACE — not the operator's.
 *   A mall in Surabaya closes at 22:00 Surabaya time whoever is asking.
 * @returns {{status:'open'|'closed'|'unknown', reason:string, spec:string|null,
 *   publicHolidayCaveat?:boolean}}
 */
export function evaluateOpeningHours(spec, { at = new Date(), timeZone = 'UTC' } = {}) {
  const raw = typeof spec === 'string' && spec.trim() ? spec.trim() : null;
  const parsed = parseOpeningHours(spec);
  if (!parsed.supported) {
    return { status: UNKNOWN, reason: parsed.reason, spec: raw };
  }

  const clock = localClock(at, timeZone);
  if (!clock) {
    return { status: UNKNOWN, reason: 'could not read the local time there', spec: raw };
  }

  if (parsed.always) {
    return { status: OPEN, reason: 'open 24/7', spec: raw };
  }

  const yesterday = (clock.day + 6) % 7;
  let open = false;
  let closedByRule = false;

  // Rules are applied IN ORDER: OSM's grammar lets a later rule override an
  // earlier one, which is exactly how "Mo-Sa 09:00-18:00; We off" works. A
  // set-union pass would keep Wednesday open.
  for (const rule of parsed.rules) {
    const coversToday = ruleCoversDay(rule, clock.day);
    const coversYesterday = ruleCoversDay(rule, yesterday);

    if (rule.closed) {
      if (coversToday) {
        open = false;
        closedByRule = true;
      }
      continue;
    }
    if (!coversToday && !coversYesterday) continue;

    for (const range of rule.ranges) {
      if (coversToday && inRange(range, clock.minutes, true)) { open = true; closedByRule = false; }
      else if (coversYesterday && inRange(range, clock.minutes, false)) { open = true; closedByRule = false; }
    }
  }

  return {
    status: open ? OPEN : CLOSED,
    reason: open
      ? 'inside the posted hours'
      : (closedByRule ? 'closed today by its posted hours' : 'outside the posted hours'),
    spec: raw,
    ...(parsed.publicHolidayRule ? { publicHolidayCaveat: true } : {}),
  };
}
