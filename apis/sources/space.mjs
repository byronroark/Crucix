// Space/CelesTrak — Satellite Activity Monitoring
// CelesTrak GP data updates ~every 2h; respect rate limits or the IP gets TCP-firewalled.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeFetch } from '../utils/fetch.mjs';

const CELESTRAK_BASE = 'https://celestrak.org';
const ISS_FALLBACK_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_PATH = join(ROOT, 'runs', 'config', 'space-cache.json');
const SNAPSHOT_PATH = join(ROOT, 'runs', 'config', 'space-snapshot.json');
const FETCH_META_PATH = join(ROOT, 'runs', 'config', 'space-fetch-meta.json');

// CelesTrak usage policy: GP groups update every ~2 hours.
const CELESTRAK_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000 - 5 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STARLINK_FALLBACK_COUNT = 10_700;
const SMALL_FETCH_TIMEOUT_MS = 12_000;

const SAT_CATEGORIES = {
  stations: '/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  lastDay: '/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json',
  military: '/NORAD/elements/gp.php?GROUP=military&FORMAT=json',
  oneweb: '/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=json',
};

function logProgress(msg) {
  if (process.argv[1]?.endsWith('space.mjs')) {
    console.error(`[space] ${msg}`);
  }
}

function ensureConfigDir() {
  const dir = dirname(SNAPSHOT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadFetchMeta() {
  try {
    return JSON.parse(readFileSync(FETCH_META_PATH, 'utf8'));
  } catch {
    return { lastOkAt: null };
  }
}

function saveFetchMeta(patch) {
  try {
    ensureConfigDir();
    writeFileSync(FETCH_META_PATH, JSON.stringify({ ...loadFetchMeta(), ...patch }, null, 2));
  } catch { /* non-fatal */ }
}

function loadConstellationCache() {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return { starlink: STARLINK_FALLBACK_COUNT, oneweb: 0, updatedAt: null };
  }
}

function saveConstellationCache(patch) {
  try {
    ensureConfigDir();
    const prev = loadConstellationCache();
    writeFileSync(CACHE_PATH, JSON.stringify({
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* non-fatal */ }
}

function loadSpaceSnapshot(ignoreMaxAge = false) {
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const snap = JSON.parse(raw);
    if (!snap?.savedAt || !snap.payload) return null;
    if (!ignoreMaxAge) {
      const age = Date.now() - new Date(snap.savedAt).getTime();
      if (age > SNAPSHOT_MAX_AGE_MS) return null;
    }
    return snap.payload;
  } catch {
    return null;
  }
}

function saveSpaceSnapshot(payload) {
  try {
    ensureConfigDir();
    writeFileSync(SNAPSHOT_PATH, JSON.stringify({
      savedAt: new Date().toISOString(),
      payload,
    }, null, 2));
    saveFetchMeta({ lastOkAt: new Date().toISOString() });
  } catch { /* non-fatal */ }
}

function shouldSkipCelestrakNetwork() {
  if (process.env.SPACE_FORCE_REFRESH === '1') return false;
  const meta = loadFetchMeta();
  if (!meta.lastOkAt) return false;
  const age = Date.now() - new Date(meta.lastOkAt).getTime();
  return age < CELESTRAK_MIN_INTERVAL_MS && Boolean(loadSpaceSnapshot(true));
}

function stalePayload(reason, extra = {}) {
  const snap = loadSpaceSnapshot(true);
  if (!snap) return null;
  return {
    ...snap,
    timestamp: new Date().toISOString(),
    status: 'stale',
    staleSnapshot: true,
    error: reason,
    warnings: [reason, ...(snap.warnings || [])].filter(Boolean).slice(0, 3),
    ...extra,
  };
}

async function getTLEs(category) {
  const path = SAT_CATEGORIES[category];
  if (!path) return { error: 'Invalid category' };
  return safeFetch(`${CELESTRAK_BASE}${path}`, {
    timeout: SMALL_FETCH_TIMEOUT_MS,
    retries: 0,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function fetchIssFallback() {
  const data = await safeFetch(ISS_FALLBACK_URL, { timeout: 10_000, retries: 0 });
  if (data?.error || data.latitude == null || data.longitude == null) {
    return { error: data?.error || 'ISS fallback unavailable' };
  }
  const epoch = data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date().toISOString();
  const iss = {
    name: 'ISS',
    noradId: 25544,
    inclination: 51.6,
    period: 92.7,
    epoch,
    latitude: data.latitude,
    longitude: data.longitude,
  };
  return {
    iss,
    stations: [iss],
    stationPositions: [{ lat: data.latitude, lon: data.longitude, name: 'ISS (live)' }],
  };
}

async function getRecentLaunches() {
  const data = await getTLEs('lastDay');
  if (data.error || !Array.isArray(data)) {
    return { error: data.error || 'Failed to fetch launch data' };
  }

  const launches = data.map(sat => ({
    name: sat.OBJECT_NAME,
    noradId: sat.NORAD_CAT_ID,
    classification: sat.CLASSIFICATION_TYPE,
    period: sat.PERIOD,
    inclination: sat.INCLINATION,
    apogee: sat.APOAPSIS,
    perigee: sat.PERIAPSIS,
    epoch: sat.EPOCH,
    country: sat.COUNTRY_CODE,
    objectType: sat.OBJECT_TYPE,
  })).filter(s => s.name && s.noradId);

  launches.sort((a, b) => new Date(b.epoch || 0) - new Date(a.epoch || 0));

  const byCountry = {};
  launches.forEach(l => {
    const country = l.country || 'UNK';
    byCountry[country] = (byCountry[country] || 0) + 1;
  });

  return { totalObjects: launches.length, recentLaunches: launches.slice(0, 25), byCountry };
}

async function getStationData() {
  const data = await getTLEs('stations');
  if (data.error || !Array.isArray(data)) {
    return { error: data.error || 'Failed to fetch station data' };
  }

  const stations = data.map(sat => ({
    name: sat.OBJECT_NAME,
    noradId: sat.NORAD_CAT_ID,
    apogee: sat.APOAPSIS,
    perigee: sat.PERIAPSIS,
    inclination: sat.INCLINATION,
    period: sat.PERIOD,
    epoch: sat.EPOCH,
  })).filter(s => s.name);

  const iss = stations.find(s => s.name.includes('ISS') || s.noradId === 25544);
  return { totalStations: stations.length, stations: stations.slice(0, 10), iss };
}

async function getMilitaryCount() {
  const data = await getTLEs('military');
  if (data.error || !Array.isArray(data)) {
    return { count: 0, error: data.error };
  }

  const byCountry = {};
  data.forEach(sat => {
    const country = sat.COUNTRY_CODE || 'UNK';
    byCountry[country] = (byCountry[country] || 0) + 1;
  });

  return { count: data.length, byCountry };
}

async function getConstellationStats() {
  const cache = loadConstellationCache();
  let oneweb = cache.oneweb || 0;
  let starlink = cache.starlink || STARLINK_FALLBACK_COUNT;
  let stale = false;
  const errors = [];

  // Never pull the Starlink mega-catalog during sweeps — it triggers CelesTrak IP blocks.
  logProgress(`starlink count from cache (${starlink})`);

  try {
    const onewebRes = await getTLEs('oneweb');
    if (Array.isArray(onewebRes)) {
      oneweb = onewebRes.length;
      saveConstellationCache({ oneweb });
    } else if (onewebRes.error) {
      errors.push(onewebRes.error);
      if (cache.oneweb > 0) {
        oneweb = cache.oneweb;
        stale = true;
      }
    }
  } catch (e) {
    errors.push(e.message);
    if (cache.oneweb > 0) {
      oneweb = cache.oneweb;
      stale = true;
    }
  }

  return { starlink, oneweb, stale, errors };
}

function generateSignals(data) {
  const signals = [];
  if (data.launches?.totalObjects > 50) {
    signals.push(`HIGH LAUNCH TEMPO: ${data.launches.totalObjects} new objects tracked in last 30 days`);
  }
  if (data.military?.count > 0) {
    signals.push(`MILITARY TRACK: ${data.military.count} objects in CelesTrak military group`);
  }
  if (data.constellations?.starlink > 6000) {
    signals.push(`STARLINK MEGA-CONSTELLATION: ${data.constellations.starlink} active satellites`);
  }
  return signals;
}

function buildResult({ launches, stations, military, constellations, status = 'active', warnings, extra = {} }) {
  const data = { launches, stations, military, constellations };
  return {
    source: 'Space/CelesTrak',
    timestamp: new Date().toISOString(),
    status,
    recentLaunches: launches.recentLaunches || [],
    totalNewObjects: launches.totalObjects || 0,
    launchByCountry: launches.byCountry || {},
    spaceStations: stations.stations || [],
    iss: stations.iss || null,
    militarySatellites: military.count || 0,
    militaryByCountry: military.byCountry || {},
    constellations: {
      starlink: constellations.starlink || 0,
      oneweb: constellations.oneweb || 0,
      stale: Boolean(constellations.stale),
    },
    signals: generateSignals(data),
    warnings: warnings?.length ? warnings.slice(0, 3) : undefined,
    ...extra,
  };
}

export async function briefing() {
  try {
    if (shouldSkipCelestrakNetwork()) {
      const cached = stalePayload('Serving cached space data (CelesTrak refresh interval)');
      if (cached) {
        logProgress('using cached snapshot (within 2h CelesTrak window)');
        return cached;
      }
    }

    logProgress('fetching CelesTrak core groups...');
    const [launches, stations, military] = await Promise.all([
      getRecentLaunches(),
      getStationData(),
      getMilitaryCount(),
    ]);

    const hasCoreData = !launches.error || !stations.error;

    if (!hasCoreData) {
      logProgress('CelesTrak unreachable — trying ISS fallback + cache');
      const issFallback = await fetchIssFallback();
      const cached = stalePayload(
        launches.error || stations.error || 'CelesTrak unreachable',
        issFallback.iss ? {
          iss: issFallback.iss,
          spaceStations: issFallback.stations,
          stationPositions: issFallback.stationPositions,
        } : {},
      );
      if (cached) return cached;

      if (issFallback.iss) {
        const cache = loadConstellationCache();
        const partial = buildResult({
          launches: { totalObjects: 0, recentLaunches: [], byCountry: {} },
          stations: { stations: issFallback.stations, iss: issFallback.iss },
          military: { count: 0, byCountry: {} },
          constellations: { starlink: cache.starlink, oneweb: cache.oneweb, stale: true },
          status: 'partial',
          warnings: [launches.error, stations.error, 'ISS position from WhereTheISS fallback'].filter(Boolean),
          issFallback: true,
        });
        partial.stationPositions = issFallback.stationPositions;
        return partial;
      }

      return {
        source: 'Space/CelesTrak',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: launches.error || stations.error || 'CelesTrak unreachable (IP may be temporarily firewalled)',
      };
    }

    logProgress('fetching oneweb count (starlink from cache only)...');
    const constellations = await getConstellationStats();

    const partialErrors = [
      launches.error,
      stations.error,
      military.error,
      ...(constellations.errors || []),
    ].filter(Boolean);

    const result = buildResult({
      launches,
      stations,
      military,
      constellations,
      status: partialErrors.length ? 'partial' : 'active',
      warnings: partialErrors,
    });

    saveSpaceSnapshot(result);
    logProgress(`done — new=${result.totalNewObjects} mil=${result.militarySatellites} sl=${result.constellations.starlink}`);
    return result;
  } catch (e) {
    const cached = stalePayload(e.message);
    if (cached) return cached;
    return {
      source: 'Space/CelesTrak',
      timestamp: new Date().toISOString(),
      status: 'error',
      error: e.message,
    };
  }
}

if (process.argv[1]?.endsWith('space.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
