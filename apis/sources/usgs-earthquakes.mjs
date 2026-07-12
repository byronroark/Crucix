// USGS — Earthquake feeds (no API key)

import { safeFetch } from '../utils/fetch.mjs';
import config from '../../crucix.config.mjs';

const FEEDS = {
  day: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
  week: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
  significant: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
};

export async function briefing() {
  const minMag = (config.earthquakes?.minMagnitude ?? parseFloat(process.env.EARTHQUAKE_MIN_MAG)) || 4.5;
  const feedKey = config.earthquakes?.feed || 'day';
  const url = FEEDS[feedKey] || FEEDS.day;

  const data = await safeFetch(url, { timeout: 12000 });
  const features = data?.features || [];

  const events = features
    .map(f => {
      const [lon, lat, depth] = f.geometry?.coordinates || [];
      const p = f.properties || {};
      const mag = p.mag;
      if (mag == null || mag < minMag) return null;
      return {
        id: f.id,
        magnitude: mag,
        place: p.place,
        time: p.time ? new Date(p.time).toISOString() : null,
        lat: lat != null ? +lat.toFixed(3) : null,
        lon: lon != null ? +lon.toFixed(3) : null,
        depth: depth != null ? +depth.toFixed(1) : null,
        url: p.url,
        tsunami: p.tsunami === 1,
        priority: mag >= 6 ? 1 : 2,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.magnitude - a.magnitude);

  return {
    source: 'USGS',
    timestamp: new Date().toISOString(),
    minMagnitude: minMag,
    total: events.length,
    events: events.slice(0, 40),
  };
}

if (process.argv[1]?.endsWith('usgs-earthquakes.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
