/** Merge NWS, OpenWeather, hurricane positions, and tornado reports into unified map dots. */

function scoreDot(d) {
  let score = 0;
  const event = `${d.event || ''} ${d.headline || ''}`.toLowerCase();
  if (d.subtype === 'hurricane' || /hurricane|typhoon|tropical storm/.test(event)) score += 50;
  if (/florida|gulf|atlantic|caribbean|puerto rico|hawaii|united states|; [A-Z]{2};/.test(`${d.areas || ''}`.toLowerCase())) score += 40;
  if (d.severity === 'Extreme') score += 20;
  if (d.severity === 'Severe') score += 10;
  if (d.subtype === 'tornado') score += 15;
  if (d.efScale && /EF[2-5]/.test(d.efScale)) score += 10;
  return score;
}

function dotKey(d) {
  return `${d.subtype}|${d.symbol || d.event || ''}|${d.lat?.toFixed(2)}|${d.lon?.toFixed(2)}`;
}

export function mergeWeatherDots({
  nwsAlerts = [],
  openWeatherAlerts = [],
  hurricanePositions = [],
  tornadoReports = [],
  maxAlerts = 25,
} = {}) {
  const byKey = new Map();

  const add = (d) => {
    if (d.lat == null || d.lon == null) return;
    const key = dotKey(d);
    const existing = byKey.get(key);
    if (!existing || scoreDot(d) > scoreDot(existing)) byKey.set(key, d);
  };

  for (const a of nwsAlerts) {
    add({
      subtype: 'nws',
      event: a.event,
      severity: a.severity,
      headline: a.headline,
      areas: a.areas,
      lat: a.lat,
      lon: a.lon,
      priority: /hurricane|typhoon|tropical/i.test(a.event || '') ? 1 : 2,
      sourceLabel: 'NWS',
    });
  }

  for (const a of openWeatherAlerts) {
    add({
      subtype: 'openweather',
      event: a.event,
      severity: a.severity,
      headline: a.headline || a.description,
      areas: a.areas,
      lat: a.lat,
      lon: a.lon,
      priority: 2,
      sourceLabel: 'OpenWeather',
    });
  }

  for (const h of hurricanePositions) {
    add({
      subtype: 'hurricane',
      event: h.name || 'Hurricane',
      severity: h.classification || 'Tropical',
      headline: `${h.name || 'Storm'} · ${h.maxWindKts || '?'} kt`,
      areas: h.basin || '',
      lat: h.lat,
      lon: h.lon,
      priority: 1,
      sourceLabel: 'NHC',
      stormId: h.id,
    });
  }

  for (const t of tornadoReports) {
    add({
      subtype: 'tornado',
      event: 'Tornado Report',
      severity: t.efScale || 'UNK',
      headline: t.comments || t.location,
      areas: `${t.county || ''}, ${t.state || ''}`,
      lat: t.lat,
      lon: t.lon,
      priority: /EF[2-5]/.test(t.efScale || '') ? 1 : 2,
      sourceLabel: 'SPC',
      efScale: t.efScale,
      time: t.time,
    });
  }

  const dots = [...byKey.values()]
    .sort((a, b) => scoreDot(b) - scoreDot(a))
    .slice(0, maxAlerts);

  return {
    total: dots.length,
    dots,
    summary: {
      nws: dots.filter(d => d.subtype === 'nws').length,
      openweather: dots.filter(d => d.subtype === 'openweather').length,
      hurricanes: dots.filter(d => d.subtype === 'hurricane').length,
      tornadoes48h: dots.filter(d => d.subtype === 'tornado').length,
    },
  };
}
