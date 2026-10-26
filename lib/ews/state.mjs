// Persist last Apocalypse EWS emergency level across sweeps.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../crucix.config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function stateFilePath() {
  const rel = config.ews?.stateFile || 'runs/config/ews-state.json';
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  return join(ROOT, rel);
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * @returns {{ level: number, asOf?: string|null, updatedAt?: string }|null}
 */
export function loadEwsState() {
  const path = stateFilePath();
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const level = Number(doc?.level);
    if (!Number.isFinite(level) || level < 1 || level > 5) return null;
    return {
      level: Math.round(level),
      asOf: doc.asOf || null,
      updatedAt: doc.updatedAt || null,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ level: number, asOf?: string|null }} state
 */
export function saveEwsState(state) {
  const level = Number(state?.level);
  if (!Number.isFinite(level) || level < 1 || level > 5) return;
  const path = stateFilePath();
  ensureDir(path);
  writeFileSync(path, JSON.stringify({
    version: 1,
    level: Math.round(level),
    asOf: state.asOf || null,
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
}

export { stateFilePath as ewsStateFilePath };
