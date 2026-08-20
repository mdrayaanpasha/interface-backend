// Live world news via GDELT (free, no API key, global coverage).
// GDELT rate-limits to ~1 request / 5s, so we cache results briefly and fail
// soft (return []) on any error or rate-limit — news is enrichment, never a
// hard dependency for the analysis.
// Use undici's OWN fetch (not Node's global fetch) so we can attach a custom
// dispatcher. GDELT is IPv4-only and slow to accept connections from here;
// Node's default 10s connectTimeout fires too early. Force IPv4 + 20s connect.
import { Agent, fetch as undiciFetch } from 'undici';

const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';

const gdeltDispatcher = new Agent({
  connect: { timeout: 20_000, family: 4 },
  headersTimeout: 25_000,
  bodyTimeout: 25_000,
});
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map(); // query -> { at, articles }

function quote(s) {
  return `"${String(s).replace(/"/g, '').trim()}"`;
}

/**
 * Build a focused GDELT query from the route + cargo + implied corridor regions.
 * Restricts to English sources for readable summaries.
 */
function buildQuery({ origin, dest, cargo, corridorRegions = [] }) {
  // GDELT rejects quoted phrases shorter than 5 chars ("too short"), so drop
  // them (e.g. "Suez"). Keep the query lean — the known-good shape is
  // ("A" OR "B") (few topic words) sourcelang:english.
  const candidates = [origin, dest, ...corridorRegions];
  const places = candidates
    .filter((p) => p && p.trim().length >= 5)
    .slice(0, 4)
    .map(quote);
  if (!places.length) return null; // nothing safe to search

  const placeClause = `(${places.join(' OR ')})`;
  const topicClause = '(shipping OR port OR trade OR freight OR export)';
  return `${placeClause} ${topicClause} sourcelang:english`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GDELT allows ~1 request / 5s. Serialize our calls and space them so
// back-to-back analyses don't trip the (escalating) rate limit.
const MIN_GAP_MS = 5500;
let gdeltGate = Promise.resolve();
let lastCallAt = 0;

function throttleGdelt(fn) {
  const run = gdeltGate.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return fn();
  });
  // keep the chain alive even if fn throws
  gdeltGate = run.then(() => {}, () => {});
  return run;
}

async function fetchGdeltOnce(query) {
  const url =
    `${GDELT}?query=${encodeURIComponent(query)}` +
    `&mode=ArtList&maxrecords=10&format=json&sort=DateDesc&timespan=14d`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await undiciFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'supply-risk-mvp/1.0' },
      dispatcher: gdeltDispatcher,
    });
    const text = await res.text();
    // GDELT returns plain-text notices (e.g. rate-limit) instead of JSON.
    if (!text.trim().startsWith('{')) {
      const note = text.slice(0, 120).trim();
      const rateLimited = /limit requests/i.test(note);
      return { ok: false, note, rateLimited };
    }
    const data = JSON.parse(text);
    const articles = (data.articles || []).map((a) => ({
      title: a.title,
      domain: a.domain,
      url: a.url,
      date: a.seendate,
      language: a.language,
    }));
    return { ok: true, articles };
  } catch (err) {
    return { ok: false, note: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// All GDELT calls go through the throttle gate (spacing >= 5.5s). If we still
// hit a rate-limit notice, back off once more and retry.
async function fetchGdelt(query) {
  const first = await throttleGdelt(() => fetchGdeltOnce(query));
  if (first.ok || !first.rateLimited) return first;
  return throttleGdelt(() => fetchGdeltOnce(query));
}

/**
 * Fetch recent world news relevant to a shipment. Best-effort and cached.
 *
 * @param {{origin:string, dest:string, cargo:string, corridorRegions?:string[]}} ctx
 * @returns {Promise<{available:boolean, articles:Array, note?:string}>}
 */
export async function getNews(ctx) {
  const query = buildQuery(ctx);
  if (!query) {
    return { available: false, articles: [], note: 'location names too short to search' };
  }

  const hit = cache.get(query);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { available: true, articles: hit.articles, cached: true };
  }

  const result = await fetchGdelt(query);
  if (!result.ok) {
    return { available: false, articles: [], note: result.note };
  }

  // De-dup by title, keep the freshest handful.
  const seen = new Set();
  const articles = [];
  for (const a of result.articles) {
    const key = (a.title || '').toLowerCase().slice(0, 80);
    if (!a.title || seen.has(key)) continue;
    seen.add(key);
    articles.push(a);
    if (articles.length >= 6) break;
  }

  cache.set(query, { at: now, articles });
  return { available: true, articles };
}
