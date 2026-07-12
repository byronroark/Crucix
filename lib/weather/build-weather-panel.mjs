/** Build regional weather panel payload for dashboard radar + local ticker. */

import { bboxForStates, regionLabel, stateMatchesArea } from './region-presets.mjs';

function severityRank(severity) {
  if (severity === 'Extreme') return 2;
  if (severity === 'Severe') return 1;
  return 0;
}

function alertKey(a, source) {
  return `${source}|${a.event}|${a.areas || ''}|${a.onset || a.start || ''}`;
}

function normalizeAlert(a, source) {
  const feedSource = source === 'openweather' ? 'OPENWEATHER' : 'NWS';
  return {
    id: alertKey(a, feedSource),
    event: a.event || 'Weather Alert',
    severity: a.severity || 'Severe',
    headline: String(a.headline || a.description || a.event || '').substring(0, 160),
    areas: a.areas || '',
    state: a.state || null,
    lat: a.lat,
    lon: a.lon,
    source: feedSource,
    onset: a.onset || (a.start ? new Date(a.start * 1000).toISOString() : null),
    expires: a.expires || (a.end ? new Date(a.end * 1000).toISOString() : null),
  };
}

export function buildWeatherPanel({
  states = [],
  nwsAlerts = [],
  openWeatherAlerts = [],
} = {}) {
  if (!states?.length) return null;

  const bbox = bboxForStates(states);
  if (!bbox) return null;

  const byId = new Map();

  for (const a of nwsAlerts) {
    if (!['Severe', 'Extreme'].includes(a.severity)) continue;
    if (!stateMatchesArea(states, a.areas)) continue;
    const norm = normalizeAlert(a, 'nws');
    byId.set(norm.id, norm);
  }

  for (const a of openWeatherAlerts) {
    if (!stateMatchesArea(states, a.areas) && !states.includes(a.state)) continue;
    const norm = normalizeAlert(a, 'openweather');
    byId.set(norm.id, norm);
  }

  const alerts = [...byId.values()]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity)
      || String(a.event).localeCompare(String(b.event)))
    .slice(0, 8);

  const hasExtreme = alerts.some(a => a.severity === 'Extreme');

  return {
    regions: states,
    regionLabel: regionLabel(states),
    bbox,
    center: {
      lat: +((bbox.south + bbox.north) / 2).toFixed(4),
      lon: +((bbox.west + bbox.east) / 2).toFixed(4),
    },
    alerts,
    emergency: {
      active: alerts.length > 0,
      level: hasExtreme ? 'extreme' : alerts.length ? 'severe' : null,
      summary: alerts.slice(0, 3).map(a => {
        const area = a.areas ? ` · ${a.areas}` : '';
        return `${a.event}${area}`;
      }).join(' · '),
    },
  };
}

/** Convert panel alerts into Local News ticker feed items. */
export function weatherFeedItems(weatherPanel) {
  if (!weatherPanel?.alerts?.length) return [];
  return weatherPanel.alerts.map(a => ({
    headline: a.headline || a.event,
    source: a.source,
    type: 'weather',
    timestamp: a.onset || new Date().toISOString(),
    region: a.areas || weatherPanel.regionLabel,
    state: a.state || null,
    severity: a.severity,
    urgent: a.severity === 'Extreme',
  }));
}
