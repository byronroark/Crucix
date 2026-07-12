#!/usr/bin/env node
// Verify ACLED auth and event data read (/api/acled/read).
//
// Usage:
//   npm run test:acled
//   npm run test:acled -- --debug

import '../apis/utils/env.mjs';
import {
  authenticate,
  briefing,
  getAcledEventLagConfig,
  getAcledEventPeriod,
  probeAcledTransport,
  lastAuthDiagnostics,
} from '../apis/sources/acled.mjs';

const debug = process.argv.includes('--debug');

const hasToken = Boolean(process.env.ACLED_ACCESS_TOKEN?.trim());
const hasPassword = Boolean(process.env.ACLED_EMAIL && process.env.ACLED_PASSWORD);
if (!hasToken && !hasPassword) {
  console.error('[test-acled] Set ACLED_ACCESS_TOKEN (+ ACLED_REFRESH_TOKEN) or ACLED_EMAIL/ACLED_PASSWORD in .env');
  process.exit(2);
}

const lagConfig = getAcledEventLagConfig();
const period = getAcledEventPeriod();

console.log('[test-acled] Authenticating...');
const transport = await probeAcledTransport();
console.log(`[test-acled] transport: curl=${transport.curlAvailable}, cycletls=${transport.cycleTlsAvailable}`
  + `, ACLED_USE_CURL=${transport.acledUseCurl}, ACLED_USE_CYCLETLS=${transport.acledUseCycletls}`);
if (!transport.curlAvailable && transport.acledUseCurl !== '0') {
  console.error('[test-acled] WARN: curl not found in container — run `docker compose up -d --build`');
}
if (debug) {
  console.log(`[test-acled] event window: lag=${lagConfig.lagDays}d, span=${lagConfig.windowDays}d`
    + ` → ${period.start} .. ${period.end}`);
}

const session = await authenticate();
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

console.log(`[test-acled] Fetching ${lagConfig.windowDays}-day event sample (lag ${lagConfig.lagDays}d, Research tier)...`);
const data = await briefing();
if (data.error) {
  console.error('[test-acled] Event sample FAIL:', data.error);
  process.exit(1);
}

console.log(`[test-acled] Event sample OK — ${data.totalEvents} events, ${data.totalFatalities} fatalities`
  + ` (${data.period?.start} → ${data.period?.end})`);
if (data.deadliestEvents?.[0]) {
  const top = data.deadliestEvents[0];
  console.log(`[test-acled] Deadliest: ${top.fatalities} fatalities — ${top.country}, ${top.location} (${top.date})`);
}
