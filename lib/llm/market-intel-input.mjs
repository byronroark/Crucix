// Market Intelligence — LLM input from default + watchlist quotes and symbol-scoped news.

import config from '../../crucix.config.mjs';

export function hasMarketIntelInput(sweepData) {
  const news = sweepData?.marketNews?.items?.length || 0;
  return news > 0;
}

function quoteLines(sweepData) {
  const quotes = sweepData.markets?.quotes || {};
  const symbols = sweepData.marketNews?.symbols || [];
  const lines = [];
  for (const sym of symbols) {
    const q = quotes[sym];
    if (!q || q.error || q.price == null) continue;
    const chg = q.changePct != null ? `${q.changePct >= 0 ? '+' : ''}${q.changePct}%` : 'n/a';
    lines.push(`${sym} (${q.name || sym}): $${q.price} (${chg} today)`);
  }
  const tracked = sweepData.markets?.tracked || [];
  for (const q of tracked) {
    if (symbols.includes(q.symbol)) continue;
    if (q.price == null) continue;
    const chg = q.changePct != null ? `${q.changePct >= 0 ? '+' : ''}${q.changePct}%` : 'n/a';
    lines.push(`${q.symbol} (${q.name || q.symbol}): $${q.price} (${chg} today)`);
  }
  return lines;
}

export function buildMarketIntelContext(sweepData, cfg = config) {
  if (!hasMarketIntelInput(sweepData)) return null;

  const maxChars = cfg.marketIntel?.maxInputChars || 6000;
  const lines = [];

  const prices = quoteLines(sweepData);
  if (prices.length) {
    lines.push('=== TRACKED PRICES (defaults + watchlist) ===');
    lines.push(...prices);
  }

  const bySymbol = sweepData.marketNews?.bySymbol || {};
  lines.push('\n=== SYMBOL-SCOPED HEADLINES ===');
  for (const [sym, items] of Object.entries(bySymbol)) {
    if (!items?.length) continue;
    lines.push(`\n[${sym}]`);
    for (const it of items.slice(0, 6)) {
      lines.push(`- ${it.title} (${it.source || it.domain || 'news'}, ${it.date || ''})`);
    }
  }

  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n...[truncated]';
  return text;
}
