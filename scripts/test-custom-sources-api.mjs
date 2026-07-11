#!/usr/bin/env node
// Round-trip test for user-managed custom sources store (no HTTP server).

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.CUSTOM_SOURCES_USER_FILE = join(mkdtempSync(join(tmpdir(), 'crucix-src-')), 'custom-sources.json');

const { addSource, updateSource, deleteSource, listSources, loadMergedSources } =
  await import(`file://${join(ROOT, 'lib/config/custom-sources-store.mjs')}`);

const added = addSource({
  name: 'Test Feed',
  url: 'https://example.com/rss.xml',
  tier: 'analyzed',
  region: 'Europe',
  tags: 'test, demo',
});
if (!added.ok) {
  console.error('[test-custom-sources-api] add failed:', added.errors);
  process.exit(1);
}

const id = added.source.id;
const updated = updateSource(id, { name: 'Test Feed Updated', region: 'Asia' });
if (!updated.ok) {
  console.error('[test-custom-sources-api] update failed:', updated.errors);
  process.exit(1);
}

const merged = loadMergedSources();
if (!merged.some(s => s.name === 'Test Feed Updated')) {
  console.error('[test-custom-sources-api] merged sources missing update');
  process.exit(1);
}

const listed = listSources();
if (!listed.some(s => s.id === id && s.editable)) {
  console.error('[test-custom-sources-api] listSources missing user entry');
  process.exit(1);
}

const removed = deleteSource(id);
if (!removed.ok) {
  console.error('[test-custom-sources-api] delete failed:', removed.errors);
  process.exit(1);
}

console.log('[test-custom-sources-api] OK — add / update / merge / list / delete');
