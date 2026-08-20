import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { pool } from './db/pool.js';
import { analyzeShipment, UnresolvedLocationError } from './services/analyze.js';
import authRouter from './routes/auth.js';
import savedRoutesRouter from './routes/savedRoutes.js';
import { startCron } from './jobs/cron.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;

app.get('/api/health', async (_req, res) => {
  let db = 'unknown';
  try {
    await pool.query('SELECT 1');
    db = 'ok';
  } catch {
    db = 'down';
  }
  res.json({ status: 'ok', db, model: process.env.OLLAMA_MODEL });
});

// Ad-hoc analysis — works without login. Also persists to shipments/routes.
app.post('/api/analyze', async (req, res) => {
  const { origin, dest, cargo, budget } = req.body || {};
  if (!origin || !dest || !cargo) {
    return res.status(400).json({ error: 'origin, dest and cargo are required' });
  }

  try {
    const result = await analyzeShipment({ origin, dest, cargo, budget: budget ?? null });

    // Best-effort persistence (existing behavior).
    let shipmentId = null;
    try {
      const ins = await pool.query(
        'INSERT INTO shipments (origin, dest, cargo, budget) VALUES ($1,$2,$3,$4) RETURNING id',
        [origin, dest, cargo, budget ?? null]
      );
      shipmentId = ins.rows[0].id;
      for (const r of result.routes) {
        await pool.query(
          'INSERT INTO routes (shipment_id, name, waypoints, cost, carbon, recommended) VALUES ($1,$2,$3,$4,$5,$6)',
          [shipmentId, r.name, JSON.stringify(r.waypoints), r.cost, r.carbon, r.recommended]
        );
      }
    } catch (dbErr) {
      console.error('[analyze] persistence failed (continuing):', dbErr.message);
    }

    res.json({ shipmentId, ...result });
  } catch (err) {
    if (err instanceof UnresolvedLocationError) {
      return res.status(422).json({
        error: 'Could not resolve one of the locations',
        unresolved: err.unresolved,
        hint: 'Use a recognizable city or port name.',
      });
    }
    console.error('[analyze] failed:', err);
    res.status(500).json({ error: 'analysis failed', detail: err.message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/routes', savedRoutesRouter);

// Serve the built frontend (single-origin deployment). API + app on one port.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', '..', 'frontend', 'dist');
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback for client-side routes (but never for /api).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(DIST, 'index.html'));
  });
  console.log(`[server] serving frontend from ${DIST}`);
} else {
  console.log('[server] frontend build not found — API only (run `npm run build` in frontend)');
}

// 404 for unmatched /api routes.
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
  startCron();
});
