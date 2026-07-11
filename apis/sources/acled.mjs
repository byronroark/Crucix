// ACLED — Armed Conflict Location & Event Data
// Auth strategy (tries in order):
//   1. OAuth Bearer token (password grant, then refresh_token when access expires)
//   2. Cookie-based session fallback: POST /user/login?_format=json
// Set ACLED_EMAIL and ACLED_PASSWORD in .env (your myACLED login credentials).
// Data endpoint: GET https://acleddata.com/api/acled/read
// Docs: https://acleddata.com/api-documentation/getting-started

import { daysAgo } from '../utils/fetch.mjs';
import '../utils/env.mjs';

const LOGIN_URL = 'https://acleddata.com/user/login?_format=json';
const TOKEN_URL = 'https://acleddata.com/oauth/token';
const API_BASE  = 'https://acleddata.com/api/acled/read';

const TOKEN_SKEW_MS = 60_000;           // refresh 1 min before access token expiry
const DEFAULT_ACCESS_TTL_SEC = 86_400;    // 24h per ACLED docs
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days per ACLED docs

/** Populated on each authenticate() call — useful for test:acled --debug */
export const lastAuthDiagnostics = { attempts: [] };

const ACLED_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Crucix/1.0; +https://github.com/byronroark/Crucix)',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function cloudflareHint(raw) {
  const text = String(raw || '');
  if (/just a moment|cf-browser-verification|cloudflare/i.test(text)) {
    return 'Cloudflare bot challenge blocked this request from the server. '
      + 'ACLED may be unreachable from this host/IP via automated fetch. '
      + 'Try a residential network, or contact access@acleddata.com.';
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

/** @type {{ cookies: string|null, token: string|null, refreshToken: string|null, method: string|null, expires: number, refreshExpires: number }} */
let sessionCache = {
  cookies: null,
  token: null,
  refreshToken: null,
  method: null,
  expires: 0,
  refreshExpires: 0,
};

function isDebug() {
  return process.argv.includes('--debug');
}

function debugLog(...args) {
  if (isDebug()) console.error('[ACLED DEBUG]', ...args);
}

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        ...ACLED_FETCH_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const raw = await res.text().catch(() => '');
    const parsed = parseAcledJson(raw, `OAuth token endpoint (HTTP ${res.status})`);
    if (parsed.error) return { error: parsed.error };
    const data = parsed.data;

    if (!res.ok) {
      const msg = data?.error_description || data?.message || data?.error || raw.slice(0, 200);
      return { error: `OAuth failed (HTTP ${res.status}): ${msg}` };
    }

    return parseOAuthTokenResponse(data);
  } catch (e) {
    clearTimeout(timer);
    const cause = e.cause ? ` → ${e.cause.message || e.cause.code || e.cause}` : '';
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_BASE}?${params}`, {
      headers: { ...ACLED_FETCH_HEADERS, ...headers },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const raw = await res.text().catch(() => '');
    const parsed = parseAcledJson(raw, `${label} probe (HTTP ${res.status})`);
    if (parsed.error) return { error: parsed.error };
    const data = parsed.data;

    if (!res.ok) {
      const msg = data?.message || raw.slice(0, 200);
      return { error: `${label} probe failed (HTTP ${res.status}): ${msg}` };
    }

    if (data?.status && data.status !== 200) {
      return { error: `${label} probe API error: status ${data.status} — ${data.message || 'Unknown error'}` };
    }

    if (!Array.isArray(data?.data)) {
      return { error: `${label} probe succeeded but response missing data array` };
    }

    return { ok: true };
  } catch (e) {
    clearTimeout(timer);
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
  debugLog(`OAuth session ready — access expires in ${Math.round((sessionCache.expires - Date.now()) / 60000)} min`
    + (sessionCache.refreshToken ? ', refresh token cached' : ''));
  return sessionCache;
}

// Cookie-based session login (mirrors browser / Postman flow)
async function loginCookie(email, password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { ...ACLED_FETCH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: email, pass: password }),
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);

    const setCookies = res.headers.getSetCookie?.() || [];
    const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

    if (res.ok && cookieStr) {
      return { cookies: cookieStr };
    }

    if (res.status >= 300 && res.status < 400 && cookieStr) {
      return { cookies: cookieStr };
    }

    const errText = await res.text().catch(() => '');
    return { error: `Cookie login failed (HTTP ${res.status}): ${errText.slice(0, 200)}` };
  } catch (e) {
    clearTimeout(timer);
    const cause = e.cause ? ` → ${e.cause.message || e.cause.code || e.cause}` : '';
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
  if (!email || !password) {
    return { error: 'No ACLED credentials. Set ACLED_EMAIL and ACLED_PASSWORD in .env.' };
  }

  lastAuthDiagnostics.attempts = [];

  if (accessTokenValid()) {
    return sessionCache;
  }

  const errors = [];

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
  return { error: `All ACLED auth methods failed.\n${errors.join('\n')}` };
}

function authHeaders(session) {
  const headers = { ...ACLED_FETCH_HEADERS, 'Content-Type': 'application/json' };
  if (session.method === 'cookie' && session.cookies) {
    headers.Cookie = session.cookies;
  } else if (session.method === 'oauth' && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return headers;
}

async function fetchAcledData(url, session) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      headers: authHeaders(session),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const errText = await res.text().catch(() => '');
    return { res, errText };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
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
    let { res, errText } = await fetchAcledData(url, session);
    debugLog(`Data response: HTTP ${res.status}`);

    // On 401, invalidate access token and retry once (refresh or password grant)
    if (res.status === 401 && session.method === 'oauth') {
      debugLog('Data request 401 — re-authenticating');
      invalidateAccessToken();
      session = await authenticate();
      if (session.error) {
        return { error: `ACLED re-auth after 401 failed: ${session.error}` };
      }
      ({ res, errText } = await fetchAcledData(url, session));
      debugLog(`Retry data response: HTTP ${res.status}`);
    }

    if (!res.ok) {
      if (isDebug()) debugLog(`Error body: ${errText.slice(0, 500)}`);
      const cf = cloudflareHint(errText);
      if (cf) {
        emptySession();
        return { error: `ACLED blocked by Cloudflare (HTTP ${res.status}, auth method: ${session.method}). ${cf}` };
      }
      if (res.status === 401 || res.status === 403) {
        emptySession();
        const hint = res.status === 403
          ? '\n→ Fix: Log in at https://acleddata.com/user/login, then:\n'
            + '  1. Accept Terms of Use (profile → Terms of Use button → check the box)\n'
            + '  2. Complete all required profile fields\n'
            + '  3. Ensure your account has the "API" access group\n'
            + '  Contact access@acleddata.com if issues persist.'
          : '';
        return { error: `ACLED data access denied (HTTP ${res.status}, auth method: ${session.method}). Response: ${errText.slice(0, 300)}${hint}` };
      }
      return { error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }

    const parsed = parseAcledJson(errText, `ACLED data (HTTP ${res.status})`);
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
  if (!process.env.ACLED_EMAIL || !process.env.ACLED_PASSWORD) {
    return {
      source: 'ACLED',
      timestamp: new Date().toISOString(),
      status: 'no_credentials',
      message: 'Set ACLED_EMAIL and ACLED_PASSWORD in .env. Register at https://acleddata.com/user/register',
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
