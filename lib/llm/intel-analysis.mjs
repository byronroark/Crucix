// Intelligence Analysis — LLM synthesis from multi-pool OSINT inputs.
//
// Separate pipeline from lib/llm/ideas.mjs (market-positioning oriented).
// Harvests GDELT, Telegram, WHO, ACLED, delta, and other rich-text V2 pools
// via lib/llm/intel-input.mjs. Optional tier:'analyzed' custom RSS adds more.

import { buildIntelContext, hasIntelInput } from './intel-input.mjs';
import { extractJsonArray } from './parse-json-array.mjs';

/**
 * @param {LLMProvider} provider
 * @param {object} sweepData synthesized V2
 * @param {object} [config] crucix config (intelAnalysis pools / caps)
 * @returns {Promise<Array|null>}
 */
export async function generateIntelAnalysis(provider, sweepData, config = {}) {
  if (!provider?.isConfigured) return null;
  if (!hasIntelInput(sweepData, config)) return null;

  let context;
  try {
    context = buildIntelContext(sweepData, config);
  } catch (err) {
    console.error('[Intel Analysis] Failed to compact input:', err.message);
    return null;
  }
  if (!context) return null;

  const systemPrompt = `You are a senior OSINT analyst at an independent intelligence shop. You receive curated raw items from multiple intelligence pools (GDELT, Telegram, WHO, ACLED, humanitarian reports, cyber alerts, sanctions data, social OSINT, and optional custom RSS) and produce 3-6 standalone intelligence summaries.

Rules:
- Draw from AT LEAST 3 different source pools in the input — do not rely on a single pool
- Prefer geopolitical, humanitarian, cyber, sanctions, conflict, and convergence stories over routine domestic politics
- Each summary must cite at least one source pool label from the input (e.g. GDELT, ReliefWeb, CISA-KEV, Telegram)
- If two pools reinforce each other, cite both and call out the convergence
- Use DELTA_SUMMARY to weight recently changing topics higher
- Be brief; the panel that renders this is compact
- Confidence rubric: HIGH = multiple corroborating pools or hard-data backing; MEDIUM = single solid source; LOW = speculative or rumor-tier

Output ONLY a valid JSON array of objects. Each object:
{
  "title": "Short headline (max 12 words)",
  "summary": "2-4 sentence synthesis combining what happened + why it matters",
  "region": "Global | Americas | Europe | Asia | Middle East | Africa | Custom",
  "confidence": "HIGH | MEDIUM | LOW",
  "tags": ["tag1", "tag2"],
  "sources": ["pool label from input", ...]
}`;

  try {
    const result = await provider.complete(systemPrompt, context, { maxTokens: 2048, timeout: 60000 });
    const parsed = parseIntelResponse(result.text);
    if (parsed && parsed.length) return parsed;
    const preview = (result.text || '').replace(/\s+/g, ' ').substring(0, 240);
    console.warn('[Intel Analysis] No valid intel items parsed from response'
      + (preview ? ` — preview: ${preview}...` : ' — empty response text'));
    return null;
  } catch (err) {
    console.error('[Intel Analysis] Generation failed:', err.message);
    return null;
  }
}

export { hasIntelInput, buildIntelContext, harvestIntelItems } from './intel-input.mjs';

function parseIntelResponse(text) {
  const arr = extractJsonArray(text);
  if (!Array.isArray(arr)) return null;

  return arr
    .map(normalizeIntelItem)
    .filter(it => it && it.title && it.summary);
}

function normalizeIntelItem(it) {
  if (!it || typeof it !== 'object') return null;
  const title = it.title || it.headline || it.name || '';
  const summary = it.summary || it.analysis || it.text || it.body || it.description || '';
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
