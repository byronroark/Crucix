// NHC — Active hurricane positions, official track/cone, ATCF model tracks

import { safeFetch } from '../utils/fetch.mjs';
import { fetchKmzCoordinates } from '../../lib/weather/kmz-parse.mjs';
import { lineToArcs } from '../../lib/weather/geometry.mjs';
import { parseAdeckLines, tracksToArcs } from '../../lib/weather/atcf-parse.mjs';
import { HURRICANE_MODELS, SPAGHETTI_TECH_BLOCKLIST, availableModelIds } from '../../lib/weather/atcf-models.mjs';

const CURRENT_STORMS = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const ATCF_BASE = 'https://ftp.nhc.noaa.gov/atcf/aid_public';

const MODEL_COLORS = {
  official: ['rgba(255,152,0,0.9)', 'rgba(255,152,0,0.2)'],
  ecmwf: ['rgba(100,181,246,0.85)', 'rgba(100,181,246,0.15)'],
  gfs: ['rgba(129,199,132,0.85)', 'rgba(129,199,132,0.15)'],
  hafs: ['rgba(186,104,200,0.85)', 'rgba(186,104,200,0.15)'],
  ukmet: ['rgba(255,213,79,0.85)', 'rgba(255,213,79,0.15)'],
  cmc: ['rgba(239,154,154,0.85)', 'rgba(239,154,154,0.15)'],
  consensus: ['rgba(255,255,255,0.75)', 'rgba(255,255,255,0.12)'],
  spaghetti: ['rgba(255,152,0,0.35)', 'rgba(255,152,0,0.08)'],
};

function modelColor(modelId) {
  return MODEL_COLORS[modelId] || MODEL_COLORS.spaghetti;
}

async function fetchAdeck(stormId) {
  try {
    const res = await fetch(`${ATCF_BASE}/a${stormId}.dat`, {
      headers: { 'User-Agent': 'Crucix/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

function buildModelTracks(adeckMap, stormName) {
  const modelTracks = {};
  const foundTechs = [];
  for (const [tech, points] of adeckMap.entries()) {
    if (SPAGHETTI_TECH_BLOCKLIST.has(tech)) continue;
    foundTechs.push(tech);
    const modelId = HURRICANE_MODELS.find(m => m.techs.includes(tech))?.id || null;
    modelTracks[tech] = {
      label: tech,
      modelId,
      arcs: tracksToArcs(tech, points, {
        color: modelColor(modelId || 'spaghetti'),
        stroke: modelId ? 0.55 : 0.2,
        label: `${stormName} · ${tech}`,
        modelId,
      }),
    };
  }
  return { modelTracks, foundTechs };
}

export async function briefing() {
  const current = await safeFetch(CURRENT_STORMS, { timeout: 12000 });
  const storms = current?.activeStorms || [];
  const positions = [];
  const stormPayloads = [];
  const allTechs = new Set();

  for (const s of storms) {
    const lat = s.latitudeNumeric ?? null;
    const lon = s.longitudeNumeric ?? null;
    const name = s.name || s.id;
    const classification = s.classification || '';
    const maxWindKts = parseInt(s.intensity, 10) || null;

    if (lat != null && lon != null) {
      positions.push({
        id: s.id,
        name,
        classification,
        maxWindKts,
        lat: +lat.toFixed(3),
        lon: +lon.toFixed(3),
        basin: (s.id || '').slice(0, 2).toUpperCase(),
        movementDir: s.movementDir,
        movementSpeed: s.movementSpeed,
        lastUpdate: s.lastUpdate,
      });
    }

    const trackKmz = s.forecastTrack?.kmzFile;
    const coneKmz = s.trackCone?.kmzFile;
    const [officialCoords, coneCoords, adeckText] = await Promise.all([
      trackKmz ? fetchKmzCoordinates(trackKmz) : Promise.resolve([]),
      coneKmz ? fetchKmzCoordinates(coneKmz) : Promise.resolve([]),
      fetchAdeck(s.id),
    ]);

    const officialArcs = officialCoords.length >= 2
      ? lineToArcs(officialCoords, { color: MODEL_COLORS.official, stroke: 0.7, label: `${name} · Official`, hurricane: true, model: 'OFCL' })
      : [];

    const adeckMap = parseAdeckLines(adeckText);
    const { modelTracks, foundTechs } = buildModelTracks(adeckMap, name);
    foundTechs.forEach(t => allTechs.add(t));

    // Prefer OFCL from a-deck if KMZ track missing
    if (!officialArcs.length) {
      for (const tech of ['OFCL', 'OFCI']) {
        const pts = adeckMap.get(tech);
        if (pts?.length) {
          officialArcs.push(...tracksToArcs(tech, pts, {
            color: MODEL_COLORS.official,
            stroke: 0.7,
            label: `${name} · Official`,
            hurricane: true,
            model: tech,
            modelId: 'official',
          }));
          break;
        }
      }
    }

    stormPayloads.push({
      id: s.id,
      name,
      classification,
      maxWindKts,
      lat,
      lon,
      officialTrack: { arcs: officialArcs },
      officialCone: {
        coords: coneCoords,
        polygon: coneCoords.length >= 3 ? { type: 'Polygon', coordinates: [coneCoords] } : null,
      },
      modelTracks,
      advisory: s.publicAdvisory?.url || null,
    });
  }

  const availableModels = availableModelIds([...allTechs]);

  return {
    source: 'NHC',
    timestamp: new Date().toISOString(),
    activeCount: storms.length,
    positions,
    storms: stormPayloads,
    availableModels,
    defaultModel: 'official',
  };
}

if (process.argv[1]?.endsWith('nhc-hurricanes.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
