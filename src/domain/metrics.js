/**
 * The metrics the app can show, chart and export. Each key is a field of
 * `analyse()`'s result. Pure module.
 */

export const METRICS = Object.freeze([
  { key: 'weightKg', label: 'Weight', unit: 'kg', decimals: 1 },
  { key: 'bmi', label: 'BMI', unit: '', decimals: 1 },
  { key: 'bodyFatPercent', label: 'Body fat', unit: '%', decimals: 1 },
  { key: 'fatMassKg', label: 'Fat mass', unit: 'kg', decimals: 1 },
  { key: 'leanMassKg', label: 'Lean mass', unit: 'kg', decimals: 1 },
  { key: 'muscleMassKg', label: 'Skeletal muscle', unit: 'kg', decimals: 1 },
  { key: 'waterPercent', label: 'Body water', unit: '%', decimals: 1 },
  { key: 'bmrKcal', label: 'BMR', unit: 'kcal', decimals: 0 },
  { key: 'impedanceOhm', label: 'Impedance', unit: 'Ω', decimals: 1 },
]);

const byKey = new Map(METRICS.map((m) => [m.key, m]));

export function metricByKey(key) {
  return byKey.get(key);
}

export function isMetricKey(key) {
  return byKey.has(key);
}

/** Number only, rounded to the metric's precision; empty string when missing. */
export function formatMetricValue(metric, value) {
  return Number.isFinite(value) ? value.toFixed(metric.decimals) : '';
}

/** Value with unit, or an em dash when missing. */
export function formatMetric(metric, value) {
  const number = formatMetricValue(metric, value);
  if (number === '') return '—';
  return metric.unit ? `${number} ${metric.unit}` : number;
}

/** Column header such as `Weight (kg)`. */
export function metricHeading(metric) {
  return metric.unit ? `${metric.label} (${metric.unit})` : metric.label;
}

/** 'up' | 'down' | 'same' after rounding to the metric's precision; null if missing. */
export function changeDirection(metric, delta) {
  if (!Number.isFinite(delta)) return null;
  const rounded = Number(delta.toFixed(metric.decimals));
  return rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'same';
}

/** Signed change such as `−0.3 kg`; `''` when missing. */
export function formatChange(metric, delta) {
  const direction = changeDirection(metric, delta);
  if (direction === null) return '';
  const sign = direction === 'up' ? '+' : direction === 'down' ? '−' : '';
  const number = Math.abs(delta).toFixed(metric.decimals);
  return metric.unit ? `${sign}${number} ${metric.unit}` : `${sign}${number}`;
}
