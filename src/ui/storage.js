/**
 * localStorage access. Every read and write is guarded: storage can be
 * unavailable (private mode, blocked site data) and the app must still run.
 */

import { parseStoredHistory } from '../domain/history.js';
import { parseStoredSettings } from '../domain/settings.js';

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
  loadHistory: () => parseStoredHistory(read(HISTORY_KEY)),
  saveHistory: (history) => write(HISTORY_KEY, history),
  loadSettings: () => parseStoredSettings(read(SETTINGS_KEY)),
  saveSettings: (settings) => write(SETTINGS_KEY, settings),
};
