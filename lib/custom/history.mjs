// Append-only historical log for custom OSINT items (opt-in via config).

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../crucix.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function historyDir() {
  const rel = config.customSourcesHistoryDir || 'runs/memory/custom';
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  return join(ROOT, rel);
}

function itemKey(item) {
  const basis = [item.name, item.url, item.title, item.timestamp].filter(Boolean).join('|');
  return createHash('sha1').update(basis).digest('hex').substring(0, 16);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Append new custom items to per-source history logs.
 * @param {Array<{name:string,title:string,url?:string,timestamp?:string,content?:string,region?:string,tags?:string[]}>} items
 */
export function appendCustomHistory(items = []) {
  if (config.customSourcesHistory === false) return;
  if (!items.length) return;

  const dir = historyDir();
  ensureDir(dir);
  const maxPerSource = config.customSourcesHistoryMaxPerSource ?? 500;

  const bySource = new Map();
  for (const it of items) {
    if (!it?.name || !it?.title) continue;
    if (!bySource.has(it.name)) bySource.set(it.name, []);
    bySource.get(it.name).push(it);
  }

  for (const [sourceName, batch] of bySource) {
    const safeName = sourceName.replace(/[^a-zA-Z0-9._-]+/g, '_').substring(0, 60);
    const filePath = join(dir, `${safeName}.jsonl`);
    let seen = new Set();
    if (existsSync(filePath)) {
      try {
        const lines = readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
        for (const line of lines.slice(-maxPerSource)) {
          try { seen.add(itemKey(JSON.parse(line))); } catch { /* skip */ }
        }
      } catch { /* start fresh */ }
    }

    const newLines = [];
    for (const it of batch) {
      const key = itemKey(it);
      if (seen.has(key)) continue;
      seen.add(key);
      newLines.push(JSON.stringify({
        ts: it.timestamp || new Date().toISOString(),
        title: it.title,
        url: it.url || null,
        region: it.region || null,
        tags: it.tags || [],
        content: it.content ? String(it.content).substring(0, 500) : null,
      }));
    }
    if (!newLines.length) continue;

    let existing = '';
    if (existsSync(filePath)) {
      try {
        const lines = readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
        existing = lines.slice(-(maxPerSource - newLines.length)).join('\n');
        if (existing) existing += '\n';
      } catch { /* overwrite */ }
    }
    writeFileSync(filePath, existing + newLines.join('\n') + '\n', 'utf8');
  }
}
