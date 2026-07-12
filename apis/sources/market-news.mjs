// Symbol-scoped market news via GDELT — defaults + user watchlist.

import { searchEvents } from './gdelt.mjs';
import { loadMarketIntelSymbols } from '../../lib/config/market-watchlist-store.mjs';
import config from '../../crucix.config.mjs';

const BATCH_SIZE = 5;
const GDELT_DELAY_MS = 5500;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function compactArticle(a, symbol) {
  return {
    symbol,
    title: a.title,
    url: a.url,
    date: a.seendate,
    domain: a.domain,
    language: a.language,
    source: a.domain || 'GDELT',
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatchers(entry) {
  const matchers = [];
  const sym = entry.symbol.replace(/-USD$/, '');
  matchers.push(new RegExp(`\\b${escapeRegex(sym)}\\b`, 'i'));
  if (entry.symbol !== sym) {
    matchers.push(new RegExp(`\\b${escapeRegex(entry.symbol)}\\b`, 'i'));
  }
  for (const alias of entry.aliases || []) {
    if (alias.length >= 3) matchers.push(new RegExp(escapeRegex(alias), 'i'));
  }
  if (entry.name && entry.name.length >= 3 && entry.name !== entry.symbol) {
    matchers.push(new RegExp(escapeRegex(entry.name), 'i'));
  }
  return matchers;
}

function matchesEntry(text, entry) {
  if (!text) return false;
  return buildMatchers(entry).some(re => re.test(text));
}

function buildGdeltQuery(batch) {
  const parts = batch.map(entry => {
    const terms = [entry.symbol.replace(/-USD$/, '')];
    if (entry.name && entry.name !== entry.symbol) terms.push(`"${entry.name}"`);
    for (const alias of (entry.aliases || []).slice(0, 2)) {
      if (alias.length >= 3) terms.push(`"${alias}"`);
    }
    return `(${terms.join(' OR ')})`;
  });
  return parts.join(' OR ');
}

function assignSymbol(article, batch) {
  const text = `${article.title || ''} ${article.url || ''}`;
  for (const entry of batch) {
    if (matchesEntry(text, entry)) return entry.symbol;
  }
  return batch[0]?.symbol || null;
}

export async function collect() {
  const watchlist = loadMarketIntelSymbols();
  if (!watchlist.length) {
    return { items: [], bySymbol: {}, symbols: [], timestamp: new Date().toISOString() };
  }

  const mc = config.marketIntel || {};
  const timespan = mc.gdeltTimespan || '48h';
  const maxPerSymbol = mc.maxHeadlinesPerSymbol || 8;
  const maxTotal = mc.maxHeadlinesTotal || 40;

  const items = [];
  const bySymbol = {};
  for (const entry of watchlist) bySymbol[entry.symbol] = [];

  for (let i = 0; i < watchlist.length; i += BATCH_SIZE) {
    if (i > 0) await delay(GDELT_DELAY_MS);

    const batch = watchlist.slice(i, i + BATCH_SIZE);
    const query = buildGdeltQuery(batch);

    try {
      const data = await searchEvents(query, { maxRecords: 50, timespan });
      const articles = data?.articles || [];

      for (const a of articles) {
        const sym = assignSymbol(a, batch);
        if (!sym || !matchesEntry(a.title, batch.find(e => e.symbol === sym))) continue;
        if ((bySymbol[sym] || []).length >= maxPerSymbol) continue;
        if (items.length >= maxTotal) break;

        const compact = compactArticle(a, sym);
        const dupe = items.some(x => x.title === compact.title);
        if (dupe) continue;

        items.push(compact);
        bySymbol[sym].push(compact);
      }
    } catch (err) {
      console.error('[MarketNews] GDELT batch failed:', err.message);
    }

    if (items.length >= maxTotal) break;
  }

  return {
    items,
    bySymbol,
    symbols: watchlist.map(w => w.symbol),
    timestamp: new Date().toISOString(),
  };
}

export async function briefing() {
  return collect();
}
