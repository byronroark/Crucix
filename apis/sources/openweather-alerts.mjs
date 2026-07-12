// OpenWeatherMap — Severe active warnings (region-scoped, API key required)

import { safeFetch } from '../utils/fetch.mjs';
import config from '../../crucix.config.mjs';
import { anchorsForStates, parseRegionEnv, stateMatchesArea } from '../../lib/weather/region-presets.mjs';
import { extractCentroid } from '../../lib/weather/geometry.mjs';

const OW_BASE = 'https://api.openweathermap.org/data/3.0/onecall';

function isSevereAlert(alert) {
  const tags = (alert.tags || []).join(' ').toLowerCase();
  const event = String(alert.event || '').toLowerCase();
  if (tags.includes('severe') || tags.includes('extreme')) return true;
  if (/warning|emergency|hurricane|tornado|blizzard|flood/.test(event)) return true;
  if (/watch|advisory|statement|minor/.test(event) && !/severe|warning|emergency/.test(event)) return false;
  return /warning|emergency/.test(event);
}

export async function briefing() {
  const apiKey = config.weatherAlerts?.openWeatherApiKey
    || process.env.OPENWEATHER_API_KEY
    || process.env.WEATHER_API_KEY;
  if (!apiKey) {
    return {
      source: 'OpenWeather',
      timestamp: new Date().toISOString(),
      skipped: true,
      reason: 'no API key',
      alerts: [],
    };
  }

  const states = config.weatherAlerts?.severeRegions
    || parseRegionEnv(process.env.SEVERE_WEATHER_ALERT_REGIONS, 'FL,GA,AL');
  const anchors = anchorsForStates(states, {
    globalAnchor: config.weatherAlerts?.anchor,
    anchorOverrides: config.weatherAlerts?.anchorOverrides,
  });
  const byId = new Map();

  for (const anchor of anchors) {
    const url = `${OW_BASE}?lat=${anchor.lat}&lon=${anchor.lon}&exclude=minutely,hourly,daily&appid=${apiKey}`;
    const data = await safeFetch(url, { timeout: 12000 });
    for (const alert of data?.alerts || []) {
      if (!isSevereAlert(alert)) continue;
      const areas = alert.areas?.join?.('; ') || alert.areas || anchor.name;
      if (!stateMatchesArea(states, areas) && !states.includes(anchor.state)) continue;
      const id = `${alert.event}|${alert.start}|${areas}`;
      byId.set(id, {
        id,
        event: alert.event,
        severity: alert.tags?.includes?.('Extreme') ? 'Extreme' : 'Severe',
        headline: alert.description?.split('\n')?.[0]?.slice(0, 160) || alert.event,
        description: alert.description,
        areas,
        onset: alert.start ? new Date(alert.start * 1000).toISOString() : null,
        expires: alert.end ? new Date(alert.end * 1000).toISOString() : null,
        lat: anchor.lat,
        lon: anchor.lon,
        state: anchor.state,
        source: 'OpenWeather',
      });
    }
  }

  return {
    source: 'OpenWeather',
    timestamp: new Date().toISOString(),
    regions: states,
    alerts: [...byId.values()],
  };
}

if (process.argv[1]?.endsWith('openweather-alerts.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
