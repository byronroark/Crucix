#!/usr/bin/env node
// End-to-end test for LLM trade ideas generation.

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../crucix.config.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';
import { MemoryManager } from '../lib/delta/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const latestPath = join(ROOT, 'runs', 'latest.json');

const provider = createLLMProvider(config.llm);
if (!provider?.isConfigured) {
  console.error('[test-ideas] LLM not configured — set LLM_PROVIDER + LLM_API_KEY in .env');
  process.exit(2);
}

console.log(`[test-ideas] Provider: ${provider.name} model=${provider.model}`);

let synthesized;
if (existsSync(latestPath)) {
  const raw = JSON.parse(readFileSync(latestPath, 'utf8'));
  synthesized = await synthesize(raw);
} else {
  console.warn('[test-ideas] No runs/latest.json — using minimal synthetic sweep data');
  synthesized = {
    fred: [{ id: 'VIXCLS', value: 24.5 }],
    energy: { wti: 71, brent: 74, natgas: 2.8, crudeStocks: 450000 },
    metals: { gold: 4100, silver: 60 },
    tg: { urgent: [{ text: 'Test OSINT headline about conflict escalation' }] },
    meta: { timestamp: new Date().toISOString() },
  };
}

const memory = new MemoryManager(join(ROOT, 'runs'));
const delta = memory.getLastDelta();

console.log('[test-ideas] Calling generateLLMIdeas...');
const t0 = Date.now();
const ideas = await generateLLMIdeas(provider, synthesized, delta, []);
const ms = Date.now() - t0;

if (!ideas?.length) {
  console.error(`\n[test-ideas] FAIL (${ms}ms) — returned null or empty.`);
  console.error('[test-ideas] Check runs/.cache/llm/parse-fail-ideas.txt for raw response.');
  process.exit(1);
}

console.log(`\n[test-ideas] OK (${ms}ms) — ${ideas.length} ideas:\n`);
for (const it of ideas) {
  console.log(`  [${it.confidence}] ${it.type} — ${it.title} (${it.ticker || 'n/a'})`);
}
