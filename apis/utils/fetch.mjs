// Shared fetch utility with timeout, retries, curl fallback, and error handling

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let _curlOk = null;

function curlAvailable() {
  if (_curlOk !== null) return _curlOk;
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore' });
    _curlOk = true;
  } catch {
    _curlOk = false;
  }
  return _curlOk;
}

async function fetchViaCurl(url, timeoutMs, maxBuffer) {
  const sec = Math.max(5, Math.ceil(timeoutMs / 1000));
  const connectSec = Math.min(8, sec);
  const { stdout } = await execFileAsync('curl', [
    '-fsSL',
    '--connect-timeout', String(connectSec),
    '--max-time', String(sec),
    '-A', 'Crucix/1.0',
    url,
  ], { maxBuffer });
  return stdout;
}

function parseResponseText(text) {
  try { return JSON.parse(text); } catch { return { rawText: text.slice(0, 500) }; }
}

export async function safeFetch(url, opts = {}) {
  const {
    timeout = 15000,
    retries = 1,
    headers = {},
    curlFallback = true,
    maxBuffer = 64 * 1024 * 1024,
  } = opts;
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Crucix/1.0', ...headers },
      });
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const text = await res.text();
      return parseResponseText(text);
    } catch (e) {
      lastError = e;
      if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }

  const errMsg = lastError?.message || 'Unknown error';
  const shouldTryCurl = curlFallback
    && curlAvailable()
    && (/fetch failed/i.test(errMsg) || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|abort/i.test(errMsg));

  if (shouldTryCurl) {
    try {
      const text = await fetchViaCurl(url, timeout, maxBuffer);
      return parseResponseText(text);
    } catch (e) {
      lastError = e;
    }
  }

  return { error: lastError?.message || 'Unknown error', source: url };
}

export function ago(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

export function today() {
  return new Date().toISOString().split('T')[0];
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
