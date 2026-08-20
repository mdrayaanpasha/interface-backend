import { geocodeAsync } from './geocode.js';
import { getWeather } from './weather.js';
import { getAisContext } from './ais.js';
import { getNews } from './news.js';
import { matchFeeds, impliedCorridors } from './feeds.js';
import { scoreRoutes } from './scoring.js';
import { assessRisk } from '../agents/riskAgent.js';
import { suggestAlternates } from '../agents/routeAgent.js';

/**
 * Thrown when an origin/dest name can't be geocoded. Callers (HTTP route) map
 * this to a 422; the cron logs and skips.
 */
export class UnresolvedLocationError extends Error {
  constructor(unresolved) {
    super(`Could not resolve: ${unresolved.join(', ')}`);
    this.name = 'UnresolvedLocationError';
    this.unresolved = unresolved;
  }
}

/**
 * Core analysis pipeline, shared by the ad-hoc endpoint, saved-route refresh,
 * and the daily cron. No HTTP, no DB writes — pure compute + external fetches.
 *
 * @param {{origin:string, dest:string, cargo:string, budget?:number|null}} input
 * @returns {Promise<{shipment, weather, matchedIncidents, news, ais, risk, routes, recommended}>}
 */
export async function analyzeShipment({ origin, dest, cargo, budget = null }) {
  if (!origin || !dest || !cargo) {
    throw new Error('origin, dest and cargo are required');
  }

  const shipment = { origin, dest, cargo, budget };

  // Worldwide geocoding: static ports resolve instantly, anything else falls
  // back to the free Open-Meteo geocoder.
  const [originGeo, destGeo] = await Promise.all([
    geocodeAsync(origin),
    geocodeAsync(dest),
  ]);
  if (!originGeo || !destGeo) {
    throw new UnresolvedLocationError(
      [!originGeo && origin, !destGeo && dest].filter(Boolean)
    );
  }

  const corridorRegions = impliedCorridors(originGeo, destGeo);

  // 1) Gather data: weather live, curated feeds, live world news, AIS.
  const [weather, ais, news] = await Promise.all([
    getWeather(originGeo, destGeo),
    getAisContext(),
    getNews({ origin, dest, cargo, corridorRegions }),
  ]);
  const feeds = matchFeeds({ origin, dest, cargo, originGeo, destGeo });

  // 2) Risk Agent (one LLM call).
  const risk = await assessRisk({ shipment, weather, feeds, news, ais });

  // 3) Route Agent (conditional on high risk).
  let alternates = [];
  if (risk.overall_risk === 'high') {
    alternates = await suggestAlternates({ shipment, risk });
  }

  // 4) Score & rank: original route + alternates.
  const originalRoute = {
    name: 'Direct route',
    waypoints: [origin, dest],
    risk: risk.overall_risk,
  };
  const altRoutes = alternates.map((a) => ({
    name: a.name,
    waypoints: a.waypoints.length ? a.waypoints : [origin, dest],
    rationale: a.rationale,
    // alternates assumed to reduce risk by one level from the original
    risk: risk.overall_risk === 'high' ? 'medium' : 'low',
  }));
  const rankedRoutes = scoreRoutes([originalRoute, ...altRoutes], originGeo, destGeo);

  return {
    shipment,
    weather: { summary: weather.summary, available: weather.available },
    matchedIncidents: feeds,
    news: { available: news.available, articles: news.articles, note: news.note || null },
    ais,
    risk,
    routes: rankedRoutes,
    recommended: rankedRoutes.find((r) => r.recommended) || null,
  };
}
