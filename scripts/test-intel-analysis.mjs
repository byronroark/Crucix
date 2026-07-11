#!/usr/bin/env node
// End-to-end test for Intelligence Analysis (custom tier:'analyzed' sources + LLM).
//
// Usage:
//   npm run test:intel-analysis
//
// Loads runs/latest.json, synthesizes, and runs generateIntelAnalysis with
// verbose output so you can see whether the failure is input, API, or parsing.

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../crucix.config.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { generateIntelAnalysis } from '../lib/llm/intel-analysis.mjs';

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
const analyzed = synthesized.customAnalyzed || [];

console.log(`[test-intel] customAnalyzed items: ${analyzed.length}`);
if (!analyzed.length) {
  console.error('[test-intel] No tier:"analyzed" items — add sources in crucix.config.mjs or check CustomFeeds errors');
  process.exit(2);
}

const contentChars = analyzed.reduce((n, i) => n + (i.content?.length || 0), 0);
console.log(`[test-intel] Total content chars: ${contentChars}${contentChars < 200 ? ' (WEAK — RSS may be headline-only)' : ''}`);
console.log(`[test-intel] Sample titles:`);
for (const it of analyzed.slice(0, 3)) {
  console.log(`  - [${it.name}] ${(it.title || '').substring(0, 80)}`);
}

console.log('\n[test-intel] Calling generateIntelAnalysis...');
const t0 = Date.now();
const intel = await generateIntelAnalysis(provider, synthesized);
const ms = Date.now() - t0;

if (!intel?.length) {
  console.error(`\n[test-intel] FAIL (${ms}ms) — returned null or empty. Check logs above for parse preview.`);
  console.error('Tip: pin LLM_MODEL to a JSON-friendly model, e.g. openai/gpt-4o-mini or anthropic/claude-sonnet-4');
  process.exit(1);
}

console.log(`\n[test-intel] OK (${ms}ms) — ${intel.length} items:\n`);
for (const it of intel) {
  console.log(`  [${it.confidence}] ${it.title}`);
  console.log(`    ${it.summary.substring(0, 120)}...`);
  console.log('');
}
