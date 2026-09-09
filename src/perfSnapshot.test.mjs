// Unit tests for the performance snapshot.
//
// The property that matters most is that it ALWAYS SETTLES. A diagnostic you
// run because something is wrong must not hang when the thing that is wrong is
// unusual — and "the window gets no frames at all" is exactly that case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfSnapshot, sampleFrames } from './perfSnapshot.js';

/** Drive rAF at a fixed interval, in virtual time. */
function withFakeRaf(intervalMs, run) {
  const original = globalThis.requestAnimationFrame;
  let now = performance.now();
  globalThis.requestAnimationFrame = (cb) => {
    now += intervalMs;
    return setTimeout(() => cb(now), 0);
  };
  return run().finally(() => { globalThis.requestAnimationFrame = original; });
}

test('with no requestAnimationFrame at all, it still resolves and says why', async () => {
  // Node has no rAF. A hidden or minimised window is the same situation, and
  // before the guard existed the promise simply never settled.
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    const frames = await sampleFrames(50);
    assert.equal(frames.frames, 0);
    assert.equal(frames.fps, 0, 'zero frames must not divide into a fake fps');
    assert.match(frames.note, /no frames were delivered/i);
    assert.match(frames.note, /hidden or minimised/i);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test('a steady 60 fps reads as 60 fps', async () => {
  await withFakeRaf(16.7, async () => {
    const frames = await sampleFrames(200);
    assert.ok(frames.frames > 5, `only ${frames.frames} frames`);
    assert.ok(Math.abs(frames.fps - 60) < 2, `got ${frames.fps} fps`);
    assert.ok(!frames.note, 'a real measurement carries no excuse');
  });
});

test('the report names a stutter the mean would hide', async () => {
  // Sixty good frames and one long freeze average out to something that looks
  // fine, and the freeze is the thing a person actually notices.
  const original = globalThis.requestAnimationFrame;
  let now = performance.now();
  let n = 0;
  globalThis.requestAnimationFrame = (cb) => {
    n += 1;
    now += n === 10 ? 250 : 16;
    return setTimeout(() => cb(now), 0);
  };
  try {
    const frames = await sampleFrames(400);
    assert.ok(frames.worstMs > 200, `worst frame was ${frames.worstMs} ms`);
    assert.ok(frames.meanMs < frames.worstMs / 2, 'the mean hides it, which is the point of reporting both');
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test('the snapshot survives a viewer and manager that are not there', async () => {
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    const snap = await perfSnapshot({});
    assert.equal(snap.governor, null);
    assert.deepEqual(snap.enabledLayers, []);
    assert.deepEqual(snap.entitySources, []);
    assert.equal(snap.cctv, null);
    assert.equal(snap.frames.frames, 0);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test('the governor verdict is carried through, because it is read first', async () => {
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    const snap = await perfSnapshot({
      governorDiagnostics: () => ({ mode: 'continuous', holds: ['cctv-projection'], extra: 'ignored' }),
    });
    // A held render loop has been the answer twice in this project's history,
    // so it has to reach the report intact.
    assert.equal(snap.governor.mode, 'continuous');
    assert.deepEqual(snap.governor.holds, ['cctv-projection']);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test('only ENABLED layers and non-empty sources are reported', async () => {
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    const snap = await perfSnapshot({
      dataManager: {
        getAll: () => ([
          { id: 'cctv', enabled: true, stats: { count: 600 } },
          { id: 'volcanoes', enabled: false, stats: { count: 1214 } },
        ]),
        layers: new Map(),
      },
      viewer: {
        dataSources: {
          length: 2,
          get: (i) => ([
            { name: 'empty', entities: { values: [] }, show: true },
            { name: 'volcanoes', entities: { values: new Array(1214) }, show: false },
          ][i]),
        },
      },
    });
    assert.deepEqual(snap.enabledLayers, [{ id: 'cctv', count: 600 }]);
    // An empty source says nothing about cost; a hidden one still holds its
    // geometry, so it is reported with `shown: false` rather than dropped.
    assert.deepEqual(snap.entitySources, [{ name: 'volcanoes', entities: 1214, shown: false }]);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});
