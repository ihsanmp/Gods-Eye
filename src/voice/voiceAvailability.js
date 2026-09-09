// src/voice/voiceAvailability.js
/**
 * Is the voice agent configured on the server?
 *
 * The voice control used to mount unconditionally, so a checkout with no
 * OPENAI_API_KEY showed a microphone, a model-tier button, a mute button and a
 * running cost readout — none of which could do anything. Pressing the mic
 * produced a red VOICE SYSTEM ERROR panel, which is a bad way to learn that a
 * feature was never switched on.
 *
 * So the UI is now gated on the server actually having a key. A control that
 * cannot work should not be on screen, and one that can should appear without
 * anyone editing code — add the key, reload, and the microphone is back.
 *
 * THE CHECK NEVER MOVES THE KEY. `/api/realtime/available` answers a boolean.
 * Asking `/api/realtime/token` instead would mint a real ephemeral credential
 * just to find out whether minting is possible.
 *
 * @module voice/voiceAvailability
 */

/** Where the server reports whether the feature is configured. */
export const AVAILABILITY_URL = '/api/realtime/available';

/** Give up quickly: this gates a UI element, and boot must not wait on it. */
export const AVAILABILITY_TIMEOUT_MS = 5000;

/**
 * Ask the server whether the voice agent can run.
 *
 * Fails CLOSED. A network error, a timeout, a non-JSON body, or a server too
 * old to know this route all resolve to `false`, so the failure mode is a
 * missing microphone rather than a microphone that produces an error panel the
 * moment it is pressed. The mistake is recoverable and quiet; the alternative
 * is not.
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] Injectable for tests.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function isVoiceConfigured({
  fetchImpl = globalThis.fetch,
  timeoutMs = AVAILABILITY_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') return false;
  try {
    const response = await fetchImpl(AVAILABILITY_URL, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) return false;
    const body = await response.json();
    // Strictly `true`. A body shaped differently than expected is not a
    // licence to show a control that may not work.
    return body?.available === true;
  } catch {
    return false;
  }
}
