// Space/CelesTrak — Satellite Activity Monitoring
// No API key required. Uses CelesTrak for public TLE data and launch info.
// Tracks: Recent launches, ISS position, satellite decay alerts, space debris.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeFetch } from '../utils/fetch.mjs';

const CELESTRAK_BASE = 'https://celestrak.org';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_PATH = join(ROOT, 'runs', 'config', 'space-cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // CelesTrak rate-limits mega-constellations

const SAT_CATEGORIES = {
  stations: '/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  lastDay: '/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json',
  military: '/NORAD/elements/gp.php?GROUP=military&FORMAT=json',
  starlink: '/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json',
  oneweb: '/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=json',
};

function loadConstellationCache() {
  try {
    const raw = readFileSync(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { starlink: 0, oneweb: 0, updatedAt: null };
  }
}

function saveConstellationCache(patch) {
  try {
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const prev = loadConstellationCache();
    writeFileSync(CACHE_PATH, JSON.stringify({
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* non-fatal */ }
}

async function getTLEs(category) {
  const path = SAT_CATEGORIES[category];
  if (!path) return { error: 'Invalid category' };
  return safeFetch(`${CELESTRAK_BASE}${path}`, { timeout: 20000 });
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
    launchDate: sat.LAUNCH_DATE,
    decayDate: sat.DECAY_DATE,
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

async function countConstellation(category) {
  const data = await getTLEs(category);
  if (Array.isArray(data)) return { count: data.length };
  return { count: 0, error: data.error || `Failed to fetch ${category}` };
}

async function getConstellationStats() {
  const cache = loadConstellationCache();
  const cacheAge = cache.updatedAt ? Date.now() - new Date(cache.updatedAt).getTime() : Infinity;
  const cacheFresh = cacheAge < CACHE_TTL_MS;

  // Fetch sequentially — parallel mega-constellation pulls trigger CelesTrak 403 cooldowns.
  const starlinkRes = await countConstellation('starlink');
  const onewebRes = await countConstellation('oneweb');

  let starlink = starlinkRes.count;
  let oneweb = onewebRes.count;
  let stale = false;

  if (starlink <= 0 && cache.starlink > 0 && (cacheFresh || starlinkRes.error)) {
    starlink = cache.starlink;
    stale = true;
  }
  if (oneweb <= 0 && cache.oneweb > 0 && (cacheFresh || onewebRes.error)) {
    oneweb = cache.oneweb;
    stale = true;
  }

  if (starlinkRes.count > 0 || onewebRes.count > 0) {
    saveConstellationCache({
      starlink: starlinkRes.count > 0 ? starlinkRes.count : cache.starlink,
      oneweb: onewebRes.count > 0 ? onewebRes.count : cache.oneweb,
    });
  }

  return {
    starlink,
    oneweb,
    stale,
    errors: [starlinkRes.error, onewebRes.error].filter(Boolean),
  };
}

function generateSignals(data) {
  const signals = [];

  if (data.launches?.totalObjects > 50) {
    signals.push(`HIGH LAUNCH TEMPO: ${data.launches.totalObjects} new objects tracked in last 30 days`);
  }

  const byCountry = data.launches?.byCountry || {};
  const cnLaunches = byCountry.PRC || byCountry.CN || 0;
  const ruLaunches = byCountry.CIS || byCountry.RU || 0;

  if (cnLaunches > 10) {
    signals.push(`CHINA SPACE ACTIVITY: ${cnLaunches} objects launched recently`);
  }
  if (ruLaunches > 5) {
    signals.push(`RUSSIA SPACE ACTIVITY: ${ruLaunches} objects launched recently`);
  }
  if (data.military?.count > 0) {
    signals.push(`MILITARY TRACK: ${data.military.count} objects in CelesTrak military group`);
  }
  if (data.constellations?.starlink > 6000) {
    signals.push(`STARLINK MEGA-CONSTELLATION: ${data.constellations.starlink} active satellites`);
  }

  return signals;
}

function settleResult(result, fallback = {}) {
  return result.status === 'fulfilled' ? result.value : { ...fallback, error: result.reason?.message || 'fetch failed' };
}

export async function briefing() {
  try {
    const [launchesR, stationsR, militaryR, constellationsR] = await Promise.allSettled([
      getRecentLaunches(),
      getStationData(),
      getMilitaryCount(),
      getConstellationStats(),
    ]);

    const launches = settleResult(launchesR);
    const stations = settleResult(stationsR);
    const military = settleResult(militaryR, { count: 0, byCountry: {} });
    const constellations = settleResult(constellationsR, { starlink: 0, oneweb: 0, stale: false, errors: [] });

    const hasCoreData = !launches.error || !stations.error;
    if (!hasCoreData) {
      return {
        source: 'Space/CelesTrak',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: launches.error || stations.error || 'Failed to fetch space data',
      };
    }

    const partialErrors = [
      launches.error,
      stations.error,
      military.error,
      ...(constellations.errors || []),
    ].filter(Boolean);

    const data = { launches, stations, military, constellations };
    const signals = generateSignals(data);

    return {
      source: 'Space/CelesTrak',
      timestamp: new Date().toISOString(),
      status: partialErrors.length ? 'partial' : 'active',
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
      signals,
      warnings: partialErrors.length ? partialErrors.slice(0, 3) : undefined,
    };
  } catch (e) {
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
