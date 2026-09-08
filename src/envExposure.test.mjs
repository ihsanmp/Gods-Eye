import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/*
 * Every setting the client READS must be a setting the build EXPOSES.
 *
 * Vite only replaces `import.meta.env.X` for names listed in its `define` block
 * (this project does not use envPrefix, so nothing is exposed automatically).
 * Read a name that is not listed and nothing breaks — it compiles, it runs, and
 * the value is `undefined` forever. The setting appears to exist, documentation
 * can be written for it, a user can put it in their .env, and it does nothing.
 *
 * That is exactly what happened to GEV_GPU_BUDGET: shipped as the dial for
 * lowering GPU load on an integrated chip, read in main.js, never defined, and
 * therefore dead from the first commit. It was caught only when someone asked
 * how to use it.
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const config = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');

/** Every source file the browser bundle can reach. */
function clientSources(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      clientSources(full, found);
    } else if (/\.(js|ts|tsx)$/.test(entry) && !/\.test\.mjs$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

test('no client setting is read without being exposed to the client', () => {
  // Vite's own built-ins are always present and are not defined by this project.
  const BUILT_IN = new Set(['MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR', 'LEGACY']);

  const defineBlock = config.slice(config.indexOf('define: {'), config.indexOf('build: {'));
  const exposed = new Set(
    [...defineBlock.matchAll(/'import\.meta\.env\.([A-Z0-9_]+)'/g)].map((m) => m[1]),
  );

  const missing = new Map();
  for (const file of clientSources(path.join(ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) {
      const name = match[1];
      if (BUILT_IN.has(name) || exposed.has(name)) continue;
      if (!missing.has(name)) missing.set(name, []);
      missing.get(name).push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(
    [...missing.entries()],
    [],
    'these are read by client code but never defined, so they are permanently undefined',
  );
});

test('the GPU budget dial is actually wired, end to end', () => {
  // The specific one that was dead. Named rather than left to the sweep above,
  // because a setting nobody can reach is worse than no setting: it invites
  // someone to edit their .env and conclude the machine simply cannot go faster.
  assert.match(config, /'import\.meta\.env\.GEV_GPU_BUDGET': JSON\.stringify\(env\.GEV_GPU_BUDGET\)/);
  const main = readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(main, /Number\(import\.meta\.env\.GEV_GPU_BUDGET\)/);
});
