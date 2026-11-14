import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEX,
  BODY_FAT_FORMULAS,
  impedanceOhms,
  bmi,
  bodyFatPercent,
  analyse,
} from '../src/domain/bodyComposition.js';

const closeTo = (actual, expected, tolerance = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

// The known example packet: 73.6 kg, impedance 4730 (473.0 ohm).
const EXAMPLE = { takenAt: '2023-07-31T15:30:59', weightKg: 73.6, impedanceRaw: 4730 };
const MAN = { heightCm: 175, age: 30, sex: SEX.MALE };
const WOMAN = { heightCm: 175, age: 30, sex: SEX.FEMALE };

describe('impedanceOhms', () => {
  test('treats the raw value as tenths of an ohm', () => {
    assert.equal(impedanceOhms(4730), 473);
  });

  test('zero means no impedance was measured (e.g. wearing socks)', () => {
    assert.equal(impedanceOhms(0), null);
  });

  test('values outside a plausible human range are discarded', () => {
    assert.equal(impedanceOhms(500), null); // 50 ohm
    assert.equal(impedanceOhms(30000), null); // 3000 ohm
  });
});

describe('bmi', () => {
  test('is weight over height squared', () => {
    closeTo(bmi(73.6, 175), 24.0327);
  });

  test('is null without a usable height', () => {
    assert.equal(bmi(73.6, 0), null);
    assert.equal(bmi(73.6, undefined), null);
  });
});

describe('bodyFatPercent', () => {
  const input = { weightKg: 73.6, impedanceOhm: 473, ...MAN };

  test('Sun 2003 BIA formula for a man', () => {
    closeTo(bodyFatPercent(input, { formula: 'sun2003' }), 18.4767);
  });

  test('Sun 2003 BIA formula for a woman', () => {
    closeTo(bodyFatPercent({ ...input, sex: SEX.FEMALE }, { formula: 'sun2003' }), 22.395);
  });

  test('Deurenberg 1991 BMI formula ignores impedance', () => {
    closeTo(bodyFatPercent(input, { formula: 'deurenberg1991' }), 19.539);
    closeTo(
      bodyFatPercent({ ...input, impedanceOhm: null }, { formula: 'deurenberg1991' }),
      19.539,
    );
  });

  test('BIA formula is null without impedance', () => {
    assert.equal(bodyFatPercent({ ...input, impedanceOhm: null }, { formula: 'sun2003' }), null);
  });

  test('calibration offset is added in percentage points', () => {
    closeTo(
      bodyFatPercent(input, { formula: 'sun2003', calibrationOffset: -2.5 }),
      18.4767 - 2.5,
    );
  });

  test('result is clamped to 0-75 %', () => {
    assert.equal(bodyFatPercent(input, { formula: 'sun2003', calibrationOffset: -50 }), 0);
    assert.equal(bodyFatPercent(input, { formula: 'sun2003', calibrationOffset: 90 }), 75);
  });

  test('unknown formula throws', () => {
    assert.throws(() => bodyFatPercent(input, { formula: 'nope' }), /formula/i);
  });

  test('every registered formula has a label', () => {
    for (const [key, formula] of Object.entries(BODY_FAT_FORMULAS)) {
      assert.ok(formula.label, `${key} has no label`);
      assert.equal(typeof formula.usesImpedance, 'boolean');
    }
  });
});

describe('analyse', () => {
  test('derives every metric for the example measurement', () => {
    const result = analyse(EXAMPLE, MAN, { formula: 'sun2003', calibrationOffset: 0 });

    assert.equal(result.weightKg, 73.6);
    assert.equal(result.impedanceOhm, 473);
    closeTo(result.bmi, 24.0327);
    closeTo(result.bodyFatPercent, 18.4767);
    closeTo(result.fatMassKg, 73.6 * 0.184767);
    closeTo(result.leanMassKg, 73.6 * (1 - 0.184767));
    closeTo(result.waterPercent, 60.548); // Kushner & Schoeller 1986
    closeTo(result.muscleMassKg, 32.760); // Janssen 2000 SMM
    closeTo(result.bmrKcal, 1684.75); // Mifflin-St Jeor
  });

  test('women use the female coefficients', () => {
    const result = analyse(EXAMPLE, WOMAN, { formula: 'sun2003' });
    closeTo(result.bmrKcal, 1518.75);
    closeTo(result.waterPercent, (0.382 * 64.7463 + 0.105 * 73.6 + 8.315) / 73.6 * 100);
    closeTo(result.muscleMassKg, 28.935);
  });

  test('impedance-based metrics are null when impedance is missing', () => {
    const result = analyse({ ...EXAMPLE, impedanceRaw: 0 }, MAN, { formula: 'sun2003' });

    assert.equal(result.impedanceOhm, null);
    assert.equal(result.bodyFatPercent, null);
    assert.equal(result.fatMassKg, null);
    assert.equal(result.waterPercent, null);
    assert.equal(result.muscleMassKg, null);
    closeTo(result.bmi, 24.0327);
    closeTo(result.bmrKcal, 1684.75);
  });

  test('only weight survives an incomplete profile', () => {
    const result = analyse(EXAMPLE, { heightCm: null, age: null, sex: null }, {
      formula: 'sun2003',
    });

    assert.equal(result.weightKg, 73.6);
    assert.equal(result.impedanceOhm, 473);
    for (const key of ['bmi', 'bodyFatPercent', 'waterPercent', 'muscleMassKg', 'bmrKcal']) {
      assert.equal(result[key], null, key);
    }
  });
});
