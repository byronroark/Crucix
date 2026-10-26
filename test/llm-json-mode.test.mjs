import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../lib/llm/openai.mjs';
import { GeminiProvider } from '../lib/llm/gemini.mjs';
import { withOpenAiJsonMode } from '../lib/llm/json-mode.mjs';

test('withOpenAiJsonMode adds response_format by default', () => {
  const body = withOpenAiJsonMode({ model: 'x' });
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('withOpenAiJsonMode can be disabled', () => {
  const body = withOpenAiJsonMode({ model: 'x' }, { jsonMode: false });
  assert.equal(body.response_format, undefined);
});

test('OpenAIProvider sends response_format json_object', async () => {
  const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-test' });
  const originalFetch = global.fetch;
  let posted;
  global.fetch = async (_url, options) => {
    posted = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: 'gpt-test',
      }),
    };
  };
  try {
    const result = await provider.complete('sys', 'user');
    assert.deepEqual(posted.response_format, { type: 'json_object' });
    assert.equal(result.text, '{"ok":true}');
    assert.equal(result.finishReason, 'stop');
  } finally {
    global.fetch = originalFetch;
  }
});

test('GeminiProvider requests application/json mime type', async () => {
  const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-test' });
  const originalFetch = global.fetch;
  let posted;
  global.fetch = async (_url, options) => {
    posted = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    };
  };
  try {
    const result = await provider.complete('sys', 'user');
    assert.equal(posted.generationConfig.responseMimeType, 'application/json');
    assert.equal(result.text, '{"ok":true}');
  } finally {
    global.fetch = originalFetch;
  }
});
