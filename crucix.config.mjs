// Crucix Configuration — all settings with env var overrides

import "./apis/utils/env.mjs"; // Load .env first

export default {
  port: parseInt(process.env.PORT) || 3117,
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
