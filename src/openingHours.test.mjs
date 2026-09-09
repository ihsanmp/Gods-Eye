// Unit tests for the OSM opening_hours subset.
//
// The bias under test is ASYMMETRIC and deliberate: a wrong "open" sends
// someone driving to a shut mall, so anything the parser does not fully
// understand must come back `unknown`. Most of what follows pins that edge
// rather than the happy path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSED,
  OPEN,
  UNKNOWN,
  evaluateOpeningHours,
  localClock,
  parseOpeningHours,
} from './openingHours.js';

/** A moment expressed in Jakarta wall-clock terms (UTC+7, no DST). */
const jakarta = (isoLocal) => new Date(`${isoLocal}+07:00`);
const inJakarta = (spec, isoLocal) =>
  evaluateOpeningHours(spec, { at: jakarta(isoLocal), timeZone: 'Asia/Jakarta' });

// 2026-09-07 is a Monday; 09-12 a Saturday; 09-13 a Sunday.

test('a plain weekday range opens and closes on time', () => {
  assert.equal(inJakarta('Mo-Fr 09:00-17:00', '2026-09-07T09:00').status, OPEN);
  assert.equal(inJakarta('Mo-Fr 09:00-17:00', '2026-09-07T16:59').status, OPEN);
  // The closing minute itself is shut — 17:00-17:00 is zero minutes of trading.
  assert.equal(inJakarta('Mo-Fr 09:00-17:00', '2026-09-07T17:00').status, CLOSED);
  assert.equal(inJakarta('Mo-Fr 09:00-17:00', '2026-09-07T08:59').status, CLOSED);
  // Saturday is not in Mo-Fr.
  assert.equal(inJakarta('Mo-Fr 09:00-17:00', '2026-09-12T12:00').status, CLOSED);
});

test('24/7 is always open', () => {
  assert.equal(inJakarta('24/7', '2026-09-13T03:17').status, OPEN);
  assert.equal(inJakarta('24 / 7', '2026-09-13T03:17').status, OPEN);
});

test('a bare time range with no day selector applies every day', () => {
  assert.equal(inJakarta('10:00-22:00', '2026-09-13T11:00').status, OPEN);
  assert.equal(inJakarta('10:00-22:00', '2026-09-13T23:00').status, CLOSED);
});

test('several blocks are applied in order, so a later rule overrides an earlier one', () => {
  // This is the shape that a set-union parser gets wrong: Wednesday must be
  // CLOSED even though Mo-Sa covers it.
  const spec = 'Mo-Sa 09:00-18:00; We off';
  assert.equal(inJakarta(spec, '2026-09-08T12:00').status, OPEN, 'Tuesday open');
  assert.equal(inJakarta(spec, '2026-09-09T12:00').status, CLOSED, 'Wednesday closed');
  assert.equal(inJakarta(spec, '2026-09-10T12:00').status, OPEN, 'Thursday open');
});

test('a lunch break really closes the place', () => {
  const spec = 'Mo-Fr 09:00-12:00,13:00-17:00';
  assert.equal(inJakarta(spec, '2026-09-07T11:30').status, OPEN);
  assert.equal(inJakarta(spec, '2026-09-07T12:30').status, CLOSED);
  assert.equal(inJakarta(spec, '2026-09-07T13:30').status, OPEN);
});

test('a comma list of days is not read as a range', () => {
  const spec = 'Mo,We,Fr 08:00-12:00';
  assert.equal(inJakarta(spec, '2026-09-07T09:00').status, OPEN, 'Monday');
  assert.equal(inJakarta(spec, '2026-09-08T09:00').status, CLOSED, 'Tuesday is not listed');
  assert.equal(inJakarta(spec, '2026-09-09T09:00').status, OPEN, 'Wednesday');
});

test('a day range that wraps the end of the week still covers both ends', () => {
  const spec = 'Sa-Su 10:00-14:00';
  assert.equal(inJakarta(spec, '2026-09-12T11:00').status, OPEN, 'Saturday');
  assert.equal(inJakarta(spec, '2026-09-13T11:00').status, OPEN, 'Sunday');
  assert.equal(inJakarta(spec, '2026-09-07T11:00').status, CLOSED, 'Monday');
});

test('hours that run past midnight stay open into the next morning', () => {
  const spec = 'Mo-Su 18:00-02:00';
  assert.equal(inJakarta(spec, '2026-09-07T19:00').status, OPEN, 'evening');
  assert.equal(inJakarta(spec, '2026-09-08T01:00').status, OPEN, 'after midnight, still that night');
  assert.equal(inJakarta(spec, '2026-09-08T03:00').status, CLOSED, 'after closing');
  assert.equal(inJakarta(spec, '2026-09-08T12:00').status, CLOSED, 'the middle of the day');
});

test('an overnight rule only spills into a day its own selector reaches', () => {
  // Friday-night trading must not make Sunday morning open.
  const spec = 'Fr 20:00-03:00';
  assert.equal(inJakarta(spec, '2026-09-12T01:00').status, OPEN, 'Saturday 01:00 is Friday night');
  assert.equal(inJakarta(spec, '2026-09-13T01:00').status, CLOSED, 'Sunday 01:00 is not');
});

test('an overnight range does not open the place before its own session starts', () => {
  // 'Mo 18:00-02:00' is one session: Monday evening running into Tuesday. The
  // 00:00-02:00 tail belongs to TUESDAY, so Monday at 01:00 — before Monday's
  // session has begun — must be CLOSED. Testing only whether the minute falls
  // in either half of the wrapped range gets this backwards and calls it open.
  const spec = 'Mo 18:00-02:00';
  assert.equal(inJakarta(spec, '2026-09-07T01:00').status, CLOSED, 'Monday 01:00 is before opening');
  assert.equal(inJakarta(spec, '2026-09-07T19:00').status, OPEN, 'Monday evening');
  assert.equal(inJakarta(spec, '2026-09-08T01:00').status, OPEN, 'Tuesday 01:00 is Monday night');
  assert.equal(inJakarta(spec, '2026-09-08T19:00').status, CLOSED, 'Tuesday evening is not covered');
});

test('the place’s own time zone decides, not the operator’s', () => {
  // 23:00 Monday in Jakarta is 16:00 Monday in London. A mall on Jakarta hours
  // is shut; reading the operator's clock would call it open.
  const spec = 'Mo-Su 10:00-22:00';
  const moment = jakarta('2026-09-07T23:00');
  assert.equal(evaluateOpeningHours(spec, { at: moment, timeZone: 'Asia/Jakarta' }).status, CLOSED);
  assert.equal(evaluateOpeningHours(spec, { at: moment, timeZone: 'Europe/London' }).status, OPEN);
});

// ── The unknown edge ────────────────────────────────────────────────────────

test('grammar this module does not implement is unknown, never a guess', () => {
  const unsupported = [
    ['Apr 01-Oct 31 09:00-18:00', /month or date/i],
    ['Dec 25 off', /month or date/i],
    ['week 1-53 09:00-17:00', /week selector/i],
    ['sunrise-sunset', /variable/i],
    ['Mo-Fr 08:00-16:00 || Sa 10:00-14:00', /fallback/i],
    ['Mo[1] 09:00-12:00', /nth-weekday/i],
    ['Mo-Fr 09:00+', /open-ended/i],
  ];
  for (const [spec, reason] of unsupported) {
    const result = evaluateOpeningHours(spec, { timeZone: 'Asia/Jakarta' });
    assert.equal(result.status, UNKNOWN, `${spec} must be unknown`);
    assert.match(result.reason, reason, `${spec} must say why`);
    // The raw tag travels with the answer so the agent can read it out.
    assert.equal(result.spec, spec);
  }
});

test('a spec that is only partly understandable is rejected whole', () => {
  // "Mo-Fr 09:00-17:00" alone is fine, but the seasonal half is not — and
  // answering from the half we understand would claim a shop is open in a month
  // it shuts for entirely.
  const result = evaluateOpeningHours('Mo-Fr 09:00-17:00; Jan 01 off', { timeZone: 'Asia/Jakarta' });
  assert.equal(result.status, UNKNOWN);
});

test('a missing, blank, or non-string tag is unknown rather than closed', () => {
  for (const spec of [undefined, null, '', '   ', 42, {}, []]) {
    const result = evaluateOpeningHours(spec, { timeZone: 'Asia/Jakarta' });
    assert.equal(result.status, UNKNOWN, `${JSON.stringify(spec)} must be unknown`);
    assert.equal(result.spec, null);
  }
});

test('garbage inside an otherwise well-shaped rule is unknown', () => {
  for (const spec of ['Mo-Fr 9-5', 'Xx-Yy 09:00-17:00', 'Mo-Fr 25:00-26:00', 'Mo-Fr 09:00-17:00 off']) {
    assert.equal(
      evaluateOpeningHours(spec, { timeZone: 'Asia/Jakarta' }).status,
      UNKNOWN,
      `${spec} must be unknown`,
    );
  }
});

test('an invalid time zone yields unknown instead of throwing into a voice turn', () => {
  const result = evaluateOpeningHours('Mo-Fr 09:00-17:00', { timeZone: 'Mars/Olympus_Mons' });
  assert.equal(result.status, UNKNOWN);
  assert.match(result.reason, /local time/i);
});

test('a public-holiday rule is carried as a caveat, not silently dropped', () => {
  const result = inJakarta('Mo-Su 10:00-22:00; PH off', '2026-09-07T12:00');
  assert.equal(result.status, OPEN);
  // We have no holiday calendar, so the agent must be able to hedge.
  assert.equal(result.publicHolidayCaveat, true);
});

test('a spec of nothing but public-holiday rules has nothing to evaluate', () => {
  assert.equal(evaluateOpeningHours('PH off', { timeZone: 'Asia/Jakarta' }).status, UNKNOWN);
});

// ── parse/clock internals ───────────────────────────────────────────────────

test('parseOpeningHours reports why it gave up', () => {
  assert.equal(parseOpeningHours('24/7').always, true);
  assert.equal(parseOpeningHours('Mo-Fr 09:00-17:00').supported, true);
  assert.match(parseOpeningHours('').reason, /no opening hours/i);
  assert.match(parseOpeningHours('Qq 09:00-17:00').reason, /day selector|unrecognised/i);
});

test('localClock reads the weekday and minute in the target zone', () => {
  // 2026-09-07T23:00+07:00 is Monday night in Jakarta, Monday afternoon in London.
  const moment = jakarta('2026-09-07T23:00');
  assert.deepEqual(localClock(moment, 'Asia/Jakarta'), { day: 1, minutes: 23 * 60 });
  assert.deepEqual(localClock(moment, 'Europe/London'), { day: 1, minutes: 17 * 60 });
});

test('localClock puts midnight at minute zero, not minute 1440', () => {
  // Some ICU builds render midnight as hour "24" under hour12:false; a raw
  // Number() of that would place midnight after the end of the day and read
  // every overnight rule wrong.
  const midnight = localClock(jakarta('2026-09-08T00:00'), 'Asia/Jakarta');
  assert.equal(midnight.minutes, 0);
  assert.equal(midnight.day, 2, 'and it has already rolled over to Tuesday');
});

test('localClock is total for junk input', () => {
  assert.equal(localClock(new Date('nonsense'), 'Asia/Jakarta'), null);
  assert.equal(localClock(new Date(), 'Not/AZone'), null);
});
