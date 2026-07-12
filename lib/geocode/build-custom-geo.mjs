// Synthesize map-ready geo points for the custom OSINT pipeline.
//
// Takes the already-collected custom items (ticker + analyzed) plus the
// raw customSources config, resolves coordinates for each via the
// geocoding cascade, applies per-source caps and jitter, and returns
// objects shaped like D.news so the dashboard can render them directly.

import { resolveCoords } from './index.mjs';

const SWEEP_GEOCODE_BUDGET = 10; // max external API calls per synthesize
const DEFAULT_MAP_MAX = 15;
const JITTER_DEG = 0.3;

/** Normalize headline for cross-source dedupe. */
export function normalizeHeadline(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Fold geocoded rows with the same headline into one map point + sources[]. */
export function foldCustomGeoByHeadline(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeHeadline(row.title);
    if (!key) continue;
    const entry = {
      name: row.source || 'Custom',
      url: row.url,
      date: row.date,
    };
    if (!map.has(key)) {
      map.set(key, {
        ...row,
        sources: [entry],
        _mergeCount: 1,
      });
      continue;
    }
    const existing = map.get(key);
    const seenNames = new Set(existing.sources.map(s => s.name));
    if (!seenNames.has(entry.name)) existing.sources.push(entry);
    const prevCount = existing._mergeCount || 1;
    const nextCount = prevCount + 1;
    existing.lat = (existing.lat * prevCount + row.lat) / nextCount;
    existing.lon = (existing.lon * prevCount + row.lon) / nextCount;
    existing._mergeCount = nextCount;
    if (new Date(row.date) > new Date(existing.date)) {
      existing.date = row.date;
      existing.source = row.source;
      existing.url = row.url;
      existing.title = row.title;
    }
  }
  return [...map.values()].map(({ _mergeCount, ...row }) => row);
}

/**
 * @param {Array} items   merged customTicker + customAnalyzed
 * @param {Array} sources raw config.customSources
 * @returns {Promise<Array>} list of { title, source, sources?, url, date, lat, lon, region, tier, method }
 */
export async function buildCustomGeo(items, sources) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const sourcesByName = new Map();
  for (const s of (sources || [])) {
    if (s?.name) sourcesByName.set(s.name, s);
  }

  // Newest first so per-source caps keep the freshest items.
  const sorted = [...items].sort((a, b) =>
    new Date(b.timestamp || b.date || 0) - new Date(a.timestamp || a.date || 0)
  );

  // Dedupe identical headlines per source.
  const seen = new Set();
  const deduped = [];
  for (const it of sorted) {
    const key = `${it.source || it.name || '?'}|${(it.title || '').slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  const budget = { remaining: SWEEP_GEOCODE_BUDGET };
  const perSourceCount = new Map();
  const out = [];

  for (const it of deduped) {
    const sourceName = it.source || it.name;
    const src = sourcesByName.get(sourceName) || { name: sourceName, region: it.region };
    const maxForSource = Number.isFinite(src.mapMaxItems) ? src.mapMaxItems : DEFAULT_MAP_MAX;
    const used = perSourceCount.get(sourceName) || 0;
    if (used >= maxForSource) continue;

    let coords;
    try {
      coords = await resolveCoords({ item: it, source: src, budget });
    } catch (err) {
      console.error(`[customGeo] resolve failed for "${it.title?.slice(0, 60)}":`, err.message);
      continue;
    }
    if (!coords) continue;

    out.push({
      title: (it.title || '').slice(0, 240),
      source: sourceName || 'Custom',
      url: it.url || undefined,
      date: it.timestamp || it.date || new Date().toISOString(),
      lat: coords.lat + (Math.random() - 0.5) * 2 * JITTER_DEG,
      lon: coords.lon + (Math.random() - 0.5) * 2 * JITTER_DEG,
      region: coords.region || src.region || 'Custom',
      tier: it._tier || (it.itemsAnalyzed ? 'analyzed' : 'ticker'),
      method: coords.method,
    });
    perSourceCount.set(sourceName, used + 1);
  }

  return foldCustomGeoByHeadline(out);
}
