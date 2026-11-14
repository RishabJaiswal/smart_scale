/**
 * Measurement history: merging synced data, (de)serialising, CSV export.
 * Pure module.
 */

import { analyse } from './bodyComposition.js';
import { METRICS, formatMetricValue, metricHeading } from './metrics.js';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Two readings are the same if taken at the same second with the same weight. */
export function measurementKey(m) {
  return `${m.takenAt}|${m.weightKg}`;
}

const byTakenAt = (a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0);

/**
 * @returns {{history: import('./protocol.js').Measurement[], added: number}}
 */
export function mergeMeasurements(existing, incoming) {
  const merged = new Map(existing.map((m) => [measurementKey(m), m]));
  let added = 0;
  for (const m of incoming) {
    const key = measurementKey(m);
    if (!merged.has(key)) {
      merged.set(key, m);
      added++;
    }
  }
  return { history: [...merged.values()].sort(byTakenAt), added };
}

export function removeMeasurement(history, key) {
  return history.filter((m) => measurementKey(m) !== key);
}

function isMeasurement(m) {
  return (
    m != null &&
    typeof m.takenAt === 'string' &&
    TIMESTAMP.test(m.takenAt) &&
    Number.isFinite(m.weightKg) &&
    m.weightKg > 0 &&
    Number.isFinite(m.impedanceRaw)
  );
}

/** Parse whatever was in storage; never throws. */
export function parseStoredHistory(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter(isMeasurement)
    .map(({ takenAt, weightKg, impedanceRaw }) => ({ takenAt, weightKg, impedanceRaw }))
    .sort(byTakenAt);
}

/**
 * Export every metric for every measurement. Cells that cannot be computed
 * are left empty.
 */
export function toCsv(history, profile, options) {
  const header = ['Date', ...METRICS.map(metricHeading), 'Impedance (raw)'];
  const rows = history.map((m) => {
    const analysis = analyse(m, profile, options);
    return [
      m.takenAt.replace('T', ' '),
      ...METRICS.map((metric) => formatMetricValue(metric, analysis[metric.key])),
      String(m.impedanceRaw),
    ];
  });
  return [header, ...rows].map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n';
}

function csvCell(value) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
