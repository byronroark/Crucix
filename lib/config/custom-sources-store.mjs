// User-managed custom OSINT sources — persisted JSON overlay on crucix.config.mjs seed sources.

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../crucix.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const VALID_TIERS = new Set(['ticker', 'analyzed']);
const VALID_TYPES = new Set(['rss']);

function userFilePath() {
  const rel = config.customSourcesUserFile || 'runs/config/custom-sources.json';
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  return join(ROOT, rel);
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readUserDoc() {
  const path = userFilePath();
  if (!existsSync(path)) return { version: 1, sources: [] };
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    return { version: doc.version || 1, sources: Array.isArray(doc.sources) ? doc.sources : [] };
  } catch {
    return { version: 1, sources: [] };
  }
}

function writeUserDoc(doc) {
  const path = userFilePath();
  ensureDir(path);
  writeFileSync(path, JSON.stringify({ version: 1, sources: doc.sources }, null, 2), 'utf8');
}

function seedSources() {
  return Array.isArray(config.customSources) ? config.customSources : [];
}

/** Normalize + validate an RSS source payload for the user store. */
export function validateRssSource(raw, { partial = false } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['invalid payload'] };

  const name = String(raw.name || '').trim();
  const url = String(raw.url || '').trim();
  const tier = raw.tier || 'ticker';
  const region = String(raw.region || 'Global').trim() || 'Global';

  if (!partial || raw.name !== undefined) {
    if (!name) errors.push('name is required');
    if (name.length > 80) errors.push('name too long (max 80)');
  }
  if (!partial || raw.url !== undefined) {
    if (!url) errors.push('url is required');
    else {
      try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) errors.push('url must be http or https');
      } catch {
        errors.push('url is invalid');
      }
    }
  }
  if (!partial || raw.tier !== undefined) {
    if (!VALID_TIERS.has(tier)) errors.push('tier must be ticker or analyzed');
  }

  let tags = [];
  if (raw.tags !== undefined) {
    if (Array.isArray(raw.tags)) tags = raw.tags.map(String).slice(0, 8);
    else if (typeof raw.tags === 'string') {
      tags = raw.tags.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
    }
  }

  const lat = raw.lat != null && raw.lat !== '' ? Number(raw.lat) : null;
  const lon = raw.lon != null && raw.lon !== '' ? Number(raw.lon) : null;
  if (lat != null && !Number.isFinite(lat)) errors.push('lat must be a number');
  if (lon != null && !Number.isFinite(lon)) errors.push('lon must be a number');

  const refreshMinutes = raw.refreshMinutes != null
    ? Number(raw.refreshMinutes)
    : 30;
  if (!Number.isFinite(refreshMinutes) || refreshMinutes < 5 || refreshMinutes > 1440) {
    errors.push('refreshMinutes must be between 5 and 1440');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      type: 'rss',
      name,
      url,
      tier,
      region,
      tags,
      refreshMinutes,
      ...(Number.isFinite(lat) ? { lat } : {}),
      ...(Number.isFinite(lon) ? { lon } : {}),
      ...(raw.mapMaxItems != null ? { mapMaxItems: Number(raw.mapMaxItems) } : {}),
    },
  };
}

/** Config-shaped sources for custom-feeds.mjs (seed + user, user wins on name collision). */
export function loadMergedSources() {
  const seeds = seedSources();
  const user = readUserDoc().sources;
  const byName = new Map();
  for (const s of seeds) {
    if (s?.name) byName.set(s.name, { ...s, _origin: 'seed' });
  }
  for (const s of user) {
    if (s?.name) byName.set(s.name, { ...s, _origin: 'user', _id: s._id });
  }
  return [...byName.values()];
}

/** List sources for the settings UI. */
export function listSources(feedStatus = {}) {
  const seeds = seedSources().map(s => ({
    id: `seed:${s.name}`,
    ...s,
    editable: false,
    origin: 'seed',
    lastStatus: feedStatus[s.name] || null,
  }));

  const user = readUserDoc().sources.map(s => ({
    id: s._id,
    type: s.type || 'rss',
    name: s.name,
    url: s.url,
    tier: s.tier || 'ticker',
    region: s.region || 'Global',
    tags: s.tags || [],
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    refreshMinutes: s.refreshMinutes ?? 30,
    editable: true,
    origin: 'user',
    lastStatus: feedStatus[s.name] || null,
  }));

  return [...seeds, ...user];
}

export function addSource(payload) {
  const v = validateRssSource(payload);
  if (!v.ok) return { ok: false, errors: v.errors };

  const doc = readUserDoc();
  const merged = loadMergedSources();
  if (merged.some(s => s.name === v.value.name)) {
    return { ok: false, errors: [`source name "${v.value.name}" already exists`] };
  }

  const entry = { _id: randomUUID(), ...v.value };
  doc.sources.push(entry);
  writeUserDoc(doc);
  return { ok: true, source: listSources().find(s => s.id === entry._id) };
}

export function updateSource(id, payload) {
  const doc = readUserDoc();
  const idx = doc.sources.findIndex(s => s._id === id);
  if (idx === -1) return { ok: false, errors: ['source not found'] };

  const merged = { ...doc.sources[idx], ...payload };
  const v = validateRssSource(merged);
  if (!v.ok) return { ok: false, errors: v.errors };

  const nameClash = loadMergedSources().some(s => s.name === v.value.name && s._id !== id);
  if (nameClash) return { ok: false, errors: [`source name "${v.value.name}" already exists`] };

  doc.sources[idx] = { _id: id, ...v.value };
  writeUserDoc(doc);
  return { ok: true, source: listSources().find(s => s.id === id) };
}

export function deleteSource(id) {
  const doc = readUserDoc();
  const before = doc.sources.length;
  doc.sources = doc.sources.filter(s => s._id !== id);
  if (doc.sources.length === before) return { ok: false, errors: ['source not found'] };
  writeUserDoc(doc);
  return { ok: true };
}

export function getUserFilePath() {
  return userFilePath();
}
