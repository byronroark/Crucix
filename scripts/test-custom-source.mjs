#!/usr/bin/env node
// Test a single custom source end-to-end without waiting for the next sweep.
// Bypasses the on-disk cache and prints fetched items + Intel-readiness check.
//
// Usage:
//   npm run test:custom-source -- "Source Name"
//   npm run test:custom-source -- "Source Name" --keep-cache
//
// "Source Name" must match the `name` field of an entry in config.customSources.

import config from '../crucix.config.mjs';
import { collect } from '../apis/sources/custom-feeds.mjs';

const args = process.argv.slice(2);
const keepCache = args.includes('--keep-cache');
const positional = args.filter(a => !a.startsWith('--'));
const name = positional[0];

if (!name) {
  console.error('[test-custom-source] usage: npm run test:custom-source -- "Source Name" [--keep-cache]');
  console.error('Configured sources:');
  for (const s of (config.customSources || [])) {
    console.error(`  - ${s.name} (${s.type}, tier=${s.tier || 'ticker'})`);
  }
  process.exit(2);
}

const match = (config.customSources || []).find(s => s.name === name);
if (!match) {
  console.error(`[test-custom-source] no source named "${name}" in config.customSources`);
  process.exit(2);
}

console.log(`[test-custom-source] Fetching "${name}" (${match.type}, tier=${match.tier || 'ticker'}) ${keepCache ? '(using cache)' : '(bypassing cache)'}...`);

const t0 = Date.now();
const result = await collect({ ignoreCache: !keepCache, onlyName: name });
const ms = Date.now() - t0;

const ticker = (result.itemsTicker || []).length;
const analyzed = (result.itemsAnalyzed || []).length;
const total = ticker + analyzed;

console.log('');
console.log(`Result (${ms}ms):`);
console.log(`  itemsTicker:   ${ticker}`);
console.log(`  itemsAnalyzed: ${analyzed}`);
console.log(`  errors:        ${result.errors?.length || 0}`);
if (result.errors?.length) {
  for (const e of result.errors) console.log(`    - ${e.name}: ${e.error}`);
}

const first = (result.itemsTicker?.[0] || result.itemsAnalyzed?.[0]);
if (first) {
  console.log('');
  console.log('First item:');
  console.log(`  title:     ${first.title}`);
  console.log(`  url:       ${first.url || '(none)'}`);
  console.log(`  timestamp: ${first.timestamp || '(none)'}`);
  console.log(`  region:    ${first.region || '(none)'}`);
  if (first.content) {
    console.log(`  content:   ${first.content.substring(0, 200)}${first.content.length > 200 ? '...' : ''}`);
  }
}

// Intel-readiness check (only meaningful for analyzed-tier sources)
if (match.tier === 'analyzed') {
  console.log('');
  const contentSize = (result.itemsAnalyzed || []).reduce((sum, i) => sum + (i.content?.length || 0), 0);
  if (analyzed === 0) {
    console.log('Intel-readiness: FAIL (no analyzed items returned)');
  } else if (contentSize < 200) {
    console.log(`Intel-readiness: WEAK (only ${contentSize} chars of content across ${analyzed} items) — LLM has very little to work with`);
  } else {
    console.log(`Intel-readiness: OK (${contentSize} chars of content across ${analyzed} items)`);
  }
}

process.exit(total > 0 ? 0 : 1);
