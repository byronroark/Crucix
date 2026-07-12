// Yahoo Finance — Live market quotes (no API key required)
// Core symbols always fetched; user watchlist symbols fetched additionally.

import { safeFetch } from '../utils/fetch.mjs';
import { loadWatchlist, isDefaultMarketIntelSymbol } from '../../lib/config/market-watchlist-store.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export const DEFAULT_CRYPTO_SYMBOLS = ['BTC-USD', 'XRP-USD', 'XLM-USD', 'ETH-USD'];

// Core macro panel symbols — always on
export const CORE_SYMBOLS = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'Nasdaq Composite',
  '^DJI': 'Dow Jones',
  '^RUT': 'Russell 2000',
  TLT: '20Y+ Treasury',
  HYG: 'High Yield Corp',
  LQD: 'IG Corporate',
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'CL=F': 'WTI Crude',
  'BZ=F': 'Brent Crude',
  'NG=F': 'Natural Gas',
  'BTC-USD': 'Bitcoin',
  'XRP-USD': 'XRP',
  'XLM-USD': 'Stellar',
  'ETH-USD': 'Ethereum',
  '^VIX': 'VIX',
};

function allSymbolLabels() {
  const labels = { ...CORE_SYMBOLS };
  for (const entry of loadWatchlist()) {
    labels[entry.symbol] = entry.name || entry.symbol;
  }
  return labels;
}

export async function fetchQuote(symbol, nameMap = null) {
  const labels = nameMap || allSymbolLabels();
  try {
    const url = `${BASE}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
    const data = await safeFetch(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const timestamps = result.timestamp || [];

    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2];
    const change = price && prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    const history = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        history.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          close: Math.round(closes[i] * 100) / 100,
        });
      }
    }

    return {
      symbol,
      name: labels[symbol] || meta.shortName || symbol,
      price: Math.round(price * 100) / 100,
      prevClose: Math.round((prevClose || 0) * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName || '',
      marketState: meta.marketState || 'UNKNOWN',
      history,
    };
  } catch (e) {
    return { symbol, name: labels[symbol] || symbol, error: e.message };
  }
}

/** Test a symbol before adding to watchlist. */
export async function testSymbol(symbol, assetClass = 'stock', quoteCurrency = 'USD') {
  const { normalizeSymbol } = await import('../../lib/config/market-watchlist-store.mjs');
  const { symbol: sym } = normalizeSymbol(symbol, assetClass, quoteCurrency);
  const q = await fetchQuote(sym, { [sym]: sym });
  if (!q || q.error) return { ok: false, error: q?.error || 'symbol not found' };
  return { ok: true, quote: q };
}

export async function briefing() {
  return collect();
}

export async function collect() {
  const labels = allSymbolLabels();
  const watchlist = loadWatchlist();
  const watchlistSyms = new Set(watchlist.map(w => w.symbol));
  const symbols = Object.keys(labels);

  const results = await Promise.allSettled(
    symbols.map(s => fetchQuote(s, labels))
  );

  const quotes = {};
  let ok = 0;
  let failed = 0;

  for (const r of results) {
    const q = r.status === 'fulfilled' ? r.value : null;
    if (q && !q.error) {
      quotes[q.symbol] = q;
      ok++;
    } else {
      failed++;
      const sym = q?.symbol || 'unknown';
      quotes[sym] = q || { symbol: sym, error: 'fetch failed' };
    }
  }

  const coreSymSet = new Set(Object.keys(CORE_SYMBOLS));
  const tracked = watchlist
    .filter(w => !coreSymSet.has(w.symbol) && !isDefaultMarketIntelSymbol(w.symbol))
    .map(w => quotes[w.symbol])
    .filter(q => q && !q.error);

  return {
    quotes,
    summary: {
      totalSymbols: symbols.length,
      watchlistSymbols: watchlist.length,
      ok,
      failed,
      timestamp: new Date().toISOString(),
    },
    indexes: pickGroup(quotes, ['^GSPC', '^IXIC', '^DJI', '^RUT']),
    rates: pickGroup(quotes, ['TLT', 'HYG', 'LQD']),
    commodities: pickGroup(quotes, ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F']),
    crypto: pickGroup(quotes, DEFAULT_CRYPTO_SYMBOLS),
    volatility: pickGroup(quotes, ['^VIX']),
    tracked,
    watchlistSymbols: [...watchlistSyms],
  };
}

function pickGroup(quotes, symbols) {
  return symbols.map(s => quotes[s]).filter(Boolean);
}
