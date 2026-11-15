import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/**
 * Loads google-apps-script/Code.gs with in-memory stand-ins for the Apps
 * Script services it uses, so its logic can be exercised without Google.
 * This does NOT prove behaviour on real Google Sheets.
 */
export function loadAppsScript() {
  const tabs = new Map(); // name -> { cells: any[][], formats: Map, frozen }
  const properties = new Map();

  const makeSheet = (tab) => ({
    getLastRow: () => tab.cells.length,
    getLastColumn: () => Math.max(0, ...tab.cells.map((row) => row.length)),
    clearContents: () => { tab.cells = []; },
    setFrozenRows: (n) => { tab.frozen = n; },
    getRange: (row, column, rows, columns) => ({
      getValues: () =>
        Array.from({ length: rows }, (_, r) =>
          Array.from({ length: columns }, (_, c) => tab.cells[row - 1 + r]?.[column - 1 + c] ?? '')),
      setValues: (values) => {
        values.forEach((line, r) => {
          tab.cells[row - 1 + r] ??= [];
          line.forEach((value, c) => { tab.cells[row - 1 + r][column - 1 + c] = value; });
        });
      },
      setNumberFormat: (format) => { tab.formats.set(column, format); },
    }),
  });

  const book = {
    getSheetByName: (name) => (tabs.has(name) ? makeSheet(tabs.get(name)) : null),
    insertSheet: (name) => {
      tabs.set(name, { cells: [], formats: new Map(), frozen: 0 });
      return makeSheet(tabs.get(name));
    },
    getSpreadsheetTimeZone: () => 'UTC',
  };

  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    Utilities: {
      formatDate: (date) => date.toISOString().slice(0, 19),
    },
  });
  vm.runInContext(readFileSync(new URL('../../google-apps-script/Code.gs', import.meta.url), 'utf8'), context);

  return {
    tabs,
    get: () => JSON.parse(context.doGet().text),
    post: (body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text),
  };
}
