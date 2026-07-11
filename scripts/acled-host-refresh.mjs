#!/usr/bin/env node
// Refresh ACLED OAuth tokens using the HOST's curl (outside Docker).
// Use when Cloudflare blocks requests from inside the container.
//
// Usage (on NUC host, not in docker):
//   node scripts/acled-host-refresh.mjs
//   node scripts/acled-host-refresh.mjs --debug

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import '../apis/utils/env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_FILE = join(ROOT, 'runs', '.cache', 'acled-oauth.json');
const TOKEN_URL = 'https://acleddata.com/oauth/token';
const debug = process.argv.includes('--debug');

function curlPost(body) {
  const raw = execFileSync('curl', [
    '-sS', '--http1.1', '--compressed',
    '-X', 'POST', TOKEN_URL,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '--data-binary', body,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (debug) console.error('[host-refresh] raw:', raw.slice(0, 300));
  return raw;
}

function loadRefreshToken() {
  const fromEnv = process.env.ACLED_REFRESH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const doc = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    return doc.refresh_token?.trim() || null;
  } catch {
    return null;
  }
}

const refreshToken = loadRefreshToken();
let body;
if (refreshToken) {
  console.log('[host-refresh] Using refresh_token…');
  body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: 'acled',
  }).toString();
} else {
  const email = process.env.ACLED_EMAIL?.trim();
  const password = process.env.ACLED_PASSWORD;
  if (!email || !password) {
    console.error('[host-refresh] Set ACLED_REFRESH_TOKEN or ACLED_EMAIL/ACLED_PASSWORD in .env');
    process.exit(2);
  }
  console.log('[host-refresh] Requesting new tokens (password grant)…');
  body = new URLSearchParams({
    username: email,
    password,
    grant_type: 'password',
    client_id: 'acled',
    scope: 'authenticated',
  }).toString();
}

let data;
try {
  data = JSON.parse(curlPost(body));
} catch (e) {
  console.error('[host-refresh] curl/parse failed:', e.message);
  process.exit(1);
}

if (!data.access_token) {
  console.error('[host-refresh] No access_token:', JSON.stringify(data).slice(0, 400));
  process.exit(1);
}

const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 86_400;
const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
const refreshExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

mkdirSync(dirname(CACHE_FILE), { recursive: true });
writeFileSync(CACHE_FILE, JSON.stringify({
  access_token: data.access_token,
  refresh_token: data.refresh_token || refreshToken || null,
  expires_at: expiresAt,
  refresh_expires_at: refreshExpiresAt,
  updated_at: new Date().toISOString(),
  source: 'host-refresh',
}, null, 2), 'utf8');

console.log(`[host-refresh] OK — wrote ${CACHE_FILE}`);
console.log(`[host-refresh] access expires ~${Math.round(expiresIn / 3600)}h`);
if (data.refresh_token || refreshToken) {
  console.log('[host-refresh] refresh_token saved — container can read runs/.cache/acled-oauth.json');
}
