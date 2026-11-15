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
    };

    if (!readings.remoteChanged && !profiles.remoteChanged) return { ...outcome, pushed: false };

    const written = await store.push({
      baseRev: snapshot.rev,
      readings: withProfileNames(merged.readings, merged.profiles),
      profiles: merged.profiles,
    });
    if (written.ok) return { ...outcome, pushed: true };
    // Someone else wrote in between: pull again and re-merge.
  }
  throw new Error('The sheet keeps changing while syncing. Try again in a moment.');
}

/** The sheet shows who each reading belongs to; the app only reads the id back. */
function withProfileNames(readings, profiles) {
  const names = new Map(profiles.map((p) => [p.id, p.name]));
  return readings.map((m) => ({ ...m, profileName: names.get(m.profileId) ?? '' }));
}
