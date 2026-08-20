import { chat } from './ollamaClient.js';

const SYSTEM = `You are a maritime routing advisor. Given a shipment and a risk assessment, propose 1-2 alternate shipping routes that reduce the flagged risks.
Respond with ONLY a single JSON object of this shape:
{
  "alternates": [
    {
      "name": "<short route name, e.g. 'Cape of Good Hope routing'>",
      "waypoints": ["<port or region>", "..."],
      "rationale": "<one sentence: which risk it avoids and the trade-off>"
    }
  ]
}
Use real, well-known ports/regions as waypoints. Keep to at most 2 alternates.`;

function normalizeAlternates(raw) {
  const arr = Array.isArray(raw?.alternates) ? raw.alternates : [];
  return arr
    .slice(0, 2)
    .map((a) => ({
      name: typeof a?.name === 'string' && a.name.trim() ? a.name : 'Alternate route',
      waypoints: Array.isArray(a?.waypoints)
        ? a.waypoints.filter((w) => typeof w === 'string')
        : [],
      rationale: typeof a?.rationale === 'string' ? a.rationale : null,
    }))
    .filter((a) => a.waypoints.length > 0 || a.name !== 'Alternate route');
}

/**
 * Run the Route Agent. Only meaningful when overall risk is high.
 *
 * @param {{shipment:object, risk:object}} ctx
 * @returns {Promise<Array<{name, waypoints, rationale}>>}
 */
export async function suggestAlternates(ctx) {
  const { shipment, risk } = ctx;

  const flags = Object.entries(risk.categories)
    .map(([cat, c]) => `${cat}: ${c.flag} (${c.score})`)
    .join(', ');

  const userMsg = `SHIPMENT
Origin: ${shipment.origin}
Destination: ${shipment.dest}
Cargo: ${shipment.cargo}

RISK ASSESSMENT
Overall: ${risk.overall_risk} (${risk.overall_score}/100)
Category flags: ${flags}
Summary: ${risk.summary}

Propose 1-2 alternate routes that reduce the highest risks. Respond with ONLY the JSON object.`;

  try {
    const raw = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
      { json: true }
    );
    return normalizeAlternates(raw);
  } catch (err) {
    console.error('[routeAgent] LLM failed:', err.message);
    return [];
  }
}
