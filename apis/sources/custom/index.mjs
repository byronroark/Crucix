// Drop-in Custom Sources Loader
//
// Any *.mjs file you place in this directory is auto-discovered at sweep time
// (no registration in apis/briefing.mjs needed). Each file must export a
// `briefing` function (named or default) that returns:
//
//   {
//     itemsTicker:   [{ name, title, url?, timestamp, region?, tags?, content? }],
//     itemsAnalyzed: [{ name, title, url?, timestamp, region?, tags?, content? }],
//   }
//
// One bad file does NOT kill the others — each is wrapped in try/catch.
// See CUSTOM_SOURCES.md for a working example.

import { existsSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PER_MODULE_TIMEOUT_MS = 25_000;

export async function briefing() {
  if (!existsSync(__dirname)) {
    return emptyResult([]);
  }

  const entries = readdirSync(__dirname)
    .filter(f => f.endsWith('.mjs') && f !== 'index.mjs')
    .filter(f => {
      try { return statSync(join(__dirname, f)).isFile(); } catch { return false; }
    });

  if (!entries.length) return emptyResult([]);

  const results = await Promise.allSettled(
    entries.map(file => runDropIn(file))
  );

  const sources = {};
  const errors = [];
  let okCount = 0;
  for (let i = 0; i < results.length; i++) {
    const file = entries[i];
    const r = results[i];
    if (r.status === 'fulfilled' && r.value && !r.value.error) {
      sources[file.replace(/\.mjs$/, '')] = r.value.data;
      okCount++;
    } else {
      const err = r.status === 'fulfilled' ? r.value.error : r.reason?.message;
      errors.push({ file, error: String(err || 'unknown') });
    }
  }

  return {
    source: 'CustomDropIns',
    timestamp: new Date().toISOString(),
    configured: entries.length,
    ok: okCount,
    failed: errors.length,
    sources,
    errors,
  };
}

async function runDropIn(file) {
  try {
    const modUrl = pathToFileURL(join(__dirname, file)).href;
    const mod = await import(modUrl);
    const fn = typeof mod.briefing === 'function' ? mod.briefing
             : typeof mod.default === 'function' ? mod.default
             : null;
    if (!fn) return { error: 'no briefing() or default export' };

    const data = await Promise.race([
      Promise.resolve(fn()),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`drop-in "${file}" timed out`)), PER_MODULE_TIMEOUT_MS)),
    ]);

    return { data: normalize(data) };
  } catch (err) {
    return { error: err.message };
  }
}

function normalize(data) {
  if (!data || typeof data !== 'object') return { itemsTicker: [], itemsAnalyzed: [] };
  return {
    itemsTicker: Array.isArray(data.itemsTicker) ? data.itemsTicker : [],
    itemsAnalyzed: Array.isArray(data.itemsAnalyzed) ? data.itemsAnalyzed : [],
    meta: data.meta || {},
  };
}

function emptyResult(entries) {
  return { source: 'CustomDropIns', timestamp: new Date().toISOString(), configured: entries.length, ok: 0, failed: 0, sources: {}, errors: [] };
}
