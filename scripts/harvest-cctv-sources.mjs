#!/usr/bin/env node
/**
 * Re-harvest the Indonesian ATCS camera catalogue.
 *
 *   node scripts/harvest-cctv-sources.mjs            # report only
 *   node scripts/harvest-cctv-sources.mjs --write    # update the catalogue
 *
 * WHY THIS EXISTS. Public ATCS portals publish their camera list inside the
 * page, and the shape differs per portal. This encodes the shapes that were
 * worked out by hand so the catalogue can be refreshed rather than being a
 * one-time dump that rots.
 *
 * IT TESTS EVERY STREAM BEFORE WRITING ANYTHING. A camera that is listed but
 * silent is worse than a missing one: it puts a marker on the map that never
 * shows a picture, and an operator cannot tell that from a camera that is off.
 * Only feeds that returned a real HLS playlist are written.
 *
 * RUN IT FROM INDONESIA if you can. Several portals are reachable only from
 * there — see scripts/probe-cctv-sources.mjs — so a run there may find sources
 * this one cannot.
 *
 * Adding a portal: give it a `parse` that returns {name, lat, lon, stream} and
 * the rest (stream testing, id generation, merging) is shared.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'config', 'cctv_sources.indonesia.json');
const UA = 'MapMonitoring/0.1 (public CCTV catalogue build)';
const WRITE = process.argv.includes('--write');

/** Pose defaults, matching the entries already in the catalogue. */
const POSE = { headingConfidence: 'low', pitchDeg: -14, fovDeg: 70, rangeM: 260, mountHeightM: 7 };

const slug = (s) => String(s).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);

const PORTALS = [
  {
    id: 'tasikmalaya',
    city: 'Tasikmalaya',
    url: 'https://atcs.tasikmalayakota.go.id/mplayer/',
    provider: 'ATCS Dishub Kota Tasikmalaya',
    license: 'Public ATCS feed published by Dishub Kota Tasikmalaya via atcs.tasikmalayakota.go.id',
    // A JSON blob inline in the page, one object per camera.
    parse(html) {
      const re = /"nama":"([^"]+)","jenis":"[^"]*","link":"([^"]+)","jalan_status":"[^"]*","lokasi_lat":"(-?[\d.]+)","lokasi_lng":"(-?[\d.]+)"/g;
      const out = [];
      let m;
      while ((m = re.exec(html))) {
        out.push({ name: m[1], stream: m[2].split('\\/').join('/'), lat: +m[3], lon: +m[4] });
      }
      return out;
    },
  },
  {
    id: 'banyumas',
    city: 'Banyumas',
    url: 'http://atcs.banyumaskab.go.id/',
    provider: 'ATCS Dishub Kabupaten Banyumas',
    license: 'Public ATCS feed published by Dishub Kabupaten Banyumas via atcs.banyumaskab.go.id',
    // Leaflet marker pushes, each carrying its own stream URL.
    parse(html) {
      const re = /url:\s*"([^"]+\.m3u8[^"]*)",\s*name:\s*"([^"]*)",[\s\S]{0,120}?lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)/g;
      const seen = new Set();
      const out = [];
      let m;
      while ((m = re.exec(html))) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({
          name: m[2].replace(/^CCTV\s+/i, '').trim() || m[2],
          stream: m[1],
          lat: +m[3],
          lon: +m[4],
        });
      }
      return out;
    },
  },
  {
    id: 'binamarga',
    city: null, // taken per-camera: these run along national roads, not in one city
    url: 'https://binamarga.pu.go.id/cctv-ai/',
    provider: 'Bina Marga — Kementerian Pekerjaan Umum',
    license: 'Public national-road CCTV published by Direktorat Jenderal Bina Marga via binamarga.pu.go.id',
    /*
     * Two steps, unlike the others. The map page has every camera's position
     * but its `url` is a PLAYER PAGE; the real stream lives inside that page.
     *
     * Only the `its.binamarga.pu.go.id` streams are taken. The other 37 are on
     * apps.ptbtu.com, whose TLS certificate has EXPIRED — the video is live but
     * using it means turning off certificate verification for that host, which
     * is the repo owner's decision, not a harvester's. The remaining 40 are
     * tokenised iframes to a third-party viewer, not streams at all.
     */
    parse(html) {
      const re = /lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+),\s*info:\s*"([^"]*)",\s*category:\s*"[^"]*",\s*url:\s*"(https:\/\/binamarga\.pu\.go\.id\/play-hls\/[^"]+)"/g;
      const out = [];
      let m;
      while ((m = re.exec(html))) {
        out.push({ lat: +m[1], lon: +m[2], info: m[3], playerUrl: m[4] });
      }
      return out;
    },
    async resolve(camera) {
      const html = await (await fetch(camera.playerUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      })).text();
      const stream = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/)?.[0] || null;
      if (!stream || !stream.includes('its.binamarga.pu.go.id')) return null;
      const heading = html.match(/<h3 class="text-center">([^<]*)<\/h3>/)?.[1]?.trim() || '';
      const city = html.match(/<h6 class="text-center">([^<]*)<\/h6>/)?.[1]?.trim() || '';
      const [code, ...rest] = heading.split(' - ');
      return { ...camera, stream, name: rest.join(' - ').trim() || heading, code: (code || '').trim(), city };
    },
  },
];

/** A playlist that exists AND names something to play. */
async function streamIsLive(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA } });
    if (!response.ok) return false;
    const body = await response.text();
    return body.includes('#EXTM3U') && /EXTINF|\.m3u8/.test(body);
  } catch {
    return false;
  }
}

const harvested = [];

for (const portal of PORTALS) {
  // portal.city is null for the national-road set, whose cameras each name
  // their own city — so the heading falls back to the portal id.
  process.stdout.write(`
${portal.city || portal.id} (${portal.url})
`);
  let html = '';
  try {
    html = await (await fetch(portal.url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(45000),
    })).text();
  } catch (error) {
    console.log(`  unreachable: ${error.cause?.code || error.name}`);
    continue;
  }

  const cameras = portal.parse(html);
  console.log(`  parsed ${cameras.length}`);
  let live = 0;
  for (const raw of cameras) {
    // A portal whose page only points at a player needs one more hop.
    let camera = raw;
    if (portal.resolve) {
      try {
        camera = await portal.resolve(raw);
      } catch {
        camera = null;
      }
      if (!camera) continue;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) continue;
    if (!(await streamIsLive(camera.stream))) continue;
    live += 1;
    const city = portal.city || camera.city || 'Jalan Nasional';
    harvested.push({
      id: `id-${portal.id}-${slug(camera.code || camera.name)}`,
      name: camera.name,
      city,
      cityId: portal.city ? portal.id : slug(city),
      provider: portal.provider,
      sourceKind: 'live',
      feedType: 'hls',
      url: camera.stream,
      lat: camera.lat,
      lon: camera.lon,
      ...POSE,
      license: portal.license,
    });
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`  live ${live} / ${cameras.length}`);
}

const existing = JSON.parse(readFileSync(CATALOG, 'utf8'));
const byId = new Map(existing.map((c) => [c.id, c]));
let added = 0;
let refreshed = 0;
for (const camera of harvested) {
  if (byId.has(camera.id)) {
    // A portal can move a stream without renaming the camera.
    if (byId.get(camera.id).url !== camera.url) refreshed += 1;
    byId.set(camera.id, { ...byId.get(camera.id), url: camera.url, lat: camera.lat, lon: camera.lon });
  } else {
    byId.set(camera.id, camera);
    added += 1;
  }
}

console.log(`\nharvested ${harvested.length} live cameras — ${added} new, ${refreshed} with a changed stream`);
if (!WRITE) {
  console.log('Report only. Pass --write to update config/cctv_sources.indonesia.json.');
} else {
  writeFileSync(CATALOG, `${JSON.stringify([...byId.values()], null, 2)}\n`, 'utf8');
  console.log(`written: ${existing.length} -> ${byId.size} cameras`);
}
