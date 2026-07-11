#!/usr/bin/env node
// Verify ACLED OAuth (password grant + token probe + optional refresh).
//
// Usage:
//   npm run test:acled
//   npm run test:acled -- --debug

import '../apis/utils/env.mjs';
import { authenticate, briefing, lastAuthDiagnostics } from '../apis/sources/acled.mjs';

const debug = process.argv.includes('--debug');

if (!process.env.ACLED_EMAIL || !process.env.ACLED_PASSWORD) {
  console.error('[test-acled] Set ACLED_EMAIL and ACLED_PASSWORD in .env');
  process.exit(2);
}

console.log('[test-acled] Authenticating (OAuth + token probe)...');
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

console.log('[test-acled] Fetching 7-day briefing sample...');
const data = await briefing();
if (data.error) {
  console.error('[test-acled] Briefing FAIL:', data.error);
  process.exit(1);
}

console.log(`[test-acled] Briefing OK — ${data.totalEvents} events, ${data.totalFatalities} fatalities (7d)`);
if (data.deadliestEvents?.[0]) {
  const top = data.deadliestEvents[0];
  console.log(`[test-acled] Deadliest: ${top.fatalities} fatalities — ${top.country}, ${top.location} (${top.date})`);
}
