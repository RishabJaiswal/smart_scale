/**
 * People who use the scale, and which readings belong to whom.
 *
 * A reading's `profileId` names its profile; `null` (or an id that no
 * longer exists) means it is unassigned. Pure module.
 */

import { BODY_FAT_FORMULAS, DEFAULT_FORMULA, SEX } from './bodyComposition.js';
import { measurementKey } from './history.js';

export const FIRST_PROFILE_ID = 'me';
const MAX_NAME_LENGTH = 30;
const MAX_OFFSET = 20;
const SAFE_ID = /^[\w-]{1,40}$/;
const SUGGEST_WITHIN_KG = 3;
const SUGGEST_MARGIN_KG = 1;

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} name
 * @property {number|null} heightCm
 * @property {number|null} age
 * @property {'male'|'female'|null} sex
 * @property {string} formula            Body-fat formula key.
 * @property {number} calibrationOffset  Body-fat percentage points.
 */

/** Validate a stored list; always returns at least one profile. */
export function normalizeProfiles(raw) {
  const seen = new Set();
  const profiles = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry.id !== 'string' || !SAFE_ID.test(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    profiles.push(normalizeProfile(entry, `Profile ${profiles.length + 1}`));
  }
  return profiles.length ? profiles : [normalizeProfile({ id: FIRST_PROFILE_ID }, 'Me')];
}

function normalizeProfile(raw, fallbackName) {
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  return {
    id: raw.id,
    name: name || fallbackName,
    heightCm: numberInRange(raw.heightCm, 50, 250),
    age: numberInRange(raw.age, 5, 120),
    sex: raw.sex === SEX.MALE || raw.sex === SEX.FEMALE ? raw.sex : null,
    formula: Object.hasOwn(BODY_FAT_FORMULAS, raw.formula) ? raw.formula : DEFAULT_FORMULA,
    calibrationOffset: clampedOffset(raw.calibrationOffset),
  };
}

/** `Profile N` with the lowest N not already taken. */
export function nextProfileName(profiles) {
  const names = new Set(profiles.map((p) => p.name));
  let n = profiles.length + 1;
  while (names.has(`Profile ${n}`)) n++;
  return `Profile ${n}`;
}

export function profileById(profiles, id) {
  return profiles.find((p) => p.id === id) ?? null;
}

export function measurementsOf(history, profileId) {
  return history.filter((m) => m.profileId === profileId);
}

/** Readings with no profile, or (given `profiles`) pointing at one that is gone. */
export function unassignedOf(history, profiles = null) {
  const known = profiles && new Set(profiles.map((p) => p.id));
  return history.filter((m) => m.profileId == null || (known !== null && !known.has(m.profileId)));
}

/** Map the readings with the given keys to a profile (or `null` to unassign). */
export function assignMeasurements(history, keys, profileId) {
  const chosen = new Set(keys);
  return history.map((m) => (chosen.has(measurementKey(m)) ? { ...m, profileId } : m));
}

/** Unassign every reading of a profile, e.g. before deleting it. */
export function releaseProfile(history, profileId) {
  return history.map((m) => (m.profileId === profileId ? { ...m, profileId: null } : m));
}

/** Who new readings belong to without asking: the only profile, else nobody. */
export function defaultAssignee(profiles) {
  return profiles.length === 1 ? profiles[0].id : null;
}

/**
 * Guess whose reading this is from each profile's reading nearest in time.
 * Only suggests when one profile is within 3 kg and clearly closer than the
 * rest; the user always confirms.
 * @returns {string|null} profile id
 */
export function suggestProfile(measurement, history, profiles) {
  const at = Date.parse(`${measurement.takenAt}Z`);
  const gaps = profiles
    .map((profile) => {
      const own = measurementsOf(history, profile.id);
      if (own.length === 0) return null;
      const nearest = own.reduce((best, m) =>
        Math.abs(Date.parse(`${m.takenAt}Z`) - at) < Math.abs(Date.parse(`${best.takenAt}Z`) - at) ? m : best,
      );
      return { id: profile.id, gap: Math.abs(nearest.weightKg - measurement.weightKg) };
    })
    .filter(Boolean)
    .sort((a, b) => a.gap - b.gap);

  const [best, runnerUp] = gaps;
  if (!best || best.gap > SUGGEST_WITHIN_KG) return null;
  if (runnerUp && runnerUp.gap - best.gap < SUGGEST_MARGIN_KG) return null;
  return best.id;
}

/**
 * Readings saved before profiles existed belong to whoever was using the
 * app, i.e. the first profile. `rawSettings` is the stored settings object
 * as it was saved (or null).
 */
export function adoptLegacyHistory(history, rawSettings, profiles) {
  if (Array.isArray(rawSettings?.profiles)) return history;
  return history.map((m) => (m.profileId == null ? { ...m, profileId: profiles[0].id } : m));
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
