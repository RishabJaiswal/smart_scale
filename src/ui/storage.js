/**
 * localStorage access. Every read and write is guarded: storage can be
 * unavailable (private mode, blocked site data) and the app must still run.
 */

import { parseStoredHistory } from '../domain/history.js';
import { normalizeSettings, parseRawSettings } from '../domain/settings.js';
import { adoptLegacyHistory } from '../domain/profiles.js';

const HISTORY_KEY = 'hs11.history.v1';
const SETTINGS_KEY = 'hs11.settings.v1';

function read(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const storage = {
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
};
