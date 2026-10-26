// Robust JSON array extraction from LLM responses (markdown fences, prose wrappers, truncation, etc.)

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DEBUG_DIR = join(ROOT, 'runs', '.cache', 'llm');

const DEFAULT_ARRAY_KEYS = [
  'items', 'ideas', 'analysis', 'intelligence', 'results', 'summaries', 'intel', 'data',
  'trades', 'recommendations', 'responses', 'trade_ideas', 'leverageable_ideas',
];

/**
 * @param {string} text raw LLM response
 * @param {{ arrayKeys?: string[], debugLabel?: string }} [opts]
 * @returns {Array|null}
 */
export function extractJsonArray(text, opts = {}) {
  if (text == null) return null;
  const raw = typeof text === 'string' ? text : extractMessageText(text);
  if (!raw) return null;

  const arrayKeys = opts.arrayKeys || DEFAULT_ARRAY_KEYS;
  const candidates = collectCandidates(raw);

  for (const candidate of candidates) {
    const arr = tryParseArray(candidate, arrayKeys);
    if (arr?.length) return arr;
    const repaired = tryParseArray(repairJson(candidate), arrayKeys);
    if (repaired?.length) return repaired;
    const truncated = tryParseArray(repairTruncatedJson(candidate), arrayKeys);
    if (truncated?.length) return truncated;
  }

  // Last resort: salvage complete objects from a truncated top-level array
  const salvaged = salvagePartialArray(raw, arrayKeys);
  if (salvaged?.length) return salvaged;

  const single = tryParseSingleObject(raw, arrayKeys);
  if (single?.length) return single;

  if (opts.debugLabel) {
    saveParseDebug(opts.debugLabel, raw);
  }
  return null;
}

function collectCandidates(raw) {
  const out = [];
  const add = (s) => {
    const t = String(s || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };

  add(raw);

  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    add(cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim());
  }

  const fences = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const m of fences) add(m[1]);

  // Prefer first JSON-looking region after optional prose
  const jsonish = raw.match(/[\[{][\s\S]*/);
  if (jsonish) add(jsonish[0]);

  const start = raw.indexOf('[');
  if (start !== -1) {
    const slice = extractBalancedArray(raw, start);
    if (slice) add(slice);
    else add(raw.slice(start)); // truncated array — still try repair
  }

  const objStart = raw.indexOf('{');
  if (objStart !== -1) {
    const slice = extractBalancedObject(raw, objStart);
    if (slice) add(slice);
    else add(raw.slice(objStart));
  }

  return out;
}

function extractBalancedArray(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractBalancedObject(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseArray(raw, arrayKeys) {
  try {
    const parsed = JSON.parse(raw);
    return coerceToArray(parsed, arrayKeys);
  } catch {
    return null;
  }
}

function tryParseSingleObject(raw, arrayKeys) {
  for (const candidate of collectCandidates(raw)) {
    if (!candidate.trimStart().startsWith('{')) continue;
    for (const variant of [candidate, repairJson(candidate), repairTruncatedJson(candidate)]) {
      try {
        const parsed = JSON.parse(variant);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const keys = ['title', 'summary', 'headline', 'type', 'rationale'];
        if (keys.some(k => k in parsed)) return [parsed];
        const arr = coerceToArray(parsed, arrayKeys);
        if (arr?.length) return arr;
      } catch { /* next */ }
    }
  }
  return null;
}

function coerceToArray(parsed, arrayKeys) {
  if (Array.isArray(parsed)) return flattenItems(parsed);
  if (typeof parsed === 'string') {
    const inner = tryParseArray(repairJson(parsed), arrayKeys)
      || tryParseArray(repairTruncatedJson(parsed), arrayKeys);
    if (inner?.length) return inner;
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  for (const key of arrayKeys) {
    const val = parsed[key];
    if (Array.isArray(val)) return flattenItems(val);
    if (typeof val === 'string') {
      const inner = tryParseArray(repairJson(val), arrayKeys)
        || tryParseArray(repairTruncatedJson(val), arrayKeys);
      if (inner?.length) return inner;
    }
    if (val && typeof val === 'object') {
      const nested = coerceToArray(val, arrayKeys);
      if (nested?.length) return nested;
    }
  }

  // e.g. {"0": {...}, "1": {...}} or single-key wrapper objects
  const values = Object.values(parsed);
  if (values.length && values.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
    const items = values.filter(v => v.title || v.headline || v.name || v.summary || v.type);
    if (items.length) return items;
  }
  return null;
}

function flattenItems(arr) {
  const out = [];
  for (const item of arr) {
    if (!item) continue;
    if (typeof item === 'string') {
      try {
        const parsed = JSON.parse(repairJson(item));
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed)) out.push(...flattenItems(parsed));
          else out.push(parsed);
        }
      } catch { /* skip */ }
      continue;
    }
    if (typeof item === 'object') out.push(item);
  }
  return out;
}

function repairJson(raw) {
  return String(raw)
    .replace(/^\uFEFF/, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\r\n/g, '\n');
}

/**
 * Close truncated JSON (unclosed strings / brackets) so partial LLM output can parse.
 * Best-effort — may drop a trailing incomplete object.
 */
export function repairTruncatedJson(raw) {
  let s = repairJson(raw).trim();
  if (!s) return s;

  // Drop trailing incomplete key/value fragments common in truncated streams
  s = s.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"?\s*:?\s*$/u, '');
  s = s.replace(/,\s*[^,\[\]{}]*$/u, (m) => (m.includes('"') ? '' : m.replace(/,\s*$/, '')));
  s = s.replace(/:\s*$/u, ': null');
  s = s.replace(/,\s*$/u, '');

  // Close an open string
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') inString = !inString;
  }
  if (inString) s += '"';

  // Close open braces/brackets (track stack outside strings)
  const stack = [];
  inString = false;
  escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length && stack[stack.length - 1] === ch) stack.pop();
    }
  }
  while (stack.length) s += stack.pop();

  // Final trailing-comma cleanup after closers
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

/** Pull complete `{...}` elements from a truncated `[...]` when full parse fails. */
function salvagePartialArray(raw, arrayKeys) {
  const start = raw.indexOf('[');
  if (start === -1) return null;
  const body = raw.slice(start + 1);
  const items = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length || body[i] === ']') break;
    if (body[i] !== '{') break;
    const obj = extractBalancedObject(body, i);
    if (!obj) break;
    try {
      const parsed = JSON.parse(repairJson(obj));
      if (parsed && typeof parsed === 'object') items.push(parsed);
    } catch { /* stop on first bad object */ break; }
    i += obj.length;
  }
  if (!items.length) return null;
  return flattenItems(items);
}

function saveParseDebug(label, raw) {
  try {
    if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
    const safe = label.replace(/[^a-z0-9_-]+/gi, '_').substring(0, 40);
    writeFileSync(join(DEBUG_DIR, `parse-fail-${safe}.txt`), raw, 'utf8');
  } catch { /* non-fatal */ }
}

// local import guard for non-string content passed directly
function extractMessageText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(p => (typeof p === 'object' ? (p?.text || p?.content || '') : String(p || '')))
      .filter(Boolean).join('\n').trim();
  }
  return String(content).trim();
}
