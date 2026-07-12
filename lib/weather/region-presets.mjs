/** US state region presets for weather/tornado alert filtering. */

export const REGION_PRESETS = {
  'US-Southeast': ['FL', 'GA', 'AL', 'MS', 'SC', 'NC', 'TN', 'LA'],
  'US-Tornado-Alley': ['TX', 'OK', 'KS', 'NE', 'IA', 'MO', 'AR'],
  'Florida': ['FL'],
  'US-Gulf': ['FL', 'AL', 'MS', 'LA', 'TX'],
};

/** State capital anchors for OpenWeather One Call queries (override via OPENWEATHER_ANCHOR_* env). */
export const STATE_ANCHORS = {
  FL: { lat: 30.4383, lon: -84.2807, name: 'Tallahassee' },
  GA: { lat: 33.749, lon: -84.388, name: 'Georgia' },
  AL: { lat: 32.377, lon: -86.3, name: 'Alabama' },
  MS: { lat: 32.2988, lon: -90.1848, name: 'Mississippi' },
  SC: { lat: 34.0007, lon: -81.0348, name: 'South Carolina' },
  NC: { lat: 35.7796, lon: -78.6382, name: 'North Carolina' },
  TN: { lat: 36.1627, lon: -86.7816, name: 'Tennessee' },
  LA: { lat: 30.4515, lon: -91.1871, name: 'Louisiana' },
  TX: { lat: 30.2672, lon: -97.7431, name: 'Texas' },
  OK: { lat: 35.4676, lon: -97.5164, name: 'Oklahoma' },
  KS: { lat: 39.0473, lon: -95.6752, name: 'Kansas' },
  NE: { lat: 40.8136, lon: -96.7026, name: 'Nebraska' },
  IA: { lat: 41.5868, lon: -93.625, name: 'Iowa' },
  MO: { lat: 38.5767, lon: -92.1735, name: 'Missouri' },
  AR: { lat: 34.7465, lon: -92.2896, name: 'Arkansas' },
};

/** Full state names for matching OpenWeather alert area text. */
const STATE_AREA_NAMES = {
  FL: 'FLORIDA', GA: 'GEORGIA', AL: 'ALABAMA', MS: 'MISSISSIPPI',
  SC: 'SOUTH CAROLINA', NC: 'NORTH CAROLINA', TN: 'TENNESSEE', LA: 'LOUISIANA',
  TX: 'TEXAS', OK: 'OKLAHOMA', KS: 'KANSAS', NE: 'NEBRASKA', IA: 'IOWA',
  MO: 'MISSOURI', AR: 'ARKANSAS',
};

export function parseRegionEnv(raw, fallback = 'FL,GA,AL') {
  const parts = String(raw || fallback).split(',').map(s => s.trim()).filter(Boolean);
  const states = new Set();
  for (const part of parts) {
    const presetKey = Object.keys(REGION_PRESETS).find(k => k.toLowerCase() === part.toLowerCase());
    if (presetKey) {
      REGION_PRESETS[presetKey].forEach(s => states.add(s));
      continue;
    }
    if (/^[A-Z]{2}$/i.test(part)) states.add(part.toUpperCase());
  }
  return [...states];
}

/** Parse `lat,lon,name` or `lat,lon` anchor override from env. */
export function parseAnchorOverride(raw) {
  const parts = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return {
    lat: +lat.toFixed(4),
    lon: +lon.toFixed(4),
    name: parts.slice(2).join(', ') || 'Custom',
  };
}

/** Collect OPENWEATHER_ANCHOR_FL-style per-state overrides from env. */
export function anchorOverridesFromEnv(env = process.env) {
  const overrides = {};
  for (const [key, val] of Object.entries(env || {})) {
    const m = key.match(/^OPENWEATHER_ANCHOR_([A-Z]{2})$/);
    if (!m) continue;
    const parsed = parseAnchorOverride(val);
    if (parsed) overrides[m[1]] = parsed;
  }
  return overrides;
}

export function anchorsForStates(states, opts = {}) {
  const globalAnchor = opts.globalAnchor ?? null;
  const perState = opts.anchorOverrides ?? anchorOverridesFromEnv();

  return states
    .map((state) => {
      const override = perState[state]
        || (globalAnchor && states.length === 1 ? globalAnchor : null);
      const base = override || STATE_ANCHORS[state];
      if (!base) return null;
      return { ...base, state };
    })
    .filter(Boolean);
}

export function stateMatchesArea(states, areaText) {
  if (!areaText || !states?.length) return false;
  const upper = String(areaText).toUpperCase();
  return states.some(st => {
    const stateName = STATE_AREA_NAMES[st];
    return upper.includes(st) || (stateName && upper.includes(stateName));
  });
}

/** Approximate state bounding boxes for regional radar mini-maps (south, west, north, east). */
export const STATE_BBOX = {
  FL: { south: 24.4, west: -87.6, north: 31.0, east: -79.8 },
  GA: { south: 30.4, west: -85.6, north: 35.0, east: -80.8 },
  AL: { south: 30.2, west: -88.5, north: 35.0, east: -84.9 },
  MS: { south: 30.2, west: -91.7, north: 35.0, east: -88.1 },
  SC: { south: 32.0, west: -83.4, north: 35.2, east: -78.5 },
  NC: { south: 33.8, west: -84.3, north: 36.6, east: -75.5 },
  TN: { south: 35.0, west: -90.3, north: 36.7, east: -81.6 },
  LA: { south: 28.9, west: -94.0, north: 33.0, east: -88.8 },
  TX: { south: 25.8, west: -106.6, north: 36.5, east: -93.5 },
  OK: { south: 33.6, west: -103.0, north: 37.0, east: -94.4 },
  KS: { south: 37.0, west: -102.1, north: 40.0, east: -94.6 },
  NE: { south: 40.0, west: -104.1, north: 43.0, east: -95.3 },
  IA: { south: 40.4, west: -96.6, north: 43.5, east: -90.1 },
  MO: { south: 36.0, west: -95.8, north: 40.6, east: -89.1 },
  AR: { south: 33.0, west: -94.6, north: 36.5, east: -89.6 },
};

/** Union bounding box for one or more state codes. */
export function bboxForStates(states) {
  const boxes = (states || []).map(s => STATE_BBOX[s]).filter(Boolean);
  if (!boxes.length) return null;
  return {
    south: Math.min(...boxes.map(b => b.south)),
    west: Math.min(...boxes.map(b => b.west)),
    north: Math.max(...boxes.map(b => b.north)),
    east: Math.max(...boxes.map(b => b.east)),
  };
}

/** Human-readable region badge label, e.g. `FL · GA · AL`. */
export function regionLabel(states) {
  if (!states?.length) return '';
  return states.join(' · ');
}
