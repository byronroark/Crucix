/** US state region presets for weather/tornado alert filtering. */

export const REGION_PRESETS = {
  'US-Southeast': ['FL', 'GA', 'AL', 'MS', 'SC', 'NC', 'TN', 'LA'],
  'US-Tornado-Alley': ['TX', 'OK', 'KS', 'NE', 'IA', 'MO', 'AR'],
  'Florida': ['FL'],
  'US-Gulf': ['FL', 'AL', 'MS', 'LA', 'TX'],
};

/** State capital / centroid anchors for OpenWeather One Call queries. */
export const STATE_ANCHORS = {
  FL: { lat: 30.4383, lon: -84.2807, name: 'Florida' },
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

export function anchorsForStates(states) {
  return states
    .map(s => STATE_ANCHORS[s])
    .filter(Boolean)
    .map(a => ({ ...a, state: Object.entries(STATE_ANCHORS).find(([, v]) => v === a)?.[0] || null }));
}

export function stateMatchesArea(states, areaText) {
  if (!areaText || !states?.length) return false;
  const upper = String(areaText).toUpperCase();
  return states.some(st => {
    const name = STATE_ANCHORS[st]?.name?.toUpperCase();
    return upper.includes(st) || (name && upper.includes(name));
  });
}
