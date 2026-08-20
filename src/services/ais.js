import dotenv from 'dotenv';

dotenv.config();

const AISSTREAM_KEY = process.env.AISSTREAM_KEY || '';

/**
 * Best-effort AIS enrichment. AISStream.io is a websocket stream (needs a key);
 * for the MVP we treat AIS as optional and simply report availability. If no
 * key is configured we skip cleanly and never block the analyze request.
 *
 * Returns null when unavailable, or a small summary object when it can say
 * something useful. Intentionally kept dependency-free and non-blocking.
 *
 * @returns {Promise<{available:boolean, note:string}|null>}
 */
export async function getAisContext() {
  if (!AISSTREAM_KEY) {
    return { available: false, note: 'AIS not configured (no AISSTREAM_KEY); skipped.' };
  }
  // A full AISStream.io integration is a websocket subscription that would need
  // to run alongside the request. For the MVP we acknowledge the key is present
  // but do not block the response on live vessel positions.
  return {
    available: false,
    note: 'AIS key present; live vessel tracking not wired into the request path for MVP.',
  };
}
