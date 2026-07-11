#!/usr/bin/env node
// Refresh ACLED OAuth tokens using the HOST's curl (outside Docker).
// Use when Cloudflare blocks requests from inside the container.
//
// Usage (on NUC host, not in docker):
//   node scripts/acled-host-refresh.mjs
//   node scripts/acled-host-refresh.mjs --debug
//   node scripts/acled-host-refresh.mjs --password   # skip refresh, use email/password

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
const forcePassword = process.argv.includes('--password');

function cleanToken(value) {
  if (!value) return null;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v || null;
}

function curlPost(body) {
  const raw = execFileSync('curl', [
    '-sS', '--http1.1', '--compressed',
    '-X', 'POST', TOKEN_URL,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '--data-binary', body,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (debug) console.error('[host-refresh] raw:', raw.slice(0, 400));
  return raw;
}

function requestTokens(body) {
  try {
    return JSON.parse(curlPost(body));
  } catch (e) {
    console.error('[host-refresh] curl/parse failed:', e.message);
    process.exit(1);
  }
}

function loadRefreshToken() {
  const fromEnv = cleanToken(process.env.ACLED_REFRESH_TOKEN);
  if (fromEnv) return fromEnv;
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const doc = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    return cleanToken(doc.refresh_token);
  } catch {
    return null;
  }
}

function passwordGrantBody() {
  const email = cleanToken(process.env.ACLED_EMAIL);
  const password = process.env.ACLED_PASSWORD;
  if (!email || !password) return null;
  return new URLSearchParams({
    username: email,
    password,
    grant_type: 'password',
    client_id: 'acled',
    scope: 'authenticated',
  }).toString();
}

function refreshGrantBody(refreshToken) {
  return new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: 'acled',
  }).toString();
}

function isInvalidRefresh(data) {
  const code = String(data?.error || '').toLowerCase();
  const desc = String(data?.error_description || '').toLowerCase();
  return code === 'invalid_grant' || desc.includes('refresh token');
}

let data = null;
let usedRefreshToken = null;

if (!forcePassword) {
  const refreshToken = loadRefreshToken();
  if (refreshToken) {
    console.log('[host-refresh] Trying refresh_token…');
    usedRefreshToken = refreshToken;
    data = requestTokens(refreshGrantBody(refreshToken));
    if (!data.access_token && isInvalidRefresh(data)) {
      console.log('[host-refresh] refresh_token invalid — falling back to password grant…');
      data = null;
      usedRefreshToken = null;
    }
  }
}

if (!data?.access_token) {
  const body = passwordGrantBody();
  if (!body) {
    console.error('[host-refresh] Refresh failed and no password fallback.');
    console.error('[host-refresh] Set ACLED_EMAIL + ACLED_PASSWORD in .env, then re-run:');
    console.error('[host-refresh]   node scripts/acled-host-refresh.mjs --password');
    process.exit(2);
  }
  console.log('[host-refresh] Requesting new tokens (password grant)…');
  data = requestTokens(body);
}

if (!data.access_token) {
  console.error('[host-refresh] No access_token:', JSON.stringify(data).slice(0, 400));
  process.exit(1);
}

const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 86_400;
const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
const refreshExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const newRefresh = cleanToken(data.refresh_token) || usedRefreshToken;

mkdirSync(dirname(CACHE_FILE), { recursive: true });
writeFileSync(CACHE_FILE, JSON.stringify({
  access_token: data.access_token,
  refresh_token: newRefresh,
  expires_at: expiresAt,
  refresh_expires_at: refreshExpiresAt,
  updated_at: new Date().toISOString(),
  source: 'host-refresh',
}, null, 2), 'utf8');

console.log(`[host-refresh] OK — wrote ${CACHE_FILE}`);
console.log(`[host-refresh] access expires ~${Math.round(expiresIn / 3600)}h`);
if (newRefresh) {
  console.log('[host-refresh] refresh_token saved — update ACLED_REFRESH_TOKEN in .env if you use env bootstrap');
}
