import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenRouterModel } from '../lib/llm/openrouter-models.mjs';

test('resolveOpenRouterModel maps bare anthropic IDs', () => {
  assert.equal(resolveOpenRouterModel('claude-sonnet-4-6'), 'anthropic/claude-sonnet-4.6');
  assert.equal(resolveOpenRouterModel('anthropic/claude-sonnet-4.6'), 'anthropic/claude-sonnet-4.6');
  assert.equal(resolveOpenRouterModel('anthropic/claude-3.5-sonnet'), 'anthropic/claude-3.5-sonnet');
});
