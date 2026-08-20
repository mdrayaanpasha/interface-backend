import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const FEED_FILES = ['geopolitical.json', 'port_incidents.json', 'export_bans.json'];

/**
 * Load all curated feed files fresh from disk. Read on each request so hand
 * edits take effect without a server restart. Tolerant of a bad/missing file.
 */
function loadAll() {
  const out = [];
  for (const file of FEED_FILES) {
    try {
      const raw = readFileSync(join(DATA_DIR, file), 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) out.push(...arr);
    } catch (err) {
      console.warn(`[feeds] skipping ${file}: ${err.message}`);
    }
  }
  return out;
}

// Rough continent grouping by country code, used to infer chokepoints a route
// must pass through even when they aren't named in origin/dest.
const EAST_ASIA = new Set(['CN', 'HK', 'KR', 'JP', 'TW']);
const SOUTH_SE_ASIA = new Set(['IN', 'LK', 'SG', 'AE', 'SA']);
const EUROPE = new Set(['NL', 'BE', 'DE', 'FR', 'GB', 'ES', 'GR', 'TR']);

/**
 * Infer implied transit regions (chokepoints) from the origin/dest countries.
 * e.g. Asia <-> Europe implies the Suez Canal / Red Sea passage.
 * @returns {string[]} region names (empty when nothing inferred)
 */
export function impliedCorridors(originGeo, destGeo) {
  const a = originGeo?.country;
  const b = destGeo?.country;
  if (!a || !b) return [];
  const asia = (c) => EAST_ASIA.has(c) || SOUTH_SE_ASIA.has(c);
  if ((asia(a) && EUROPE.has(b)) || (asia(b) && EUROPE.has(a))) {
    return ['Suez', 'Red Sea', 'Bab-el-Mandeb', 'Gulf of Aden'];
  }
  return [];
}

/**
 * Match curated incidents to a route. An incident matches if any of its
 * regions/keywords appears in the haystack built from origin, dest, cargo,
 * their resolved country codes, and any implied transit corridors.
 *
 * @param {{origin:string, dest:string, cargo:string, originGeo?:object, destGeo?:object}} ctx
 * @returns {Array<object>} matched incidents (with the fields the agent needs)
 */
export function matchFeeds(ctx) {
  const haystackParts = [
    ctx.origin,
    ctx.dest,
    ctx.cargo,
    ctx.originGeo?.country,
    ctx.destGeo?.country,
    impliedCorridors(ctx.originGeo, ctx.destGeo).join(' '),
  ];
  const haystack = haystackParts
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matched = [];
  for (const item of loadAll()) {
    const terms = [...(item.regions || []), ...(item.keywords || [])];
    const hit = terms.some((t) => haystack.includes(String(t).toLowerCase()));
    if (hit) {
      matched.push({
        id: item.id,
        title: item.title,
        category: item.category,
        severity: item.severity,
        summary: item.summary,
        updated: item.updated,
      });
    }
  }
  return matched;
}
