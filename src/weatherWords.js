/*
 * How this console says the weather, in Indonesian.
 *
 * Shared, because there are now two surfaces that report conditions at a point
 * — the Route panel's destination card and the search bar's chosen place — and
 * a second copy of the wording would drift from the first. The cockpit's own
 * English readout (`weatherCodeLabel` in data/regionalBrief.js) is deliberately
 * separate: it is a different voice for a different reader, not a duplicate.
 */

/**
 * A number, or null — rejecting the things `Number()` quietly turns into zero.
 *
 * This matters more here than almost anywhere. `Number(null)` is 0, and 0 is a
 * real, meaningful value in both fields this module reads: WMO code 0 is
 * "Cerah", and 0°C is a temperature. So a missing reading coerced with a plain
 * `Number()` does not fail — it reports clear skies at freezing point, which is
 * a confident lie rather than a gap. Open-Meteo omits fields it has no data
 * for, so this is a live case, not a hypothetical.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * A WMO weather code in words.
 *
 * Open-Meteo reports the WMO 4677 code, which is a fine-grained scale — eleven
 * kinds of drizzle alone. These are grouped to the distinctions a person
 * actually acts on: whether to expect rain, and how hard.
 *
 * @param {number|string|null|undefined} code - WMO code.
 * @returns {string} Indonesian description.
 */
export function describeWeatherCode(code) {
  const value = toNumber(code);
  if (value === null) return 'Tidak diketahui';
  if (value === 0) return 'Cerah';
  if (value <= 2) return 'Cerah berawan';
  if (value === 3) return 'Berawan';
  if (value <= 48) return 'Berkabut';
  if (value <= 57) return 'Gerimis';
  if (value <= 67) return 'Hujan';
  if (value <= 77) return 'Salju';
  if (value <= 82) return 'Hujan deras';
  if (value <= 86) return 'Hujan salju';
  return 'Badai petir';
}

/**
 * The reading as short lines, or null when there is nothing to say.
 *
 * Temperature is the one field that must be present: a card with wind and no
 * temperature reads as broken rather than partial. Everything else is dropped
 * when missing rather than shown as a dash, so the line stays short and every
 * figure on it is real.
 *
 * @param {object|null|undefined} weather - The `weather` block from
 *   /api/weather-effects.
 * @returns {{headline: string, detail: string}|null}
 */
export function summarizeWeather(weather) {
  const temperature = toNumber(weather?.temperatureC);
  if (temperature === null) return null;

  const headline = `${Math.round(temperature)}°C · ${describeWeatherCode(weather.weatherCode)}`;

  const parts = [];
  const apparent = toNumber(weather?.apparentTemperatureC);
  // Only worth saying when it disagrees with the thermometer; "30°, terasa 30°"
  // is noise. A degree of rounding either way is not a disagreement.
  if (apparent !== null && Math.abs(apparent - temperature) >= 1) {
    parts.push(`terasa ${Math.round(apparent)}°C`);
  }
  const wind = toNumber(weather?.windKph);
  if (wind !== null) parts.push(`angin ${Math.round(wind)} km/jam`);
  const rain = toNumber(weather?.precipitationMm);
  if (rain !== null && rain > 0) parts.push(`hujan ${rain.toFixed(1)} mm`);
  const cloud = toNumber(weather?.cloudCoverPct);
  if (cloud !== null) parts.push(`awan ${Math.round(cloud)}%`);

  return { headline, detail: parts.join(' · ') };
}
