import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSheetSync, parseSheetLink } from '../src/sync/sheetSyncController.js';
import { ManualTimers } from './support/fakeTransport.js';

const URL_OK = 'https://script.google.com/macros/s/abc/exec';
const READING = { takenAt: '2026-11-15T09:34:00', weightKg: 93.3, impedanceRaw: 5490, profileId: 'me' };
const OTHER = { takenAt: '2026-11-16T09:00:00', weightKg: 93.0, impedanceRaw: 5480, profileId: 'me' };
const PROFILE = { id: 'me', name: 'Me', heightCm: null, age: null, sex: null, formula: 'sun2003', calibrationOffset: 0 };

class MemorySheet {
  constructor() { this.rev = 0; this.readings = []; this.profiles = []; this.pulls = 0; this.onPull = null; this.fail = null; }
  async pull() {
    this.pulls++;
    if (this.fail) throw this.fail;
    const snapshot = { rev: this.rev, readings: [...this.readings], profiles: [...this.profiles] };
    if (this.onPull) { const hook = this.onPull; this.onPull = null; hook(); }
    return snapshot;
  }
  async push({ baseRev, readings, profiles }) {
    if (baseRev !== this.rev) return { ok: false, conflict: true };
    this.readings = readings.map(({ profileName, ...rest }) => rest);
    this.profiles = profiles;
    this.rev++;
    return { ok: true, rev: this.rev };
  }
}

function setup({ saved = null, online = true } = {}) {
  const sheet = new MemorySheet();
  const world = {
    sheet,
    timers: new ManualTimers(),
    online,
    saved,
    local: { readings: [READING], profiles: [PROFILE] },
    applied: [],
    states: [],
  };
  world.sync = createSheetSync({
    load: () => world.saved,
    save: (link) => { world.saved = link; },
    makeStore: (url) => {
      if (url !== URL_OK) throw new Error('not a web app link');
      return sheet;
    },
    getLocal: () => world.local,
    applyMerged: (merged) => {
      world.applied.push(merged);
      world.local = { readings: merged.readings, profiles: merged.profiles };
    },
    onChange: (state) => world.states.push(state.phase),
    isOnline: () => world.online,
    timers: world.timers,
    now: () => 1234,
  });
  return world;
}

describe('createSheetSync', () => {
  test('starts disconnected', () => {
    const { sync } = setup();
    assert.equal(sync.state.connected, false);
  });

  test('connecting with a bad link fails and stays disconnected', async () => {
    const world = setup();
    await assert.rejects(world.sync.connect('https://docs.google.com/spreadsheets/d/x'), /web app link/);
    assert.equal(world.sync.state.connected, false);
    assert.equal(world.saved, null);
  });

  test('connecting uploads local data and remembers the agreed state', async () => {
    const world = setup();

    await world.sync.connect(URL_OK);

    assert.deepEqual(world.sheet.readings, [READING]);
    assert.equal(world.sync.state.phase, 'idle');
    assert.equal(world.sync.state.lastSyncedAt, 1234);
    assert.equal(world.saved.url, URL_OK);
    assert.deepEqual(world.saved.base.readings, [READING]);
    assert.deepEqual(world.applied, [], 'nothing new came from the sheet');
  });

  test('a failed first sync does not leave a half-made connection', async () => {
    const world = setup();
    world.sheet.fail = new Error('HTTP 404');

    await assert.rejects(world.sync.connect(URL_OK), /404/);

    assert.equal(world.sync.state.connected, false);
    assert.equal(world.saved, null);
  });

  test('restores a saved connection', () => {
    const world = setup({ saved: { url: URL_OK, base: { readings: [], profiles: [] }, lastSyncedAt: 99 } });
    assert.equal(world.sync.state.connected, true);
    assert.equal(world.sync.state.lastSyncedAt, 99);
  });

  test('applies changes that arrive from the sheet', async () => {
    const world = setup();
    await world.sync.connect(URL_OK);
    world.sheet.readings = [READING, OTHER];

    await world.sync.syncNow();

    assert.equal(world.applied.length, 1);
    assert.deepEqual(world.local.readings, [READING, OTHER]);
  });

  test('schedule() collapses a burst of changes into one sync', async () => {
    const world = setup();
    await world.sync.connect(URL_OK);
    const before = world.sheet.pulls;

    world.sync.schedule();
    world.sync.schedule();
    world.sync.schedule();
    assert.equal(world.timers.count, 1);
    world.timers.fireAll();
    await world.sync.idle();

    assert.equal(world.sheet.pulls, before + 1);
  });

  test('offline: waits, then syncs when asked again online', async () => {
    const world = setup();
    await world.sync.connect(URL_OK);
    world.online = false;
    world.local = { readings: [READING, OTHER], profiles: [PROFILE] };
    const before = world.sheet.pulls;

    await world.sync.syncNow();
    assert.equal(world.sync.state.phase, 'offline');
    assert.equal(world.sheet.pulls, before, 'no network attempt while offline');

    world.online = true;
    await world.sync.syncNow();
    assert.equal(world.sync.state.phase, 'idle');
    assert.deepEqual(world.sheet.readings, [READING, OTHER]);
  });

  test('an error is reported and the agreed state is left alone', async () => {
    const world = setup();
    await world.sync.connect(URL_OK);
    const base = world.saved.base;
    world.sheet.fail = new Error('HTTP 500');

    await world.sync.syncNow();

    assert.equal(world.sync.state.phase, 'error');
    assert.match(world.sync.state.error, /500/);
    assert.equal(world.saved.base, base);
    assert.equal(world.sync.state.connected, true);
  });

  test('edits made while a sync is in flight are not overwritten', async () => {
    const world = setup();
    await world.sync.connect(URL_OK);
    world.sheet.readings = [READING, OTHER]; // arrives from another phone
    const mine = { ...READING, takenAt: '2026-11-17T08:00:00' };
    world.sheet.onPull = () => {
      world.local = { readings: [READING, mine], profiles: [PROFILE] }; // user acts mid-sync
    };

    await world.sync.syncNow();

    assert.deepEqual(world.local.readings.map((m) => m.takenAt), [READING.takenAt, OTHER.takenAt, mine.takenAt]);
    assert.deepEqual(world.sheet.readings.map((m) => m.takenAt), [READING.takenAt, OTHER.takenAt, mine.takenAt]);
  });

  test('disconnecting forgets the link and stops syncing', async () => {
    const world = setup();
    await world.sync.connect(URL_OK);
    const before = world.sheet.pulls;

    world.sync.disconnect();
    world.sync.schedule();
    world.timers.fireAll();
    await world.sync.idle();

    assert.equal(world.saved, null);
    assert.equal(world.sync.state.connected, false);
    assert.equal(world.sheet.pulls, before);
  });

  test('reports phases as it goes', async () => {
    const world = setup();
    await world.sync.connect(URL_OK);
    assert.deepEqual(world.states.slice(0, 2), ['syncing', 'idle']);
  });
});

describe('parseSheetLink', () => {
  test('round-trips a saved link', () => {
    const link = { url: URL_OK, base: { readings: [READING], profiles: [PROFILE] }, lastSyncedAt: 5 };
    assert.deepEqual(parseSheetLink(JSON.stringify(link)), link);
  });

  test('is null for nothing, junk, or a non-Apps-Script URL', () => {
    assert.equal(parseSheetLink(null), null);
    assert.equal(parseSheetLink('{oops'), null);
    assert.equal(parseSheetLink(JSON.stringify({ url: 'https://evil.example/x' })), null);
  });

  test('repairs a missing or damaged base', () => {
    const link = parseSheetLink(JSON.stringify({ url: URL_OK, base: { readings: 'x' } }));
    assert.deepEqual(link, { url: URL_OK, base: { readings: [], profiles: [] }, lastSyncedAt: null });
  });
});
