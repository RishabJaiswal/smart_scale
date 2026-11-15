/**
 * Decides when to sync with the shared sheet and keeps the connection's
 * state: debouncing bursts of edits, waiting while offline, and never
 * overwriting edits made while a sync was in flight. No DOM access;
 * everything it touches is passed in.
 */

import { syncWithSheet, EMPTY_BASE } from '../domain/sheetSync.js';
import { sanitizeReadings } from '../domain/history.js';
import { sanitizeProfiles } from '../domain/profiles.js';
import { isAppsScriptUrl } from './appsScriptStore.js';

export const SYNC_DEBOUNCE_MS = 2000;
const MAX_PASSES = 5;

/**
 * @typedef {{url: string, base: {readings: object[], profiles: object[]}, lastSyncedAt: number|null}} SheetLink
 * @typedef {{connected: boolean, url: string|null, phase: 'idle'|'syncing'|'offline'|'error',
 *            lastSyncedAt: number|null, error: string|null}} SheetSyncState
 */

/** Read a saved link; null if absent or unusable. Never throws. */
export function parseSheetLink(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || !isAppsScriptUrl(raw.url)) return null;
  return {
    url: raw.url,
    base: {
      readings: sanitizeReadings(raw.base?.readings),
      profiles: sanitizeProfiles(raw.base?.profiles),
    },
    lastSyncedAt: Number.isFinite(raw.lastSyncedAt) ? raw.lastSyncedAt : null,
  };
}

/**
 * @param {Object} deps
 * @param {() => SheetLink|null} deps.load
 * @param {(link: SheetLink|null) => void} deps.save
 * @param {(url: string) => import('../domain/sheetSync.js').SheetStore} deps.makeStore  Throws on a bad URL.
 * @param {() => {readings: object[], profiles: object[]}} deps.getLocal
 *   Must return the same arrays until the data changes (compared by identity).
 * @param {(merged: {readings: object[], profiles: object[]}) => void} deps.applyMerged
 * @param {(state: SheetSyncState) => void} [deps.onChange]
 */
export function createSheetSync({
  load,
  save,
  makeStore,
  getLocal,
  applyMerged,
  onChange = () => {},
  isOnline = () => globalThis.navigator?.onLine !== false,
  timers = globalThis,
  now = () => Date.now(),
}) {
  let link = load();
  let store = null;
  let running = null;
  let timer = null;
  let phase = 'idle';
  let error = null;

  try {
    if (link) store = makeStore(link.url);
  } catch {
    link = null;
  }

  const api = {
    /** @returns {SheetSyncState} */
    get state() {
      return {
        connected: Boolean(link),
        url: link?.url ?? null,
        phase,
        lastSyncedAt: link?.lastSyncedAt ?? null,
        error,
      };
    },

    /** Link to a sheet and do the first sync; rejects (and stays disconnected) if either fails. */
    async connect(url) {
      const candidate = makeStore(url);
      await api.idle();
      link = { url: url.trim(), base: EMPTY_BASE, lastSyncedAt: null };
      store = candidate;
      await api.syncNow();
      if (phase === 'error') {
        const message = error;
        api.disconnect();
        throw new Error(message);
      }
    },

    disconnect() {
      timers.clearTimeout(timer);
      timer = null;
      link = null;
      store = null;
      error = null;
      save(null);
      setPhase('idle');
    },

    /** Sync soon; repeated calls within the delay collapse into one. */
    schedule(delayMs = SYNC_DEBOUNCE_MS) {
      if (!link) return;
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        api.syncNow();
      }, delayMs);
    },

    /** Sync now. Never rejects: failures land in `state`. */
    syncNow() {
      if (!link) return Promise.resolve();
      if (running) return running;
      if (!isOnline()) {
        setPhase('offline');
        return Promise.resolve();
      }
      running = run().finally(() => {
        running = null;
      });
      return running;
    },

    /** Resolves when no sync is in flight. */
    idle() {
      return running ?? Promise.resolve();
    },
  };

  async function run() {
    setPhase('syncing');
    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const local = getLocal();
        const result = await syncWithSheet(store, local, link.base);
        if (!link) return; // disconnected while waiting

        const current = getLocal();
        const editedMeanwhile =
          current.readings !== local.readings || current.profiles !== local.profiles;
        // The merge was computed from stale local data. The sheet already has
        // it, so go round again: the next merge keeps the newer local edits.
        if (editedMeanwhile) continue;

        link = { ...link, base: result.base, lastSyncedAt: now() };
        save(link);
        if (result.localChanged) applyMerged(result);
        error = null;
        setPhase('idle');
        return;
      }
      throw new Error('Data kept changing while syncing. It will retry.');
    } catch (failure) {
      error = failure?.message || String(failure);
      setPhase('error');
    }
  }

  function setPhase(next) {
    phase = next;
    onChange(api.state);
  }

  return api;
}
