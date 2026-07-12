import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonArray } from '../lib/llm/parse-json-array.mjs';

test('extractJsonArray parses fenced JSON arrays', () => {
  const text = 'Here are ideas:\n```json\n[{"title":"Gold hedge","type":"LONG","confidence":"HIGH"}]\n```';
  const arr = extractJsonArray(text);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].title, 'Gold hedge');
});

test('extractJsonArray unwraps object wrappers', () => {
  const arr = extractJsonArray('{"ideas":[{"title":"X","type":"WATCH"}]}', { arrayKeys: ['ideas'] });
  assert.equal(arr[0].title, 'X');
});

test('extractJsonArray extracts array from trailing prose', () => {
  const text = 'Analysis:\n[{"title":"A","summary":"B"}]\nHope this helps.';
  const arr = extractJsonArray(text);
  assert.equal(arr[0].title, 'A');
});
