/**
 * Derived views over the history: time ranges, summaries, grouping, BMI
 * band. Pure module; "now" is always passed in.
 */

export const RANGES = Object.freeze([
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
]);

export const DEFAULT_RANGE = '30d';

export function isRangeKey(key) {
  return RANGES.some((r) => r.key === key);
}

/** Format a Date as the scale's zone-less local timestamp. */
export function localTimestamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** Readings taken within the range ending at `now`. */
export function filterByRange(history, rangeKey, now) {
  const range = RANGES.find((r) => r.key === rangeKey);
  if (!range || range.days === null) return history;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - range.days);
  const from = localTimestamp(cutoff);
  return history.filter((m) => m.takenAt >= from);
}

/** Difference `current - previous`, or null if either is missing. */
export function change(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return tidy(current - previous);
}

/**
 * @param {(number|null|undefined)[]} values  In time order.
 */
export function summarize(values) {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return null;
  const first = v[0];
  const last = v.at(-1);
  return {
    count: v.length,
    first,
    last,
    change: tidy(last - first),
    average: tidy(v.reduce((a, b) => a + b, 0) / v.length),
    min: Math.min(...v),
    max: Math.max(...v),
  };
}

/** Newest month first; readings within a month newest first. */
export function groupByMonth(history) {
  const groups = new Map();
  for (const m of [...history].reverse()) {
    const key = m.takenAt.slice(0, 7);
    if (!groups.has(key)) {
      groups.set(key, { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)), items: [] });
    }
    groups.get(key).items.push(m);
  }
  return [...groups.values()];
}

const BMI_SCALE_MIN = 15;
const BMI_SCALE_MAX = 40;
export const BMI_BANDS = Object.freeze([
  { key: 'under', label: 'Underweight', from: BMI_SCALE_MIN, to: 18.5 },
  { key: 'healthy', label: 'Healthy', from: 18.5, to: 25 },
  { key: 'over', label: 'Overweight', from: 25, to: 30 },
  { key: 'obese', label: 'Obese', from: 30, to: BMI_SCALE_MAX },
]);

/** WHO adult BMI category plus a 0-1 position on a 15-40 scale. */
export function bmiBand(bmi) {
  if (!Number.isFinite(bmi)) return null;
  const band =
    BMI_BANDS.find((b) => bmi < b.to) ?? BMI_BANDS.at(-1);
  return { ...band, position: scalePosition(bmi) };
}

export function scalePosition(bmi) {
  const p = (bmi - BMI_SCALE_MIN) / (BMI_SCALE_MAX - BMI_SCALE_MIN);
  return Math.min(1, Math.max(0, p));
}

/** 'Today', 'Yesterday' or null, relative to `now`. */
export function relativeDay(takenAt, now) {
  const day = takenAt.slice(0, 10);
  if (day === localTimestamp(now).slice(0, 10)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localTimestamp(yesterday).slice(0, 10)) return 'Yesterday';
  return null;
}

const tidy = (n) => Math.round(n * 1e6) / 1e6;
