/**
 * Two-way sync between this device and a shared sheet, written against a
 * small SheetStore interface so it runs against Google Apps Script or a
 * test fake. Pure apart from the store calls.
 *
 * @typedef {Object} SheetSnapshot
 * @property {number} rev  Revision counter; bumped by every write.
 * @property {object[]} readings
 * @property {object[]} profiles
 *
 * @typedef {Object} SheetStore
 * @property {() => Promise<SheetSnapshot>} pull
 * @property {(write: {baseRev: number, readings: object[], profiles: object[]}) =>
 *   Promise<{ok: true, rev: number} | {ok: false, conflict: true}>} push
 *   Rejects the write with `conflict` if the sheet moved on from `baseRev`.
 *
 * @typedef {{readings: object[], profiles: object[]}} SyncedData
 */

import { threeWayMerge } from './merge.js';
import { measurementKey, sanitizeReadings } from './history.js';
import { sanitizeProfiles } from './profiles.js';
import { analyse } from './bodyComposition.js';
import { METRICS, metricHeading } from './metrics.js';

/** Calculated figures written beside each reading. Weight is already a column. */
const SHEET_METRICS = METRICS.filter((metric) => metric.key !== 'weightKg');
export const SHEET_METRIC_HEADERS = Object.freeze(SHEET_METRICS.map(metricHeading));

export const EMPTY_BASE = Object.freeze({ readings: [], profiles: [] });
const MAX_ATTEMPTS = 3;

const sameReading = (a, b) => a.profileId === b.profileId && a.impedanceRaw === b.impedanceRaw;
const PROFILE_FIELDS = ['name', 'heightCm', 'age', 'sex', 'formula', 'calibrationOffset'];
const sameProfile = (a, b) => PROFILE_FIELDS.every((field) => a[field] === b[field]);

/**
 * Pull the sheet, merge it with this device's data relative to the last
 * agreed state (`base`), and push the result if the sheet needs it.
 *
 * @param {SheetStore} store
 * @param {SyncedData} local
 * @param {SyncedData} base  What device and sheet agreed on last time.
 * @returns {Promise<SyncedData & {base: SyncedData, localChanged: boolean, pushed: boolean}>}
 */
export async function syncWithSheet(store, local, base = EMPTY_BASE) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const snapshot = await store.pull();
    const readings = threeWayMerge({
      base: base.readings,
      local: local.readings,
      remote: sanitizeReadings(snapshot.readings),
      keyOf: measurementKey,
      same: sameReading,
    });
    const profiles = threeWayMerge({
      base: base.profiles,
      local: local.profiles,
      remote: sanitizeProfiles(snapshot.profiles),
      keyOf: (p) => p.id,
      same: sameProfile,
    });

    const merged = {
      readings: sanitizeReadings(readings.merged),
      profiles: profiles.merged,
    };
    const outcome = {
      ...merged,
      base: merged,
      localChanged: readings.localChanged || profiles.localChanged,
      // Older copies of Code.gs do not report their columns and drop the calculated ones.
      scriptOutdated: !Array.isArray(snapshot.extraHeaders),
    };

    // A script that reports its columns but lacks the calculated ones needs a rewrite.
    const columnsOutdated =
      Array.isArray(snapshot.extraHeaders) &&
      snapshot.extraHeaders.join('\n') !== SHEET_METRIC_HEADERS.join('\n');
    if (!readings.remoteChanged && !profiles.remoteChanged && !columnsOutdated) {
      return { ...outcome, pushed: false };
    }

    const written = await store.push({
      baseRev: snapshot.rev,
      readings: sheetRows(merged.readings, merged.profiles),
      extraHeaders: SHEET_METRIC_HEADERS,
      profiles: merged.profiles,
    });
    if (written.ok) return { ...outcome, pushed: true };
    // Someone else wrote in between: pull again and re-merge.
  }
  throw new Error('The sheet keeps changing while syncing. Try again in a moment.');
}

/**
 * Readings as sent to the sheet: plus the profile's name and the calculated
 * metrics, for people reading the sheet. The app only reads back the
 * reading itself and recalculates the rest.
 */
function sheetRows(readings, profiles) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return readings.map((m) => {
    const profile = byId.get(m.profileId) ?? null;
    const analysis = analyse(m, profile, {
      formula: profile?.formula,
      calibrationOffset: profile?.calibrationOffset,
    });
    return {
      ...m,
      profileName: profile?.name ?? '',
      extra: SHEET_METRICS.map((metric) => {
        const value = analysis[metric.key];
        return Number.isFinite(value) ? Number(value.toFixed(metric.decimals)) : '';
      }),
    };
  });
}
