// Market Intelligence — LLM synthesis scoped to user watchlist symbols only.

import { buildMarketIntelContext, hasMarketIntelInput } from './market-intel-input.mjs';
import { extractJsonArray } from './parse-json-array.mjs';

export async function generateMarketIntel(provider, sweepData, config = {}) {
  if (!provider?.isConfigured) return null;
  if (!hasMarketIntelInput(sweepData)) return null;

  const context = buildMarketIntelContext(sweepData, config);
  if (!context) return null;

  const symbols = (sweepData.markets?.tracked || []).map(q => q.symbol).join(', ');

  const systemPrompt = `You are a market intelligence analyst. You receive live prices and recent news headlines for a user-defined watchlist ONLY: ${symbols}.

Rules:
- Discuss ONLY symbols in the watchlist input — ignore general macro or unrelated tickers
- Synthesize 2-4 brief intelligence items connecting price action to headlines where possible
- Flag earnings, regulatory, product, or sector catalysts when visible in headlines
- Be concise; the dashboard panel is compact
- Confidence: HIGH = multiple corroborating headlines or clear catalyst; MEDIUM = single solid source; LOW = speculative

Output ONLY a valid JSON object with a "summaries" array. No markdown fences. Each element:
{
  "title": "Short headline (max 12 words)",
  "summary": "2-3 sentences on what matters for the symbol(s)",
  "symbols": ["TICKER"],
  "confidence": "HIGH | MEDIUM | LOW",
  "tags": ["earnings", "regulatory", etc.]
}`;

  try {
    const result = await provider.complete(systemPrompt, context, { maxTokens: 1536, timeout: 45000 });
    const arr = extractJsonArray(result.text, { debugLabel: 'market-intel' });
    if (!Array.isArray(arr)) return null;

    const normalized = arr.map(normalizeItem).filter(it => it && it.title && it.summary);
    return normalized.length ? normalized : null;
  } catch (err) {
    console.error('[Market Intel] Generation failed:', err.message);
    return null;
  }
}

export { hasMarketIntelInput, buildMarketIntelContext } from './market-intel-input.mjs';

function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const title = String(it.title || it.headline || '').trim();
  const summary = String(it.summary || it.analysis || it.text || '').trim();
  if (!title || !summary) return null;

  let symbols = [];
  if (Array.isArray(it.symbols)) symbols = it.symbols.map(String);
  else if (it.symbol) symbols = [String(it.symbol)];

  let tags = [];
  if (Array.isArray(it.tags)) tags = it.tags.map(String).slice(0, 5);

  const confidence = ['HIGH', 'MEDIUM', 'LOW'].includes(String(it.confidence).toUpperCase())
    ? String(it.confidence).toUpperCase()
    : 'MEDIUM';

  return { title, summary, symbols, confidence, tags };
}
