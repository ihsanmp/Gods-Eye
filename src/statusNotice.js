/*
 * What survives of the status-notice machinery.
 *
 * This was loadingFeedback.js: a time-driven reducer that painted a top-centre
 * chip with live loading progress ("LOADING LIVE DATA" and the roster of layers
 * still working), arbitrated that progress against one-off notices, and drove
 * it all from a 60 ms ticker and a 500 ms safety-net poll.
 *
 * That readout was removed, and with it the reducer, the presenters, the
 * tickers and the arbitration - nothing called them any more, and a tested
 * module that nothing calls is worse than no module: the tests keep passing and
 * the coverage is a fiction.
 *
 * The banner still exists for share-link FAILURES, so the two pieces that
 * failure path actually uses are kept here, under a name that says what they
 * are. Neither is about loading.
 */

/**
 * How long a failure banner stays up.
 *
 * Five seconds, unchanged from when the banner shared the surface with the
 * loading readout. It is long enough to read a sentence like "Shared satellite
 * could not be restored — feed unavailable", which is why these messages were
 * deliberately kept out of the two-second toast.
 */
export const LOADING_FAILURE_DWELL_MS = 5000;

/**
 * Whether deferred notice work still owns the current presentation epoch.
 *
 * A share-link failure is not shown immediately: it waits for the startup cover
 * to fade. In that gap a newer restore can begin, and the stale message must not
 * land on top of it - so the caller captures the generation it was queued under
 * and checks it here before presenting. Disposal cancels everything outright.
 *
 * @param {number} expectedGeneration - Generation captured when the work queued.
 * @param {number} currentGeneration - The panel's generation now.
 * @param {boolean} [disposed] - Whether the panel has been disposed.
 * @returns {boolean} True when the deferred work may still present.
 */
export function canPresentDeferredStatusNotice(expectedGeneration, currentGeneration, disposed = false) {
  return !disposed
    && Number.isSafeInteger(expectedGeneration)
    && expectedGeneration === currentGeneration;
}
