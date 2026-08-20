// Static port/city → { lat, lon } dictionary. Enough major ports for the demo.
// Keys are lowercased; lookup is case-insensitive and tolerant of "port of X".

const PORTS = {
  shanghai: { lat: 31.23, lon: 121.47, country: 'CN' },
  shenzhen: { lat: 22.54, lon: 114.06, country: 'CN' },
  ningbo: { lat: 29.87, lon: 121.55, country: 'CN' },
  'hong kong': { lat: 22.32, lon: 114.17, country: 'HK' },
  singapore: { lat: 1.29, lon: 103.85, country: 'SG' },
  busan: { lat: 35.18, lon: 129.08, country: 'KR' },
  tokyo: { lat: 35.65, lon: 139.84, country: 'JP' },
  yokohama: { lat: 35.44, lon: 139.64, country: 'JP' },
  mumbai: { lat: 18.95, lon: 72.84, country: 'IN' },
  'nhava sheva': { lat: 18.95, lon: 72.94, country: 'IN' },
  chennai: { lat: 13.08, lon: 80.29, country: 'IN' },
  colombo: { lat: 6.94, lon: 79.85, country: 'LK' },
  dubai: { lat: 25.27, lon: 55.3, country: 'AE' },
  'jebel ali': { lat: 25.01, lon: 55.06, country: 'AE' },
  jeddah: { lat: 21.49, lon: 39.19, country: 'SA' },
  'port said': { lat: 31.26, lon: 32.3, country: 'EG' },
  suez: { lat: 29.97, lon: 32.55, country: 'EG' },
  piraeus: { lat: 37.94, lon: 23.65, country: 'GR' },
  istanbul: { lat: 41.01, lon: 28.98, country: 'TR' },
  rotterdam: { lat: 51.95, lon: 4.14, country: 'NL' },
  antwerp: { lat: 51.26, lon: 4.4, country: 'BE' },
  hamburg: { lat: 53.55, lon: 9.99, country: 'DE' },
  'le havre': { lat: 49.49, lon: 0.11, country: 'FR' },
  felixstowe: { lat: 51.96, lon: 1.35, country: 'GB' },
  london: { lat: 51.51, lon: -0.13, country: 'GB' },
  valencia: { lat: 39.45, lon: -0.33, country: 'ES' },
  'new york': { lat: 40.67, lon: -74.04, country: 'US' },
  'los angeles': { lat: 33.74, lon: -118.26, country: 'US' },
  'long beach': { lat: 33.75, lon: -118.19, country: 'US' },
  savannah: { lat: 32.08, lon: -81.09, country: 'US' },
  houston: { lat: 29.73, lon: -95.28, country: 'US' },
  santos: { lat: -23.96, lon: -46.33, country: 'BR' },
  durban: { lat: -29.87, lon: 31.03, country: 'ZA' },
  'cape town': { lat: -33.9, lon: 18.42, country: 'ZA' },
  sydney: { lat: -33.86, lon: 151.21, country: 'AU' },
  melbourne: { lat: -37.84, lon: 144.95, country: 'AU' },
};

function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^port of\s+/, '')
    .trim();
}

/**
 * Resolve a place name to coordinates. Returns null if unknown.
 * @param {string} name
 * @returns {{name:string, lat:number, lon:number, country:string}|null}
 */
export function geocode(name) {
  const key = normalize(name);
  if (PORTS[key]) return { name, ...PORTS[key] };
  // loose contains-match fallback
  const hit = Object.keys(PORTS).find((k) => key.includes(k) || k.includes(key));
  return hit ? { name, ...PORTS[hit] } : null;
}

// In-memory cache so repeated worldwide lookups don't re-hit the network.
const geoCache = new Map();

/**
 * Worldwide geocoder. Tries the built-in port dictionary first (instant), then
 * falls back to the free Open-Meteo geocoding API (no key, any city/port on
 * Earth). Returns null only if the name can't be resolved anywhere.
 *
 * @param {string} name
 * @returns {Promise<{name:string, lat:number, lon:number, country:string, resolvedName?:string}|null>}
 */
export async function geocodeAsync(name) {
  const local = geocode(name);
  if (local) return local;

  const key = normalize(name);
  if (geoCache.has(key)) return geoCache.get(key);

  try {
    const url =
      'https://geocoding-api.open-meteo.com/v1/search' +
      `?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`geocoding HTTP ${res.status}`);
    const data = await res.json();
    const r = data?.results?.[0];
    if (!r) {
      geoCache.set(key, null);
      return null;
    }
    const resolved = {
      name,
      resolvedName: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
      country: r.country_code || r.country || '',
    };
    geoCache.set(key, resolved);
    return resolved;
  } catch (err) {
    console.warn(`[geocode] worldwide lookup failed for "${name}": ${err.message}`);
    return null;
  }
}

/** Great-circle distance in km between two {lat,lon}. */
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** A few interpolated sample points along the great-circle-ish corridor. */
export function corridorPoints(a, b, n = 3) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    pts.push({
      lat: +(a.lat + (b.lat - a.lat) * t).toFixed(3),
      lon: +(a.lon + (b.lon - a.lon) * t).toFixed(3),
    });
  }
  return pts;
}
