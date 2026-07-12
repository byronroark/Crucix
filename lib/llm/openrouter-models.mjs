// Map bare model names from .env to OpenRouter provider/model slugs.

const BARE_TO_OPENROUTER = {
  'openrouter/auto': 'openrouter/auto',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
  'claude-sonnet-4.6': 'anthropic/claude-sonnet-4.6',
  'claude-sonnet-4': 'anthropic/claude-sonnet-4.6',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-sonnet-3.5': 'anthropic/claude-3.5-sonnet',
  'gpt-5.4': 'openai/gpt-4.1',
  'gpt-5.3-codex': 'openai/gpt-4.1',
  'gemini-3.1-pro': 'google/gemini-2.5-pro-preview',
  'grok-4-latest': 'x-ai/grok-4',
};

/**
 * @param {string|null|undefined} model
 * @returns {string}
 */
export function resolveOpenRouterModel(model) {
  const raw = (model || 'openrouter/auto').trim();
  if (!raw) return 'openrouter/auto';
  if (raw.includes('/')) return raw;
  if (BARE_TO_OPENROUTER[raw]) return BARE_TO_OPENROUTER[raw];
  if (/^claude/i.test(raw)) return `anthropic/${raw}`;
  if (/^gpt/i.test(raw)) return `openai/${raw}`;
  if (/^gemini/i.test(raw)) return `google/${raw}`;
  if (/^grok/i.test(raw)) return `x-ai/${raw}`;
  if (/^mistral/i.test(raw)) return `mistralai/${raw}`;
  return raw;
}
