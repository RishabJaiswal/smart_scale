/**
 * localStorage access. Every read and write is guarded: storage can be
 * unavailable (private mode, blocked site data) and the app must still run.
 */

import { parseStoredHistory } from '../domain/history.js';
import { normalizeSettings, parseRawSettings } from '../domain/settings.js';
import { adoptLegacyHistory } from '../domain/profiles.js';

import { parseSheetLink } from '../sync/sheetSyncController.js';

function read(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} namespace  Key prefix, so demo mode keeps its data apart
 *   from the real app's on the same origin.
 */
export function createStorage(namespace = 'hs11') {
  const HISTORY_KEY = `${namespace}.history.v1`;
  const SETTINGS_KEY = `${namespace}.settings.v1`;
  const SHEET_KEY = `${namespace}.sheet.v1`;

  return {
    /** Load settings and history together, migrating pre-profile data. */
    load() {
      const rawSettings = parseRawSettings(read(SETTINGS_KEY));
      const settings = normalizeSettings(rawSettings);
      const history = adoptLegacyHistory(
        parseStoredHistory(read(HISTORY_KEY)),
        rawSettings,
        settings.profiles,
      );
      return { settings, history };
    },
    saveHistory: (history) => write(HISTORY_KEY, history),
    saveSettings: (settings) => write(SETTINGS_KEY, settings),
    loadSheetLink: () => parseSheetLink(read(SHEET_KEY)),
    saveSheetLink: (link) => write(SHEET_KEY, link),
  };
}
