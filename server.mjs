#!/usr/bin/env node
// Crucix Intelligence Engine — Dev Server
// Serves the Jarvis dashboard, runs sweep cycle, pushes live updates via SSE

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import config from './crucix.config.mjs';
import { getLocale, currentLanguage, getSupportedLocales } from './lib/i18n.mjs';
import { fullBriefing } from './apis/briefing.mjs';
import { synthesize, generateIdeas, buildWatchlistMarketPatch, buildTrackedTiles } from './dashboard/inject.mjs';
import { MemoryManager } from './lib/delta/index.mjs';
import { createLLMProvider } from './lib/llm/index.mjs';
import { generateLLMIdeas } from './lib/llm/ideas.mjs';
import { generateIntelAnalysis, hasIntelInput, harvestIntelItems } from './lib/llm/intel-analysis.mjs';
import { generateMarketIntel, hasMarketIntelInput } from './lib/llm/market-intel.mjs';
import {
  listWatchlist,
  loadWatchlist,
  addSymbol,
  updateSymbol,
  deleteSymbol,
  normalizeSymbol,
  getDefaultMarketIntelSymbols,
  loadMarketIntelSymbols,
} from './lib/config/market-watchlist-store.mjs';
import {
  loadLastSweepAt,
  saveLastSweepAt,
  resolveLastSweepAt,
  msUntilNextSweep,
} from './lib/config/sweep-state.mjs';
import {
  saveDashboardSnapshot,
  applyDashboardSnapshot,
} from './lib/config/dashboard-snapshot.mjs';
import { testSymbol, collect as collectYFinance } from './apis/sources/yfinance.mjs';
import { collect as collectMarketNews } from './apis/sources/market-news.mjs';
import { collect as collectCustomFeeds, testRssFeed, testCustomSource } from './apis/sources/custom-feeds.mjs';
import {
  listSources,
  addSource,
  updateSource,
  deleteSource,
} from './lib/config/custom-sources-store.mjs';
import { TelegramAlerter } from './lib/alerts/telegram.mjs';
import { warmAcledAuth } from './apis/sources/acled.mjs';
import { DiscordAlerter } from './lib/alerts/discord.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const RUNS_DIR = join(ROOT, 'runs');
const MEMORY_DIR = join(RUNS_DIR, 'memory');

// Ensure directories exist
for (const dir of [RUNS_DIR, MEMORY_DIR, join(MEMORY_DIR, 'cold'), join(RUNS_DIR, 'config'), join(RUNS_DIR, '.cache', 'custom-feeds'), join(RUNS_DIR, '.cache', 'geocode')]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// === State ===
let currentData = null;    // Current synthesized dashboard data
let lastSweepTime = null;  // Timestamp of last sweep
let sweepStartedAt = null; // Timestamp when current/last sweep started
let sweepInProgress = false;
let sweepTimer = null;
const startTime = Date.now();
const sseClients = new Set();

// === Delta/Memory ===
const memory = new MemoryManager(RUNS_DIR);

// === LLM + Telegram + Discord ===
const llmProvider = createLLMProvider(config.llm);
const telegramAlerter = new TelegramAlerter(config.telegram);
const discordAlerter = new DiscordAlerter(config.discord || {});

/**
 * Build the markdown body for a Crucix brief. Shared by the /brief Telegram
 * command, the Discord /brief command, and the scheduled daily brief so all
 * three render identical content.
 *
 * @param {object} [opts]
 * @param {'telegram'|'discord'} [opts.flavor] - tweak headline formatting
 * @param {string} [opts.title] - optional override (e.g. "CRUCIX DAILY BRIEF")
 * @returns {string|null} markdown body, or null if no data yet
 */
function buildBriefBody({ flavor = 'telegram', title } = {}) {
  if (!currentData) return null;

  const tg = currentData.tg || {};
  const energy = currentData.energy || {};
  const metals = currentData.metals || {};
  const delta = memory.getLastDelta();
  const ideas = (currentData.ideas || []).slice(0, 3);
  const isDiscord = flavor === 'discord';
  const bold = (s) => (isDiscord ? `**${s}**` : `*${s}*`);
  const italic = (s) => (isDiscord ? `_${s}_` : `_${s}_`);

  const sections = [
    `${bold(`\u{1F4CB} ${title || 'CRUCIX BRIEF'}`)}`,
    `${italic(`${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`)}`,
    ``,
  ];

  if (delta?.summary) {
    const dirEmoji = { 'risk-off': '\u{1F4C9}', 'risk-on': '\u{1F4C8}', 'mixed': '\u2194\uFE0F' }[delta.summary.direction] || '\u2194\uFE0F';
    sections.push(`${dirEmoji} Direction: ${bold(delta.summary.direction.toUpperCase())} | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
    sections.push('');
  }

  const vix = currentData.fred?.find(f => f.id === 'VIXCLS');
  const hy = currentData.fred?.find(f => f.id === 'BAMLH0A0HYM2');
  if (vix || energy.wti || metals.gold || metals.silver) {
    sections.push(`\u{1F4CA} VIX: ${vix?.value ?? '--'} | WTI: $${energy.wti ?? '--'} | Brent: $${energy.brent ?? '--'}`);
    sections.push(`   Gold: $${metals.gold ?? '--'} | Silver: $${metals.silver ?? '--'}${hy ? ` | HY Spread: ${hy.value}` : ''}`);
    sections.push(`   NatGas: $${energy.natgas ?? '--'}`);
    sections.push('');
  }

  if (tg.urgent?.length > 0) {
    sections.push(`\u{1F4E1} OSINT: ${tg.urgent.length} urgent signals, ${tg.posts || 0} total posts`);
    for (const p of tg.urgent.slice(0, 2)) {
      sections.push(`  \u2022 ${(p.text || '').substring(0, 80)}`);
    }
    sections.push('');
  }

  if (ideas.length > 0) {
    sections.push(`${bold('\u{1F4A1} Top Ideas:')}`);
    for (const idea of ideas) {
      const ico = idea.type === 'long' ? '\u{1F4C8}' : idea.type === 'hedge' ? '\u{1F6E1}\uFE0F' : '\u{1F441}\uFE0F';
      sections.push(`  ${ico} ${idea.title}`);
    }
  }

  return sections.join('\n');
}

if (llmProvider) console.log(`[Crucix] LLM enabled: ${llmProvider.name} (model: ${llmProvider.model})`);
if (telegramAlerter.isConfigured) {
  console.log('[Crucix] Telegram alerts enabled');

  // ─── Two-Way Bot Commands ───────────────────────────────────────────────

  telegramAlerter.onCommand('/status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `🖥️ *CRUCIX STATUS*`,
      ``,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: ${config.publicUrl || `http://localhost:${config.port}`}`,
    ].join('\n');
  });

  telegramAlerter.onCommand('/sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    // Fire and forget — don't block the bot response
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  telegramAlerter.onCommand('/brief', async () => {
    return buildBriefBody({ flavor: 'telegram' })
      ?? '⏳ No data yet — waiting for first sweep to complete.';
  });

  telegramAlerter.onCommand('/portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start polling for bot commands
  telegramAlerter.startPolling(config.telegram.botPollingInterval);

  // Schedule the optional daily brief (no-op if TELEGRAM_DAILY_BRIEF_TIME unset)
  scheduleDailyBrief();
}

/**
 * Schedule a once-daily Telegram brief at config.telegram.dailyBriefTime ("HH:MM").
 * Uses setTimeout for the first fire and a 24h setInterval thereafter. Honors
 * config.telegram.dailyBriefTz (IANA tz) when provided. Bypasses tier rate limits
 * because a daily digest is not an alert; honors /mute only if dailyBriefRespectMute=true.
 */
function scheduleDailyBrief() {
  const timeStr = config.telegram.dailyBriefTime;
  if (!timeStr) return;
  if (!telegramAlerter.isConfigured) return;

  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) {
    console.warn(`[Crucix] Invalid TELEGRAM_DAILY_BRIEF_TIME "${timeStr}" — expected HH:MM. Disabling daily brief.`);
    return;
  }
  const hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    console.warn(`[Crucix] TELEGRAM_DAILY_BRIEF_TIME "${timeStr}" out of range. Disabling daily brief.`);
    return;
  }

  const tz = config.telegram.dailyBriefTz || undefined;

  const msUntilNextRun = () => {
    const now = new Date();
    // Compute the current wall-clock time in the target timezone using Intl.
    let nowH, nowM, nowS;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(now);
      const get = (t) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
      nowH = get('hour') % 24; nowM = get('minute'); nowS = get('second');
    } catch {
      console.warn(`[Crucix] Invalid TELEGRAM_DAILY_BRIEF_TZ "${tz}" — falling back to system timezone.`);
      nowH = now.getHours(); nowM = now.getMinutes(); nowS = now.getSeconds();
    }
    const nowSec = nowH * 3600 + nowM * 60 + nowS;
    const targetSec = hh * 3600 + mm * 60;
    let deltaSec = targetSec - nowSec;
    if (deltaSec <= 0) deltaSec += 24 * 3600;
    return deltaSec * 1000;
  };

  const fire = async () => {
    try {
      if (config.telegram.dailyBriefRespectMute && telegramAlerter._isMuted?.()) {
        console.log('[Crucix] Daily brief suppressed (muted)');
        return;
      }
      const body = buildBriefBody({ flavor: 'telegram', title: 'CRUCIX DAILY BRIEF' });
      if (!body) {
        console.log('[Crucix] Daily brief skipped — no sweep data yet');
        return;
      }
      const result = await telegramAlerter.sendMessage(body);
      console.log(result.ok ? '[Crucix] Daily brief sent' : '[Crucix] Daily brief send failed');
    } catch (err) {
      console.error('[Crucix] Daily brief error:', err.message);
    }
  };

  const firstDelay = msUntilNextRun();
  const tzLabel = tz ? ` (${tz})` : '';
  const firstFireAt = new Date(Date.now() + firstDelay).toLocaleString();
  console.log(`[Crucix] Daily brief scheduled for ${timeStr}${tzLabel} — first fire at ${firstFireAt}`);

  setTimeout(() => {
    fire();
    // After the first run, recompute on each cycle so DST shifts don't drift.
    const tick = () => {
      fire();
      setTimeout(tick, msUntilNextRun());
    };
    setTimeout(tick, msUntilNextRun());
  }, firstDelay);
}

// === Discord Bot ===
if (discordAlerter.isConfigured) {
  console.log('[Crucix] Discord bot enabled');

  // Reuse the same command handlers as Telegram (DRY)
  discordAlerter.onCommand('status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `**🖥️ CRUCIX STATUS**\n`,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: ${config.publicUrl || `http://localhost:${config.port}`}`,
    ].join('\n');
  });

  discordAlerter.onCommand('sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  discordAlerter.onCommand('brief', async () => {
    return buildBriefBody({ flavor: 'discord' })
      ?? '⏳ No data yet — waiting for first sweep to complete.';
  });

  discordAlerter.onCommand('portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start the Discord bot (non-blocking — connection happens async)
  discordAlerter.start().catch(err => {
    console.error('[Crucix] Discord bot startup failed (non-fatal):', err.message);
  });
}

// === Express Server ===
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(join(ROOT, 'dashboard/public')));

// Serve loading page until first sweep completes, then the dashboard with injected locale
app.get('/', (req, res) => {
  if (!currentData) {
    res.sendFile(join(ROOT, 'dashboard/public/loading.html'));
  } else {
    const htmlPath = join(ROOT, 'dashboard/public/jarvis.html');
    let html = readFileSync(htmlPath, 'utf-8');
    
    // Inject locale data into the HTML
    const locale = getLocale();
    const localeScript = `<script>window.__CRUCIX_LOCALE__ = ${JSON.stringify(locale).replace(/<\/script>/gi, '<\\/script>')};</script>`;
    html = html.replace('</head>', `${localeScript}\n</head>`);
    
    res.type('html').send(html);
  }
});

// === Custom Sources API (dashboard settings UI) ===

function requireAdmin(req, res, next) {
  const token = config.adminToken;
  if (!token) return next();
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${token}`) return next();
  return res.status(401).json({ error: 'Unauthorized — set Authorization: Bearer <ADMIN_TOKEN>' });
}

function feedStatusFromData() {
  const map = {};
  for (const e of (currentData?.customFeedErrors || [])) {
    if (e?.name) map[e.name] = { ok: false, error: e.error };
  }
  return map;
}

async function hotRefreshCustomSources() {
  const latestPath = join(RUNS_DIR, 'latest.json');
  if (!existsSync(latestPath) || sweepInProgress) return false;
  try {
    const raw = JSON.parse(readFileSync(latestPath, 'utf8'));
    raw.sources.CustomFeeds = await collectCustomFeeds({ ignoreCache: true });
    const synthesized = await synthesize(raw);
    if (currentData) {
      synthesized.delta = currentData.delta;
      synthesized.ideas = currentData.ideas || [];
      synthesized.ideasSource = currentData.ideasSource;
      synthesized.intelAnalysis = currentData.intelAnalysis || [];
      synthesized.intelAnalysisSource = currentData.intelAnalysisSource;
      synthesized.marketIntel = currentData.marketIntel || [];
      synthesized.marketIntelSource = currentData.marketIntelSource;
    }
    currentData = synthesized;
    broadcast({ type: 'update', data: currentData });
    return true;
  } catch (err) {
    console.error('[Crucix] Hot refresh after source change failed:', err.message);
    return false;
  }
}

async function hotRefreshMarketWatchlist({ force = false } = {}) {
  const latestPath = join(RUNS_DIR, 'latest.json');
  if (!existsSync(latestPath) || !currentData) return false;
  if (!force && sweepInProgress) return false;

  applyInstantWatchlistTracked();
  broadcast({ type: 'update', data: currentData });

  try {
    const raw = JSON.parse(readFileSync(latestPath, 'utf8'));
    raw.sources.YFinance = await collectYFinance();
    raw.sources.MarketNews = await collectMarketNews();
    writeFileSync(latestPath, JSON.stringify(raw, null, 2));

    const patch = buildWatchlistMarketPatch(raw);
    currentData.markets = patch.markets;
    currentData.marketNews = patch.marketNews;
    currentData.metals = { ...currentData.metals, ...patch.metals };
    currentData.energy = { ...currentData.energy, ...patch.energyPatch };

    const wlCount = patch.markets?.marketIntelSymbolCount || 0;
    const newsCount = patch.marketNews?.items?.length || 0;
    if (!wlCount) {
      currentData.marketIntelSource = 'no-watchlist';
      currentData.marketIntel = [];
    } else if (newsCount) {
      currentData.marketIntelSource = currentData.marketIntel?.length ? 'llm' : 'headlines-only';
    } else {
      currentData.marketIntelSource = 'headlines-only';
      currentData.marketIntel = [];
    }
    broadcast({ type: 'update', data: currentData });
    return true;
  } catch (err) {
    console.error('[Crucix] Hot refresh after watchlist change failed:', err.message);
    return false;
  }
}

function applyInstantWatchlistTracked() {
  if (!currentData) return;
  if (!currentData.markets) currentData.markets = {};
  currentData.markets.tracked = buildTrackedTiles({
    quotes: currentData.markets.quotes || {},
    tracked: currentData.markets.tracked || [],
  });
  currentData.markets.watchlistCount = loadWatchlist().length;
  currentData.markets.marketIntelSymbolCount = loadMarketIntelSymbols().length;
}

app.get('/api/config/sources', (req, res) => {
  const cf = currentData?.health ? feedStatusFromData() : {};
  res.json({ sources: listSources(cf), adminRequired: Boolean(config.adminToken) });
});

app.post('/api/config/sources/test', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const url = body.url;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const type = body.type || 'rss';
    const samples = type === 'rss'
      ? await testRssFeed(url)
      : await testCustomSource(body);
    res.json({ ok: true, samples });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/config/sources', requireAdmin, async (req, res) => {
  const result = addSource(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  const refreshed = await hotRefreshCustomSources();
  res.json({ ...result, refreshed });
});

app.put('/api/config/sources/:id', requireAdmin, async (req, res) => {
  if (String(req.params.id).startsWith('seed:')) {
    return res.status(403).json({ error: 'Built-in seed sources cannot be edited from the UI' });
  }
  const result = updateSource(req.params.id, req.body || {});
  if (!result.ok) return res.status(result.errors?.[0] === 'source not found' ? 404 : 400).json(result);
  const refreshed = await hotRefreshCustomSources();
  res.json({ ...result, refreshed });
});

app.delete('/api/config/sources/:id', requireAdmin, async (req, res) => {
  if (String(req.params.id).startsWith('seed:')) {
    return res.status(403).json({ error: 'Built-in seed sources cannot be deleted from the UI' });
  }
  const result = deleteSource(req.params.id);
  if (!result.ok) return res.status(404).json(result);
  const refreshed = await hotRefreshCustomSources();
  res.json({ ...result, refreshed });
});

// === Market Watchlist API ===

app.get('/api/config/market-watchlist', (req, res) => {
  res.json({
    symbols: listWatchlist(),
    defaults: getDefaultMarketIntelSymbols(),
    adminRequired: Boolean(config.adminToken),
  });
});

app.get('/api/config/market-watchlist/normalize', (req, res) => {
  const result = normalizeSymbol(
    req.query.symbol || '',
    req.query.assetClass || 'stock',
    req.query.quoteCurrency || 'USD',
  );
  res.json(result);
});

app.post('/api/config/market-watchlist/refresh', async (req, res) => {
  const force = req.body?.force === true || req.query?.force === '1';
  const refreshed = await hotRefreshMarketWatchlist({ force });
  res.json({ refreshed });
});

app.post('/api/config/market-watchlist/test', requireAdmin, async (req, res) => {
  const body = req.body || {};
  if (!body.symbol) return res.status(400).json({ error: 'symbol is required' });
  try {
    const result = await testSymbol(body.symbol, body.assetClass || 'stock', body.quoteCurrency || 'USD');
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/config/market-watchlist', requireAdmin, async (req, res) => {
  try {
    const result = addSymbol(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    applyInstantWatchlistTracked();
    broadcast({ type: 'update', data: currentData });
    res.json({ ...result, refreshed: null, refreshPending: true });
    hotRefreshMarketWatchlist({ force: true }).catch(err => {
      console.error('[Crucix] Background watchlist refresh failed:', err.message);
    });
  } catch (err) {
    console.error('[Crucix] Watchlist add failed:', err.message);
    res.status(500).json({ ok: false, errors: [err.message] });
  }
});

app.put('/api/config/market-watchlist/:id', requireAdmin, async (req, res) => {
  try {
    const result = updateSymbol(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.errors?.[0] === 'symbol not found' ? 404 : 400).json(result);
    applyInstantWatchlistTracked();
    broadcast({ type: 'update', data: currentData });
    res.json({ ...result, refreshed: null, refreshPending: true });
    hotRefreshMarketWatchlist({ force: true }).catch(err => {
      console.error('[Crucix] Background watchlist refresh failed:', err.message);
    });
  } catch (err) {
    console.error('[Crucix] Watchlist update failed:', err.message);
    res.status(500).json({ ok: false, errors: [err.message] });
  }
});

app.delete('/api/config/market-watchlist/:id', requireAdmin, async (req, res) => {
  try {
    const result = deleteSymbol(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    applyInstantWatchlistTracked();
    broadcast({ type: 'update', data: currentData });
    res.json({ ...result, refreshed: null, refreshPending: true });
    hotRefreshMarketWatchlist({ force: true }).catch(err => {
      console.error('[Crucix] Background watchlist refresh failed:', err.message);
    });
  } catch (err) {
    console.error('[Crucix] Watchlist delete failed:', err.message);
    res.status(500).json({ ok: false, errors: [err.message] });
  }
});

// API: current data
app.get('/api/data', (req, res) => {
  if (!currentData) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  res.json(currentData);
});

// API: health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    lastSweep: lastSweepTime,
    nextSweep: lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
      : null,
    sweepInProgress,
    sweepStartedAt,
    sourcesOk: currentData?.meta?.sourcesOk || 0,
    sourcesFailed: currentData?.meta?.sourcesFailed || 0,
    llmEnabled: !!config.llm.provider,
    llmProvider: config.llm.provider,
    llmModel: llmProvider?.model || config.llm.model || null,
    telegramEnabled: !!(config.telegram.botToken && config.telegram.chatId),
    refreshIntervalMinutes: config.refreshIntervalMinutes,
    language: currentLanguage,
  });
});

// API: available locales
app.get('/api/locales', (req, res) => {
  res.json({
    current: currentLanguage,
    supported: getSupportedLocales(),
  });
});

// SSE: live updates
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// === Sweep Cycle ===
function scheduleNextSweep({ ifNeverSweptDelayMs = 0 } = {}) {
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
  const delay = lastSweepTime
    ? msUntilNextSweep(lastSweepTime, config.refreshIntervalMinutes)
    : ifNeverSweptDelayMs;
  const nextAt = new Date(Date.now() + delay);
  console.log(`[Crucix] Next sweep scheduled at ${nextAt.toLocaleString()}`);
  sweepTimer = setTimeout(() => {
    runSweepCycle().catch(err => {
      console.error('[Crucix] Scheduled sweep failed:', err.message || err);
      scheduleNextSweep({ ifNeverSweptDelayMs: config.refreshIntervalMinutes * 60 * 1000 });
    });
  }, delay);
}

async function runSweepCycle() {
  if (sweepInProgress) {
    console.log('[Crucix] Sweep already in progress, skipping');
    return;
  }

  sweepInProgress = true;
  sweepStartedAt = new Date().toISOString();
  broadcast({ type: 'sweep_start', timestamp: sweepStartedAt });
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Crucix] Starting sweep at ${new Date().toLocaleTimeString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 1. Run the full briefing sweep
    const rawData = await fullBriefing();

    // 2. Save to runs/latest.json
    writeFileSync(join(RUNS_DIR, 'latest.json'), JSON.stringify(rawData, null, 2));
    lastSweepTime = rawData.crucix?.timestamp || new Date().toISOString();
    saveLastSweepAt(lastSweepTime);

    // 3. Synthesize into dashboard format
    console.log('[Crucix] Synthesizing dashboard data...');
    const synthesized = await synthesize(rawData);

    // 4. Delta computation + memory
    const delta = memory.addRun(synthesized);
    synthesized.delta = delta;

    // 5. LLM-powered trade ideas (LLM-only feature) — isolated so failures don't kill sweep
    if (llmProvider?.isConfigured) {
      try {
        console.log('[Crucix] Generating LLM trade ideas...');
        const previousIdeas = memory.getLastRun()?.ideas || [];
        const llmIdeas = await generateLLMIdeas(llmProvider, synthesized, delta, previousIdeas);
        if (llmIdeas) {
          synthesized.ideas = llmIdeas;
          synthesized.ideasSource = 'llm';
          console.log(`[Crucix] LLM generated ${llmIdeas.length} ideas`);
        } else {
          synthesized.ideas = [];
          synthesized.ideasSource = 'llm-failed';
        }
      } catch (llmErr) {
        console.error('[Crucix] LLM ideas failed (non-fatal):', llmErr.message);
        synthesized.ideas = [];
        synthesized.ideasSource = 'llm-failed';
      }
    } else {
      synthesized.ideas = [];
      synthesized.ideasSource = 'disabled';
    }

    // 5b. Intelligence Analysis — multi-pool OSINT synthesis
    const intelHarvest = harvestIntelItems({ ...synthesized, _delta: delta }, config);
    if (llmProvider?.isConfigured && hasIntelInput({ ...synthesized, _delta: delta }, config)) {
      try {
        const poolSummary = Object.entries(intelHarvest.poolCounts)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}:${n}`)
          .join(', ');
        console.log(`[Crucix] Generating Intelligence Analysis (${poolSummary})...`);
        const intel = await generateIntelAnalysis(llmProvider, { ...synthesized, _delta: delta }, config);
        if (intel && intel.length) {
          synthesized.intelAnalysis = intel;
          synthesized.intelAnalysisSource = 'llm';
          console.log(`[Crucix] Intel Analysis generated ${intel.length} items`);
        } else {
          synthesized.intelAnalysis = [];
          synthesized.intelAnalysisSource = 'llm-failed';
        }
      } catch (intelErr) {
        console.error('[Crucix] Intel Analysis failed (non-fatal):', intelErr.message);
        synthesized.intelAnalysis = [];
        synthesized.intelAnalysisSource = 'llm-failed';
      }
    } else if (!llmProvider?.isConfigured) {
      synthesized.intelAnalysis = [];
      synthesized.intelAnalysisSource = 'disabled';
    } else {
      synthesized.intelAnalysis = [];
      synthesized.intelAnalysisSource = 'no-input';
    }

    // 5c. Market Intelligence — watchlist-scoped news synthesis
    if (llmProvider?.isConfigured && config.marketIntel?.enabled !== false && hasMarketIntelInput(synthesized)) {
      try {
        console.log('[Crucix] Generating Market Intelligence...');
        const mi = await generateMarketIntel(llmProvider, synthesized, config);
        if (mi && mi.length) {
          synthesized.marketIntel = mi;
          synthesized.marketIntelSource = 'llm';
          console.log(`[Crucix] Market Intel generated ${mi.length} items`);
        } else {
          synthesized.marketIntel = [];
          synthesized.marketIntelSource = 'headlines-only';
        }
      } catch (miErr) {
        console.error('[Crucix] Market Intel failed (non-fatal):', miErr.message);
        synthesized.marketIntel = [];
        synthesized.marketIntelSource = 'headlines-only';
      }
    } else if (!synthesized.markets?.marketIntelSymbolCount) {
      synthesized.marketIntel = [];
      synthesized.marketIntelSource = 'no-watchlist';
    } else if (!llmProvider?.isConfigured) {
      synthesized.marketIntel = [];
      synthesized.marketIntelSource = synthesized.marketNews?.items?.length ? 'headlines-only' : 'disabled';
    } else {
      synthesized.marketIntel = [];
      synthesized.marketIntelSource = 'headlines-only';
    }

    // 6. Alert evaluation — Telegram + Discord (LLM with rule-based fallback, multi-tier, semantic dedup)
    if (delta?.summary?.totalChanges > 0) {
      if (telegramAlerter.isConfigured) {
        telegramAlerter.evaluateAndAlert(llmProvider, delta, memory).catch(err => {
          console.error('[Crucix] Telegram alert error:', err.message);
        });
      }
      if (discordAlerter.isConfigured) {
        discordAlerter.evaluateAndAlert(llmProvider, delta, memory).catch(err => {
          console.error('[Crucix] Discord alert error:', err.message);
        });
      }
    }

    // 7. Post actionable ideas to Discord (HIGH confidence, short horizon, Kalshi-style)
    if (discordAlerter.isConfigured && synthesized.ideas?.length > 0) {
      discordAlerter.sendActionableIdeas(synthesized.ideas).catch(err => {
        console.error('[Crucix] Discord idea alert error:', err.message);
      });
    }

    // Prune old alerted signals
    memory.pruneAlertedSignals();

    saveDashboardSnapshot(synthesized);
    currentData = synthesized;

    // 6. Push to all connected browsers
    broadcast({ type: 'update', data: currentData });

    console.log(`[Crucix] Sweep complete — ${currentData.meta.sourcesOk}/${currentData.meta.sourcesQueried} sources OK`);
    console.log(`[Crucix] ${currentData.ideas.length} ideas (${synthesized.ideasSource}) | ${currentData.intelAnalysis?.length || 0} intel (${synthesized.intelAnalysisSource}) | ${currentData.news.length} news | ${currentData.newsFeed.length} feed items`);
    if (delta?.summary) console.log(`[Crucix] Delta: ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical, direction: ${delta.summary.direction}`);
    scheduleNextSweep();

  } catch (err) {
    console.error('[Crucix] Sweep failed:', err.message);
    broadcast({ type: 'sweep_error', error: err.message });
  } finally {
    sweepInProgress = false;
  }
}

// === Startup ===
async function start() {
  const port = config.port;

  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           CRUCIX INTELLIGENCE ENGINE         ║
  ║          Local Palantir · 26 Sources         ║
  ╠══════════════════════════════════════════════╣
  ║  Dashboard:  http://localhost:${port}${' '.repeat(14 - String(port).length)}║
  ║  Health:     http://localhost:${port}/api/health${' '.repeat(4 - String(port).length)}║
  ║  Refresh:    Every ${config.refreshIntervalMinutes} min${' '.repeat(20 - String(config.refreshIntervalMinutes).length)}║
  ║  LLM:        ${(config.llm.provider || 'disabled').padEnd(31)}║
  ║  Telegram:   ${config.telegram.botToken ? 'enabled' : 'disabled'}${' '.repeat(config.telegram.botToken ? 24 : 23)}║
  ║  Discord:    ${config.discord?.botToken ? 'enabled' : config.discord?.webhookUrl ? 'webhook only' : 'disabled'}${' '.repeat(config.discord?.botToken ? 24 : config.discord?.webhookUrl ? 20 : 23)}║
  ╚══════════════════════════════════════════════╝
  `);

  const server = app.listen(port);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[Crucix] FATAL: Port ${port} is already in use!`);
      console.error(`[Crucix] A previous Crucix instance may still be running.`);
      console.error(`[Crucix] Fix:  taskkill /F /IM node.exe   (Windows)`);
      console.error(`[Crucix]       kill $(lsof -ti:${port})   (macOS/Linux)`);
      console.error(`[Crucix] Or change PORT in .env\n`);
    } else {
      console.error(`[Crucix] Server error:`, err.stack || err.message);
    }
    process.exit(1);
  });

  server.on('listening', async () => {
    console.log(`[Crucix] Server running on http://localhost:${port}`);

    // Auto-open browser
    // NOTE: On Windows, `start` in PowerShell is an alias for Start-Service, not cmd's start.
    // We must use `cmd /c start ""` to ensure it works in both cmd.exe and PowerShell.
    const openCmd = process.platform === 'win32' ? 'cmd /c start ""' :
                    process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${openCmd} "http://localhost:${port}"`, (err) => {
      if (err) console.log('[Crucix] Could not auto-open browser:', err.message);
    });

    // Try to load existing data first for instant display (await so dashboard shows immediately)
    let existingRaw = null;
    try {
      existingRaw = JSON.parse(readFileSync(join(RUNS_DIR, 'latest.json'), 'utf8'));
      const sweepAt = existingRaw?.crucix?.timestamp || null;
      let data = await synthesize(existingRaw);
      data = applyDashboardSnapshot(data, sweepAt);
      if (!data.delta) {
        const delta = memory.getLastDelta();
        if (delta) data.delta = delta;
      }
      currentData = data;
      applyInstantWatchlistTracked();
      const restored = data.ideas?.length || data.intelAnalysis?.length || data.marketIntel?.length;
      console.log(`[Crucix] Loaded existing data from runs/latest.json — dashboard ready instantly${restored ? ' (LLM summaries restored)' : ''}`);
      broadcast({ type: 'update', data: currentData });
      if (loadWatchlist().length) {
        hotRefreshMarketWatchlist({ force: true }).catch(err => {
          console.warn('[Crucix] Watchlist quote refresh on startup failed:', err.message);
        });
      }
    } catch {
      console.log('[Crucix] No existing data found — first sweep required');
    }

    lastSweepTime = resolveLastSweepAt(loadLastSweepAt(), existingRaw?.crucix?.timestamp || null);
    if (lastSweepTime) saveLastSweepAt(lastSweepTime);

    await warmAcledAuth().catch((err) => {
      console.warn('[ACLED] Auth warmup error:', err.message);
    });

    const waitMs = msUntilNextSweep(lastSweepTime, config.refreshIntervalMinutes);
    if (!existingRaw || waitMs === 0) {
      const reason = !existingRaw ? 'no prior sweep data' : 'refresh interval elapsed';
      console.log(`[Crucix] Running sweep now (${reason})...`);
      runSweepCycle().catch(err => {
        console.error('[Crucix] Initial sweep failed:', err.message || err);
        scheduleNextSweep({ ifNeverSweptDelayMs: config.refreshIntervalMinutes * 60 * 1000 });
      });
    } else {
      const mins = Math.ceil(waitMs / 60000);
      console.log(`[Crucix] Skipping immediate sweep — last sweep ${new Date(lastSweepTime).toLocaleString()}, next in ~${mins} min`);
      scheduleNextSweep();
    }
  });
}

// Graceful error handling — log full stack traces for diagnosis
process.on('unhandledRejection', (err) => {
  console.error('[Crucix] Unhandled rejection:', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[Crucix] Uncaught exception:', err?.stack || err?.message || err);
});

start().catch(err => {
  console.error('[Crucix] FATAL — Server failed to start:', err?.stack || err?.message || err);
  process.exit(1);
});
