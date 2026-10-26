// Intelligence Analysis — LLM synthesis from multi-pool OSINT inputs.
//
// Separate pipeline from lib/llm/ideas.mjs (market-positioning oriented).
// Harvests GDELT, Telegram, WHO, ACLED, delta, and other rich-text V2 pools
// via lib/llm/intel-input.mjs. Optional tier:'analyzed' custom RSS adds more.

import { buildIntelContext, hasIntelInput } from './intel-input.mjs';
import { extractJsonArray } from './parse-json-array.mjs';
import { completeJsonWithRetry } from './complete-json.mjs';

const INTEL_SCHEMA_HINT = '{"summaries":[{"title":"string","summary":"string","region":"string","confidence":"HIGH|MEDIUM|LOW","tags":["string"],"sources":["string"]}]}';

/**
 * @param {LLMProvider} provider
 * @param {object} sweepData synthesized V2
 * @param {object} [config] crucix config (intelAnalysis pools / caps)
 * @returns {Promise<{ items: Array|null, error: { reason: string, message: string }|null, retried?: boolean }>}
 */
export async function generateIntelAnalysis(provider, sweepData, config = {}) {
  if (!provider?.isConfigured) {
    return { items: null, error: { reason: 'disabled', message: 'LLM not configured' } };
  }
  if (!hasIntelInput(sweepData, config)) {
    return { items: null, error: { reason: 'no-input', message: 'Insufficient OSINT pools for intel analysis' } };
  }

  let context;
  try {
    context = buildIntelContext(sweepData, config);
  } catch (err) {
    console.error('[Intel Analysis] Failed to compact input:', err.message);
    return { items: null, error: { reason: 'api', message: `compact failed: ${err.message}` } };
  }
  if (!context) {
    return { items: null, error: { reason: 'no-input', message: 'Empty intel context after harvest' } };
  }

  const systemPrompt = `You are a senior OSINT analyst at an independent intelligence shop. You receive curated raw items from multiple intelligence pools (GDELT, Telegram, WHO, ACLED, humanitarian reports, cyber alerts, sanctions data, social OSINT, and optional custom RSS) and produce 3-6 standalone intelligence summaries.

Rules:
- Draw from AT LEAST 3 different source pools in the input — do not rely on a single pool
- Prefer geopolitical, humanitarian, cyber, sanctions, conflict, and convergence stories over routine domestic politics
- Each summary must cite at least one source pool label from the input (e.g. GDELT, ReliefWeb, CISA-KEV, Telegram)
- If two pools reinforce each other, cite both and call out the convergence
- Use DELTA_SUMMARY to weight recently changing topics higher
- Be brief; the panel that renders this is compact
- Confidence rubric: HIGH = multiple corroborating pools or hard-data backing; MEDIUM = single solid source; LOW = speculative or rumor-tier

Output ONLY a valid JSON object with a "summaries" array. No markdown fences, no prose outside JSON. Each array element:
{
  "title": "Short headline (max 12 words)",
  "summary": "2-4 sentence synthesis combining what happened + why it matters",
  "region": "Global | Americas | Europe | Asia | Middle East | Africa | Custom",
  "confidence": "HIGH | MEDIUM | LOW",
  "tags": ["tag1", "tag2"],
  "sources": ["pool label from input", ...]
}`;

  // Raised from 2048 — truncated intel JSON was a common parse-failure mode
  const result = await completeJsonWithRetry(provider, {
    systemPrompt,
    userMessage: context,
    parse: parseIntelResponse,
    schemaHint: INTEL_SCHEMA_HINT,
    maxTokens: 4096,
    timeout: 60000,
    logLabel: 'Intel Analysis',
  });

  if (result.items?.length) {
    return { items: result.items, error: null, retried: result.retried };
  }

  return {
    items: null,
    error: result.error || { reason: 'parse', message: 'No valid intel items parsed from response' },
    retried: result.retried,
  };
}

export { hasIntelInput, buildIntelContext, harvestIntelItems } from './intel-input.mjs';

function parseIntelResponse(text) {
  const arr = extractJsonArray(text, { debugLabel: 'intel' });
  if (!Array.isArray(arr)) return null;

  const normalized = arr.map(normalizeIntelItem).filter(it => it && it.title && it.summary);
  return normalized.length ? normalized : null;
}

function normalizeIntelItem(it) {
  if (!it || typeof it !== 'object') return null;
  let title = it.title || it.headline || it.name || '';
  let summary = it.summary || it.analysis || it.text || it.body || it.description || '';
  if (!summary && title) summary = title;
  if (!title && summary) title = String(summary).split(/[.!?]/)[0].trim().substring(0, 120);
  if (!title || !summary) return null;
  return {
    title: String(title).substring(0, 180),
    summary: String(summary).substring(0, 800),
    region: it.region || 'Global',
    confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(String(it.confidence || '').toUpperCase())
      ? String(it.confidence).toUpperCase()
      : 'MEDIUM',
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 6).map(String) : [],
    sources: Array.isArray(it.sources) ? it.sources.slice(0, 8).map(String)
      : (it.source ? [String(it.source)] : []),
    timestamp: new Date().toISOString(),
  };
}
