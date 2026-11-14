import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, parseStoredSettings } from '../src/domain/settings.js';

describe('normalizeSettings', () => {
  test('fills every field from defaults when given nothing', () => {
    assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  });

  test('keeps a valid profile', () => {
    const s = normalizeSettings({ profile: { heightCm: 175, age: 30, sex: 'female' } });
    assert.deepEqual(s.profile, { heightCm: 175, age: 30, sex: 'female' });
  });

  test('coerces numeric strings from form inputs', () => {
    const s = normalizeSettings({ profile: { heightCm: '180', age: '41', sex: 'male' } });
    assert.deepEqual(s.profile, { heightCm: 180, age: 41, sex: 'male' });
  });

  test('blanks out-of-range or unknown profile values', () => {
    const s = normalizeSettings({ profile: { heightCm: 20, age: 300, sex: 'other' } });
    assert.deepEqual(s.profile, { heightCm: null, age: null, sex: null });
  });

  test('falls back to the default formula when unknown', () => {
    assert.equal(normalizeSettings({ formula: 'magic' }).formula, DEFAULT_SETTINGS.formula);
    assert.equal(normalizeSettings({ formula: 'deurenberg1991' }).formula, 'deurenberg1991');
  });

  test('limits the calibration offset to ±20 points', () => {
    assert.equal(normalizeSettings({ calibrationOffset: '-3.5' }).calibrationOffset, -3.5);
    assert.equal(normalizeSettings({ calibrationOffset: 99 }).calibrationOffset, 20);
    assert.equal(normalizeSettings({ calibrationOffset: 'abc' }).calibrationOffset, 0);
  });

  test('keeps only known metrics, without duplicates, in registry order', () => {
    const s = normalizeSettings({ metrics: ['bmi', 'nonsense', 'weightKg', 'bmi'] });
    assert.deepEqual(s.metrics, ['weightKg', 'bmi']);
  });

  test('chart metric must be a known metric', () => {
    assert.equal(normalizeSettings({ chartMetric: 'bodyFatPercent' }).chartMetric, 'bodyFatPercent');
    assert.equal(normalizeSettings({ chartMetric: 'x' }).chartMetric, DEFAULT_SETTINGS.chartMetric);
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
