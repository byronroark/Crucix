// Robust JSON array extraction from LLM responses (markdown fences, prose wrappers, etc.)

const DEFAULT_ARRAY_KEYS = [
  'items', 'ideas', 'analysis', 'intelligence', 'results', 'summaries', 'intel', 'data',
];

/**
 * @param {string} text raw LLM response
 * @param {{ arrayKeys?: string[] }} [opts]
 * @returns {Array|null}
 */
export function extractJsonArray(text, opts = {}) {
  if (!text) return null;
  const arrayKeys = opts.arrayKeys || DEFAULT_ARRAY_KEYS;

  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  const direct = tryParseArray(cleaned, arrayKeys);
  if (direct) return direct;

  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParseArray(fence[1].trim(), arrayKeys);
    if (fenced) return fenced;
  }

  const start = cleaned.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        const slice = tryParseArray(cleaned.slice(start, i + 1), arrayKeys);
        if (slice) return slice;
        return null;
      }
    }
  }
  return null;
}

function tryParseArray(raw, arrayKeys) {
  try {
    const parsed = JSON.parse(raw);
    return coerceToArray(parsed, arrayKeys);
  } catch {
    return null;
  }
}

function coerceToArray(parsed, arrayKeys) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  for (const key of arrayKeys) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  return null;
}
