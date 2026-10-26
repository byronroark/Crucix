import test from 'node:test';
import assert from 'node:assert/strict';
import { completeJsonWithRetry, classifyLlmError } from '../lib/llm/complete-json.mjs';

function mockProvider(responses) {
  let i = 0;
  return {
    name: 'mock',
    get isConfigured() { return true; },
    async complete(_sys, _user, opts = {}) {
      const next = responses[i++];
      if (!next) throw new Error('unexpected extra complete() call');
      if (typeof next === 'function') return next(opts);
      if (next.throw) throw next.throw;
      return {
        text: next.text ?? '',
        finishReason: next.finishReason || 'stop',
        usage: { inputTokens: 1, outputTokens: next.text?.length || 0 },
        model: 'mock',
      };
    },
  };
}

test('classifyLlmError maps timeouts', () => {
  assert.equal(classifyLlmError(new Error('AbortError: timed out')).reason, 'timeout');
  assert.equal(classifyLlmError(new Error('OpenAI API 500: boom')).reason, 'api');
});

test('completeJsonWithRetry returns items on first success', async () => {
  const provider = mockProvider([
    { text: '{"ideas":[{"title":"A","type":"LONG"}]}' },
  ]);
  const result = await completeJsonWithRetry(provider, {
    systemPrompt: 'sys',
    userMessage: 'user',
    schemaHint: '{"ideas":[]}',
    parse: (text) => {
      const parsed = JSON.parse(text);
      return parsed.ideas;
    },
    logLabel: 'test',
  });
  assert.equal(result.error, null);
  assert.equal(result.retried, false);
  assert.equal(result.items[0].title, 'A');
});

test('completeJsonWithRetry repairs on parse failure', async () => {
  const provider = mockProvider([
    { text: 'Here is junk not json' },
    { text: '{"ideas":[{"title":"Repaired","type":"WATCH"}]}' },
  ]);
  const result = await completeJsonWithRetry(provider, {
    systemPrompt: 'sys',
    userMessage: 'user',
    schemaHint: '{"ideas":[]}',
    parse: (text) => {
      try {
        const parsed = JSON.parse(text);
        return parsed.ideas?.length ? parsed.ideas : null;
      } catch {
        return null;
      }
    },
    logLabel: 'test',
  });
  assert.equal(result.error, null);
  assert.equal(result.retried, true);
  assert.equal(result.items[0].title, 'Repaired');
});

test('completeJsonWithRetry regenerates on empty then succeeds', async () => {
  const provider = mockProvider([
    { text: '' },
    { text: '{"ideas":[{"title":"Retry","type":"HEDGE"}]}' },
  ]);
  const result = await completeJsonWithRetry(provider, {
    systemPrompt: 'sys',
    userMessage: 'user',
    schemaHint: '{"ideas":[]}',
    parse: (text) => {
      try {
        const parsed = JSON.parse(text);
        return parsed.ideas?.length ? parsed.ideas : null;
      } catch {
        return null;
      }
    },
    logLabel: 'test',
  });
  assert.equal(result.retried, true);
  assert.equal(result.items[0].title, 'Retry');
});

test('completeJsonWithRetry surfaces api errors without retry', async () => {
  const provider = mockProvider([
    { throw: new Error('OpenRouter API 401: Unauthorized') },
  ]);
  const result = await completeJsonWithRetry(provider, {
    systemPrompt: 'sys',
    userMessage: 'user',
    schemaHint: '{"ideas":[]}',
    parse: () => null,
    logLabel: 'test',
  });
  assert.equal(result.items, null);
  assert.equal(result.retried, false);
  assert.equal(result.error.reason, 'api');
});

test('completeJsonWithRetry keeps parse reason when retry also fails', async () => {
  const provider = mockProvider([
    { text: 'not json' },
    { text: 'still not json' },
  ]);
  const result = await completeJsonWithRetry(provider, {
    systemPrompt: 'sys',
    userMessage: 'user',
    schemaHint: '{"ideas":[]}',
    parse: () => null,
    logLabel: 'test',
  });
  assert.equal(result.items, null);
  assert.equal(result.retried, true);
  assert.equal(result.error.reason, 'parse');
});

test('completeJsonWithRetry requests jsonMode by default', async () => {
  let seen;
  const provider = mockProvider([
    (opts) => {
      seen = opts;
      return { text: '{"ideas":[{"title":"Z"}]}', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, model: 'mock' };
    },
  ]);
  await completeJsonWithRetry(provider, {
    systemPrompt: 'sys',
    userMessage: 'user',
    schemaHint: '{"ideas":[]}',
    parse: (text) => JSON.parse(text).ideas,
    logLabel: 'test',
  });
  assert.equal(seen.jsonMode, true);
});
