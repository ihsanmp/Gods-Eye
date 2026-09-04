/**
 * Nominatim's `addresstype`/`type` vocabulary mapped onto the Google Geocoding
 * `types` values the rest of the app already understands, so a keyless hit is
 * framed at the same scale a keyed one would be. Anything unlisted falls
 * through to `precise-place`, which is the right default for a named landmark.
 *
 * It lives in its own module because BOTH keyless geocode paths need it -
 * `locations.js` (the search box) and `annotations/annotationResolver.js`
 * (named marks and routes) - and those two already import from each other in
 * the other direction. Hanging the table off either one would close an import
 * cycle for a plain lookup table.
 *
 * @module data/osmPlaceTypes
 */

export const OSM_TYPE_TO_GOOGLE_TYPES = {
  country: ['country'],
  state: ['administrative_area_level_1'],
  province: ['administrative_area_level_1'],
  region: ['administrative_area_level_1'],
  county: ['administrative_area_level_2'],
  state_district: ['administrative_area_level_2'],
  city: ['locality'],
  town: ['locality'],
  municipality: ['locality'],
  village: ['sublocality'],
  hamlet: ['sublocality'],
  suburb: ['sublocality_level_1'],
  neighbourhood: ['neighborhood'],
  quarter: ['neighborhood'],
  city_district: ['neighborhood'],
  borough: ['neighborhood'],
  postcode: ['postal_code'],
  road: ['route'],
  residential: ['route'],
  street: ['route'],
  park: ['park'],
  nature_reserve: ['park'],
  forest: ['natural_feature'],
  water: ['natural_feature'],
  bay: ['natural_feature'],
  peak: ['natural_feature'],
  island: ['natural_feature'],
  beach: ['natural_feature'],
  river: ['natural_feature'],
  aerodrome: ['airport'],
  airport: ['airport'],
  university: ['university'],
  college: ['university'],
  stadium: ['stadium'],
};
