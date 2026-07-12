// OpenRouter Provider — raw fetch, no SDK

import { LLMProvider } from './provider.mjs';
import { extractAssistantText } from './message-text.mjs';
import { resolveOpenRouterModel } from './openrouter-models.mjs';

export class OpenRouterProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'openrouter';
    this.apiKey = config.apiKey;
    this.model = resolveOpenRouterModel(config.model || 'openrouter/auto');
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const wantJson = opts.jsonMode !== false;
    const baseBody = {
      model: this.model,
      max_tokens: opts.maxTokens || 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    };

    let res = await this._post(wantJson ? { ...baseBody, response_format: { type: 'json_object' } } : baseBody, opts);
    if (!res.ok && wantJson && res.status === 400) {
      const errText = await res.clone().text().catch(() => '');
      if (/response_format|json_object/i.test(errText)) {
        res = await this._post(baseBody, opts);
      }
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenRouter API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0] || {};
    const msg = choice.message || {};
    let text = extractAssistantText(msg);
    if (!text && typeof choice.text === 'string') text = choice.text.trim();
    if (!text && msg.parsed) {
      try { text = JSON.stringify(msg.parsed); } catch { /* ignore */ }
    }

    return {
      text,
      finishReason: choice.finish_reason || null,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }

  async _post(body, opts) {
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/calesthio/Crucix',
        'X-Title': 'Crucix',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });
  }
}
