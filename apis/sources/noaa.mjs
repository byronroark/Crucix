// NOAA / National Weather Service — Severe weather alerts (US, no API key)

import { safeFetch } from '../utils/fetch.mjs';
import { extractCentroid } from '../../lib/weather/geometry.mjs';

const NWS_BASE = 'https://api.weather.gov';

export async function getActiveAlerts(opts = {}) {
  const {
    severity = null,
    urgency = null,
    event = null,
    limit = 100,
  } = opts;

  const params = new URLSearchParams({ limit: String(limit), status: 'actual' });
  if (severity) params.set('severity', severity);
  if (urgency) params.set('urgency', urgency);
  if (event) params.set('event', event);

  return safeFetch(`${NWS_BASE}/alerts/active?${params}`, {
    headers: { Accept: 'application/geo+json' },
  });
}

export async function getSevereAlerts() {
  const [extreme, severe] = await Promise.all([
    getActiveAlerts({ severity: 'Extreme', limit: 100 }),
    getActiveAlerts({ severity: 'Severe', limit: 100 }),
  ]);
  const byId = new Map();
  for (const batch of [extreme, severe]) {
    for (const f of batch?.features || []) {
      const id = f.properties?.id || f.id;
      if (id) byId.set(id, f);
    }
  }
  return { type: 'FeatureCollection', features: [...byId.values()] };
}

function mapFeature(f) {
  const { lat, lon } = extractCentroid(f.geometry);
  const event = f.properties?.event || 'Weather Alert';
  const hurricaneLike = /hurricane|typhoon|tropical/i.test(event);
  return {
    id: f.properties?.id || f.id,
    event,
    severity: f.properties?.severity,
    urgency: f.properties?.urgency,
    headline: f.properties?.headline,
    areas: f.properties?.areaDesc,
    onset: f.properties?.onset,
    expires: f.properties?.expires,
    lat,
    lon,
    priority: hurricaneLike ? 1 : 2,
  };
}

export async function briefing() {
  const alerts = await getSevereAlerts();
  const features = alerts?.features || [];

  const hurricanes = features.filter(f => /hurricane|typhoon|tropical/i.test(f.properties?.event || ''));
  const tornadoes = features.filter(f => /tornado/i.test(f.properties?.event || ''));
  const floods = features.filter(f => /flood/i.test(f.properties?.event || ''));
  const winter = features.filter(f => /blizzard|ice storm|winter/i.test(f.properties?.event || ''));
  const fire = features.filter(f => /fire/i.test(f.properties?.event || ''));
  const other = features.filter(f => {
    const e = f.properties?.event || '';
    return !/hurricane|typhoon|tropical|tornado|flood|blizzard|ice storm|winter|fire/i.test(e);
  });

  const mapped = features.map(mapFeature).filter(a => a.lat != null && a.lon != null);
  mapped.sort((a, b) => {
    const score = (x) => (x.priority === 1 ? 10 : 0) + (x.severity === 'Extreme' ? 5 : 0);
    return score(b) - score(a);
  });

  return {
    source: 'NOAA/NWS',
    timestamp: new Date().toISOString(),
    totalSevereAlerts: features.length,
    summary: {
      hurricanes: hurricanes.length,
      tornadoes: tornadoes.length,
      floods: floods.length,
      winterStorms: winter.length,
      wildfires: fire.length,
      other: other.length,
    },
    alerts: mapped,
    topAlerts: mapped.slice(0, 25),
  };
}

if (process.argv[1]?.endsWith('noaa.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
