// OpenRouter Provider — raw fetch, no SDK

import { LLMProvider } from './provider.mjs';

export class OpenRouterProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'openrouter';
    this.apiKey = config.apiKey;
    this.model = config.model || 'openrouter/auto';
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/calesthio/Crucix',
        'X-Title': 'Crucix',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens || 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenRouter API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    // Some OpenRouter reasoning models bill tokens but put the answer in
    // `reasoning` / `reasoning_content` with an empty `content` field.
    const text = (msg.content || msg.reasoning_content || msg.reasoning || '').trim();

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
