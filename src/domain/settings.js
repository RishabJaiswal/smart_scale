/**
 * User settings with defaults and validation. Pure module: callers handle
 * storage; anything unexpected falls back to a default.
 */

import { BODY_FAT_FORMULAS, DEFAULT_FORMULA, SEX } from './bodyComposition.js';
import { METRICS, isMetricKey } from './metrics.js';
import { DEFAULT_RANGE, isRangeKey } from './insights.js';

export const DEFAULT_SETTINGS = Object.freeze({
  profile: Object.freeze({ heightCm: null, age: null, sex: null }),
  formula: DEFAULT_FORMULA,
  calibrationOffset: 0,
  metrics: Object.freeze(['weightKg', 'bmi', 'bodyFatPercent', 'muscleMassKg', 'waterPercent']),
  chartMetric: 'weightKg',
  chartRange: DEFAULT_RANGE,
  accentColor: '#0f766e',
});

const MAX_OFFSET = 20;

export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};

  return {
    profile: {
      heightCm: numberInRange(profile.heightCm, 50, 250),
      age: numberInRange(profile.age, 5, 120),
      sex: profile.sex === SEX.MALE || profile.sex === SEX.FEMALE ? profile.sex : null,
    },
    formula: Object.hasOwn(BODY_FAT_FORMULAS, input.formula) ? input.formula : DEFAULT_FORMULA,
    calibrationOffset: clampedOffset(input.calibrationOffset),
    metrics: Array.isArray(input.metrics)
      ? METRICS.map((m) => m.key).filter((key) => input.metrics.includes(key))
      : [...DEFAULT_SETTINGS.metrics],
    chartMetric: isMetricKey(input.chartMetric) ? input.chartMetric : DEFAULT_SETTINGS.chartMetric,
    chartRange: isRangeKey(input.chartRange) ? input.chartRange : DEFAULT_RANGE,
    accentColor:
      typeof input.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(input.accentColor)
        ? input.accentColor.toLowerCase()
        : DEFAULT_SETTINGS.accentColor,
  };
}

export function parseStoredSettings(json) {
  try {
    return normalizeSettings(JSON.parse(json));
  } catch {
    return normalizeSettings(undefined);
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(value);
}

function numberInRange(value, min, max) {
  const n = toNumber(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function clampedOffset(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, n));
}
