// Signal Core — relative activity scores for the dashboard HOT METRICS panel.
// Bar width = current value vs rolling median from prior sweeps (hot memory).
// Trend = escalated/deescalated flag from the delta engine since last sweep.

import config from '../crucix.config.mjs';

export const SIGNAL_CORE_METRICS = [
  {
    key: 'urgent_posts',
    labelKey: 'signalMetrics.incidentTempo',
    extract: d => d.tg?.urgent?.length || 0,
    floor: 1,
  },
  {
    key: 'air_total',
    labelKey: 'signalMetrics.airActivity',
    extract: d => d.air?.reduce((s, a) => s + (a.total || 0), 0) || 0,
    floor: 10,
  },
  {
    key: 'thermal_hc',
    labelKey: 'signalMetrics.thermalSpikes',
    extract: d => d.thermal?.reduce((s, t) => s + (t.hc || 0), 0) || 0,
    floor: 10,
  },
  {
    key: 'sdr_total',
    labelKey: 'signalMetrics.sdrNodes',
    extract: d => d.sdr?.total || 0,
    floor: 50,
  },
  {
    key: 'earthquake_total',
    labelKey: 'signalMetrics.earthquakes',
    extract: d => d.earthquakes?.total || 0,
    floor: 1,
  },
  {
    key: 'who_alerts',
    labelKey: 'signalMetrics.whoAlerts',
    extract: d => d.who?.length || 0,
    floor: 1,
  },
];

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function metricTrend(key, delta) {
  if (!delta?.signals) return 'flat';
  if (delta.signals.escalated?.some(s => s.key === key)) return 'up';
  if (delta.signals.deescalated?.some(s => s.key === key)) return 'down';
  return 'flat';
}

function activityBarPct(current, baseline, priorCount, floor) {
  if (current <= 0) return 0;
  if (priorCount === 0 || baseline == null) return 50;
  const denom = Math.max(baseline, floor, 1);
  return Math.min(100, Math.max(0, (current / denom) * 50));
}

/**
 * @param {object} current - current synthesized sweep payload
 * @param {Array<object>} priorRuns - compact data from prior hot-memory runs
 * @param {object|null} delta - delta since previous sweep
 */
export function buildSignalCore(current, priorRuns = [], delta = null) {
  const floorOverrides = config.signalCore?.floors || {};

  const metrics = SIGNAL_CORE_METRICS.map(m => {
    const value = m.extract(current);
    const priorValues = priorRuns.map(run => m.extract(run));
    const baseline = priorValues.length ? median(priorValues) : null;
    const floor = floorOverrides[m.key] ?? m.floor ?? 1;
    const barPct = activityBarPct(value, baseline, priorValues.length, floor);
    const trend = metricTrend(m.key, delta);

    return {
      key: m.key,
      labelKey: m.labelKey,
      value,
      barPct: Math.round(barPct),
      trend,
      baseline: baseline != null ? Math.round(baseline) : null,
    };
  });

  return {
    metrics,
    hasBaseline: priorRuns.length > 0,
  };
}
