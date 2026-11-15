import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './support/fakeGoogle.js';
import { AppsScriptStore, isAppsScriptUrl } from '../src/sync/appsScriptStore.js';
import { syncWithSheet, EMPTY_BASE } from '../src/domain/sheetSync.js';

const READING = { takenAt: '2026-11-15T09:34:00', weightKg: 93.3, impedanceRaw: 5490, profileId: 'me', profileName: 'Rishab' };
const PROFILE = { id: 'me', name: 'Rishab', heightCm: 175, age: 30, sex: 'male', formula: 'sun2003', calibrationOffset: -1.5 };
const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';

describe('Code.gs (against stand-in Google services)', () => {
  test('an untouched sheet reads as empty at revision 0', () => {
    const script = loadAppsScript();
    assert.deepEqual(script.get(), { ok: true, rev: 0, readings: [], profiles: [] });
  });

  test('a write creates both tabs with headers and bumps the revision', () => {
    const script = loadAppsScript();

    const result = script.post({ baseRev: 0, readings: [READING], profiles: [PROFILE] });

    assert.deepEqual(result, { ok: true, rev: 1 });
    assert.deepEqual(script.tabs.get('Readings').cells, [
      ['Date', 'Weight (kg)', 'Impedance (raw)', 'Profile ID', 'Profile'],
      ['2026-11-15T09:34:00', 93.3, 5490, 'me', 'Rishab'],
    ]);
    assert.deepEqual(script.tabs.get('Profiles').cells[1], ['me', 'Rishab', 175, 30, 'male', 'sun2003', -1.5]);
  });

  test('dates and ids are stored as plain text so Sheets leaves them alone', () => {
    const script = loadAppsScript();
    script.post({ baseRev: 0, readings: [READING], profiles: [PROFILE] });
    assert.equal(script.tabs.get('Readings').formats.get(1), '@');
    assert.equal(script.tabs.get('Readings').formats.get(4), '@');
  });

  test('what was written reads back in the app’s shape', () => {
    const script = loadAppsScript();
    script.post({ baseRev: 0, readings: [READING, { ...READING, takenAt: '2026-11-16T09:00:00', profileId: null, profileName: '' }], profiles: [{ ...PROFILE, heightCm: null, sex: null }] });

    const { rev, readings, profiles } = script.get();

    assert.equal(rev, 1);
    assert.deepEqual(readings, [
      { takenAt: '2026-11-15T09:34:00', weightKg: 93.3, impedanceRaw: 5490, profileId: 'me' },
      { takenAt: '2026-11-16T09:00:00', weightKg: 93.3, impedanceRaw: 5490, profileId: null },
    ]);
    assert.deepEqual(profiles, [{ ...PROFILE, heightCm: null, sex: null }]);
  });

  test('a write based on a stale revision is refused and changes nothing', () => {
    const script = loadAppsScript();
    script.post({ baseRev: 0, readings: [READING], profiles: [PROFILE] });

    const result = script.post({ baseRev: 0, readings: [], profiles: [] });

    assert.deepEqual(result, { ok: false, conflict: true });
    assert.equal(script.get().readings.length, 1);
  });

  test('writing fewer rows removes the old ones', () => {
    const script = loadAppsScript();
    script.post({ baseRev: 0, readings: [READING, { ...READING, takenAt: '2026-11-16T09:00:00' }], profiles: [PROFILE] });
    script.post({ baseRev: 1, readings: [READING], profiles: [PROFILE] });
    assert.equal(script.get().readings.length, 1);
  });

  test('a date cell typed by hand is turned back into text', () => {
    const script = loadAppsScript();
    script.post({ baseRev: 0, readings: [READING], profiles: [PROFILE] });
    script.tabs.get('Readings').cells[1][0] = new Date(Date.UTC(2026, 10, 15, 9, 34, 0));
    assert.equal(script.get().readings[0].takenAt, '2026-11-15T09:34:00');
  });

  test('blank rows left in the sheet are skipped', () => {
    const script = loadAppsScript();
    script.post({ baseRev: 0, readings: [READING], profiles: [PROFILE] });
    script.tabs.get('Readings').cells.push(['', '', '', '', '']);
    assert.equal(script.get().readings.length, 1);
  });
});

describe('isAppsScriptUrl', () => {
  test('accepts a deployed web app link', () => {
    assert.equal(isAppsScriptUrl(URL_OK), true);
    assert.equal(isAppsScriptUrl(`  ${URL_OK}  `), true);
  });

  test('rejects sheet links, dev links and other sites', () => {
    assert.equal(isAppsScriptUrl('https://docs.google.com/spreadsheets/d/abc/edit'), false);
    assert.equal(isAppsScriptUrl('https://script.google.com/macros/s/abc/dev'), false);
    assert.equal(isAppsScriptUrl('https://evil.example/macros/s/abc/exec'), false);
    assert.equal(isAppsScriptUrl('http://script.google.com/macros/s/abc/exec'), false);
    assert.equal(isAppsScriptUrl(''), false);
  });
});

describe('AppsScriptStore', () => {
  /** fetch that routes to the stand-in script, the way the web app would. */
  const fetchVia = (script, calls = []) => async (url, init = {}) => {
    calls.push({ url, init });
    const payload = init.method === 'POST' ? script.post(JSON.parse(init.body)) : script.get();
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };

  test('refuses anything that is not an Apps Script web app link', () => {
    assert.throws(() => new AppsScriptStore('https://docs.google.com/spreadsheets/d/abc/edit'), /web app link/i);
  });

  test('pull reads the sheet', async () => {
    const script = loadAppsScript();
    script.post({ baseRev: 0, readings: [READING], profiles: [PROFILE] });

    const snapshot = await new AppsScriptStore(URL_OK, fetchVia(script)).pull();

    assert.equal(snapshot.rev, 1);
    assert.equal(snapshot.readings[0].weightKg, 93.3);
  });

  test('push posts JSON as text/plain, which browsers send without a preflight', async () => {
    const calls = [];
    const store = new AppsScriptStore(URL_OK, fetchVia(loadAppsScript(), calls));

    const result = await store.push({ baseRev: 0, readings: [READING], profiles: [PROFILE] });

    assert.deepEqual(result, { ok: true, rev: 1 });
    assert.equal(calls[0].url, URL_OK);
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[0].init.headers['Content-Type'], /^text\/plain/);
  });

  test('explains the usual cause when Google answers with a web page', async () => {
    const store = new AppsScriptStore(URL_OK, async () => ({ ok: true, status: 200, text: async () => '<!doctype html><title>Sign in</title>' }));
    await assert.rejects(store.pull(), /Anyone/);
  });

  test('reports HTTP failures', async () => {
    const store = new AppsScriptStore(URL_OK, async () => ({ ok: false, status: 404, text: async () => '' }));
    await assert.rejects(store.pull(), /404/);
  });

  test('a whole sync round-trips through the script and settles', async () => {
    const script = loadAppsScript();
    const store = new AppsScriptStore(URL_OK, fetchVia(script));
    const { profileName, ...reading } = READING;
    const local = { readings: [reading], profiles: [PROFILE] };

    const first = await syncWithSheet(store, local, EMPTY_BASE);
    const second = await syncWithSheet(store, first, first.base);

    assert.equal(first.pushed, true);
    assert.equal(second.pushed, false, 'what was written reads back identical');
    assert.equal(second.localChanged, false);
    assert.equal(script.tabs.get('Readings').cells[1][4], 'Rishab');
  });
});
