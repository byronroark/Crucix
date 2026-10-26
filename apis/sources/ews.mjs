// Apocalypse Early Warning System — Kyle McDonald public EWS snapshot
// Polls R2 dashboard.json; extracts only current + lightweight composite signals.
// Never stores liveAircraft (~500KB+).

import { safeFetch } from '../utils/fetch.mjs';
import config from '../../crucix.config.mjs';

const DEFAULT_URL = 'https://pub-49bb6a6f314c47be9b481c25e5f6ca9e.r2.dev/dashboard.json';
const PUBLIC_PAGE = 'https://ews.kylemcdonald.net/';

/**
 * Extract lightweight EWS fields from the public snapshot.
 * @param {object} raw parsed dashboard.json
 * @returns {object|null}
 */
export function extractEwsSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cur = raw.current;
  if (!cur || typeof cur !== 'object') return null;

  const level = Number(cur.emergencyLevel);
  if (!Number.isFinite(level) || level < 1 || level > 5) return null;

  const composite = raw.signals?.composite && typeof raw.signals.composite === 'object'
    ? {
        asOf: raw.signals.composite.asOf || null,
        actualConcurrentCount: raw.signals.composite.actualConcurrentCount ?? null,
        expectedConcurrentCount: raw.signals.composite.expectedConcurrentCount ?? null,
        varianceAdjustedSigmaShift: raw.signals.composite.varianceAdjustedSigmaShift ?? null,
      }
    : null;

  return {
    source: 'EWS',
    timestamp: new Date().toISOString(),
    level: Math.round(level),
    asOf: cur.asOf || raw.snapshotGeneratedAt || null,
    concurrentCount: cur.concurrentCount ?? null,
    baselineMean: cur.baselineMean ?? null,
    baselineStdDev: cur.baselineStdDev ?? null,
    zScore: cur.zScore ?? cur.varianceAdjustedZScore ?? null,
    alertLevel: cur.alertLevel || null,
    gaugeValue: cur.gaugeValue ?? null,
    composite,
    url: PUBLIC_PAGE,
    snapshotUrl: config.ews?.snapshotUrl || DEFAULT_URL,
    // Explicitly omit liveAircraft / watchlist / trends payloads
  };
}

export async function briefing() {
  if (config.ews?.enabled === false) {
    return {
      source: 'EWS',
      timestamp: new Date().toISOString(),
      disabled: true,
      error: 'EWS disabled via config',
    };
  }

  const url = config.ews?.snapshotUrl || DEFAULT_URL;
  const raw = await safeFetch(url, { timeout: 20000, retries: 1 });
  if (raw?.rawText && !raw.current) {
    throw new Error('EWS snapshot was not valid JSON');
  }

  const extracted = extractEwsSnapshot(raw);
  if (!extracted) {
    throw new Error('EWS snapshot missing current.emergencyLevel (1–5)');
  }
  return extracted;
}

if (process.argv[1]?.endsWith('ews.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
