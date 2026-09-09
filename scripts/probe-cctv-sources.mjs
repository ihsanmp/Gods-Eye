#!/usr/bin/env node
/**
 * Which Indonesian public CCTV portals can THIS machine reach?
 *
 *   node scripts/probe-cctv-sources.mjs
 *
 * WHY THIS EXISTS. The camera catalogue is 544 cameras, all Yogyakarta, from
 * one publisher (cctv.jogjaprov.go.id). Widening it to the rest of Indonesia
 * needs other publishers, and the obvious ones are each city's ATCS / Dishub
 * portal.
 *
 * From the machine this script was written on, 3 of 21 answered: the Jogja host
 * already in use, plus Bandung and Semarang. The controls at the bottom
 * answered too, so the connection itself was fine.
 *
 * READ THE FAILURE REASONS, NOT JUST THE COUNT — they say different things:
 *
 *   ENOTFOUND      the hostname does not exist in DNS. Most of the failures
 *                  here were this, which means the URL is simply WRONG rather
 *                  than blocked. These were guesses; a correct one may exist.
 *   CONNECT_TIMEOUT / EAI_AGAIN
 *                  the host exists but will not answer. This is what
 *                  geo-fencing looks like, and it may well answer from inside
 *                  Indonesia.
 *   403 / 404      the host answered. It is reachable; the path is wrong or
 *                  the front page is closed.
 *
 * So run this from Indonesia, and treat the ENOTFOUND rows as "find the real
 * URL" rather than "unavailable". Whatever answers is what the next catalogue
 * can be built from.
 *
 * Nothing is fetched but the front page, and nothing is written anywhere.
 */

const TIMEOUT_MS = 12000;

/** [label, url] — public transport-agency CCTV portals, one per city. */
const SOURCES = [
  ['Yogyakarta (in use)', 'https://cctv.jogjaprov.go.id/'],
  ['Jakarta', 'https://cctv.jakarta.go.id/'],
  ['Jakarta ATCS', 'https://atcs.jakarta.go.id/'],
  ['Bandung', 'https://atcs-dishub.bandung.go.id/'],
  ['Bandung (alt)', 'https://cctv.bandung.go.id/'],
  ['Semarang', 'https://cctv.semarangkota.go.id/'],
  ['Semarang ATCS', 'https://atcs.semarangkota.go.id/'],
  ['Jawa Tengah', 'https://cctv.jatengprov.go.id/'],
  ['Surabaya', 'https://cctv.surabaya.go.id/'],
  ['Surabaya SITS', 'https://sitsdishub.surabaya.go.id/'],
  ['Denpasar', 'https://atcs-dishub.denpasarkota.go.id/'],
  ['Bogor kota', 'https://cctv.kotabogor.go.id/'],
  ['Bogor kabupaten', 'https://atcs.bogorkab.go.id/'],
  ['Malang', 'https://cctv.malangkota.go.id/'],
  ['Surakarta', 'https://atcs.surakarta.go.id/'],
  ['Medan', 'https://cctv.pemkomedan.go.id/'],
  ['Balikpapan', 'https://cctv.balikpapan.go.id/'],
  ['Pekanbaru', 'https://atcs.pekanbaru.go.id/'],
  ['Padang', 'https://atcs.padang.go.id/'],
  ['Tangerang', 'https://atcs-dishub.tangerangkota.go.id/'],
  ['Bekasi', 'https://cctv.bekasikota.go.id/'],
];

/** A control group: if these fail too, the problem is the connection, not the hosts. */
const CONTROLS = [
  ['control · USGS', 'https://earthquake.usgs.gov/'],
  ['control · Nominatim', 'https://nominatim.openstreetmap.org/'],
];

async function probe(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'MapMonitoring/0.1 (source probe)' },
    });
    return { ok: response.ok, status: response.status, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, why: error.cause?.code || error.name };
  }
}

const reachable = [];

for (const [group, list] of [['SOURCES', SOURCES], ['CONTROLS', CONTROLS]]) {
  console.log(`\n── ${group} ──`);
  for (const [label, url] of list) {
    const result = await probe(url);
    const mark = result.ok ? 'OK  ' : (result.status ? `HTTP` : 'FAIL');
    const detail = result.ok
      ? `${result.status} in ${result.ms} ms`
      : (result.status ? `${result.status} in ${result.ms} ms` : `${result.why} after ${result.ms} ms`);
    console.log(`  ${mark} ${label.padEnd(22)} ${detail}`);
    if (result.ok && group === 'SOURCES') reachable.push(label);
  }
}

console.log(`\n${reachable.length} of ${SOURCES.length} sources answered from here.`);
if (reachable.length > 1) {
  console.log('Reachable beyond the one already in use:');
  for (const label of reachable.filter((l) => !l.includes('in use'))) console.log(`  · ${label}`);
  console.log('\nThose are the publishers to build the next catalogue from.');
} else {
  console.log('Only the publisher already in use answered — nothing new to build from here.');
}
