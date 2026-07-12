// User-managed stock/crypto watchlist — drives extra price tiles + Market Intelligence news.

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../crucix.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const VALID_ASSET_CLASSES = new Set(['stock', 'crypto']);
const MAX_SYMBOLS = 20;

const BUILTIN_MARKET_INTEL_DEFAULTS = [
  { symbol: 'BTC-USD', name: 'Bitcoin', assetClass: 'crypto', aliases: ['Bitcoin', 'BTC'] },
  { symbol: 'XRP-USD', name: 'XRP', assetClass: 'crypto', aliases: ['XRP', 'Ripple'] },
  { symbol: 'XLM-USD', name: 'Stellar', assetClass: 'crypto', aliases: ['Stellar', 'XLM'] },
  { symbol: 'ETH-USD', name: 'Ethereum', assetClass: 'crypto', aliases: ['Ethereum', 'ETH'] },
  { symbol: 'GC=F', name: 'Gold', assetClass: 'commodity', aliases: ['Gold', 'COMEX gold'] },
  { symbol: 'SI=F', name: 'Silver', assetClass: 'commodity', aliases: ['Silver', 'COMEX silver'] },
];

const KNOWN_CRYPTO = new Set([
  'BTC', 'ETH', 'XLM', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK',
  'UNI', 'ATOM', 'LTC', 'BCH', 'ALGO', 'NEAR', 'APT', 'ARB', 'OP',
]);

function userFilePath() {
  const rel = config.marketWatchlistUserFile || 'runs/config/market-watchlist.json';
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  return join(ROOT, rel);
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sanitizeSymbols(symbols) {
  let changed = false;
  const out = [];
  const seen = new Set();
  for (const raw of symbols) {
    let s = raw;
    if (!s || typeof s !== 'object') { changed = true; continue; }
    if (!s._id) { s = { ...s, _id: randomUUID() }; changed = true; }
    if (!s.symbol) { changed = true; continue; }
    const norm = normalizeSymbol(s.symbol, s.assetClass || 'stock', s.quoteCurrency || 'USD');
    if (!norm.symbol) { changed = true; continue; }
    const next = {
      ...s,
      symbol: norm.symbol,
      assetClass: norm.assetClass,
      quoteCurrency: norm.quoteCurrency,
    };
    if (next.symbol !== s.symbol || next.assetClass !== (s.assetClass || 'stock') || next.quoteCurrency !== s.quoteCurrency) {
      s = next;
      changed = true;
    }
    if (isDefaultMarketIntelSymbol(s.symbol)) { changed = true; continue; }
    if (seen.has(s.symbol)) { changed = true; continue; }
    seen.add(s.symbol);
    out.push(s);
  }
  return { symbols: out, changed };
}

function readUserDoc() {
  const path = userFilePath();
  if (!existsSync(path)) return { version: 1, symbols: [] };
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const raw = Array.isArray(doc.symbols) ? doc.symbols : [];
    const { symbols, changed } = sanitizeSymbols(raw);
    const result = { version: doc.version || 1, symbols };
    if (changed) writeUserDoc(result);
    return result;
  } catch {
    return { version: 1, symbols: [] };
  }
}

function writeUserDoc(doc) {
  const path = userFilePath();
  ensureDir(path);
  writeFileSync(path, JSON.stringify({ version: 1, symbols: doc.symbols }, null, 2), 'utf8');
}

/** Validate/normalize a 3-letter fiat quote currency for crypto pairs. */
export function normalizeQuoteCurrency(raw) {
  const currency = String(raw || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: 'quote currency must be a 3-letter code (e.g. USD, EUR)' };
  }
  return { ok: true, currency };
}

/** Split a Yahoo crypto pair like SOL-EUR into base + quote. */
export function parseCryptoPair(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const m = sym.match(/^([A-Z0-9]+)-([A-Z]{3})$/);
  if (!m) return { base: sym, quoteCurrency: 'USD' };
  return { base: m[1], quoteCurrency: m[2] };
}

/** Normalize user input to a Yahoo Finance symbol. */
export function normalizeSymbol(raw, assetClass = 'stock', quoteCurrency = 'USD') {
  let sym = String(raw || '').trim().toUpperCase().replace(/^\$/, '');
  if (!sym) return { symbol: '', assetClass, quoteCurrency: null, base: '' };

  const cls = VALID_ASSET_CLASSES.has(assetClass) ? assetClass : 'stock';
  const ccyResult = normalizeQuoteCurrency(quoteCurrency);
  const quote = ccyResult.ok ? ccyResult.currency : 'USD';

  let base = sym;
  let pairQuote = null;
  if (sym.includes('-') && !sym.includes('=') && !sym.startsWith('^')) {
    const parts = sym.split('-');
    if (parts.length === 2 && /^[A-Z]{3}$/.test(parts[1])) {
      base = parts[0];
      pairQuote = parts[1];
    }
  }

  const looksCrypto = cls === 'crypto' || KNOWN_CRYPTO.has(base) || sym.endsWith('-USD') || Boolean(pairQuote);

  if (looksCrypto && !sym.includes('=') && !sym.startsWith('^')) {
    const resolvedQuote = pairQuote || quote;
    return {
      symbol: `${base}-${resolvedQuote}`,
      assetClass: 'crypto',
      quoteCurrency: resolvedQuote,
      base,
    };
  }

  return { symbol: sym, assetClass: 'stock', quoteCurrency: null, base: sym };
}

/** Built-in Market Intelligence symbols (always monitored for news). */
export function getDefaultMarketIntelSymbols() {
  const defs = Array.isArray(config.marketIntelDefaults) && config.marketIntelDefaults.length
    ? config.marketIntelDefaults
    : BUILTIN_MARKET_INTEL_DEFAULTS;
  return defs.map(d => ({
    id: `default:${d.symbol}`,
    symbol: d.symbol,
    name: d.name || d.symbol,
    assetClass: d.assetClass || 'stock',
    aliases: Array.isArray(d.aliases) ? d.aliases : [],
    isDefault: true,
    editable: false,
  }));
}

export function isDefaultMarketIntelSymbol(symbol) {
  const { symbol: norm } = normalizeSymbol(symbol, 'crypto');
  return getDefaultMarketIntelSymbols().some(d => d.symbol === symbol || d.symbol === norm);
}

/** Defaults + user watchlist (deduped by symbol) for Market Intelligence news/LLM. */
export function loadMarketIntelSymbols() {
  const merged = [...getDefaultMarketIntelSymbols()];
  const seen = new Set(merged.map(d => d.symbol));
  for (const entry of loadWatchlist()) {
    if (seen.has(entry.symbol)) continue;
    merged.push({ ...entry, isDefault: false, editable: true });
    seen.add(entry.symbol);
  }
  return merged;
}

/** @returns {Array<{id, symbol, name, assetClass, aliases, addedAt}>} */
export function loadWatchlist() {
  return readUserDoc().symbols.map(s => ({
    id: s._id,
    symbol: s.symbol,
    name: s.name || s.symbol,
    assetClass: s.assetClass || 'stock',
    quoteCurrency: s.assetClass === 'crypto' ? (s.quoteCurrency || parseCryptoPair(s.symbol).quoteCurrency) : null,
    aliases: Array.isArray(s.aliases) ? s.aliases : [],
    addedAt: s.addedAt || null,
  }));
}

export function listWatchlist() {
  return loadWatchlist().map(s => ({ ...s, editable: true }));
}

export function validateSymbolPayload(raw, { partial = false } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['invalid payload'] };

  const assetClass = raw.assetClass || 'stock';
  const quoteCurrency = raw.quoteCurrency || 'USD';

  if (!partial || raw.symbol !== undefined) {
    const { symbol } = normalizeSymbol(raw.symbol, assetClass, quoteCurrency);
    if (!symbol) errors.push('symbol is required');
    else if (symbol.length > 16) errors.push('symbol too long');
  }

  if (!partial || raw.assetClass !== undefined) {
    if (!VALID_ASSET_CLASSES.has(assetClass)) errors.push('assetClass must be stock or crypto');
  }

  if (assetClass === 'crypto' || raw.quoteCurrency !== undefined) {
    const ccy = normalizeQuoteCurrency(raw.quoteCurrency || 'USD');
    if (!ccy.ok) errors.push(ccy.error);
  }

  let name = raw.name != null ? String(raw.name).trim() : '';
  if (name.length > 80) errors.push('name too long (max 80)');

  let aliases = [];
  if (raw.aliases !== undefined) {
    if (Array.isArray(raw.aliases)) aliases = raw.aliases.map(String).map(s => s.trim()).filter(Boolean).slice(0, 5);
    else if (typeof raw.aliases === 'string') {
      aliases = raw.aliases.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
    }
  }

  if (errors.length) return { ok: false, errors };

  const { symbol, assetClass: cls, quoteCurrency: normQuote } = normalizeSymbol(raw.symbol, assetClass, quoteCurrency);
  return {
    ok: true,
    value: {
      symbol,
      name: name || symbol,
      assetClass: cls,
      quoteCurrency: cls === 'crypto' ? normQuote : null,
      aliases,
    },
  };
}

export function addSymbol(payload) {
  const v = validateSymbolPayload(payload);
  if (!v.ok) return { ok: false, errors: v.errors };

  const doc = readUserDoc();
  if (doc.symbols.length >= MAX_SYMBOLS) {
    return { ok: false, errors: [`watchlist limit reached (max ${MAX_SYMBOLS})`] };
  }
  if (doc.symbols.some(s => s.symbol === v.value.symbol)) {
    return { ok: false, errors: [`${v.value.symbol} is already on the watchlist`] };
  }
  if (isDefaultMarketIntelSymbol(v.value.symbol)) {
    return { ok: false, errors: [`${v.value.symbol} is already a default Macro + Markets / Market Intelligence symbol`] };
  }

  const entry = {
    _id: randomUUID(),
    ...v.value,
    addedAt: new Date().toISOString(),
  };
  doc.symbols.push(entry);
  writeUserDoc(doc);
  return { ok: true, symbol: listWatchlist().find(s => s.id === entry._id) };
}

export function updateSymbol(id, payload) {
  const doc = readUserDoc();
  const idx = doc.symbols.findIndex(s => s._id === id);
  if (idx === -1) return { ok: false, errors: ['symbol not found'] };

  const merged = { ...doc.symbols[idx], ...payload, symbol: payload.symbol ?? doc.symbols[idx].symbol };
  const v = validateSymbolPayload(merged);
  if (!v.ok) return { ok: false, errors: v.errors };

  const clash = doc.symbols.some((s, i) => i !== idx && s.symbol === v.value.symbol);
  if (clash) return { ok: false, errors: [`${v.value.symbol} is already on the watchlist`] };

  doc.symbols[idx] = { _id: id, addedAt: doc.symbols[idx].addedAt, ...v.value };
  writeUserDoc(doc);
  return { ok: true, symbol: listWatchlist().find(s => s.id === id) };
}

export function deleteSymbol(id) {
  const doc = readUserDoc();
  const before = doc.symbols.length;
  doc.symbols = doc.symbols.filter(s => s._id !== id);
  if (doc.symbols.length === before) return { ok: false, errors: ['symbol not found'] };
  writeUserDoc(doc);
  return { ok: true };
}

export function getUserFilePath() {
  return userFilePath();
}
