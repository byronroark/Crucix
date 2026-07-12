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

test('extractJsonArray repairs trailing commas', () => {
  const arr = extractJsonArray('[{"title":"A","type":"LONG","confidence":"HIGH"},]', { arrayKeys: ['ideas'] });
  assert.equal(arr[0].title, 'A');
});

test('extractJsonArray handles multipart-style string input', () => {
  const arr = extractJsonArray('{"summaries":[{"title":"T","summary":"Body text"}]}');
  assert.equal(arr[0].summary, 'Body text');
});

test('extractJsonArray handles trade_ideas wrapper', () => {
  const arr = extractJsonArray('{"trade_ideas":[{"title":"Gold","type":"LONG","confidence":"HIGH"}]}');
  assert.equal(arr[0].title, 'Gold');
});

test('extractJsonArray unwraps nested idea objects', () => {
  const json = '{"ideas":[{"idea":{"title":"Oil hedge","type":"HEDGE","confidence":"MEDIUM"}}]}';
  const arr = extractJsonArray(json);
  assert.equal(arr[0].idea.title, 'Oil hedge');
});
