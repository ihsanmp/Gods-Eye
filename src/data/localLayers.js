import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';

// Use Vite's ?url import to properly resolve these assets in dev and build
import datacentersUrl from './local_data/datacenters/datacenters.geojsonl?url';
import damsUrl from './local_data/dams/dams.geojsonl?url';
import portsUrl from './local_data/maritime/ports.geojsonl?url';
import chokepointsUrl from './local_data/maritime/chokepoints.geojsonl?url';

/**
 * Registry of local GeoJSON datasets.
 * These are lazily loaded natively into Cesium when enabled.
 */
const datacenters = createLocalGeoJsonLayer({
  id: 'local-datacenters',
  url: datacentersUrl,
  name: 'Datacenters',
  color: '#00ffff', // Cyan
  icon: '▣',
  source: 'Local',
  labels: true,
  labelMax: 700,
  labelGridPx: 138,
});

const dams = createLocalGeoJsonLayer({
  id: 'local-dams',
  url: damsUrl,
  name: 'Dams',
  color: '#0088ff', // Blue
  icon: '▰',
  source: 'USACE',
  labels: true,
  labelMax: 900,
  labelGridPx: 132,
});

// Live NASA FIRMS fires (VIIRS ×3 NRT via the /api/firms proxy). The id keeps
// the historical `local-` prefix for persistence + voice-tool-enum compat,
// but the data is NOT bundled anymore — it needs FIRMS_MAP_KEY server-side.
const fires = createFirmsHeatmapLayer({
  id: 'local-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
  group: 'natural-hazards',
});

/*
 * Maritime infrastructure. Two small hand-built sets rather than a feed,
 * because neither changes: a strait is where it has always been, and a
 * container port moves about once a generation.
 *
 * EVERY COORDINATE IN BOTH FILES WAS RESOLVED THROUGH NOMINATIM AND CHECKED
 * against an independent prior before being written — see the generator in the
 * commit that added them. That check was not ceremony: searching "Port of Hong
 * Kong" returned a fast-food shop in Guernsey, and "Port of Shanghai" a massage
 * parlour in Kent. Santos is absent because no query resolved near its prior,
 * and a wrong dot on a map is worse than a missing one.
 *
 * They pair with the live AIS layer: ships moving over the fixed places that
 * explain why they are moving there.
 */
const ports = createLocalGeoJsonLayer({
  id: 'maritime-ports',
  url: portsUrl,
  name: 'Major Ports',
  color: '#4dd0e1',
  icon: '⚓',
  source: 'OSM-verified',
  group: 'maritime',
  labels: true,
  labelMax: 400,
  labelGridPx: 130,
});

const chokepoints = createLocalGeoJsonLayer({
  id: 'maritime-chokepoints',
  url: chokepointsUrl,
  name: 'Chokepoints',
  color: '#ffb74d',
  icon: '⧗',
  source: 'OSM-verified',
  group: 'maritime',
  labels: true,
  labelMax: 400,
  labelGridPx: 130,
});

export default [
  datacenters,
  dams,
  submarineCablesLayer,
  fires,
  ports,
  chokepoints,
];
