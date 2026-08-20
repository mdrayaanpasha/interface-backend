import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../auth/middleware.js';
import { UnresolvedLocationError } from '../services/analyze.js';
import { refreshOneRoute } from '../jobs/refreshRoutes.js';

const router = Router();
router.use(requireAuth);

// Fetch a saved route owned by the current user, or null.
async function getOwnedRoute(id, userId) {
  const q = await pool.query(
    'SELECT id, user_id, name, origin, dest, cargo, budget, current_risk, current_score, last_refreshed_at, created_at FROM saved_routes WHERE id=$1',
    [id]
  );
  const route = q.rows[0];
  if (!route || route.user_id !== userId) return null;
  return route;
}

// Create a saved route and run the first analysis immediately.
router.post('/', async (req, res) => {
  const { name, origin, dest, cargo, budget } = req.body || {};
  if (!name || !origin || !dest || !cargo) {
    return res.status(400).json({ error: 'name, origin, dest and cargo are required' });
  }

  try {
    const ins = await pool.query(
      'INSERT INTO saved_routes (user_id, name, origin, dest, cargo, budget) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, origin, dest, cargo, budget',
      [req.userId, name, origin, dest, cargo, budget ?? null]
    );
    const route = ins.rows[0];

    let result = null;
    try {
      result = await refreshOneRoute(route);
    } catch (err) {
      if (err instanceof UnresolvedLocationError) {
        // Roll back the saved route so the user can fix the name.
        await pool.query('DELETE FROM saved_routes WHERE id=$1', [route.id]);
        return res.status(422).json({ error: 'Could not resolve one of the locations', unresolved: err.unresolved });
      }
      console.error('[routes] initial analysis failed:', err.message);
      // Keep the route; it can be refreshed later.
    }

    const fresh = await getOwnedRoute(route.id, req.userId);
    res.status(201).json({ route: fresh, snapshot: result });
  } catch (e) {
    console.error('[routes] create failed:', e.message);
    res.status(500).json({ error: 'could not save route' });
  }
});

// List the current user's saved routes.
router.get('/', async (req, res) => {
  const q = await pool.query(
    'SELECT id, name, origin, dest, cargo, budget, current_risk, current_score, last_refreshed_at, created_at FROM saved_routes WHERE user_id=$1 ORDER BY created_at DESC',
    [req.userId]
  );
  res.json({ routes: q.rows });
});

// Route detail: latest full result + history for the trend.
router.get('/:id', async (req, res) => {
  const route = await getOwnedRoute(req.params.id, req.userId);
  if (!route) return res.status(404).json({ error: 'route not found' });

  const states = await pool.query(
    'SELECT id, overall_risk, overall_score, created_at FROM route_states WHERE saved_route_id=$1 ORDER BY created_at ASC',
    [route.id]
  );
  const latest = await pool.query(
    'SELECT result FROM route_states WHERE saved_route_id=$1 ORDER BY created_at DESC LIMIT 1',
    [route.id]
  );

  res.json({
    route,
    history: states.rows,
    latest: latest.rows[0]?.result ?? null,
  });
});

// Manual refresh now.
router.post('/:id/refresh', async (req, res) => {
  const route = await getOwnedRoute(req.params.id, req.userId);
  if (!route) return res.status(404).json({ error: 'route not found' });

  try {
    const result = await refreshOneRoute(route);
    const fresh = await getOwnedRoute(route.id, req.userId);
    res.json({ route: fresh, snapshot: result });
  } catch (err) {
    if (err instanceof UnresolvedLocationError) {
      return res.status(422).json({ error: 'Could not resolve one of the locations', unresolved: err.unresolved });
    }
    console.error('[routes] refresh failed:', err.message);
    res.status(500).json({ error: 'refresh failed', detail: err.message });
  }
});

// Delete a saved route (cascades to route_states).
router.delete('/:id', async (req, res) => {
  const route = await getOwnedRoute(req.params.id, req.userId);
  if (!route) return res.status(404).json({ error: 'route not found' });
  await pool.query('DELETE FROM saved_routes WHERE id=$1', [route.id]);
  res.json({ ok: true });
});

export default router;
