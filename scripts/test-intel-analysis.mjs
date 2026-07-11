#!/usr/bin/env node
// End-to-end test for multi-pool Intelligence Analysis.

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../crucix.config.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { generateIntelAnalysis, hasIntelInput, harvestIntelItems } from '../lib/llm/intel-analysis.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const latestPath = join(ROOT, 'runs', 'latest.json');

if (!existsSync(latestPath)) {
  console.error('[test-intel] runs/latest.json not found — wait for a sweep or run npm run sweep');
  process.exit(2);
}

const provider = createLLMProvider(config.llm);
if (!provider?.isConfigured) {
  console.error('[test-intel] LLM not configured — set LLM_PROVIDER + LLM_API_KEY in .env');
  process.exit(2);
}

console.log(`[test-intel] Provider: ${provider.name} (${provider.model})`);

const raw = JSON.parse(readFileSync(latestPath, 'utf8'));
const synthesized = await synthesize(raw);
const harvest = harvestIntelItems(synthesized, config);

console.log('[test-intel] Pool harvest counts:');
for (const [pool, count] of Object.entries(harvest.poolCounts).sort()) {
  if (count > 0) console.log(`  ${pool}: ${count}`);
}

if (!hasIntelInput(synthesized, config)) {
  console.error('[test-intel] Not enough active intel pools (need minPoolsForRun with data)');
  process.exit(2);
}

console.log(`\n[test-intel] customAnalyzed items: ${(synthesized.customAnalyzed || []).length} (optional)`);
console.log('\n[test-intel] Calling generateIntelAnalysis...');
const t0 = Date.now();
const intel = await generateIntelAnalysis(provider, synthesized, config);
const ms = Date.now() - t0;

if (!intel?.length) {
  console.error(`\n[test-intel] FAIL (${ms}ms) — returned null or empty.`);
  process.exit(1);
}

console.log(`\n[test-intel] OK (${ms}ms) — ${intel.length} items:\n`);
for (const it of intel) {
  console.log(`  [${it.confidence}] ${it.title}`);
  console.log(`    sources: ${(it.sources || []).join(', ')}`);
  console.log(`    ${it.summary.substring(0, 120)}...`);
  console.log('');
}
