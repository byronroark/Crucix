// Crucix Configuration — all settings with env var overrides

import "./apis/utils/env.mjs"; // Load .env first
import { parseRegionEnv } from './lib/weather/region-presets.mjs';

export default {
  port: parseInt(process.env.PORT) || 3117,
  publicUrl: process.env.PUBLIC_URL || null,
  refreshIntervalMinutes: parseInt(process.env.REFRESH_INTERVAL_MINUTES) || 15,

  llm: {
    provider: process.env.LLM_PROVIDER || null, // anthropic | openai | gemini | codex | openrouter | minimax | mistral | ollama | grok
    apiKey: process.env.LLM_API_KEY || null,
    model: process.env.LLM_MODEL || null,
    baseUrl: process.env.OLLAMA_BASE_URL || null,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    botPollingInterval: parseInt(process.env.TELEGRAM_POLL_INTERVAL) || 5000,
    channels: process.env.TELEGRAM_CHANNELS || null, // Comma-separated extra channel IDs
    // Daily summary at a fixed local time ("HH:MM", 24h). Leave null to disable.
    dailyBriefTime: process.env.TELEGRAM_DAILY_BRIEF_TIME || null,
    // Optional IANA timezone (e.g. "America/New_York"). Defaults to system local.
    dailyBriefTz: process.env.TELEGRAM_DAILY_BRIEF_TZ || null,
    // Whether /mute should also silence the scheduled daily brief.
    // Default: false — the brief is a digest, not an alert, so it bypasses mute.
    dailyBriefRespectMute: process.env.TELEGRAM_DAILY_BRIEF_RESPECT_MUTE === 'true',
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || null,
    channelId: process.env.DISCORD_CHANNEL_ID || null,
    guildId: process.env.DISCORD_GUILD_ID || null, // Server ID (for instant slash command registration)
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || null, // Fallback: webhook-only alerts (no bot needed)
  },

  // === Custom OSINT Sources ===
  // Add RSS feeds, Firecrawl scrapes, or HTTP-JSON endpoints here. Two tiers:
  //   tier: 'ticker'    -> joins the existing news ticker (light-touch)
  //   tier: 'analyzed'  -> saved + fed to the Intelligence Analysis LLM panel
  //
  // Optional map-placement fields on each source:
  //   lat, lon         -> fixed anchor for every item (with small jitter)
  //   geocodeQuery     -> string sent to Google/Nominatim if no other match
  //   geocode: false   -> skip external lookup (use only explicit/keyword)
  //   mapMaxItems      -> cap markers per source on the globe (default 15)
  //
  // See CUSTOM_SOURCES.md for full schema and examples.
  // User-added sources via the dashboard UI are stored separately at customSourcesUserFile.
  customSourcesUserFile: process.env.CUSTOM_SOURCES_USER_FILE || 'runs/config/custom-sources.json',
  // Append-only history for custom source items (disable with CUSTOM_SOURCES_HISTORY=0)
  customSourcesHistory: process.env.CUSTOM_SOURCES_HISTORY !== '0',
  customSourcesHistoryDir: process.env.CUSTOM_SOURCES_HISTORY_DIR || 'runs/memory/custom',
  customSourcesHistoryMaxPerSource: parseInt(process.env.CUSTOM_SOURCES_HISTORY_MAX) || 500,

  customSources: [
    // --- RSS feeds ---
    // { type: 'rss',       name: 'Reuters Politics', url: 'https://...rss', tier: 'ticker', region: 'Global', refreshMinutes: 30 },
    // 1. WJXT News4Jax — Local (covers Clay County: Orange Park, Fleming Island, Middleburg)
    {
      type: 'rss',
      name: 'News4Jax Local',
      url: 'https://www.news4jax.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml&size=25',
      tier: 'ticker',
      region: 'Florida',
      refreshMinutes: 20,
      lat: 30.1797, lon: -81.7787,        // Orange Park, FL (Clay County seat-adjacent)
      mapMaxItems: 8,
      tags: ['local', 'jacksonville', 'clay-county'],
    },
    // 2. First Coast News (WTLV/WJXX) — Local Jax/Clay coverage
    {
      type: 'rss',
      name: 'First Coast News Local',
      url: 'https://www.firstcoastnews.com/feeds/syndication/rss/news/local',
      tier: 'ticker',
      region: 'Florida',
      refreshMinutes: 20,
      lat: 30.3322, lon: -81.6557,        // Jacksonville, FL
      mapMaxItems: 8,
      tags: ['local', 'jacksonville', 'clay-county'],
    },
    // 3. Florida Politics — statewide political reporting (local news ticker)
    {
      type: 'rss',
      name: 'Florida Politics',
      url: 'https://floridapolitics.com/feed/',
      tier: 'ticker',
      region: 'Florida',
      refreshMinutes: 30,
      lat: 30.4383, lon: -84.2807,        // Tallahassee, FL
      mapMaxItems: 6,
      tags: ['florida', 'politics'],
    },
    // 4. Florida Phoenix — independent statewide policy/news (local news ticker)
    {
      type: 'rss',
      name: 'Florida Phoenix',
      url: 'https://floridaphoenix.com/feed/',
      tier: 'ticker',
      region: 'Florida',
      refreshMinutes: 30,
      lat: 30.4383, lon: -84.2807,
      mapMaxItems: 6,
      tags: ['florida', 'policy', 'investigative'],
    },
    // 5. News4Jax Politics — local + Tallahassee impact through a Jacksonville lens
    {
      type: 'rss',
      name: 'News4Jax Politics',
      url: 'https://www.news4jax.com/arc/outboundfeeds/rss/category/news/politics/?outputType=xml&size=25',
      tier: 'ticker',
      region: 'Florida',
      refreshMinutes: 30,
      lat: 30.3322, lon: -81.6557,
      mapMaxItems: 5,
      tags: ['florida', 'politics', 'local'],
    },
    // --- Firecrawl scrapes (requires FIRECRAWL_API_KEY) ---
    // { type: 'firecrawl', name: 'Some News Page', url: 'https://example.com/news', tier: 'analyzed', region: 'Asia', refreshMinutes: 120,
    //   firecrawl: { formats: ['markdown'], onlyMainContent: true } },

    // --- HTTP-JSON endpoints (latField/lonField optional) ---
    // { type: 'http-json', name: 'My Custom API', url: 'https://api.example.com/items', tier: 'analyzed', region: 'Global', refreshMinutes: 15,
    //   json: { itemsPath: 'data.articles', titleField: 'headline', urlField: 'link', dateField: 'published_at', contentField: 'body', latField: 'lat', lonField: 'lon' } },
  ],

  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY || null,
    baseUrl: process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
    // Hard cap on Firecrawl calls per sweep, regardless of refreshMinutes math.
    // Protects the free tier (~500 credits/mo, ~1 credit per scrape).
    maxCallsPerSweep: parseInt(process.env.FIRECRAWL_MAX_PER_SWEEP) || 5,
  },

  // === Geocoding (for custom-source globe markers) ===
  // Optional. When apiKey is set, custom items without explicit coords or
  // headline keyword matches are looked up via the Google Geocoding API.
  // When unset, the system falls back to OpenStreetMap Nominatim (free,
  // ~1 req/sec — fine for low-volume custom sources).
  //
  // Enable "Geocoding API" in Google Cloud Console (separate from the
  // Maps JavaScript embed). Disk-cached at runs/.cache/geocode/.
  geocode: {
    apiKey: process.env.GOOGLE_GEOCODING_API_KEY || null,
  },

  // Multi-pool Intelligence Analysis — built-in OSINT + optional custom analyzed RSS
  intelAnalysis: {
    enabled: true,
    maxInputChars: 8000,
    minPoolsForRun: 2,
    pools: {
      gdelt: 6,
      telegram: 5,
      who: 4,
      acled: 4,
      delta: 5,
      noaa: 3,
      earthquakes: 2,
      news: 4,
      reliefweb: 4,
      cisa: 4,
      cloudflare: 3,
      patents: 3,
      bluesky: 4,
      reddit: 4,
      sanctions: 4,
      adsb: 3,
      customAnalyzed: 4,
      defense: 3,
      fred: 4,
      bls: 3,
      markets: 3,
    },
  },

  // Custom analyzed OSINT — delta + alert integration
  customSignals: {
    enabled: true,
    // Tags that elevate a new analyzed item to a priority delta signal
    priorityTags: ['nuclear', 'cyber', 'sanctions', 'conflict', 'war', 'missile', 'coup'],
    // Minimum tag matches for priority (1 = any listed tag)
    minTagMatches: 1,
  },

  // Dashboard admin token — required for POST/PUT/DELETE on /api/config/sources when set
  adminToken: process.env.ADMIN_TOKEN || null,

  // User-managed stock/crypto watchlist — extra price tiles + Market Intelligence news
  marketWatchlistUserFile: process.env.MARKET_WATCHLIST_USER_FILE || 'runs/config/market-watchlist.json',
  sweepStateFile: process.env.SWEEP_STATE_FILE || 'runs/config/sweep-state.json',
  dashboardSnapshotFile: process.env.DASHBOARD_SNAPSHOT_FILE || 'runs/config/dashboard-snapshot.json',

  marketIntel: {
    enabled: true,
    maxHeadlinesPerSymbol: 8,
    maxHeadlinesTotal: 50,
    maxInputChars: 6000,
    gdeltTimespan: '48h',
  },

  // Always included in Market Intelligence news (merged with user watchlist)
  marketIntelDefaults: [
    { symbol: 'BTC-USD', name: 'Bitcoin', assetClass: 'crypto', aliases: ['Bitcoin', 'BTC'] },
    { symbol: 'XRP-USD', name: 'XRP', assetClass: 'crypto', aliases: ['XRP', 'Ripple'] },
    { symbol: 'XLM-USD', name: 'Stellar', assetClass: 'crypto', aliases: ['Stellar', 'XLM'] },
    { symbol: 'ETH-USD', name: 'Ethereum', assetClass: 'crypto', aliases: ['Ethereum', 'ETH'] },
    { symbol: 'GC=F', name: 'Gold', assetClass: 'commodity', aliases: ['Gold', 'COMEX gold'] },
    { symbol: 'SI=F', name: 'Silver', assetClass: 'commodity', aliases: ['Silver', 'COMEX silver'] },
  ],

  // Weather alerts — NWS (national) + OpenWeather (region-scoped severe only)
  weatherAlerts: {
    openWeatherApiKey: process.env.OPENWEATHER_API_KEY || process.env.WEATHER_API_KEY || null,
    severeRegions: parseRegionEnv(process.env.SEVERE_WEATHER_ALERT_REGIONS, 'FL,GA,AL'),
    maxMapAlerts: parseInt(process.env.WEATHER_MAX_MAP_ALERTS, 10) || 25,
  },

  tornadoReports: {
    regions: parseRegionEnv(process.env.TORNADO_ALERT_REGIONS, 'US-Southeast,Florida'),
    lookbackHours: parseInt(process.env.TORNADO_LOOKBACK_HOURS, 10) || 48,
  },

  earthquakes: {
    enabled: process.env.EARTHQUAKE_ALERTS !== '0',
    minMagnitude: parseFloat(process.env.EARTHQUAKE_MIN_MAG) || 4.5,
    feed: process.env.EARTHQUAKE_FEED || 'day',
  },

  // Delta engine thresholds — override defaults from lib/delta/engine.mjs
  // Set to null to use built-in defaults.
  //
  // Built-in defaults (lib/delta/engine.mjs):
  //   numeric: vix 5, hy_spread 5, 10y2y 10, wti 3, brent 3, natgas 5,
  //            gold 2, silver 3, unemployment 2, fed_funds 1,
  //            10y_yield 3, usd_index 1, mortgage 2 (all in %)
  //   count:   urgent_posts 2, thermal_total 500, air_total 50,
  //            who_alerts 1, conflict_events 5, conflict_fatalities 10,
  //            sdr_online 3, news_count 5, sources_ok 1
  //
  // See TELEGRAM_ALERTS.md for "Quieter" and "Wider net" preset blocks.
  delta: {
    thresholds: {
      numeric: {
        // Example overrides (uncomment to customize):
        // vix: 3,       // more sensitive to VIX moves
        // wti: 5,       // less sensitive to oil moves
      },
      count: {
        // urgent_posts: 3,     // need ±3 urgent posts to flag
        // thermal_total: 1000, // need ±1000 thermal detections
      },
    },
  },
};
