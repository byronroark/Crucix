// NOAA SPC — Preliminary tornado reports (48h lookback, region-filtered)

import config from '../../crucix.config.mjs';
import { parseRegionEnv } from '../../lib/weather/region-presets.mjs';

const SPC_BASE = 'https://www.spc.noaa.gov/climo/reports';

function parseCsv(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];
  let header = null;
  for (const line of lines) {
    if (line.toLowerCase().startsWith('time,')) {
      const cols = line.split(',').map(h => h.trim().toLowerCase());
      header = cols.includes('f_scale') ? cols : null;
      continue;
    }
    if (!header) continue;
    const cols = line.split(',');
    if (cols.length < 7) continue;
    const row = Object.fromEntries(header.map((h, i) => [h, (cols[i] || '').trim()]));
    rows.push(row);
  }
  return rows;
}

function parseReport(row, lookbackHours) {
  const state = (row.state || '').toUpperCase();
  const lat = parseFloat(row.lat);
  const lon = parseFloat(row.lon);
  if (!state || Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const timeStr = row.time || '';
  const hh = parseInt(timeStr.slice(0, 2), 10);
  const mm = parseInt(timeStr.slice(2, 4), 10) || 0;
  if (Number.isNaN(hh)) return null;

  const now = new Date();
  const reportDate = new Date(now);
  reportDate.setHours(hh, mm, 0, 0);
  if (reportDate > now) reportDate.setDate(reportDate.getDate() - 1);
  const ageHours = (now - reportDate) / 3600000;
  if (ageHours > lookbackHours) return null;

  return {
    time: reportDate.toISOString(),
    ageHours: Math.round(ageHours * 10) / 10,
    efScale: row.f_scale || row.fscale || 'UNK',
    location: row.location || '',
    county: row.county || '',
    state,
    lat: +lat.toFixed(3),
    lon: +lon.toFixed(3),
    comments: row.comments || '',
  };
}

async function fetchDayReports(day) {
  try {
    const res = await fetch(`${SPC_BASE}/${day}.csv`, {
      headers: { 'User-Agent': 'Crucix/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    return parseCsv(await res.text());
  } catch {
    return [];
  }
}

export async function briefing() {
  const regions = config.tornadoReports?.regions || parseRegionEnv(process.env.TORNADO_ALERT_REGIONS, 'US-Southeast,Florida');
  const lookbackHours = config.tornadoReports?.lookbackHours || parseInt(process.env.TORNADO_LOOKBACK_HOURS, 10) || 48;

  const [todayRows, yesterdayRows] = await Promise.all([
    fetchDayReports('today'),
    lookbackHours > 24 ? fetchDayReports('yesterday') : Promise.resolve([]),
  ]);

  const regionSet = new Set(regions);
  const reports = [...todayRows, ...yesterdayRows]
    .map(r => parseReport(r, lookbackHours))
    .filter(Boolean)
    .filter(r => regionSet.has(r.state));

  const seen = new Set();
  const deduped = [];
  for (const r of reports) {
    const key = `${r.lat}|${r.lon}|${r.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  deduped.sort((a, b) => new Date(b.time) - new Date(a.time));

  return {
    source: 'NOAA/SPC',
    timestamp: new Date().toISOString(),
    lookbackHours,
    regions,
    total: deduped.length,
    reports: deduped.slice(0, 50),
  };
}

if (process.argv[1]?.endsWith('spc-tornado-reports.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
