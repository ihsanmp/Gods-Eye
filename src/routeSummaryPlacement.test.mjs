// Unit tests for where the route report sits once it leaves the search bar.
//
// Two properties matter. It must land in the empty strip between the bar and
// the clock when that strip exists, and it must REFUSE when it does not —
// returning null so the caller leaves the report inside the bar, rather than
// inventing a position that lands on the bar, the clock, or off screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_SUMMARY_EDGE,
  ROUTE_SUMMARY_GAP,
  ROUTE_SUMMARY_MAX_WIDTH,
  ROUTE_SUMMARY_MIN_WIDTH,
  placeRouteSummary,
} from './routeSummaryPlacement.js';

/** The measured geometry of the running app at 1686 px, bar left of centre. */
const CLOCK = { left: 1445, right: 1664, top: 22 };
const WIDE = {
  bar: { left: 36, right: 800, top: 22 },
  obstacles: [CLOCK],
  viewport: { width: 1686 },
};

test('a wide window puts it in the strip between the bar and the clock', () => {
  const box = placeRouteSummary(WIDE);
  assert.equal(box.left, 816);
  assert.equal(box.top, 22, 'aligned with the top of the bar');
  assert.equal(box.width, ROUTE_SUMMARY_MAX_WIDTH);
  // The whole card clears both neighbours, which is the entire point.
  assert.ok(box.left >= WIDE.bar.right + ROUTE_SUMMARY_GAP, 'clear of the bar');
  assert.ok(box.left + box.width <= CLOCK.left - ROUTE_SUMMARY_GAP, 'clear of the clock');
});

test('a strip narrower than the report refuses rather than squeezing', () => {
  // A 90 px card is not a smaller report, it is an unreadable one, and null
  // tells the caller to leave it in the bar where it already fits.
  const tight = { ...WIDE, bar: { left: 36, right: 1260, top: 22 } };
  assert.equal(placeRouteSummary(tight), null);
});

test('a strip only just wide enough is used, at exactly that width', () => {
  const wall = 1445;
  const right = wall - ROUTE_SUMMARY_GAP - ROUTE_SUMMARY_MIN_WIDTH - ROUTE_SUMMARY_GAP;
  const box = placeRouteSummary({ ...WIDE, bar: { left: 36, right, top: 22 } });
  assert.equal(box.width, ROUTE_SUMMARY_MIN_WIDTH);
  assert.equal(box.left + box.width, wall - ROUTE_SUMMARY_GAP);
});

test('one pixel narrower than that is refused', () => {
  // Proves the boundary is where it claims to be, not somewhere nearby.
  const wall = 1445;
  const right = wall - ROUTE_SUMMARY_GAP - (ROUTE_SUMMARY_MIN_WIDTH - 1) - ROUTE_SUMMARY_GAP;
  assert.equal(placeRouteSummary({ ...WIDE, bar: { left: 36, right, top: 22 } }), null);
});

test('a bar caught above the window edge does not drag the card off screen', () => {
  // The bar animates in from above its resting place. A card that copied a
  // negative top mid-flight would lose its first line off the top.
  const box = placeRouteSummary({ ...WIDE, bar: { left: 36, right: 800, top: -9 } });
  assert.equal(box.top, ROUTE_SUMMARY_EDGE);
});

test('with no clock on screen it stops short of the window edge', () => {
  const box = placeRouteSummary({ ...WIDE, obstacles: [] });
  assert.ok(box.left + box.width <= WIDE.viewport.width - ROUTE_SUMMARY_GAP, 'not against the edge');
});

test('an obstacle that has not been laid out is ignored, not obeyed', () => {
  // An unmounted panel measures 0x0 at the origin. Read literally that puts the
  // right-hand wall at x=0, which would hide the report on every screen.
  const box = placeRouteSummary({ ...WIDE, obstacles: [{ left: 0, right: 0, top: 0 }, null, undefined] });
  assert.ok(box, 'a collapsed neighbour must not suppress the report');
  assert.equal(box.width, ROUTE_SUMMARY_MAX_WIDTH);
});

test('an obstacle to the LEFT of the bar is not a right-hand wall', () => {
  const box = placeRouteSummary({ ...WIDE, obstacles: [{ left: 10, right: 220, top: 22 }] });
  assert.ok(box);
  assert.ok(box.left + box.width <= WIDE.viewport.width - ROUTE_SUMMARY_GAP);
});

test('the NEAREST neighbour bounds the strip, whatever order they arrive in', () => {
  // The right context rail sits left of the clock, so an open CCTV panel - not
  // the clock - is what the report has to stop short of.
  const rail = { left: 1200, right: 1634, top: 123 };
  const forwards = placeRouteSummary({ ...WIDE, obstacles: [CLOCK, rail] });
  const backwards = placeRouteSummary({ ...WIDE, obstacles: [rail, CLOCK] });
  assert.deepEqual(forwards, backwards, 'order must not matter');
  assert.ok(forwards.left + forwards.width <= rail.left - ROUTE_SUMMARY_GAP, 'clear of the rail');
});

test('a rail that leaves no usable strip sends the report back to the bar', () => {
  // 1920 with the bar centred and the context rail open: 162 px is not a report.
  assert.equal(placeRouteSummary({
    bar: { left: 576, right: 1344, top: 22 },
    obstacles: [{ left: 1679, right: 1898, top: 22 }, { left: 1538, right: 1868, top: 123 }],
    viewport: { width: 1920 },
  }), null);
});

test('a centred bar on a narrow window keeps the report in the bar', () => {
  // 1280 wide, the pill centred at its 768 px maximum: there is no strip.
  assert.equal(placeRouteSummary({
    bar: { left: 256, right: 1024, top: 22 },
    obstacles: [{ left: 1039, right: 1258, top: 22 }],
    viewport: { width: 1280 },
  }), null);
});

test('the same centred bar on a 1920 window does get a strip', () => {
  const box = placeRouteSummary({
    bar: { left: 576, right: 1344, top: 22 },
    obstacles: [{ left: 1679, right: 1898, top: 22 }],
    viewport: { width: 1920 },
  });
  assert.ok(box, 'a wide window has room even with the bar centred');
  assert.ok(box.width >= ROUTE_SUMMARY_MIN_WIDTH);
  assert.ok(box.left + box.width <= 1679 - ROUTE_SUMMARY_GAP);
});

test('a measurement that is not a measurement is refused', () => {
  // Number(null) is 0, so an absent edge would otherwise read as the left of
  // the screen and put the card there.
  const cases = [
    ['nothing at all', undefined],
    ['empty', {}],
    ['no bar', { obstacles: [CLOCK], viewport: WIDE.viewport }],
    ['bar with a null edge', { ...WIDE, bar: { left: 36, right: null, top: 22 } }],
    ['bar with a NaN top', { ...WIDE, bar: { left: 36, right: 800, top: NaN } }],
    ['collapsed bar', { ...WIDE, bar: { left: 400, right: 400, top: 22 } }],
    ['no viewport', { bar: WIDE.bar, obstacles: [CLOCK] }],
    ['unmeasured viewport', { ...WIDE, viewport: { width: 0 } }],
  ];
  for (const [label, input] of cases) {
    assert.equal(placeRouteSummary(input), null, label);
  }
});
