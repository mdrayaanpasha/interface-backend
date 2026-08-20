import { corridorPoints } from './geocode.js';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 12_000;

async function fetchPoint({ lat, lon }) {
  const url =
    `${OPEN_METEO}?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,precipitation&forecast_days=2&timezone=UTC`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json();
    const winds = data?.hourly?.wind_speed_10m || [];
    const precip = data?.hourly?.precipitation || [];
    return {
      lat,
      lon,
      maxWind: winds.length ? Math.max(...winds) : null, // km/h
      maxPrecip: precip.length ? Math.max(...precip) : null, // mm
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live weather along the origin→dest corridor. Best-effort: on any failure
 * returns a summary noting weather data was unavailable (never throws).
 *
 * @param {{lat:number,lon:number}} originGeo
 * @param {{lat:number,lon:number}} destGeo
 * @returns {Promise<{available:boolean, maxWind:number|null, maxPrecip:number|null, summary:string, points:Array}>}
 */
export async function getWeather(originGeo, destGeo) {
  const points = [
    originGeo,
    ...corridorPoints(originGeo, destGeo, 3),
    destGeo,
  ];

  try {
    const results = await Promise.all(points.map(fetchPoint));
    const winds = results.map((r) => r.maxWind).filter((v) => v != null);
    const precips = results.map((r) => r.maxPrecip).filter((v) => v != null);
    const maxWind = winds.length ? Math.round(Math.max(...winds)) : null;
    const maxPrecip = precips.length ? +Math.max(...precips).toFixed(1) : null;

    let level = 'calm';
    if (maxWind != null) {
      if (maxWind >= 62) level = 'storm-force';
      else if (maxWind >= 39) level = 'gale';
      else if (maxWind >= 20) level = 'breezy';
    }

    const summary =
      `Along the corridor over the next 48h: peak wind ~${maxWind ?? 'n/a'} km/h (${level}), ` +
      `peak precipitation ~${maxPrecip ?? 'n/a'} mm.`;

    return { available: true, maxWind, maxPrecip, level, summary, points: results };
  } catch (err) {
    return {
      available: false,
      maxWind: null,
      maxPrecip: null,
      level: 'unknown',
      summary: `Weather data unavailable (${err.message}).`,
      points: [],
    };
  }
}
