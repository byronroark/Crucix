#!/usr/bin/env node
// Verify ACLED auth and event data read (/api/acled/read).
//
// Usage:
//   npm run test:acled
//   npm run test:acled -- --debug
//   npm run test:acled -- --fresh   # clear token cache (run host-refresh AFTER, not before)

import { existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import '../apis/utils/env.mjs';
import {
  authenticate,
  briefing,
  getAcledTierConfig,
  getAcledEventPeriod,
  probeAcledTransport,
  lastAuthDiagnostics,
} from '../apis/sources/acled.mjs';

const debug = process.argv.includes('--debug');
const fresh = process.argv.includes('--fresh');

const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs', '.cache', 'acled-oauth.json');
if (fresh && existsSync(CACHE_FILE)) {
  unlinkSync(CACHE_FILE);
  console.log(`[test-acled] --fresh: removed ${CACHE_FILE}`);
  console.log('[test-acled] Re-run: node scripts/acled-host-refresh.mjs --password');
}

const hasToken = Boolean(process.env.ACLED_ACCESS_TOKEN?.trim());
const hasPassword = Boolean(process.env.ACLED_EMAIL && process.env.ACLED_PASSWORD);
if (!hasToken && !hasPassword) {
  console.error('[test-acled] Set ACLED_ACCESS_TOKEN (+ ACLED_REFRESH_TOKEN) or ACLED_EMAIL/ACLED_PASSWORD in .env');
  process.exit(2);
}
if (hasToken && hasPassword) {
  console.warn('[test-acled] WARN: ACLED_EMAIL and ACLED_ACCESS_TOKEN both set — remove stale tokens from .env');
}

const tierConfig = getAcledTierConfig();
const period = getAcledEventPeriod(tierConfig);

console.log(`[test-acled] tier=${tierConfig.tier} (${tierConfig.label}) — ${tierConfig.dataMode}, lag=${tierConfig.lagDays}d, window=${tierConfig.windowDays}d`);

console.log('[test-acled] Authenticating...');
const transport = await probeAcledTransport();
console.log(`[test-acled] transport: curl=${transport.curlAvailable}, cycletls=${transport.cycleTlsAvailable}`
  + `, ACLED_USE_CURL=${transport.acledUseCurl}, ACLED_USE_CYCLETLS=${transport.acledUseCycletls}`);
if (!transport.curlAvailable && transport.acledUseCurl !== '0') {
  console.error('[test-acled] WARN: curl not found in container — run `docker compose up -d --build`');
}
if (debug) {
  console.log(`[test-acled] event window: lag=${tierConfig.lagDays}d, span=${tierConfig.windowDays}d`
    + `, mode=${tierConfig.dataMode} → ${period.start} .. ${period.end}`);
}

const session = await authenticate();
if (session.apiAccessDenied) {
  console.error('[test-acled] OAuth OK — waiting on ACLED API access');
  console.error('[test-acled]', session.error);
  process.exit(1);
}
if (session.error) {
  console.error('[test-acled] FAIL:', session.error);
  if (lastAuthDiagnostics.attempts.length) {
    console.error('[test-acled] Attempts:');
    for (const line of lastAuthDiagnostics.attempts) console.error(`  - ${line}`);
  }
  process.exit(1);
}

if (session.method !== 'oauth') {
  console.error(`[test-acled] FAIL: Expected OAuth session but got method=${session.method}`);
  if (lastAuthDiagnostics.attempts.length) {
    console.error('[test-acled] Attempts:');
    for (const line of lastAuthDiagnostics.attempts) console.error(`  - ${line}`);
  }
  process.exit(1);
}

console.log(`[test-acled] OK — method=${session.method}`
  + (session.refreshToken ? ', refresh_token cached' : ', no refresh_token')
  + `, access expires in ~${Math.max(0, Math.round((session.expires - Date.now()) / 60000))} min`);

if (debug && session.token) {
  console.log(`[test-acled] Token prefix: ${session.token.slice(0, 12)}...`);
}

console.log(`[test-acled] Fetching ${tierConfig.dataMode} sample (${tierConfig.label} tier)...`);
const data = await briefing();
if (data.error) {
  console.error('[test-acled] Data sample FAIL:', data.error);
  process.exit(1);
}

console.log(`[test-acled] Data sample OK — ${data.totalEvents} events, ${data.totalFatalities} fatalities`
  + ` (${data.period?.start} → ${data.period?.end}, mode=${data.dataMode || tierConfig.dataMode})`);
if (data.deadliestEvents?.[0]) {
  const top = data.deadliestEvents[0];
  console.log(`[test-acled] Deadliest: ${top.fatalities} fatalities — ${top.country}, ${top.location} (${top.date})`);
}
