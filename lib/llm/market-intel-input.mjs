// Market Intelligence — LLM input from watchlist quotes + symbol-scoped news only.

import config from '../../crucix.config.mjs';

export function hasMarketIntelInput(sweepData) {
  const watchlist = sweepData?.markets?.watchlistCount || 0;
  const news = sweepData?.marketNews?.items?.length || 0;
  return watchlist > 0 && news > 0;
}

export function buildMarketIntelContext(sweepData, cfg = config) {
  if (!hasMarketIntelInput(sweepData)) return null;

  const maxChars = cfg.marketIntel?.maxInputChars || 6000;
  const lines = [];

  const tracked = sweepData.markets?.tracked || [];
  if (tracked.length) {
    lines.push('=== WATCHLIST PRICES ===');
    for (const q of tracked) {
      const chg = q.changePct != null ? `${q.changePct >= 0 ? '+' : ''}${q.changePct}%` : 'n/a';
      lines.push(`${q.symbol} (${q.name}): $${q.price} (${chg} today)`);
    }
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
