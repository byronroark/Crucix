// Persists last sweep time across redeploys so restarts respect REFRESH_INTERVAL_MINUTES.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../crucix.config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function stateFilePath() {
  const rel = config.sweepStateFile || 'runs/config/sweep-state.json';
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  return join(ROOT, rel);
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** @returns {string|null} ISO timestamp of last completed sweep */
export function loadLastSweepAt() {
  const path = stateFilePath();
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const ts = doc?.lastSweepAt;
    if (!ts || Number.isNaN(Date.parse(ts))) return null;
    return ts;
  } catch {
    return null;
  }
}

export function saveLastSweepAt(iso) {
  if (!iso || Number.isNaN(Date.parse(iso))) return;
  const path = stateFilePath();
  ensureDir(path);
  writeFileSync(path, JSON.stringify({ version: 1, lastSweepAt: iso }, null, 2), 'utf8');
}

/** Prefer the most recent timestamp from persisted state or latest.json. */
export function resolveLastSweepAt(persisted, latestTimestamp) {
  const candidates = [persisted, latestTimestamp].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.reduce((latest, ts) => (
    new Date(ts).getTime() > new Date(latest).getTime() ? ts : latest
  ));
}

/** Milliseconds until the next sweep is due (0 = run now). */
export function msUntilNextSweep(lastSweepAt, intervalMinutes) {
  if (!lastSweepAt) return 0;
  const elapsed = Date.now() - new Date(lastSweepAt).getTime();
  const intervalMs = intervalMinutes * 60 * 1000;
  return Math.max(0, intervalMs - elapsed);
}
