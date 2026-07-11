// ACLED — Armed Conflict Location & Event Data
// Auth strategy (tries in order):
//   1. Cached OAuth tokens (runs/.cache/acled-oauth.json) or ACLED_ACCESS_TOKEN + ACLED_REFRESH_TOKEN in .env
//   2. OAuth refresh_token grant (avoids password when Cloudflare blocks Node fetch)
//   3. OAuth password grant (ACLED_EMAIL + ACLED_PASSWORD) — often blocked by Cloudflare in Docker/Node
//   4. Cookie-based session fallback
// Data endpoint: GET https://acleddata.com/api/acled/read
// Docs: https://acleddata.com/api-documentation/getting-started

import { execFile, execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { daysAgo } from '../utils/fetch.mjs';
import '../utils/env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_CACHE_FILE = join(__dirname, '..', '..', 'runs', '.cache', 'acled-oauth.json');

const LOGIN_URL = 'https://acleddata.com/user/login?_format=json';
const TOKEN_URL = 'https://acleddata.com/oauth/token';
const API_BASE  = 'https://acleddata.com/api/acled/read';

const TOKEN_SKEW_MS = 60_000;           // refresh 1 min before access token expiry
const DEFAULT_ACCESS_TTL_SEC = 86_400;    // 24h per ACLED docs
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days per ACLED docs

/** Populated on each authenticate() call — useful for test:acled --debug */
export const lastAuthDiagnostics = { attempts: [] };

const ACLED_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ACLED_BROWSER_HEADERS = {
  'User-Agent': ACLED_BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

/** @deprecated alias — use buildAcledHeaders() */
const ACLED_FETCH_HEADERS = ACLED_BROWSER_HEADERS;

function buildAcledHeaders(extra = {}) {
  return { ...ACLED_BROWSER_HEADERS, ...extra };
}

function buildAcledPostHeaders(extra = {}) {
  return buildAcledHeaders({
    Origin: 'https://acleddata.com',
    Referer: 'https://acleddata.com/',
    ...extra,
  });
}

function isDebug() {
  return process.argv.includes('--debug');
}

function debugLog(...args) {
  if (isDebug()) console.error('[ACLED DEBUG]', ...args);
}

const execFileAsync = promisify(execFile);

let curlAvailable = false;
try {
  execFileSync('curl', ['--version'], { stdio: 'ignore' });
  curlAvailable = true;
} catch {
  curlAvailable = false;
}

let cycleTlsModule = null;
let cycleTlsClient = null;
let cycleTlsInitPromise = null;
let cycleTlsChecked = false;
let cycleTlsAvailable = false;

async function ensureCycleTls() {
  if (cycleTlsChecked) return cycleTlsAvailable;
  cycleTlsChecked = true;
  try {
    cycleTlsModule = await import('cycletls');
    cycleTlsAvailable = true;
  } catch {
    cycleTlsAvailable = false;
  }
  return cycleTlsAvailable;
}

async function getCycleTlsClient() {
  if (cycleTlsClient) return cycleTlsClient;
  if (!cycleTlsInitPromise) {
    cycleTlsInitPromise = (async () => {
      await ensureCycleTls();
      if (!cycleTlsModule) throw new Error('cycletls package not installed');
      const initCycleTLS = cycleTlsModule.default ?? cycleTlsModule;
      cycleTlsClient = await initCycleTLS();
      return cycleTlsClient;
    })();
  }
  return cycleTlsInitPromise;
}

function shouldUseCycleTls() {
  const pref = String(process.env.ACLED_USE_CYCLETLS ?? '').trim().toLowerCase();
  if (pref === '0' || pref === 'false' || pref === 'no') return false;
  if (pref === '1' || pref === 'true' || pref === 'yes') return true;
  return false;
}

export function getAcledTransportInfo() {
  return {
    curlAvailable,
    cycleTlsChecked,
    cycleTlsAvailable,
    useCurl: shouldUseCurl(),
    useCycleTls: shouldUseCycleTls(),
    acledUseCurl: process.env.ACLED_USE_CURL ?? '(auto)',
    acledUseCycletls: process.env.ACLED_USE_CYCLETLS ?? '(fallback on Cloudflare)',
  };
}

export async function probeAcledTransport() {
  await ensureCycleTls();
  return getAcledTransportInfo();
}

function shouldUseCurl() {
  const pref = String(process.env.ACLED_USE_CURL ?? '').trim().toLowerCase();
  if (pref === '0' || pref === 'false' || pref === 'no') return false;
  if (pref === '1' || pref === 'true' || pref === 'yes') return true;
  return curlAvailable;
}

function parseCurlHeaderDump(headerText) {
  const blocks = String(headerText || '').split(/\r?\n\r?\n/).filter((b) => /HTTP\//i.test(b));
  const last = blocks[blocks.length - 1] || '';
  const setCookies = [];
  for (const line of last.split(/\r?\n/)) {
    const m = line.match(/^set-cookie:\s*(.+)/i);
    if (m) setCookies.push(m[1]);
  }
  return { setCookies };
}

async function acledRequestFetch(url, {
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 15000,
  followRedirects = true,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      redirect: followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    const setCookies = res.headers.getSetCookie?.() || [];
    return { status: res.status, body: text, setCookies };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw Object.assign(new Error('Request timed out'), { name: 'AbortError' });
    throw e;
  }
}

async function acledRequestCurl(url, {
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 15000,
  followRedirects = true,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'acled-'));
  const bodyFile = join(dir, 'body.txt');
  const headerFile = join(dir, 'headers.txt');
  const args = [
    '-sS',
    '--http1.1',
    '--compressed',
    followRedirects ? '-L' : '--no-location',
    '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    '-D', headerFile,
    '-o', bodyFile,
    '-w', '%{http_code}',
  ];
  if (method && method !== 'GET') args.push('-X', method);
  for (const [key, value] of Object.entries(headers)) {
    if (value != null && value !== '') args.push('-H', `${key}: ${value}`);
  }
  if (body != null) args.push('--data-binary', body);
  args.push(url);

  try {
    const { stdout } = await execFileAsync('curl', args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const status = Number.parseInt(String(stdout).trim(), 10) || 0;
    const text = await readFile(bodyFile, 'utf8').catch(() => '');
    const headerText = await readFile(headerFile, 'utf8').catch(() => '');
    const { setCookies } = parseCurlHeaderDump(headerText);
    return { status, body: text, setCookies, transport: 'curl' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function acledRequestCycleTLS(url, {
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 15000,
  followRedirects = true,
} = {}) {
  const cycleTLS = await getCycleTlsClient();
  const response = await cycleTLS(url, {
    headers,
    body: body ?? '',
    timeout: Math.max(5, Math.ceil(timeoutMs)),
    disableRedirect: !followRedirects,
    userAgent: ACLED_BROWSER_UA,
    forceHTTP1: true,
  }, method.toLowerCase());

  const status = Number(response?.status) || 0;
  const text = typeof response?.body === 'string'
    ? response.body
    : (response?.body ? String(response.body) : '');
  return { status, body: text, setCookies: [], transport: 'cycletls' };
}

/** @returns {Promise<{ status: number, body: string, setCookies: string[], transport: string }>} */
async function acledRequest(url, opts = {}) {
  const headers = opts.headers?.Authorization || opts.headers?.Cookie
    ? buildAcledHeaders(opts.headers)
    : buildAcledPostHeaders(opts.headers);
  const mergedOpts = { ...opts, headers };

  if (shouldUseCycleTls()) {
    await ensureCycleTls();
    if (cycleTlsAvailable) {
      debugLog(`HTTP ${mergedOpts.method || 'GET'} via cycletls (ACLED_USE_CYCLETLS=1)`);
      return acledRequestCycleTLS(url, mergedOpts);
    }
    debugLog('ACLED_USE_CYCLETLS=1 but cycletls is not installed');
  }

  const viaCurl = shouldUseCurl();
  if (viaCurl) {
    if (!curlAvailable) {
      debugLog('ACLED_USE_CURL=1 but curl binary not found in container — rebuild image');
    } else {
      debugLog(`HTTP ${mergedOpts.method || 'GET'} via curl`);
      const result = await acledRequestCurl(url, mergedOpts);
      if (cloudflareHint(result.body)) {
        await ensureCycleTls();
        if (cycleTlsAvailable) {
          debugLog('Cloudflare blocked curl — retrying via cycletls');
          return acledRequestCycleTLS(url, mergedOpts);
        }
      }
      return result;
    }
  }

  try {
    const result = await acledRequestFetch(url, mergedOpts);
    result.transport = 'fetch';
    if (cloudflareHint(result.body)) {
      if (curlAvailable) {
        debugLog('Cloudflare blocked fetch — retrying via curl');
        const curlResult = await acledRequestCurl(url, mergedOpts);
        if (!cloudflareHint(curlResult.body)) return curlResult;
      }
      await ensureCycleTls();
      if (cycleTlsAvailable) {
        debugLog('Cloudflare blocked fetch/curl — retrying via cycletls');
        return acledRequestCycleTLS(url, mergedOpts);
      }
    }
    return result;
  } catch (e) {
    if (curlAvailable) {
      debugLog(`fetch failed (${e.message}) — retrying via curl`);
      const curlResult = await acledRequestCurl(url, mergedOpts);
      if (!cloudflareHint(curlResult.body)) return curlResult;
    }
    await ensureCycleTls();
    if (cycleTlsAvailable) {
      debugLog(`fetch/curl failed — retrying via cycletls`);
      return acledRequestCycleTLS(url, mergedOpts);
    }
    throw e;
  }
}

function cloudflareHint(raw) {
  const text = String(raw || '');
  if (/just a moment|cf-browser-verification|cloudflare/i.test(text)) {
    return 'Cloudflare bot challenge blocked this request from the server. '
      + 'Rebuild with `docker compose up -d --build`, set ACLED_USE_CYCLETLS=1 in .env, '
      + 'or refresh tokens on the NUC host: `node scripts/acled-host-refresh.mjs`.';
  }
  return null;
}

function parseAcledJson(raw, context) {
  const cf = cloudflareHint(raw);
  if (cf) return { error: `${context}: ${cf}` };

  try {
    return { data: raw ? JSON.parse(raw) : null };
  } catch {
    return { error: `${context} returned non-JSON: ${String(raw).slice(0, 200)}` };
  }
}

function noteAuthAttempt(message) {
  lastAuthDiagnostics.attempts.push(message);
  debugLog(message);
}

function hasAcledConfig() {
  if (process.env.ACLED_ACCESS_TOKEN?.trim()) return true;
  if (process.env.ACLED_EMAIL && process.env.ACLED_PASSWORD) return true;
  if (existsSync(TOKEN_CACHE_FILE)) return true;
  return false;
}

function ensureTokenCacheDir() {
  const dir = dirname(TOKEN_CACHE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function persistOAuthTokens() {
  if (sessionCache.method !== 'oauth' || !sessionCache.token) return;
  try {
    ensureTokenCacheDir();
    writeFileSync(TOKEN_CACHE_FILE, JSON.stringify({
      access_token: sessionCache.token,
      refresh_token: sessionCache.refreshToken || null,
      expires_at: new Date(sessionCache.expires).toISOString(),
      refresh_expires_at: sessionCache.refreshExpires
        ? new Date(sessionCache.refreshExpires).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    }, null, 2), 'utf8');
    debugLog(`Persisted tokens to ${TOKEN_CACHE_FILE}`);
  } catch (err) {
    debugLog('Failed to persist ACLED tokens:', err.message);
  }
}

function loadTokenCacheIntoSession() {
  if (!existsSync(TOKEN_CACHE_FILE)) return false;
  try {
    const doc = JSON.parse(readFileSync(TOKEN_CACHE_FILE, 'utf8'));
    const expires = doc.expires_at ? new Date(doc.expires_at).getTime() : 0;
    if (!doc.access_token || !expires || Date.now() >= expires - TOKEN_SKEW_MS) return false;
    sessionCache = {
      cookies: null,
      token: doc.access_token,
      refreshToken: doc.refresh_token || null,
      method: 'oauth',
      expires,
      refreshExpires: doc.refresh_expires_at
        ? new Date(doc.refresh_expires_at).getTime()
        : (doc.refresh_token ? Date.now() + REFRESH_TTL_MS : 0),
    };
    debugLog('Loaded valid access token from disk cache');
    return true;
  } catch {
    return false;
  }
}

function cleanEnvToken(value) {
  if (!value) return null;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v || null;
}

function seedRefreshToken() {
  const envRefresh = cleanEnvToken(process.env.ACLED_REFRESH_TOKEN);
  if (envRefresh) {
    sessionCache.refreshToken = envRefresh;
    sessionCache.refreshExpires = Date.now() + REFRESH_TTL_MS;
    debugLog('Seeded refresh_token from .env');
    return;
  }

  if (!existsSync(TOKEN_CACHE_FILE)) return;
  try {
    const doc = JSON.parse(readFileSync(TOKEN_CACHE_FILE, 'utf8'));
    const cached = doc.refresh_token?.trim();
    if (!cached) return;
    sessionCache.refreshToken = cached;
    sessionCache.refreshExpires = doc.refresh_expires_at
      ? new Date(doc.refresh_expires_at).getTime()
      : Date.now() + REFRESH_TTL_MS;
    debugLog('Seeded refresh_token from disk cache');
  } catch {
    // ignore corrupt cache
  }
}
function envTokenBootstrap() {
  const access = cleanEnvToken(process.env.ACLED_ACCESS_TOKEN);
  if (!access) return null;
  const refresh = cleanEnvToken(process.env.ACLED_REFRESH_TOKEN);
  return {
    token: access,
    refreshToken: refresh,
    expires: Date.now() + DEFAULT_ACCESS_TTL_SEC * 1000,
    refreshExpires: refresh ? Date.now() + REFRESH_TTL_MS : 0,
  };
}

/** @type {{ cookies: string|null, token: string|null, refreshToken: string|null, method: string|null, expires: number, refreshExpires: number }} */
let sessionCache = {
  cookies: null,
  token: null,
  refreshToken: null,
  method: null,
  expires: 0,
  refreshExpires: 0,
};

function emptySession() {
  sessionCache = {
    cookies: null,
    token: null,
    refreshToken: null,
    method: null,
    expires: 0,
    refreshExpires: 0,
  };
}

function invalidateAccessToken() {
  sessionCache.token = null;
  sessionCache.expires = 0;
}

function accessTokenValid() {
  return sessionCache.method === 'oauth'
    && typeof sessionCache.token === 'string'
    && sessionCache.token.length > 0
    && Date.now() < sessionCache.expires - TOKEN_SKEW_MS;
}

function refreshTokenValid() {
  return typeof sessionCache.refreshToken === 'string'
    && sessionCache.refreshToken.length > 0
    && Date.now() < sessionCache.refreshExpires;
}

function parseOAuthTokenResponse(data) {
  if (!data || typeof data !== 'object') {
    return { error: 'OAuth response was not a JSON object' };
  }

  const token = typeof data.access_token === 'string' ? data.access_token.trim() : '';
  if (!token || token.length < 8) {
    return { error: `Invalid access_token in OAuth response: ${JSON.stringify(data).slice(0, 200)}` };
  }

  const tokenType = String(data.token_type || 'Bearer').toLowerCase();
  if (tokenType !== 'bearer') {
    return { error: `Unexpected token_type "${data.token_type}" (expected Bearer)` };
  }

  const expiresIn = Number(data.expires_in);
  const ttlSec = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_ACCESS_TTL_SEC;

  const refreshToken = typeof data.refresh_token === 'string' && data.refresh_token.trim().length > 0
    ? data.refresh_token.trim()
    : null;

  return {
    token,
    refreshToken,
    expires: Date.now() + ttlSec * 1000,
    refreshExpires: refreshToken ? Date.now() + REFRESH_TTL_MS : 0,
  };
}

async function postOAuthToken(body) {
  try {
    const { status, body: raw } = await acledRequest(TOKEN_URL, {
      method: 'POST',
      headers: buildAcledPostHeaders({
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body: body.toString(),
      timeoutMs: 15000,
    });

    const parsed = parseAcledJson(raw, `OAuth token endpoint (HTTP ${status})`);
    if (parsed.error) return { error: parsed.error };
    const data = parsed.data;

    if (!data || typeof data !== 'object') {
      debugLog(`OAuth response body (HTTP ${status}, ${raw.length} bytes): ${raw.slice(0, 300)}`);
      return { error: `OAuth failed (HTTP ${status}): empty or non-JSON response` };
    }

    if (status < 200 || status >= 300) {
      const msg = data?.error_description || data?.message || data?.error || raw.slice(0, 200);
      return { error: `OAuth failed (HTTP ${status}): ${msg}` };
    }

    return parseOAuthTokenResponse(data);
  } catch (e) {
    const cause = e.cause ? ` → ${e.cause.message || e.cause.code || e.cause}` : '';
    if (e.name === 'AbortError') return { error: 'OAuth error: Request timed out' };
    return { error: `OAuth error: ${e.message}${cause}` };
  }
}

// OAuth2 password grant — https://acleddata.com/api-documentation/getting-started
async function loginOAuth(email, password) {
  const body = new URLSearchParams({
    username: email,
    password,
    grant_type: 'password',
    client_id: 'acled',
    scope: 'authenticated',
  });
  return postOAuthToken(body);
}

// OAuth2 refresh grant — avoids re-posting password when access token expires
async function refreshOAuthToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: 'acled',
  });
  return postOAuthToken(body);
}

// Lightweight read to confirm credentials can access ACLED data
async function probeApiAccess(headers, label) {
  const params = new URLSearchParams({ _format: 'json', limit: '1' });
  try {
    const { status, body: raw } = await acledRequest(`${API_BASE}?${params}`, {
      headers: buildAcledHeaders(headers),
      timeoutMs: 15000,
    });

    const parsed = parseAcledJson(raw, `${label} probe (HTTP ${status})`);
    if (parsed.error) return { error: parsed.error };
    const data = parsed.data;

    if (status < 200 || status >= 300) {
      const msg = data?.message || raw.slice(0, 200);
      const hint = status === 401
        ? ' (access token expired or invalid)'
        : '';
      return { error: `${label} probe failed (HTTP ${status})${hint}: ${msg}` };
    }

    if (data?.status && data.status !== 200) {
      return { error: `${label} probe API error: status ${data.status} — ${data.message || 'Unknown error'}` };
    }

    if (!Array.isArray(data?.data)) {
      return { error: `${label} probe succeeded but response missing data array` };
    }

    return { ok: true };
  } catch (e) {
    if (e.name === 'AbortError') return { error: `${label} probe timed out (15s)` };
    return { error: `${label} probe error: ${e.message}` };
  }
}

async function probeAccessToken(token) {
  return probeApiAccess({ Authorization: `Bearer ${token}` }, 'OAuth token');
}

async function probeCookieSession(cookies) {
  return probeApiAccess({ Cookie: cookies }, 'Cookie session');
}

function applyOAuthSession(parsed, { keepRefreshOnMissing = true } = {}) {
  const refreshToken = parsed.refreshToken
    || (keepRefreshOnMissing ? sessionCache.refreshToken : null);
  const refreshExpires = parsed.refreshToken
    ? parsed.refreshExpires
    : (keepRefreshOnMissing ? sessionCache.refreshExpires : 0);

  sessionCache = {
    cookies: null,
    token: parsed.token,
    refreshToken,
    method: 'oauth',
    expires: parsed.expires,
    refreshExpires,
  };
  return sessionCache;
}

async function establishOAuthSession(tokenResult) {
  if (tokenResult.error) return tokenResult;

  const probe = await probeAccessToken(tokenResult.token);
  if (probe.error) {
    return { error: `OAuth token rejected by ACLED API: ${probe.error}` };
  }

  applyOAuthSession(tokenResult);
  persistOAuthTokens();
  debugLog(`OAuth session ready — access expires in ${Math.round((sessionCache.expires - Date.now()) / 60000)} min`
    + (sessionCache.refreshToken ? ', refresh token cached' : ''));
  return sessionCache;
}

// Cookie-based session login (mirrors browser / Postman flow)
async function loginCookie(email, password) {
  try {
    const { status, body: errText, setCookies } = await acledRequest(LOGIN_URL, {
      method: 'POST',
      headers: buildAcledPostHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: email, pass: password }),
      followRedirects: false,
      timeoutMs: 15000,
    });

    const cookieStr = setCookies.map((c) => c.split(';')[0]).join('; ');

    if (status >= 200 && status < 300 && cookieStr) {
      return { cookies: cookieStr };
    }

    if (status >= 300 && status < 400 && cookieStr) {
      return { cookies: cookieStr };
    }

    if (status >= 200 && status < 300 && !cookieStr) {
      return { error: `Cookie login returned HTTP ${status} but no session cookie (check email/password and Terms of Use at acleddata.com)` };
    }

    return { error: `Cookie login failed (HTTP ${status}): ${errText.slice(0, 200)}` };
  } catch (e) {
    const cause = e.cause ? ` → ${e.cause.message || e.cause.code || e.cause}` : '';
    if (e.name === 'AbortError') return { error: 'Cookie login error: Request timed out' };
    return { error: `Cookie login error: ${e.message}${cause}` };
  }
}

async function establishCookieSession(cookieResult) {
  if (cookieResult.error) return cookieResult;

  const probe = await probeCookieSession(cookieResult.cookies);
  if (probe.error) {
    return { error: `Cookie session rejected by ACLED API: ${probe.error}` };
  }

  sessionCache = {
    cookies: cookieResult.cookies,
    token: null,
    refreshToken: null,
    method: 'cookie',
    expires: Date.now() + 12 * 60 * 60 * 1000,
    refreshExpires: 0,
  };
  debugLog('Cookie session ready (probed)');
  return sessionCache;
}

async function authenticate() {
  const email = process.env.ACLED_EMAIL;
  const password = process.env.ACLED_PASSWORD;
  if (!hasAcledConfig()) {
    return { error: 'No ACLED credentials. Set ACLED_ACCESS_TOKEN (+ ACLED_REFRESH_TOKEN) or ACLED_EMAIL and ACLED_PASSWORD in .env.' };
  }

  lastAuthDiagnostics.attempts = [];

  if (accessTokenValid()) {
    return sessionCache;
  }

  if (loadTokenCacheIntoSession() && accessTokenValid()) {
    return sessionCache;
  }

  const errors = [];

  seedRefreshToken();

  // Refresh access token without re-posting password
  if (refreshTokenValid()) {
    debugLog('Access token expired — refreshing via refresh_token');
    const refreshed = await refreshOAuthToken(sessionCache.refreshToken);
    if (refreshed.token) {
      const session = await establishOAuthSession(refreshed);
      if (!session.error) return session;
      errors.push(`Refresh+probe: ${session.error}`);
      noteAuthAttempt(session.error);
    } else {
      errors.push(`Refresh: ${refreshed.error}`);
      noteAuthAttempt(refreshed.error);
    }
    sessionCache.refreshToken = null;
    sessionCache.refreshExpires = 0;
  }

  // Bootstrap from .env access token (paste from curl.exe on Windows — see .env.example)
  const envTokens = envTokenBootstrap();
  if (envTokens) {
    debugLog('Probing ACLED_ACCESS_TOKEN from .env');
    const session = await establishOAuthSession(envTokens);
    if (!session.error) return session;
    errors.push(`Env token+probe: ${session.error}`);
    noteAuthAttempt(session.error);
  }

  if (!email || !password) {
    emptySession();
    return { error: `ACLED token auth failed and no password fallback configured.\n${errors.join('\n')}` };
  }

  // Password grant (initial login or after refresh failure)
  debugLog('Requesting new OAuth access token (password grant)');
  const oauthResult = await loginOAuth(email, password);
  if (oauthResult.token) {
    const session = await establishOAuthSession(oauthResult);
    if (!session.error) return session;
    errors.push(`OAuth+probe: ${session.error}`);
    noteAuthAttempt(session.error);
  } else {
    errors.push(`OAuth: ${oauthResult.error}`);
    noteAuthAttempt(oauthResult.error);
  }

  // Fall back to cookie-based session (also probed — no false OK)
  const cookieResult = await loginCookie(email, password);
  if (cookieResult.cookies) {
    const session = await establishCookieSession(cookieResult);
    if (!session.error) return session;
    errors.push(`Cookie+probe: ${session.error}`);
    noteAuthAttempt(session.error);
  } else {
    errors.push(`Cookie: ${cookieResult.error}`);
    noteAuthAttempt(cookieResult.error);
  }

  emptySession();
  const tokenHint = errors.some((e) => /401|400|expired|invalid/i.test(e))
    ? '\n\n→ Tokens are expired or invalid. Refresh on the NUC host:\n'
      + '    node scripts/acled-host-refresh.mjs\n'
      + '  Or get new tokens via PowerShell curl.exe and update ACLED_ACCESS_TOKEN + ACLED_REFRESH_TOKEN in .env.'
    : '';
  return { error: `All ACLED auth methods failed.\n${errors.join('\n')}${tokenHint}` };
}

function authHeaders(session) {
  const headers = buildAcledHeaders({ 'Content-Type': 'application/json' });
  if (session.method === 'cookie' && session.cookies) {
    headers.Cookie = session.cookies;
  } else if (session.method === 'oauth' && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return headers;
}

async function fetchAcledData(url, session) {
  const { status, body } = await acledRequest(url, {
    headers: authHeaders(session),
    timeoutMs: 25000,
  });
  return { status, errText: body };
}

// Event type constants
export const EVENT_TYPES = [
  'Battles',
  'Explosions/Remote violence',
  'Violence against civilians',
  'Protests',
  'Riots',
  'Strategic developments',
];

// Query conflict events with flexible filters
export async function getEvents(opts = {}) {
  const {
    limit = 500,
    eventDateStart,
    eventDateEnd,
    eventType,
    country,
    region,
  } = opts;

  let session = await authenticate();
  if (session.error) return { error: session.error };

  const params = new URLSearchParams({ _format: 'json', limit: String(limit) });
  if (eventDateStart && eventDateEnd) {
    params.set('event_date', `${eventDateStart}|${eventDateEnd}`);
    params.set('event_date_where', 'BETWEEN');
  }
  if (eventType) params.set('event_type', eventType);
  if (country) params.set('country', country);
  if (region) params.set('region', String(region));

  const url = `${API_BASE}?${params}`;

  try {
    let { status, errText } = await fetchAcledData(url, session);
    debugLog(`Data response: HTTP ${status}`);

    // On 401, invalidate access token and retry once (refresh or password grant)
    if (status === 401 && session.method === 'oauth') {
      debugLog('Data request 401 — re-authenticating');
      invalidateAccessToken();
      session = await authenticate();
      if (session.error) {
        return { error: `ACLED re-auth after 401 failed: ${session.error}` };
      }
      ({ status, errText } = await fetchAcledData(url, session));
      debugLog(`Retry data response: HTTP ${status}`);
    }

    if (status < 200 || status >= 300) {
      if (isDebug()) debugLog(`Error body: ${errText.slice(0, 500)}`);
      const cf = cloudflareHint(errText);
      if (cf) {
        emptySession();
        return { error: `ACLED blocked by Cloudflare (HTTP ${status}, auth method: ${session.method}). ${cf}` };
      }
      if (status === 401 || status === 403) {
        emptySession();
        const hint = status === 403
          ? '\n→ Fix: Log in at https://acleddata.com/user/login, then:\n'
            + '  1. Accept Terms of Use (profile → Terms of Use button → check the box)\n'
            + '  2. Complete all required profile fields\n'
            + '  3. Ensure your account has the "API" access group\n'
            + '  Contact access@acleddata.com if issues persist.'
          : '';
        return { error: `ACLED data access denied (HTTP ${status}, auth method: ${session.method}). Response: ${errText.slice(0, 300)}${hint}` };
      }
      return { error: `HTTP ${status}: ${errText.slice(0, 200)}` };
    }

    const parsed = parseAcledJson(errText, `ACLED data (HTTP ${status})`);
    if (parsed.error) return { error: parsed.error };
    const data = parsed.data;

    if (data?.status && data.status !== 200) {
      return { error: `ACLED API error: status ${data.status} — ${data.message || 'Unknown error'}` };
    }

    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      return { error: 'ACLED data request timed out (25s)' };
    }
    const rootCause = e.cause ? `${e.cause.message || e.cause.code || e.cause}` : '';
    return { error: `ACLED data error: ${e.message}${rootCause ? ' → ' + rootCause : ''}` };
  }
}

// Summarize events by a given field
function groupBy(events, field) {
  const map = {};
  for (const e of events) {
    const key = e[field] || 'Unknown';
    if (!map[key]) map[key] = { count: 0, fatalities: 0 };
    map[key].count += 1;
    map[key].fatalities += parseInt(e.fatalities, 10) || 0;
  }
  return map;
}

// Briefing — last 7 days of global conflict events
export async function briefing() {
  if (!hasAcledConfig()) {
    return {
      source: 'ACLED',
      timestamp: new Date().toISOString(),
      status: 'no_credentials',
      message: 'Set ACLED_ACCESS_TOKEN (+ ACLED_REFRESH_TOKEN) or ACLED_EMAIL/ACLED_PASSWORD in .env. See .env.example.',
    };
  }

  const start = daysAgo(7);
  const end   = daysAgo(0);

  const data = await getEvents({
    eventDateStart: start,
    eventDateEnd: end,
    limit: 2000,
  });

  if (data?.error) {
    return { source: 'ACLED', timestamp: new Date().toISOString(), error: data.error };
  }

  let events = data?.data || [];

  events = events.map(e => ({
    ...e,
    lat: parseFloat(e.latitude) || null,
    lon: parseFloat(e.longitude) || null,
  }));

  const totalFatalities = events.reduce(
    (sum, e) => sum + (parseInt(e.fatalities, 10) || 0), 0
  );

  const byRegion  = groupBy(events, 'region');
  const byType    = groupBy(events, 'event_type');
  const byCountry = groupBy(events, 'country');

  const topCountries = Object.entries(byCountry)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});

  const deadliestEvents = events
    .filter(e => parseInt(e.fatalities, 10) > 0)
    .sort((a, b) => (parseInt(b.fatalities, 10) || 0) - (parseInt(a.fatalities, 10) || 0))
    .slice(0, 15)
    .map(e => ({
      date:       e.event_date,
      type:       e.event_type,
      subType:    e.sub_event_type,
      country:    e.country,
      location:   e.location,
      fatalities: parseInt(e.fatalities, 10) || 0,
      lat:        parseFloat(e.latitude) || null,
      lon:        parseFloat(e.longitude) || null,
      notes:      e.notes?.slice(0, 200),
    }));

  return {
    source: 'ACLED',
    timestamp: new Date().toISOString(),
    period: { start, end },
    totalEvents: events.length,
    totalFatalities,
    byRegion,
    byType,
    topCountries,
    deadliestEvents,
  };
}

// Exported for scripts/test-acled.mjs
export { authenticate, probeAccessToken, probeCookieSession, refreshOAuthToken, loginOAuth };

if (process.argv[1]?.endsWith('acled.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
