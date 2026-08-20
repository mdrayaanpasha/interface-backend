import cron from 'node-cron';
import { refreshAllRoutes } from './refreshRoutes.js';

// Daily at 03:00 server time. Override with CRON_SCHEDULE for testing.
const SCHEDULE = process.env.CRON_SCHEDULE || '0 3 * * *';

let isRunning = false;

async function runRefresh(trigger) {
  if (isRunning) {
    console.log(`[cron] refresh already running, skipping (${trigger})`);
    return;
  }
  isRunning = true;
  console.log(`[cron] starting daily route refresh (${trigger})`);
  try {
    await refreshAllRoutes();
  } catch (err) {
    console.error('[cron] refresh run failed:', err.message);
  } finally {
    isRunning = false;
    console.log('[cron] refresh run complete');
  }
}

export function startCron() {
  if (!cron.validate(SCHEDULE)) {
    console.error(`[cron] invalid CRON_SCHEDULE "${SCHEDULE}", cron disabled`);
    return;
  }
  cron.schedule(SCHEDULE, () => runRefresh('scheduled'));
  console.log(`[cron] scheduled route refresh: "${SCHEDULE}"`);
}

// Exposed so a manual trigger (endpoint/script) can reuse the overlap guard.
export { runRefresh };
