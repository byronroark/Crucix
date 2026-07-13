#!/usr/bin/env node
// Diagnose CelesTrak / ISS fallback connectivity (run on host or: docker compose exec crucix node scripts/test-space-network.mjs)

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TESTS = [
  {
    name: 'CelesTrak stations (small JSON)',
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  },
  {
    name: 'CelesTrak last-30-days',
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json',
  },
  {
    name: 'WhereTheISS ISS (fallback API)',
    url: 'https://api.wheretheiss.at/v1/satellites/25544',
  },
];

async function curlProbe(url) {
  const t0 = Date.now();
  try {
    const { stdout } = await execFileAsync('curl', [
      '-fsSL',
      '--connect-timeout', '8',
      '--max-time', '15',
      '-A', 'Crucix/1.0',
      '-w', '\n__HTTP__%{http_code}__TIME__%{time_total}',
      url,
    ], { maxBuffer: 2 * 1024 * 1024 });
    const ms = Date.now() - t0;
    const meta = stdout.match(/__HTTP__(\d+)__TIME__([\d.]+)/);
    const body = stdout.replace(/\n__HTTP__\d+__TIME__[\d.]+$/, '');
    const code = meta?.[1] || '?';
    const preview = body.slice(0, 80).replace(/\s+/g, ' ');
    return { ok: true, ms, code, preview: `${preview}...` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message?.split('\n')[0] || String(e) };
  }
}

async function fetchProbe(url) {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix/1.0' },
    });
    clearTimeout(timer);
    const text = await res.text();
    return {
      ok: res.ok,
      ms: Date.now() - t0,
      code: res.status,
      preview: text.slice(0, 80).replace(/\s+/g, ' ') + '...',
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message };
  }
}

console.log('Crucix space network diagnostics\n');
for (const test of TESTS) {
  console.log(`== ${test.name}`);
  console.log(`   ${test.url}`);
  const curl = await curlProbe(test.url);
  console.log(`   curl: ${curl.ok ? `OK HTTP ${curl.code} in ${curl.ms}ms` : `FAIL in ${curl.ms}ms — ${curl.error}`}`);
  if (curl.preview) console.log(`         ${curl.preview}`);
  const f = await fetchProbe(test.url);
  console.log(`   fetch: ${f.ok ? `OK HTTP ${f.code} in ${f.ms}ms` : `FAIL in ${f.ms}ms — ${f.error}`}`);
  console.log('');
}

console.log('Notes:');
console.log('- CelesTrak TCP timeouts usually mean your public IP is temporarily firewalled (too many catalog downloads).');
console.log('- CelesTrak GP data only updates every ~2 hours; Crucix caches between refreshes.');
console.log('- If curl works on the host but fails in Docker, compare DNS/routing (try network_mode: host).');
