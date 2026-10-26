// Ollama Provider — raw fetch, no SDK
// Uses Ollama's OpenAI-compatible Chat Completions API
// No API key required — fully local inference

import { LLMProvider } from './provider.mjs';
import { withOpenAiJsonMode, shouldRetryWithoutJsonMode } from './json-mode.mjs';

export class OllamaProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'ollama';
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = config.model || 'llama3.1:8b';
  }

  get isConfigured() { return !!this.model; }

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

    let res = await this._post(withOpenAiJsonMode(baseBody, { jsonMode: wantJson }), opts);
    if (await shouldRetryWithoutJsonMode(res, wantJson)) {
      res = await this._post(baseBody, opts);
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Ollama API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0] || {};
    const text = choice.message?.content || '';

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
    return fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout || 120000),
    });
  }
}
