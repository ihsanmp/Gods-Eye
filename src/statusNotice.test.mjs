import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOADING_FAILURE_DWELL_MS, canPresentDeferredStatusNotice } from './statusNotice.js';

/*
 * What is left of loadingFeedback.test.mjs.
 *
 * That file had 31 tests for a loading readout - reducer phases, reveal delays,
 * terminal dwells, ticker arming, traffic-chip coverage percentages. The readout
 * and its chips were removed, so those tests were exercising code no caller
 * could reach: they passed, and the coverage they reported was a fiction.
 *
 * These four cover the failure banner that survived, which is the only part
 * anything still runs.
 */

test('deferred terminal notices lose ownership to newer acquisition epochs and disposal', () => {
  assert.equal(canPresentDeferredStatusNotice(4, 4, false), true);
  assert.equal(canPresentDeferredStatusNotice(4, 5, false), false,
    'a newer restore epoch blocks the older deferred failure');
  assert.equal(canPresentDeferredStatusNotice(5, 5, true), false,
    'disposal blocks even the current deferred notice');
  // A non-integer generation is not an epoch, and must never win by accident.
  for (const bad of [NaN, 1.5, Infinity, null, undefined, '4']) {
    assert.equal(canPresentDeferredStatusNotice(bad, bad, false), false, String(bad));
  }
});

test('the failure dwell outlasts the toast it was deliberately kept out of', () => {
  // The whole reason these messages are not toasts: five seconds is long enough
  // to read "Shared satellite could not be restored — feed unavailable"; the
  // toast's two are not. If this ever drops below the toast, the argument for a
  // separate surface goes with it.
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.equal(LOADING_FAILURE_DWELL_MS, 5000);
  const toast = ui.slice(ui.indexOf('  _showToast(message) {'));
  const toastMs = Number(toast.match(/setTimeout\([\s\S]*?,\s*(\d+)\)/)?.[1]);
  assert.ok(Number.isFinite(toastMs), 'could not read the toast duration');
  assert.ok(LOADING_FAILURE_DWELL_MS > toastMs,
    `the failure banner (${LOADING_FAILURE_DWELL_MS}ms) must outlast the toast (${toastMs}ms)`);
});

test('share-follow failures use the top-center banner instead of the bottom toast', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const start = ui.indexOf('  _handleShareTrackingRestoreStatus(result) {');
  const end = ui.indexOf('\n  _initGlobalContextPanel() {', start);
  const handler = ui.slice(start, end);
  assert.match(handler, /this\._showGlobalStatusNotice\(message\)/);
  assert.match(handler, /this\.initialRestorePromise\.then\(showAfterStartupCover\)/);
  assert.match(handler, /requestAnimationFrame\(\(\) => \{/);
  assert.match(handler, /startupCover\.addEventListener\('transitionend', showOnce, \{ once: true \}\)/);
  assert.match(handler, /fallbackTimer = setTimeout\(showOnce, 1000\)/);
  assert.doesNotMatch(handler, /this\._showToast\(message\)/);
  assert.doesNotMatch(handler, /pushCockpitSignal/);
  assert.match(handler, /result\.classification === 'pending'/);
  // The ACQUIRING progress notice went with the loading readout: the banner is
  // for failures now, and "still working on it" was exactly the chrome removed.
  assert.doesNotMatch(handler, /state: 'acquiring'/);
  assert.doesNotMatch(handler, /persistent: true/);
  assert.match(handler, /this\._shareTrackingNoticeGeneration \+= 1/);
  assert.match(handler, /canPresentDeferredStatusNotice\(/);
  assert.match(handler, /if \(this\._shareTrackingAcquiringKey\) return/);
  assert.match(handler, /result\.classification === 'followed' \|\| result\.classification === 'cancelled'/);
});

test('the banner ships empty and clears itself, and its timer, on dispose', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const disposeStart = ui.indexOf('  async dispose() {');
  const disposeEnd = ui.indexOf('\n  }\n', disposeStart);
  const dispose = ui.slice(disposeStart, disposeEnd);

  // A five-second timer firing into a disposed panel would unhide an element
  // nothing owns, so the stopper clears the timeout as well as the text.
  assert.match(dispose, /this\._hideGlobalStatusNotice\(\);/);
  assert.match(dispose, /this\._shareTrackingNoticeGeneration \+= 1;/);
  const hide = ui.slice(ui.indexOf('  _hideGlobalStatusNotice() {'));
  assert.match(hide.slice(0, hide.indexOf('\n  }')), /clearTimeout\(this\._globalStatusBannerTimer\)/);

  assert.match(html, /<div id="global-status-banner" role="status" aria-live="polite" aria-atomic="true" hidden><\/div>/);
  // It ships EMPTY. The old element carried "LOADING LIVE DATA" and a detail
  // span in the markup, so the readout was on screen before any script ran.
  // (Asserted against the markup, not the file: the comment above the element
  // quotes the retired label on purpose.)
  assert.doesNotMatch(html, /id="global-loading-status"/);
  assert.doesNotMatch(html, /id="global-loading-label"/);
  assert.doesNotMatch(html, /id="global-loading-detail"/);
});
