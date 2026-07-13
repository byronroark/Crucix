#!/usr/bin/env node
// Patch runs/latest.json with current space briefing (uses snapshot when CelesTrak blocked).
// Run on NUC: docker compose exec crucix node scripts/patch-space-latest.mjs
// Then: docker compose restart crucix

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { briefing } from '../apis/sources/space.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const latestPath = join(ROOT, 'runs', 'latest.json');

if (!existsSync(latestPath)) {
  console.error('No runs/latest.json — wait for first sweep or run a full briefing.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(latestPath, 'utf8'));
const space = await briefing();

raw.sources = raw.sources || {};
raw.sources.Space = space;
raw.errors = (raw.errors || []).filter(e => e.name !== 'Space');
if (raw.crucix) {
  const ok = Object.keys(raw.sources).length;
  raw.crucix.sourcesOk = ok;
  raw.crucix.sourcesFailed = (raw.errors || []).length;
}

writeFileSync(latestPath, JSON.stringify(raw, null, 2));
console.log('Patched Space in latest.json:', space.status, 'new=', space.totalNewObjects, 'mil=', space.militarySatellites);
console.log('Restart container to refresh dashboard: docker compose restart crucix');
