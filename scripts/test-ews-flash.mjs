#!/usr/bin/env node
// Dry-run / live test for Apocalypse EWS FLASH formatting.
// Usage:
//   node scripts/test-ews-flash.mjs            — print message, send if TELEGRAM_* set
//   node scripts/test-ews-flash.mjs --dry-run  — print only

import config from '../crucix.config.mjs';
import { TelegramAlerter } from '../lib/alerts/telegram.mjs';
import { extractEwsSnapshot } from '../apis/sources/ews.mjs';

const dryRun = process.argv.includes('--dry-run');
const alerter = new TelegramAlerter(config.telegram);

const sample = extractEwsSnapshot({
  current: {
    asOf: new Date().toISOString(),
    concurrentCount: 210,
    baselineMean: 120,
    zScore: 2.4,
    emergencyLevel: 3,
  },
});

const from = 1;
const lines = [
  '🔴 *FLASH* — Apocalypse EWS',
  '',
  `Emergency level *${from} → ${sample.level}*`,
  `Concurrent aircraft: *${sample.concurrentCount}* (baseline ~${Math.round(sample.baselineMean)})`,
  `z-score: *${Number(sample.zScore).toFixed(2)}*`,
  `As of: ${sample.asOf}`,
  '',
  `[Open EWS dashboard](${sample.url})`,
];

console.log(lines.join('\n'));
console.log('---');

if (dryRun) {
  console.log('[test-ews-flash] dry-run — not sending');
  process.exit(0);
}

if (!alerter.isConfigured) {
  console.error('[test-ews-flash] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — message printed only');
  process.exit(0);
}

const ok = await alerter.sendEwsFlash(from, sample, { force: true });
process.exit(ok ? 0 : 1);
