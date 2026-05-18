// Intelligence Analysis — LLM synthesis of user-defined custom OSINT sources.
//
// Separate pipeline from lib/llm/ideas.mjs (which is market-positioning oriented).
// This one summarizes WHAT IS HAPPENING and WHY IT MATTERS based on the items
// flagged tier:'analyzed' in customSources or drop-in modules.

const INTEL_MAX_INPUT_CHARS = 4500;
const INTEL_PER_ITEM_CHARS = 600;

/**
 * Generate Intelligence Analysis from a synthesized sweep that contains
 * customAnalyzed items. Returns null if the LLM is not configured or
 * there is no analyzed input to work with.
 *
 * @param {LLMProvider} provider
 * @param {object} sweepData synthesized V2 (must include customAnalyzed)
 * @returns {Promise<Array|null>}
 */
export async function generateIntelAnalysis(provider, sweepData) {
  if (!provider?.isConfigured) return null;
  const items = Array.isArray(sweepData?.customAnalyzed) ? sweepData.customAnalyzed : [];
  if (!items.length) return null;

  let context;
  try {
    context = compactForIntel(items, sweepData);
  } catch (err) {
    console.error('[Intel Analysis] Failed to compact input:', err.message);
    return null;
  }
  if (!context) return null;

  const systemPrompt = `You are a senior OSINT analyst at an independent intelligence shop. You receive a curated set of raw source items (RSS headlines, scraped pages, JSON feeds) and produce 3-6 standalone intelligence summaries.

Rules:
- Each summary must be supported by at least one cited source from the input
- "Why it matters" should be specific and analytical, not generic
- If two sources reinforce each other, cite both and call out the convergence
- Use the DELTA_SUMMARY block to weight recently changing topics higher
- Be brief; the panel that renders this is compact
- Confidence rubric: HIGH = multiple corroborating sources or hard-data backing; MEDIUM = single solid source; LOW = speculative or rumor-tier

Output ONLY a valid JSON array of objects. Each object:
{
  "title": "Short headline (max 12 words)",
  "summary": "2-4 sentence synthesis combining what happened + why it matters",
  "region": "Global | Americas | Europe | Asia | Middle East | Africa | Custom",
  "confidence": "HIGH | MEDIUM | LOW",
  "tags": ["tag1", "tag2"],
  "sources": ["name from input", ...]
}`;

  try {
    const result = await provider.complete(systemPrompt, context, { maxTokens: 2048, timeout: 60000 });
    const parsed = parseIntelResponse(result.text);
    if (parsed && parsed.length) return parsed;
    console.warn('[Intel Analysis] No valid intel items parsed from response');
    return null;
  } catch (err) {
    console.error('[Intel Analysis] Generation failed:', err.message);
    return null;
  }
}

function compactForIntel(items, sweepData) {
  const sections = [];

  // Top 12 analyzed items, capped to INTEL_MAX_INPUT_CHARS total.
  const sorted = [...items].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  const picked = sorted.slice(0, 12);

  const lines = [];
  let remaining = INTEL_MAX_INPUT_CHARS;
  for (const item of picked) {
    if (remaining <= 0) break;
    const title = (item.title || '').replace(/\s+/g, ' ').trim();
    const content = (item.content || '').replace(/\s+/g, ' ').trim().substring(0, INTEL_PER_ITEM_CHARS);
    const region = item.region || 'Global';
    const tags = Array.isArray(item.tags) && item.tags.length ? ` [${item.tags.join(',')}]` : '';
    const line = `- [${item.name || 'source'} | ${region}${tags}] ${title}\n  ${content}`;
    if (line.length > remaining) {
      lines.push(line.substring(0, Math.max(0, remaining)));
      break;
    }
    lines.push(line);
    remaining -= line.length;
  }
  if (lines.length) sections.push(`ANALYZED_INPUT:\n${lines.join('\n')}`);
  else return null;

  // Light context from the sweep so the LLM can weight novelty
  const delta = sweepData?.delta || sweepData?._delta;
  if (delta?.summary) {
    sections.push(`DELTA_SUMMARY: direction=${delta.summary.direction}, changes=${delta.summary.totalChanges}, critical=${delta.summary.criticalChanges}`);
  }

  const urgent = (sweepData?.tg?.urgent || []).slice(0, 3);
  if (urgent.length) {
    sections.push(`PARALLEL_OSINT (telegram urgent, for cross-correlation only):\n${urgent.map(p => `- ${(p.text || '').substring(0, 160)}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

function parseIntelResponse(text) {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  let arr;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try { arr = JSON.parse(m[0]); } catch { return null; }
  }
  if (!Array.isArray(arr)) return null;

  return arr
    .filter(it => it && it.title && it.summary)
    .map(it => ({
      title: String(it.title).substring(0, 180),
      summary: String(it.summary).substring(0, 800),
      region: it.region || 'Global',
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(String(it.confidence).toUpperCase())
        ? String(it.confidence).toUpperCase()
        : 'MEDIUM',
      tags: Array.isArray(it.tags) ? it.tags.slice(0, 6).map(String) : [],
      sources: Array.isArray(it.sources) ? it.sources.slice(0, 8).map(String) : [],
      timestamp: new Date().toISOString(),
    }));
}
