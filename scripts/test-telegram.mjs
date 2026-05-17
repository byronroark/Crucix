#!/usr/bin/env node
// Manual end-to-end test for Telegram alerts.
// Usage:
//   npm run test:telegram             # sends a ROUTINE test alert
//   npm run test:telegram FLASH       # sends a FLASH test alert
//   npm run test:telegram PRIORITY    # sends a PRIORITY test alert
//
// Bypasses the LLM evaluator and rate limiter so you can verify that the bot
// token + chat ID are wired correctly and that messages actually deliver.

import config from '../crucix.config.mjs';
import { TelegramAlerter } from '../lib/alerts/telegram.mjs';

const VALID_TIERS = new Set(['FLASH', 'PRIORITY', 'ROUTINE']);
const requestedTier = (process.argv[2] || 'ROUTINE').toUpperCase();
const tier = VALID_TIERS.has(requestedTier) ? requestedTier : 'ROUTINE';

const alerter = new TelegramAlerter(config.telegram);

if (!alerter.isConfigured) {
  console.error('[test-telegram] TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID not set in .env');
  process.exit(1);
}

const fakeEvaluation = {
  shouldAlert: true,
  tier,
  confidence: 'HIGH',
  headline: `Test alert from Crucix (${tier})`,
  reason: 'This is a manual test fired by `npm run test:telegram`. If you can read this, your bot token, chat ID, and network path are all working.',
  actionable: 'No action needed — this is a wiring test.',
  signals: ['test_signal_alpha', 'test_signal_beta'],
  crossCorrelation: 'test',
};

const fakeDelta = {
  summary: { direction: 'mixed', totalChanges: 0, criticalChanges: 0 },
};

const message = alerter._formatTieredAlert(fakeEvaluation, fakeDelta, tier);

console.log(`[test-telegram] Sending ${tier} test alert to chat ${config.telegram.chatId}...`);
const result = await alerter.sendMessage(message);

if (result.ok) {
  console.log(`[test-telegram] Delivered (message id: ${result.messageId ?? 'unknown'}). Check your Telegram chat.`);
  process.exit(0);
} else {
  console.error('[test-telegram] Send failed. See [Telegram] errors above for the Bot API response.');
  process.exit(1);
}
