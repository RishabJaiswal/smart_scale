import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  measurementKey,
  mergeMeasurements,
  removeMeasurement,
  parseStoredHistory,
  toCsv,
} from '../src/domain/history.js';
import { SEX } from '../src/domain/bodyComposition.js';

const A = { takenAt: '2023-07-31T15:30:59', weightKg: 73.6, impedanceRaw: 4730, profileId: 'me' };
const B = { takenAt: '2023-08-01T07:00:00', weightKg: 72.6, impedanceRaw: 4720, profileId: null };
const C = { takenAt: '2023-08-02T07:00:00', weightKg: 72.4, impedanceRaw: 0, profileId: 'me' };

describe('mergeMeasurements', () => {
  test('adds new measurements and keeps the history sorted oldest first', () => {
    const { history, added } = mergeMeasurements([C], [B, A]);

    assert.deepEqual(history, [A, B, C]);
    assert.equal(added, 2);
  });

  test('ignores measurements already in history (same time and weight)', () => {
    const { history, added } = mergeMeasurements([A, B], [{ ...A }, C]);

    assert.deepEqual(history, [A, B, C]);
    assert.equal(added, 1);
  });

  test('deduplicates within the incoming batch too', () => {
    const { history, added } = mergeMeasurements([], [A, { ...A }]);
    assert.equal(history.length, 1);
    assert.equal(added, 1);
  });

  test('does not mutate its inputs', () => {
    const existing = [B];
    mergeMeasurements(existing, [A]);
    assert.deepEqual(existing, [B]);
  });
});

describe('removeMeasurement', () => {
  test('removes by key', () => {
    assert.deepEqual(removeMeasurement([A, B], measurementKey(A)), [B]);
  });
});

describe('parseStoredHistory', () => {
  test('round-trips JSON', () => {
    assert.deepEqual(parseStoredHistory(JSON.stringify([A, B])), [A, B]);
  });

  test('returns an empty history for missing or corrupt data', () => {
    assert.deepEqual(parseStoredHistory(null), []);
    assert.deepEqual(parseStoredHistory('{not json'), []);
    assert.deepEqual(parseStoredHistory('{"a":1}'), []);
  });

  test('drops malformed entries and sorts the rest', () => {
    const raw = JSON.stringify([B, { takenAt: 'yesterday', weightKg: 70 }, { weightKg: 'x' }, A]);
    assert.deepEqual(parseStoredHistory(raw), [A, B]);
  });

  test('readings saved before profiles existed load as unassigned', () => {
    const raw = JSON.stringify([{ takenAt: A.takenAt, weightKg: 73.6, impedanceRaw: 4730 }]);
    assert.equal(parseStoredHistory(raw)[0].profileId, null);
  });
});

describe('toCsv', () => {
  const profiles = [
    { id: 'me', name: 'Me', heightCm: 175, age: 30, sex: SEX.MALE, formula: 'sun2003', calibrationOffset: 0 },
  ];

  test('has a header row and one row per measurement', () => {
    const lines = toCsv([A, C], profiles).trim().split('\n');

    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Date,Profile,Weight \(kg\),BMI,Body fat \(%\)/);
    assert.match(lines[1], /^2023-07-31 15:30:59,Me,73\.6,24\.0,18\.5,/);
  });

  test('leaves cells empty when a metric cannot be computed', () => {
    const [header, row] = toCsv([C], profiles).trim().split('\n').map((l) => l.split(','));

    assert.equal(row[header.indexOf('Body fat (%)')], '');
    assert.equal(row[header.indexOf('Impedance (raw)')], '0');
  });

  test('each row uses its own profile; unassigned rows carry weight only', () => {
    const ann = { id: 'ann', name: 'Ann, Jr', heightCm: 165, age: 40, sex: SEX.FEMALE, formula: 'sun2003', calibrationOffset: 0 };
    const lines = toCsv([{ ...A, profileId: 'ann' }, B], [...profiles, ann]).trim().split('\n');

    assert.match(lines[1], /^2023-07-31 15:30:59,"Ann, Jr",73\.6,27\.0,/);
    assert.match(lines[2], /^2023-08-01 07:00:00,,72\.6,,/);
  });

  test('uses plain newlines and ends with a newline', () => {
    const csv = toCsv([A], profiles);
    assert.ok(csv.endsWith('\n'));
    assert.ok(!csv.includes('\r'));
  });
});
