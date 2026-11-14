import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, metricByKey, formatMetric, formatChange, changeDirection } from '../src/domain/metrics.js';
import { analyse, SEX } from '../src/domain/bodyComposition.js';

describe('METRICS', () => {
  test('every metric key exists on an analysis', () => {
    const analysis = analyse(
      { takenAt: '2023-07-31T15:30:59', weightKg: 73.6, impedanceRaw: 4730 },
      { heightCm: 175, age: 30, sex: SEX.MALE },
    );
    for (const metric of METRICS) {
      assert.ok(metric.key in analysis, `${metric.key} missing from analysis`);
    }
  });

  test('keys are unique', () => {
    const keys = METRICS.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('formatMetric', () => {
  test('rounds to the metric precision and appends the unit', () => {
    assert.equal(formatMetric(metricByKey('weightKg'), 73.6), '73.6 kg');
    assert.equal(formatMetric(metricByKey('bodyFatPercent'), 18.4767), '18.5 %');
    assert.equal(formatMetric(metricByKey('bmrKcal'), 1684.75), '1685 kcal');
  });

  test('BMI has no unit', () => {
    assert.equal(formatMetric(metricByKey('bmi'), 24.0327), '24.0');
  });

  test('missing values show a dash', () => {
    assert.equal(formatMetric(metricByKey('bodyFatPercent'), null), '—');
  });
});

describe('formatChange', () => {
  test('signed, rounded, with unit and a true minus sign', () => {
    assert.equal(formatChange(metricByKey('weightKg'), -0.3), '−0.3 kg');
    assert.equal(formatChange(metricByKey('weightKg'), 1.25), '+1.3 kg');
    assert.equal(formatChange(metricByKey('bmi'), 0.04), '0.0');
  });

  test('direction follows the rounded value', () => {
    assert.equal(changeDirection(metricByKey('weightKg'), -0.3), 'down');
    assert.equal(changeDirection(metricByKey('weightKg'), 0.04), 'same');
    assert.equal(changeDirection(metricByKey('weightKg'), 0.2), 'up');
    assert.equal(changeDirection(metricByKey('weightKg'), null), null);
  });

  test('missing change is an empty string', () => {
    assert.equal(formatChange(metricByKey('weightKg'), null), '');
  });
});
