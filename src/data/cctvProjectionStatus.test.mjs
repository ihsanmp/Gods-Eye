// Unit tests for the monitor plane's status line.
//
// The line exists to answer "why is this screen dark". It used to answer with
// the transport name — a camera with no health entry printed HLS — which is an
// answer to a different question entirely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTION_CONNECTING,
  PROJECTION_NO_FEED,
  projectionStatusText,
} from './cctvProjectionStatus.js';

test('a real health message is what gets shown', () => {
  assert.equal(
    projectionStatusText({ health: { message: 'stream timed out' } }),
    'STREAM TIMED OUT',
  );
});

test('the status is used when there is no message', () => {
  assert.equal(projectionStatusText({ health: { status: 'offline' } }), 'OFFLINE');
});

test('a message outranks a status', () => {
  assert.equal(
    projectionStatusText({ health: { message: 'no segments', status: 'ok' } }),
    'NO SEGMENTS',
  );
});

test('an unknown camera says it is connecting, not what protocol it speaks', () => {
  // THE REGRESSION. This case used to print the feed type, so a screen-filling
  // dark rectangle was labelled HLS.
  assert.equal(projectionStatusText({ health: null }), PROJECTION_CONNECTING);
  assert.equal(projectionStatusText({}), PROJECTION_CONNECTING);
  assert.equal(projectionStatusText(), PROJECTION_CONNECTING);
});

test('a caller that knows the feed failed can say so', () => {
  assert.equal(
    projectionStatusText({ health: null, fallback: PROJECTION_NO_FEED }),
    PROJECTION_NO_FEED,
  );
});

test('a blank health entry is not a status', () => {
  // An empty string is not news, and drawing it leaves the card with a name, a
  // city, and an unexplained void where the reason should be.
  for (const health of [{ message: '' }, { message: '   ' }, { status: '' }, { message: null, status: undefined }]) {
    assert.equal(projectionStatusText({ health }), PROJECTION_CONNECTING, JSON.stringify(health));
  }
});

test('a health entry that is not text does not reach the canvas', () => {
  // toUpperCase on an object yields "[OBJECT OBJECT]" across the plane.
  for (const health of [{ message: {} }, { message: 42 }, { status: ['offline'] }]) {
    assert.equal(projectionStatusText({ health }), PROJECTION_CONNECTING, JSON.stringify(health));
  }
});

test('with every source blank it still says something', () => {
  assert.equal(projectionStatusText({ health: null, fallback: '  ' }), PROJECTION_NO_FEED);
  assert.equal(projectionStatusText({ health: null, fallback: null }), PROJECTION_NO_FEED);
});
