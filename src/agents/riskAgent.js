import { chat } from './ollamaClient.js';

const SYSTEM = `You are a supply-chain risk analyst. Given a shipment route and live/curated data, assess risk across exactly four categories: weather, geopolitical, port, export_ban.
Respond with ONLY a single JSON object, no prose, matching this shape:
{
  "overall_risk": "low" | "medium" | "high",
  "overall_score": <integer 0-100>,
  "categories": {
    "weather":      { "score": <0-100>, "flag": "<short label>", "why": "<one sentence>" },
    "geopolitical": { "score": <0-100>, "flag": "<short label>", "why": "<one sentence>" },
    "port":         { "score": <0-100>, "flag": "<short label>", "why": "<one sentence>" },
    "export_ban":   { "score": <0-100>, "flag": "<short label>", "why": "<one sentence>" }
  },
  "summary": "<2-3 sentence overall assessment>"
}
Base scores on the evidence provided. If no evidence exists for a category, give it a low score and say so. Higher score = higher risk.`;

const CATEGORIES = ['weather', 'geopolitical', 'port', 'export_ban'];

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeCategory(c) {
  const obj = c && typeof c === 'object' ? c : {};
  return {
    score: clampScore(obj.score),
    flag: typeof obj.flag === 'string' ? obj.flag : 'unknown',
    why: typeof obj.why === 'string' ? obj.why : 'No specific evidence.',
  };
}

function riskFromScore(score) {
  if (score >= 66) return 'high';
  if (score >= 33) return 'medium';
  return 'low';
}

/** Validate/repair the model output into a guaranteed-shaped risk report. */
function normalizeReport(raw) {
  const categories = {};
  for (const key of CATEGORIES) {
    categories[key] = normalizeCategory(raw?.categories?.[key]);
  }

  let overallScore = clampScore(raw?.overall_score);
  if (!raw?.overall_score) {
    // derive from category max if the model omitted it
    overallScore = Math.max(...CATEGORIES.map((k) => categories[k].score));
  }

  let overallRisk = raw?.overall_risk;
  if (!['low', 'medium', 'high'].includes(overallRisk)) {
    overallRisk = riskFromScore(overallScore);
  }

  return {
    overall_risk: overallRisk,
    overall_score: overallScore,
    categories,
    summary:
      typeof raw?.summary === 'string' && raw.summary.trim()
        ? raw.summary
        : 'Risk assessment generated from available evidence.',
  };
}

/**
 * Run the Risk Agent: one Ollama call over all gathered context.
 *
 * @param {{shipment:object, weather:object, feeds:Array, ais:object|null}} ctx
 * @returns {Promise<object>} normalized risk report
 */
export async function assessRisk(ctx) {
  const { shipment, weather, feeds, news, ais } = ctx;

  const byCat = (cat) => feeds.filter((f) => f.category === cat);
  const fmt = (arr) =>
    arr.length
      ? arr.map((f) => `- [${f.severity}] ${f.title}: ${f.summary}`).join('\n')
      : '- none found';

  const newsArticles = news?.articles || [];
  const newsBlock = newsArticles.length
    ? newsArticles.map((a) => `- (${a.domain}) ${a.title}`).join('\n')
    : '- no recent relevant headlines';

  const userMsg = `SHIPMENT
Origin: ${shipment.origin}
Destination: ${shipment.dest}
Cargo: ${shipment.cargo}
Budget (USD): ${shipment.budget ?? 'unspecified'}

WEATHER (live, Open-Meteo)
${weather.summary}

GEOPOLITICAL INCIDENTS (curated)
${fmt(byCat('geopolitical'))}

PORT INCIDENTS (curated)
${fmt(byCat('port'))}

EXPORT-BAN / SANCTIONS (curated)
${fmt(byCat('export_ban'))}

LIVE WORLD NEWS (last 14 days, GDELT — use to inform geopolitical/port/export_ban scores)
${newsBlock}

AIS
${ais?.note ?? 'not available'}

Assess the four risk categories and overall risk. Respond with ONLY the JSON object.`;

  let raw;
  try {
    raw = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
      { json: true }
    );
  } catch (err) {
    // Safe fallback so the endpoint still returns something usable.
    console.error('[riskAgent] LLM failed, using fallback:', err.message);
    return normalizeReport({
      overall_risk: 'medium',
      overall_score: 40,
      summary: `Risk model unavailable (${err.message}); showing a neutral estimate.`,
      categories: {},
    });
  }

  return normalizeReport(raw);
}
