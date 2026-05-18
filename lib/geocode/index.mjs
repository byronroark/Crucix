// Cascading geocoding resolver for custom OSINT sources.
//
// Resolution order (first hit wins):
//   1. Explicit per-item lat/lon
//   2. Source-level lat/lon
//   3. Headline keyword match (geoTagText)
//   4. RSS_SOURCE_FALLBACKS[sourceName] or REGION_CENTERS[region]
//   5. External provider (Google if key set, else Nominatim)
//
// External calls are budgeted per-sweep and disk-cached. The resolver
// returns null if every step fails — caller should drop the item from
// the map (it will still appear in ticker / Intel panel).

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../crucix.config.mjs';
import { geoTagText, regionCenter, RSS_SOURCE_FALLBACKS } from './keywords.mjs';
import { geocodeGoogle } from './providers/google.mjs';
import { geocodeNominatim } from './providers/nominatim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE_DIR = join(ROOT, 'runs', '.cache', 'geocode');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

let memCache = null;

function loadMemCache() {
  if (memCache) return memCache;
  memCache = new Map();
  if (!existsSync(CACHE_DIR)) return memCache;
  return memCache;
}

function cacheKey(query) {
  return createHash('sha1').update(query.trim().toLowerCase()).digest('hex').substring(0, 16);
}

function cachePath(query) {
  return join(CACHE_DIR, `${cacheKey(query)}.json`);
}

function readCache(query) {
  const mem = loadMemCache();
  if (mem.has(query)) return mem.get(query);
  const p = cachePath(query);
  if (!existsSync(p)) return null;
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'));
    const ttl = json.lat == null ? NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS;
    const ageMs = Date.now() - new Date(json.resolvedAt).getTime();
    if (ageMs > ttl) return null;
    mem.set(query, json);
    return json;
  } catch {
    return null;
  }
}

function writeCacheEntry(query, entry) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    const payload = { query, ...entry, resolvedAt: new Date().toISOString() };
    writeFileSync(cachePath(query), JSON.stringify(payload, null, 2));
    loadMemCache().set(query, payload);
  } catch (err) {
    console.error('[geocode] cache write failed:', err.message);
  }
}

/**
 * Look up coordinates for an arbitrary free-text query via the configured
 * external provider, with disk caching. Returns null on miss.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {boolean} [opts.ignoreCache=false]
 * @returns {Promise<{lat:number, lon:number, provider:string, formatted?:string}|null>}
 */
export async function geocodeQuery(query, opts = {}) {
  if (!query || !query.trim()) return null;
  const q = query.trim().slice(0, 200);

  if (!opts.ignoreCache) {
    const cached = readCache(q);
    if (cached) {
      if (cached.lat == null) return null;
      return { lat: cached.lat, lon: cached.lon, provider: cached.provider, formatted: cached.formatted };
    }
  }

  const googleKey = config.geocode?.apiKey;
  let hit = null;
  let provider = null;
  try {
    if (googleKey) {
      hit = await geocodeGoogle(q, googleKey);
      provider = 'google';
    } else {
      hit = await geocodeNominatim(q);
      provider = 'nominatim';
    }
  } catch (err) {
    console.error(`[geocode] ${provider || 'external'} lookup failed for "${q}":`, err.message);
    // Negative cache only on definitive miss (null), not on transient errors.
    return null;
  }

  if (!hit) {
    writeCacheEntry(q, { lat: null, lon: null, provider });
    return null;
  }
  const entry = { lat: hit.lat, lon: hit.lon, provider, formatted: hit.formatted };
  writeCacheEntry(q, entry);
  return entry;
}

/**
 * Resolve coordinates for a single custom item using the full cascade.
 *
 * @param {object} ctx
 * @param {object} ctx.item   normalized custom item: { title, source, region?, lat?, lon?, ... }
 * @param {object} ctx.source normalized source config: { name, region?, lat?, lon?, geocodeQuery?, geocode? }
 * @param {object} [ctx.budget] { remaining: number } — decremented when an external call is made
 * @returns {Promise<{lat:number, lon:number, region:string, method:string}|null>}
 */
export async function resolveCoords({ item, source, budget }) {
  // 1. Explicit per-item coordinates
  if (isFiniteCoord(item?.lat, item?.lon)) {
    return { lat: item.lat, lon: item.lon, region: item.region || source?.region || 'Custom', method: 'item-explicit' };
  }
  // 2. Source-level coordinates
  if (isFiniteCoord(source?.lat, source?.lon)) {
    return { lat: source.lat, lon: source.lon, region: source.region || 'Custom', method: 'source-explicit' };
  }
  // 3. Headline keyword match
  const kw = geoTagText(item?.title || '');
  if (kw) {
    return { ...kw, method: 'keyword' };
  }
  // 4. Source-name fallback or coarse region center
  const srcFallback = RSS_SOURCE_FALLBACKS[source?.name];
  if (srcFallback) {
    return { ...srcFallback, method: 'source-fallback' };
  }
  const rc = regionCenter(source?.region);
  if (rc) {
    return { ...rc, method: 'region-center' };
  }
  // 5. External provider (budget-aware)
  if (source?.geocode === false) return null;
  if (budget && budget.remaining <= 0) return null;
  const query = (source?.geocodeQuery || item?.title || '').toString().slice(0, 160);
  if (!query) return null;
  const wasCached = readCache(query) != null;
  const hit = await geocodeQuery(query);
  if (!wasCached && budget) budget.remaining -= 1;
  if (!hit) return null;
  return { lat: hit.lat, lon: hit.lon, region: source?.region || 'Custom', method: hit.provider };
}

function isFiniteCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function ensureGeocodeCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export const GEOCODE_CACHE_DIR = CACHE_DIR;
