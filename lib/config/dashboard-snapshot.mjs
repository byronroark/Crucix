// Persists LLM-enhanced dashboard panels across redeploys (ideas, intel, market intel, delta).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../crucix.config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function snapshotFilePath() {
  const rel = config.dashboardSnapshotFile || 'runs/config/dashboard-snapshot.json';
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  return join(ROOT, rel);
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadDashboardSnapshot() {
  const path = snapshotFilePath();
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (!doc?.sweepAt || Number.isNaN(Date.parse(doc.sweepAt))) return null;
    return doc;
  } catch {
    return null;
  }
}

export function saveDashboardSnapshot(synthesized) {
  if (!synthesized?.meta?.timestamp) return;
  const path = snapshotFilePath();
  ensureDir(path);
  const doc = {
    version: 1,
    sweepAt: synthesized.meta.timestamp,
    ideas: synthesized.ideas || [],
    ideasSource: synthesized.ideasSource || 'disabled',
    intelAnalysis: synthesized.intelAnalysis || [],
    intelAnalysisSource: synthesized.intelAnalysisSource || 'disabled',
    marketIntel: synthesized.marketIntel || [],
    marketIntelSource: synthesized.marketIntelSource || 'disabled',
    delta: synthesized.delta || null,
    signalCore: synthesized.signalCore || null,
  };
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8');
}

/** Merge persisted LLM panels when snapshot matches the loaded sweep timestamp. */
export function applyDashboardSnapshot(data, sweepAt) {
  const snap = loadDashboardSnapshot();
  if (!snap || !sweepAt || snap.sweepAt !== sweepAt) return data;
  return {
    ...data,
    ideas: snap.ideas || [],
    ideasSource: snap.ideasSource || data.ideasSource,
    intelAnalysis: snap.intelAnalysis || [],
    intelAnalysisSource: snap.intelAnalysisSource || data.intelAnalysisSource,
    marketIntel: snap.marketIntel || [],
    marketIntelSource: snap.marketIntelSource || data.marketIntelSource,
    delta: snap.delta || data.delta,
    signalCore: snap.signalCore || data.signalCore,
  };
}
