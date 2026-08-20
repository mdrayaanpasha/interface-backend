import dotenv from 'dotenv';

dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder-16k:latest';
const TIMEOUT_MS = 150_000; // generous for cold model loads

/**
 * Call Ollama /api/chat. When json=true, forces JSON output and parses it.
 * Retries the parse once with a stricter reminder, then throws.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {{ json?: boolean, temperature?: number }} [opts]
 * @returns {Promise<any>} parsed object (json:true) or raw string
 */
export async function chat(messages, opts = {}) {
  const { json = false, temperature = 0.2 } = opts;

  const raw = await callOllama(messages, { json, temperature });
  if (!json) return raw;

  try {
    return JSON.parse(raw);
  } catch {
    // Retry once, nudging the model to emit strictly valid JSON.
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content:
          'That was not valid JSON. Respond again with ONLY a single valid JSON object, no prose, no markdown fences.',
      },
    ];
    const retry = await callOllama(retryMessages, { json, temperature });
    return JSON.parse(retry); // let it throw to the caller if still bad
  }
}

async function callOllama(messages, { json, temperature }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        ...(json ? { format: 'json' } : {}),
        options: { temperature },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data?.message?.content ?? '';
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
