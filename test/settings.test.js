import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseStoredSettings,
  activeProfile,
} from '../src/domain/settings.js';

describe('normalizeSettings', () => {
  test('fills every field from defaults when given nothing', () => {
    assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  });

  test('starts with a single profile that is active', () => {
    const s = normalizeSettings(undefined);
    assert.equal(s.profiles.length, 1);
    assert.equal(s.activeProfileId, s.profiles[0].id);
  });

  test('keeps several profiles and the active choice', () => {
    const s = normalizeSettings({
      profiles: [{ id: 'ann', name: 'Ann' }, { id: 'bob', name: 'Bob' }],
      activeProfileId: 'bob',
    });
    assert.deepEqual(s.profiles.map((p) => p.name), ['Ann', 'Bob']);
    assert.equal(activeProfile(s).name, 'Bob');
  });

  test('falls back to the first profile when the active one is gone', () => {
    const s = normalizeSettings({ profiles: [{ id: 'ann', name: 'Ann' }], activeProfileId: 'bob' });
    assert.equal(s.activeProfileId, 'ann');
  });

  test('migrates the old single-profile shape into a profile called Me', () => {
    const s = normalizeSettings({
      profile: { heightCm: 175, age: 30, sex: 'male' },
      formula: 'deurenberg1991',
      calibrationOffset: -1.5,
      accentColor: '#db2777',
    });
    assert.deepEqual(s.profiles, [
      { id: 'me', name: 'Me', heightCm: 175, age: 30, sex: 'male', formula: 'deurenberg1991', calibrationOffset: -1.5 },
    ]);
    assert.equal(s.accentColor, '#db2777');
    assert.equal('profile' in s, false);
  });

  test('keeps only known metrics, without duplicates, in registry order', () => {
    const s = normalizeSettings({ metrics: ['bmi', 'nonsense', 'weightKg', 'bmi'] });
    assert.deepEqual(s.metrics, ['weightKg', 'bmi']);
  });

  test('chart metric must be a known metric', () => {
    assert.equal(normalizeSettings({ chartMetric: 'bodyFatPercent' }).chartMetric, 'bodyFatPercent');
    assert.equal(normalizeSettings({ chartMetric: 'x' }).chartMetric, DEFAULT_SETTINGS.chartMetric);
  });

  test('chart range defaults to 30 days and keeps known ranges', () => {
    assert.equal(normalizeSettings({}).chartRange, '30d');
    assert.equal(normalizeSettings({ chartRange: '1y' }).chartRange, '1y');
    assert.equal(normalizeSettings({ chartRange: 'decade' }).chartRange, '30d');
  });

  test('accent colour must be a 6-digit hex colour', () => {
    assert.equal(normalizeSettings({ accentColor: '#AA33cc' }).accentColor, '#aa33cc');
    assert.equal(
      normalizeSettings({ accentColor: 'red; background:url(x)' }).accentColor,
      DEFAULT_SETTINGS.accentColor,
    );
  });
});

describe('parseStoredSettings', () => {
  test('tolerates corrupt JSON', () => {
    assert.deepEqual(parseStoredSettings('{oops'), DEFAULT_SETTINGS);
  });
});
