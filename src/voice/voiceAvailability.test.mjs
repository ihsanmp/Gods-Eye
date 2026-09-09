// Unit tests for the voice-availability gate.
//
// This decides whether a microphone appears at all, and it has to FAIL CLOSED:
// every uncertain answer must hide the control. A missing microphone is a quiet
// mistake someone can recover from; a microphone that answers a press with a
// red error panel is how people learn a feature was never configured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABILITY_URL, isVoiceConfigured } from './voiceAvailability.js';

/** A fetch stand-in returning one canned response. */
const respond = (body, { ok = true } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (body instanceof Error) throw body;
    return { ok, json: async () => body };
  };
  return { fetchImpl, calls };
};

test('a configured server shows the control', async () => {
  const { fetchImpl, calls } = respond({ available: true });
  assert.equal(await isVoiceConfigured({ fetchImpl }), true);
  assert.equal(calls[0].url, AVAILABILITY_URL);
});

test('an unconfigured server hides it', async () => {
  const { fetchImpl } = respond({ available: false });
  assert.equal(await isVoiceConfigured({ fetchImpl }), false);
});

test('only a literal true shows the control', async () => {
  // A body shaped differently than expected is not a licence to draw a button
  // that may not work.
  for (const body of [
    { available: 'true' }, { available: 1 }, { available: {} },
    {}, null, 'yes', [], { availability: true },
  ]) {
    const { fetchImpl } = respond(body);
    assert.equal(await isVoiceConfigured({ fetchImpl }), false, JSON.stringify(body));
  }
});

test('every failure hides the control rather than guessing', async () => {
  // A server too old to know this route, a network drop, a timeout, and a body
  // that is not JSON all mean the same thing here: do not draw the button.
  const cases = [
    ['404 from an older server', respond({ available: true }, { ok: false })],
    ['network error', respond(new Error('ECONNREFUSED'))],
    ['unparseable body', {
      fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('not JSON'); } }),
    }],
    ['fetch is missing entirely', { fetchImpl: undefined }],
    ['fetch is not a function', { fetchImpl: 'nope' }],
  ];
  for (const [label, { fetchImpl }] of cases) {
    assert.equal(await isVoiceConfigured({ fetchImpl }), false, label);
  }
});

test('the request carries a deadline, so boot never waits on a hung server', async () => {
  // Asserted by inspecting the signal rather than by racing a fetch that never
  // settles — a test that can itself hang is a poor way to prove something
  // cannot hang.
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = init?.signal;
    return { ok: true, json: async () => ({ available: true }) };
  };
  await isVoiceConfigured({ fetchImpl, timeoutMs: 120 });
  assert.ok(seen instanceof AbortSignal, 'the fetch must be given an abort signal');
  assert.equal(seen.aborted, false, 'and it must not already be spent');

  // And when that deadline fires, fetch rejects — which must read as "hide it".
  const rejecting = async () => { throw new DOMException('The operation was aborted.', 'TimeoutError'); };
  assert.equal(await isVoiceConfigured({ fetchImpl: rejecting }), false);
});

test('the check never asks for a token', async () => {
  // Hitting /api/realtime/token to find out whether tokens can be minted would
  // mint a real ephemeral credential as a side effect of asking a question.
  const { fetchImpl, calls } = respond({ available: true });
  await isVoiceConfigured({ fetchImpl });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, /token/);
});
