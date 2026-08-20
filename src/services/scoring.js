import { geocode, distanceKm } from './geocode.js';

// Simple, explainable cost/carbon model (no LLM).
const COST_PER_KM = 0.9;         // USD per km of sea freight (illustrative)
const CARBON_PER_KM = 0.011;     // tonnes CO2 per km (illustrative)
const RISK_PREMIUM = { low: 0, medium: 0.15, high: 0.4 }; // cost multiplier add-on

/**
 * Estimate distance for a route given its waypoint names. Falls back to the
 * origin→dest straight line when waypoints can't be geocoded.
 */
function routeDistanceKm(waypoints, originGeo, destGeo) {
  const geos = waypoints
    .map((w) => geocode(w))
    .filter(Boolean);
  const chain = [originGeo, ...geos, destGeo];
  let total = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    total += distanceKm(chain[i], chain[i + 1]);
  }
  return total || distanceKm(originGeo, destGeo);
}

/**
 * Score and rank routes. Each input route: { name, waypoints[], risk }.
 * risk is 'low'|'medium'|'high' for that route (original inherits overall risk;
 * alternates are assumed lower unless specified).
 *
 * @returns {Array} routes with { name, waypoints, distanceKm, cost, carbon, risk, recommended }
 */
export function scoreRoutes(routes, originGeo, destGeo) {
  const scored = routes.map((r) => {
    const dist = routeDistanceKm(r.waypoints || [], originGeo, destGeo);
    const premium = RISK_PREMIUM[r.risk] ?? 0;
    const cost = Math.round(dist * COST_PER_KM * (1 + premium));
    const carbon = +(dist * CARBON_PER_KM).toFixed(1);
    return {
      name: r.name,
      waypoints: r.waypoints || [],
      rationale: r.rationale || null,
      distanceKm: dist,
      cost,
      carbon,
      risk: r.risk,
      recommended: false,
    };
  });

  // Rank: lower risk first, then lower cost, then lower carbon.
  const riskRank = { low: 0, medium: 1, high: 2 };
  const ranked = [...scored].sort((a, b) => {
    if (riskRank[a.risk] !== riskRank[b.risk]) return riskRank[a.risk] - riskRank[b.risk];
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.carbon - b.carbon;
  });

  if (ranked.length) ranked[0].recommended = true;
  // Return in original order but with recommended flag set on the winner.
  const winner = ranked[0];
  return scored.map((r) => ({ ...r, recommended: r === winner || r.name === winner.name }));
}
