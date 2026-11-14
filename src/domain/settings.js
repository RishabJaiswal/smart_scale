/**
 * User settings with defaults and validation. Pure module: callers handle
 * storage; anything unexpected falls back to a default.
 */

import { METRICS, isMetricKey } from './metrics.js';
import { DEFAULT_RANGE, isRangeKey } from './insights.js';
import { normalizeProfiles, profileById, FIRST_PROFILE_ID } from './profiles.js';

const DEFAULT_METRICS = ['weightKg', 'bmi', 'bodyFatPercent', 'muscleMassKg', 'waterPercent'];
const DEFAULT_CHART_METRIC = 'weightKg';
const DEFAULT_ACCENT = '#0f766e';

export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const profiles = normalizeProfiles(Array.isArray(input.profiles) ? input.profiles : legacyProfiles(input));

  return {
    profiles,
    activeProfileId: profileById(profiles, input.activeProfileId)?.id ?? profiles[0].id,
    metrics: Array.isArray(input.metrics)
      ? METRICS.map((m) => m.key).filter((key) => input.metrics.includes(key))
      : [...DEFAULT_METRICS],
    chartMetric: isMetricKey(input.chartMetric) ? input.chartMetric : DEFAULT_CHART_METRIC,
    chartRange: isRangeKey(input.chartRange) ? input.chartRange : DEFAULT_RANGE,
    accentColor:
      typeof input.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(input.accentColor)
        ? input.accentColor.toLowerCase()
        : DEFAULT_ACCENT,
  };
}

export const DEFAULT_SETTINGS = Object.freeze(normalizeSettings(undefined));

/** Before profiles, settings held one `profile` plus top-level formula and offset. */
function legacyProfiles(input) {
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  return [
    {
      ...profile,
      id: FIRST_PROFILE_ID,
      name: 'Me',
      formula: input.formula,
      calibrationOffset: input.calibrationOffset,
    },
  ];
}

export function activeProfile(settings) {
  return profileById(settings.profiles, settings.activeProfileId) ?? settings.profiles[0];
}

/** The stored object as saved (for migrations), or null. Never throws. */
export function parseRawSettings(json) {
  try {
    const raw = JSON.parse(json);
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export function parseStoredSettings(json) {
  return normalizeSettings(parseRawSettings(json));
}
