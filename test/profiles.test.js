import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProfiles,
  nextProfileName,
  profileById,
  measurementsOf,
  unassignedOf,
  assignMeasurements,
  releaseProfile,
  defaultAssignee,
  suggestProfile,
  adoptLegacyHistory,
} from '../src/domain/profiles.js';
import { measurementKey } from '../src/domain/history.js';

const m = (takenAt, weightKg, profileId = null) => ({ takenAt, weightKg, impedanceRaw: 4700, profileId });
const ANN = { id: 'ann', name: 'Ann' };
const BOB = { id: 'bob', name: 'Bob' };

describe('normalizeProfiles', () => {
  test('always yields at least one profile, called Me', () => {
    const [only, ...rest] = normalizeProfiles([]);
    assert.equal(rest.length, 0);
    assert.deepEqual(only, {
      id: 'me', name: 'Me', heightCm: null, age: null, sex: null,
      formula: 'sun2003', calibrationOffset: 0,
    });
  });

  test('keeps valid fields and coerces form strings', () => {
    const [p] = normalizeProfiles([
      { id: 'ann', name: '  Ann  ', heightCm: '165', age: '34', sex: 'female',
        formula: 'deurenberg1991', calibrationOffset: '-1.5' },
    ]);
    assert.deepEqual(p, {
      id: 'ann', name: 'Ann', heightCm: 165, age: 34, sex: 'female',
      formula: 'deurenberg1991', calibrationOffset: -1.5,
    });
  });

  test('blanks out-of-range values and falls back on unknown formula', () => {
    const [p] = normalizeProfiles([{ id: 'x', name: 'X', heightCm: 20, age: 300, sex: 'other', formula: 'magic', calibrationOffset: 99 }]);
    assert.deepEqual([p.heightCm, p.age, p.sex, p.formula, p.calibrationOffset], [null, null, null, 'sun2003', 20]);
  });

  test('gives a nameless profile a numbered name and caps long names', () => {
    const [a, b] = normalizeProfiles([{ id: 'a', name: 'A' }, { id: 'b', name: '   ' }]);
    assert.equal(b.name, 'Profile 2');
    assert.equal(normalizeProfiles([{ id: 'a', name: 'x'.repeat(80) }])[0].name.length, 30);
    assert.equal(a.name, 'A');
  });

  test('drops entries with a missing, unsafe or duplicate id', () => {
    const ids = normalizeProfiles([{ id: 'a' }, { id: 'a' }, { id: '<b>' }, { name: 'no id' }, null, { id: 'c' }]).map((p) => p.id);
    assert.deepEqual(ids, ['a', 'c']);
  });
});

describe('nextProfileName', () => {
  test('picks the first unused numbered name', () => {
    assert.equal(nextProfileName([{ name: 'Me' }]), 'Profile 2');
    assert.equal(nextProfileName([{ name: 'Me' }, { name: 'Profile 2' }]), 'Profile 3');
  });
});

describe('profileById', () => {
  test('finds a profile or returns null', () => {
    assert.equal(profileById([ANN, BOB], 'bob'), BOB);
    assert.equal(profileById([ANN], 'zed'), null);
    assert.equal(profileById([ANN], null), null);
  });
});

describe('selecting readings', () => {
  const history = [m('2026-11-01T07:00:00', 60, 'ann'), m('2026-11-01T07:05:00', 82, 'bob'), m('2026-11-02T07:00:00', 60.2)];

  test('measurementsOf returns one profile’s readings', () => {
    assert.deepEqual(measurementsOf(history, 'ann').map((x) => x.weightKg), [60]);
  });

  test('unassignedOf returns readings without a profile', () => {
    assert.deepEqual(unassignedOf(history).map((x) => x.weightKg), [60.2]);
  });

  test('a reading pointing at a deleted profile counts as unassigned', () => {
    assert.equal(unassignedOf([m('2026-11-01T07:00:00', 60, 'gone')], [ANN]).length, 1);
  });
});

describe('assignMeasurements', () => {
  const a = m('2026-11-01T07:00:00', 60);
  const b = m('2026-11-02T07:00:00', 82);

  test('maps the chosen readings to a profile and leaves the rest', () => {
    const result = assignMeasurements([a, b], [measurementKey(a)], 'ann');
    assert.deepEqual(result.map((x) => x.profileId), ['ann', null]);
  });

  test('can move a reading between profiles or back to unassigned', () => {
    const moved = assignMeasurements([{ ...a, profileId: 'ann' }], [measurementKey(a)], 'bob');
    assert.equal(moved[0].profileId, 'bob');
    assert.equal(assignMeasurements(moved, [measurementKey(a)], null)[0].profileId, null);
  });

  test('does not mutate its input', () => {
    assignMeasurements([a], [measurementKey(a)], 'ann');
    assert.equal(a.profileId, null);
  });
});

describe('releaseProfile', () => {
  test('readings of a removed profile become unassigned', () => {
    const result = releaseProfile([m('2026-11-01T07:00:00', 60, 'ann'), m('2026-11-01T07:05:00', 82, 'bob')], 'ann');
    assert.deepEqual(result.map((x) => x.profileId), [null, 'bob']);
  });
});

describe('defaultAssignee', () => {
  test('a lone profile receives new readings automatically', () => {
    assert.equal(defaultAssignee([ANN]), 'ann');
  });

  test('with several profiles the user must choose', () => {
    assert.equal(defaultAssignee([ANN, BOB]), null);
  });
});

describe('suggestProfile', () => {
  const history = [
    m('2026-11-01T07:00:00', 60, 'ann'),
    m('2026-11-01T07:05:00', 82, 'bob'),
    m('2026-11-08T07:00:00', 61, 'ann'),
  ];

  test('suggests the profile whose nearest-in-time reading is closest in weight', () => {
    assert.equal(suggestProfile(m('2026-11-09T07:00:00', 61.4), history, [ANN, BOB]), 'ann');
    assert.equal(suggestProfile(m('2026-11-09T07:00:00', 81), history, [ANN, BOB]), 'bob');
  });

  test('compares against the reading nearest in time, not the first', () => {
    // Ann was 60 on the 1st and 61 on the 8th: 63.9 is within 3 kg of 61 but not of 60.
    assert.equal(suggestProfile(m('2026-11-09T07:00:00', 63.9), history, [ANN, BOB]), 'ann');
    assert.equal(suggestProfile(m('2026-11-01T08:00:00', 63.9), history, [ANN, BOB]), null);
  });

  test('no suggestion when nobody is within 3 kg', () => {
    assert.equal(suggestProfile(m('2026-11-09T07:00:00', 70), history, [ANN, BOB]), null);
  });

  test('no suggestion when two profiles are similarly close', () => {
    const close = [m('2026-11-01T07:00:00', 70, 'ann'), m('2026-11-01T07:05:00', 71, 'bob')];
    assert.equal(suggestProfile(m('2026-11-02T07:00:00', 70.4), close, [ANN, BOB]), null);
  });

  test('no suggestion without assigned history', () => {
    assert.equal(suggestProfile(m('2026-11-02T07:00:00', 70), [], [ANN, BOB]), null);
  });
});

describe('adoptLegacyHistory', () => {
  const legacy = [{ takenAt: '2026-11-01T07:00:00', weightKg: 60, impedanceRaw: 0, profileId: null }];

  test('readings saved before profiles existed go to the first profile', () => {
    const adopted = adoptLegacyHistory(legacy, { profile: { heightCm: 175 } }, [ANN, BOB]);
    assert.equal(adopted[0].profileId, 'ann');
  });

  test('also when no settings were ever saved', () => {
    assert.equal(adoptLegacyHistory(legacy, null, [ANN])[0].profileId, 'ann');
  });

  test('leaves history alone once settings carry profiles', () => {
    assert.equal(adoptLegacyHistory(legacy, { profiles: [ANN] }, [ANN])[0].profileId, null);
  });
});
