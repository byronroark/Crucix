#!/usr/bin/env node
import config from '../crucix.config.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { extractJsonArray } from '../lib/llm/parse-json-array.mjs';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';

const provider = createLLMProvider(config.llm);
if (!provider?.isConfigured) {
  console.error('LLM not configured');
  process.exit(2);
}

console.log(`Provider: ${provider.name} model=${provider.model}`);

const sys = `You are a test. Output ONLY valid JSON array. Each object:
{"title":"Short title","type":"WATCH","ticker":"SPY","confidence":"HIGH","rationale":"test","risk":"test","horizon":"Days","signals":["a"]}`;

const user = 'ECONOMIC: VIX=24.5, WTI=$71\nDELTA: direction=mixed, changes=2';
const result = await provider.complete(sys, user, { maxTokens: 2048, timeout: 90000 });

console.log('\n--- raw response meta ---');
console.log('typeof text:', typeof result.text);
console.log('isArray:', Array.isArray(result.text));
console.log('length:', String(result.text || '').length);
console.log('preview:', JSON.stringify(String(result.text || '').slice(0, 800)));

const parsed = extractJsonArray(String(result.text || ''), { arrayKeys: ['ideas', 'items', 'trades'] });
console.log('\n--- extractJsonArray ---');
console.log('parsed count:', parsed?.length ?? 'null');
if (parsed?.[0]) console.log('first item keys:', Object.keys(parsed[0]));
