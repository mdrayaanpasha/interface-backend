import { pool } from '../db/pool.js';
import { analyzeShipment } from '../services/analyze.js';

/**
 * Re-analyze one saved route: run the pipeline, append a route_states snapshot,
 * and update the denormalized current fields on saved_routes.
 *
 * @param {{id:number, origin:string, dest:string, cargo:string, budget:number|null}} route
 * @returns {Promise<object>} the fresh analyze result
 */
export async function refreshOneRoute(route) {
  const result = await analyzeShipment({
    origin: route.origin,
    dest: route.dest,
    cargo: route.cargo,
    budget: route.budget ?? null,
  });

  const { overall_risk, overall_score } = result.risk;

  await pool.query(
    'INSERT INTO route_states (saved_route_id, overall_risk, overall_score, result) VALUES ($1,$2,$3,$4)',
    [route.id, overall_risk, overall_score, JSON.stringify(result)]
  );
  await pool.query(
    'UPDATE saved_routes SET current_risk=$1, current_score=$2, last_refreshed_at=now() WHERE id=$3',
    [overall_risk, overall_score, route.id]
  );

  return result;
}

/**
 * Refresh every saved route, sequentially. Sequential is deliberate: the local
 * LLM handles one request at a time and GDELT is rate-limited (the news service
 * serializes its calls). Returns a per-route summary.
 */
export async function refreshAllRoutes() {
  const { rows } = await pool.query(
    'SELECT id, origin, dest, cargo, budget FROM saved_routes ORDER BY id'
  );
  console.log(`[refresh] refreshing ${rows.length} saved route(s)`);

  const summary = [];
  for (const route of rows) {
    try {
      const result = await refreshOneRoute(route);
      console.log(`[refresh] route ${route.id} (${route.origin}->${route.dest}): ${result.risk.overall_risk} ${result.risk.overall_score}`);
      summary.push({ id: route.id, ok: true, risk: result.risk.overall_risk, score: result.risk.overall_score });
    } catch (err) {
      console.error(`[refresh] route ${route.id} failed: ${err.message}`);
      summary.push({ id: route.id, ok: false, error: err.message });
    }
  }
  return summary;
}
