import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { syncWithSheet, EMPTY_BASE } from '../src/domain/sheetSync.js';

const r = (takenAt, weightKg, profileId = null) => ({ takenAt, weightKg, impedanceRaw: 4700, profileId });
const p = (id, name, extra = {}) => ({
  id, name, heightCm: null, age: null, sex: null, formula: 'sun2003', calibrationOffset: 0, ...extra,
});

/** In-memory SheetStore with optimistic concurrency, like the Apps Script. */
class FakeSheet {
  constructor({ readings = [], profiles = [] } = {}) {
    this.rev = 0;
    this.readings = readings;
    this.profiles = profiles;
    this.pushes = [];
    this.beforePush = null;
  }
  async pull() {
    return { rev: this.rev, readings: structuredClone(this.readings), profiles: structuredClone(this.profiles) };
  }
  async push({ baseRev, readings, profiles }) {
    if (this.beforePush) {
      const interfere = this.beforePush;
      this.beforePush = null;
      interfere(this);
    }
    if (baseRev !== this.rev) return { ok: false, conflict: true };
    this.pushes.push({ readings, profiles });
    this.readings = readings.map(({ profileName, ...rest }) => rest);
    this.profiles = profiles;
    this.rev++;
    return { ok: true, rev: this.rev };
  }
}

const ANN = p('ann', 'Ann');
const BOB = p('bob', 'Bob');
const A1 = r('2026-11-01T07:00:00', 60, 'ann');
const B1 = r('2026-11-01T07:05:00', 82, 'bob');

describe('syncWithSheet', () => {
  test('first sync uploads this device’s data to an empty sheet', async () => {
    const sheet = new FakeSheet();
    const result = await syncWithSheet(sheet, { readings: [A1], profiles: [ANN] }, EMPTY_BASE);

    assert.deepEqual(sheet.readings, [A1]);
    assert.deepEqual(sheet.profiles, [ANN]);
    assert.deepEqual(result.readings, [A1]);
    assert.equal(result.pushed, true);
    assert.equal(result.localChanged, false);
  });

  test('rows sent to the sheet carry the profile name for people reading it', async () => {
    const sheet = new FakeSheet();
    await syncWithSheet(sheet, { readings: [A1, r('2026-11-02T07:00:00', 70)], profiles: [ANN] }, EMPTY_BASE);
    assert.deepEqual(sheet.pushes[0].readings.map((x) => x.profileName), ['Ann', '']);
  });

  test('a second device joining receives everything from the sheet', async () => {
    const sheet = new FakeSheet({ readings: [A1], profiles: [ANN] });
    const result = await syncWithSheet(sheet, { readings: [], profiles: [] }, EMPTY_BASE);

    assert.deepEqual(result.readings, [A1]);
    assert.deepEqual(result.profiles, [ANN]);
    assert.equal(result.localChanged, true);
    assert.equal(result.pushed, false);
    assert.equal(sheet.pushes.length, 0);
  });

  test('the returned base makes an immediate re-sync a no-op', async () => {
    const sheet = new FakeSheet({ readings: [B1], profiles: [BOB] });
    const first = await syncWithSheet(sheet, { readings: [A1], profiles: [ANN] }, EMPTY_BASE);
    const second = await syncWithSheet(sheet, first, first.base);

    assert.equal(second.pushed, false);
    assert.equal(second.localChanged, false);
    assert.equal(sheet.pushes.length, 1);
  });

  test('new scale readings are added to the sheet, sorted by time', async () => {
    const sheet = new FakeSheet({ readings: [B1], profiles: [BOB] });
    const first = await syncWithSheet(sheet, { readings: [B1], profiles: [BOB] }, EMPTY_BASE);
    const earlier = r('2026-10-30T07:00:00', 82.4, 'bob');

    const result = await syncWithSheet(sheet, { ...first, readings: [...first.readings, earlier] }, first.base);

    assert.deepEqual(sheet.readings.map((x) => x.takenAt), [earlier.takenAt, B1.takenAt]);
    assert.equal(result.pushed, true);
  });

  test('a reading deleted in the app disappears from the sheet', async () => {
    const sheet = new FakeSheet();
    const first = await syncWithSheet(sheet, { readings: [A1, B1], profiles: [ANN, BOB] }, EMPTY_BASE);

    await syncWithSheet(sheet, { ...first, readings: [B1] }, first.base);

    assert.deepEqual(sheet.readings, [B1]);
  });

  test('a row deleted in the sheet disappears from the app', async () => {
    const sheet = new FakeSheet();
    const first = await syncWithSheet(sheet, { readings: [A1, B1], profiles: [ANN, BOB] }, EMPTY_BASE);
    sheet.readings = [B1];

    const result = await syncWithSheet(sheet, first, first.base);

    assert.deepEqual(result.readings, [B1]);
    assert.equal(result.localChanged, true);
  });

  test('reassigning a reading on another device arrives here', async () => {
    const sheet = new FakeSheet();
    const first = await syncWithSheet(sheet, { readings: [A1], profiles: [ANN, BOB] }, EMPTY_BASE);
    sheet.readings = [{ ...A1, profileId: 'bob' }];

    const result = await syncWithSheet(sheet, first, first.base);

    assert.equal(result.readings[0].profileId, 'bob');
  });

  test('profile edits travel both ways', async () => {
    const sheet = new FakeSheet();
    const first = await syncWithSheet(sheet, { readings: [], profiles: [ANN, BOB] }, EMPTY_BASE);
    sheet.profiles = [ANN, { ...BOB, heightCm: 180 }];
    const edited = { ...first, profiles: [{ ...ANN, age: 34 }, BOB] };

    const result = await syncWithSheet(sheet, edited, first.base);

    assert.deepEqual(result.profiles, [{ ...ANN, age: 34 }, { ...BOB, heightCm: 180 }]);
    assert.deepEqual(sheet.profiles, result.profiles);
  });

  test('ignores malformed sheet rows instead of importing them', async () => {
    const sheet = new FakeSheet({
      readings: [A1, { takenAt: '15/11/2026', weightKg: 70, impedanceRaw: 0, profileId: null }, { takenAt: A1.takenAt, weightKg: 60, impedanceRaw: 1, profileId: 'x' }],
      profiles: [ANN, { id: '', name: 'No id' }],
    });
    const result = await syncWithSheet(sheet, { readings: [], profiles: [] }, EMPTY_BASE);

    assert.deepEqual(result.readings, [A1]);
    assert.deepEqual(result.profiles, [ANN]);
  });

  test('retries when another device writes between our read and write', async () => {
    const sheet = new FakeSheet({ readings: [], profiles: [ANN] });
    sheet.beforePush = (s) => {
      s.readings = [B1];
      s.rev++;
    };

    const result = await syncWithSheet(sheet, { readings: [A1], profiles: [ANN] }, EMPTY_BASE);

    assert.deepEqual(sheet.readings.map((x) => x.weightKg), [60, 82]);
    assert.deepEqual(result.readings.map((x) => x.weightKg), [60, 82]);
  });

  test('gives up with a clear error if the sheet never settles', async () => {
    const sheet = new FakeSheet();
    sheet.push = async () => ({ ok: false, conflict: true });

    await assert.rejects(
      syncWithSheet(sheet, { readings: [A1], profiles: [ANN] }, EMPTY_BASE),
      /keeps changing/i,
    );
  });
});
