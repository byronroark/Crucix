// Custom OSINT Sources — config-driven RSS / Firecrawl / HTTP-JSON loader.
//
// Reads config.customSources from crucix.config.mjs and produces a unified
// stream of normalized items. Each source declares a tier:
//   - 'ticker'   -> joins the existing news ticker (light-touch)
//   - 'analyzed' -> kept in V2.customAnalyzed and fed to the Intelligence
//                   Analysis LLM panel (lib/llm/intel-analysis.mjs)
//
// Per-source caching lives at runs/.cache/custom-feeds/<sha>.json with a
// refreshMinutes TTL so Firecrawl on the free tier stays sustainable.
//
// See CUSTOM_SOURCES.md for the full schema and examples.

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeFetch } from '../utils/fetch.mjs';
import config from '../../crucix.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE_DIR = join(ROOT, 'runs', '.cache', 'custom-feeds');

const VALID_TIERS = new Set(['ticker', 'analyzed']);
const FETCH_TIMEOUT_MS = 20_000;
const FIRECRAWL_TIMEOUT_MS = 30_000;

// ─── Public entrypoint ───────────────────────────────────────────────────────

export async function briefing() {
  return collect();
}

export async function collect(opts = {}) {
  const sources = Array.isArray(config.customSources) ? config.customSources : [];
  const ignoreCache = Boolean(opts.ignoreCache);
  const onlyName = opts.onlyName || null;

  if (!sources.length && !onlyName) {
    return {
      source: 'CustomFeeds',
      timestamp: new Date().toISOString(),
      configured: 0,
      itemsTicker: [],
      itemsAnalyzed: [],
      errors: [],
      cache: { hits: 0, misses: 0, firecrawlCalls: 0 },
    };
  }

  ensureCacheDir();

  const itemsTicker = [];
  const itemsAnalyzed = [];
  const errors = [];
  const cacheStats = { hits: 0, misses: 0, firecrawlCalls: 0 };
  const firecrawlLimit = config.firecrawl?.maxCallsPerSweep ?? 5;

  for (const raw of sources) {
    const src = normalizeSource(raw);
    if (onlyName && src.name !== onlyName) continue;
    if (!src) continue;
    if (src._invalid) { errors.push({ name: raw?.name || '?', error: src._invalid }); continue; }

    if (src.type === 'firecrawl' && cacheStats.firecrawlCalls >= firecrawlLimit && !cacheCanServe(src)) {
      errors.push({ name: src.name, error: `Firecrawl per-sweep cap (${firecrawlLimit}) reached; skipping.` });
      continue;
    }

    try {
      const cached = ignoreCache ? null : readCache(src);
      let items;
      if (cached) {
        cacheStats.hits++;
        items = cached.items || [];
      } else {
        cacheStats.misses++;
        items = await fetchSource(src);
        if (src.type === 'firecrawl') cacheStats.firecrawlCalls++;
        writeCache(src, items);
      }
      for (const it of items) {
        const enriched = { ...it, name: src.name, type: src.type, region: it.region || src.region || 'Global', tags: it.tags || src.tags || [] };
        if (src.tier === 'analyzed') itemsAnalyzed.push(enriched);
        else itemsTicker.push(enriched);
      }
    } catch (err) {
      errors.push({ name: src.name, error: err.message });
    }
  }

  return {
    source: 'CustomFeeds',
    timestamp: new Date().toISOString(),
    configured: sources.length,
    itemsTicker,
    itemsAnalyzed,
    errors,
    cache: cacheStats,
  };
}

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeSource(raw) {
  if (!raw || typeof raw !== 'object') return { _invalid: 'not an object' };
  const { type, name, url, tier = 'ticker' } = raw;
  if (!type) return { _invalid: 'missing type' };
  if (!name) return { _invalid: 'missing name' };
  if (!url) return { _invalid: 'missing url' };
  if (!['rss', 'firecrawl', 'http-json'].includes(type)) return { _invalid: `unknown type "${type}"` };
  if (!VALID_TIERS.has(tier)) return { _invalid: `unknown tier "${tier}"` };

  return {
    type,
    name,
    url,
    tier,
    region: raw.region || 'Global',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    refreshMinutes: Number.isFinite(raw.refreshMinutes) ? raw.refreshMinutes : defaultRefresh(type),
    firecrawl: raw.firecrawl || null,
    json: raw.json || null,
    // Map placement (all optional — consumed by lib/geocode/build-custom-geo.mjs)
    lat: Number.isFinite(raw.lat) ? raw.lat : null,
    lon: Number.isFinite(raw.lon) ? raw.lon : null,
    geocodeQuery: raw.geocodeQuery || null,
    geocode: raw.geocode !== false,
    mapMaxItems: Number.isFinite(raw.mapMaxItems) ? raw.mapMaxItems : null,
  };
}

function defaultRefresh(type) {
  if (type === 'firecrawl') return 120;  // expensive — every 2h
  if (type === 'rss') return 30;
  return 15; // http-json
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

async function fetchSource(src) {
  if (src.type === 'rss') return fetchRSS(src);
  if (src.type === 'firecrawl') return fetchFirecrawl(src);
  if (src.type === 'http-json') return fetchHttpJson(src);
  throw new Error(`unsupported type "${src.type}"`);
}

// ─── RSS ─────────────────────────────────────────────────────────────────────

async function fetchRSS(src) {
  const res = await fetch(src.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'Crucix/1.0' } });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  const itemRegex = /<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[0];
    const title = stripTag(block, 'title');
    const link = stripTag(block, 'link') || (block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '');
    const pubDate = stripTag(block, 'pubDate') || stripTag(block, 'published') || stripTag(block, 'updated') || '';
    const description = stripTag(block, 'description') || stripTag(block, 'summary') || stripTag(block, 'content') || '';
    if (!title || title === src.name) continue;
    items.push({
      title: cleanText(title).substring(0, 240),
      url: cleanText(link).substring(0, 500) || undefined,
      timestamp: parseDateSafe(pubDate),
      content: cleanText(description).substring(0, 2000) || undefined,
    });
    if (items.length >= 30) break;
  }
  return items;
}

function stripTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  return (block.match(re)?.[1] || '').trim();
}

function cleanText(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateSafe(s) {
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ─── Firecrawl ───────────────────────────────────────────────────────────────

async function fetchFirecrawl(src) {
  const apiKey = config.firecrawl?.apiKey;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');
  const baseUrl = (config.firecrawl?.baseUrl || 'https://api.firecrawl.dev').replace(/\/$/, '');
  const body = {
    url: src.url,
    formats: src.firecrawl?.formats || ['markdown'],
    onlyMainContent: src.firecrawl?.onlyMainContent !== false,
  };

  const res = await fetch(`${baseUrl}/v1/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firecrawl ${res.status}: ${text.substring(0, 200)}`);
  }
  const data = await res.json();
  const payload = data?.data || data;
  const markdown = payload?.markdown || payload?.content || '';
  const title = payload?.metadata?.title || payload?.metadata?.ogTitle || src.name;
  return [{
    title: cleanText(title).substring(0, 240),
    url: src.url,
    timestamp: new Date().toISOString(),
    content: typeof markdown === 'string' ? markdown.substring(0, 8000) : undefined,
  }];
}

// ─── HTTP-JSON ───────────────────────────────────────────────────────────────

async function fetchHttpJson(src) {
  const data = await safeFetch(src.url, { timeout: FETCH_TIMEOUT_MS, retries: 1 });
  if (data?.error) throw new Error(data.error);

  const cfg = src.json || {};
  const itemsPath = cfg.itemsPath || '';
  const arr = itemsPath ? getPath(data, itemsPath) : data;
  if (!Array.isArray(arr)) {
    throw new Error(`expected array at "${itemsPath || '<root>'}", got ${typeof arr}`);
  }

  const out = [];
  for (const item of arr.slice(0, 30)) {
    const title = getPath(item, cfg.titleField || 'title') || getPath(item, 'headline') || '';
    if (!title) continue;
    const rec = {
      title: cleanText(String(title)).substring(0, 240),
      url: cleanText(String(getPath(item, cfg.urlField || 'url') || '')).substring(0, 500) || undefined,
      timestamp: parseDateSafe(getPath(item, cfg.dateField || 'date') || ''),
      content: cfg.contentField ? cleanText(String(getPath(item, cfg.contentField) || '')).substring(0, 2000) : undefined,
    };
    if (cfg.latField && cfg.lonField) {
      const lat = parseFloat(getPath(item, cfg.latField));
      const lon = parseFloat(getPath(item, cfg.lonField));
      if (Number.isFinite(lat) && Number.isFinite(lon)) { rec.lat = lat; rec.lon = lon; }
    }
    out.push(rec);
  }
  return out;
}

function getPath(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

// ─── Cache ───────────────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(src) {
  return createHash('sha1').update(`${src.name}|${src.url}`).digest('hex').substring(0, 16);
}

function cachePath(src) {
  return join(CACHE_DIR, `${cacheKey(src)}.json`);
}

function readCache(src) {
  const p = cachePath(src);
  if (!existsSync(p)) return null;
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'));
    const ageMs = Date.now() - new Date(json.fetchedAt).getTime();
    if (ageMs > (src.refreshMinutes * 60_000)) return null;
    return json;
  } catch {
    return null;
  }
}

function cacheCanServe(src) {
  return readCache(src) != null;
}

function writeCache(src, items) {
  try {
    writeFileSync(cachePath(src), JSON.stringify({ name: src.name, url: src.url, fetchedAt: new Date().toISOString(), items }, null, 2));
  } catch (err) {
    // Non-fatal — caching is best-effort
    console.error(`[CustomFeeds] cache write failed for ${src.name}:`, err.message);
  }
}
