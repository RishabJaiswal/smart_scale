/**
 * Body-composition estimates from weight, impedance and a user profile.
 *
 * Pure module: no DOM, no Bluetooth. All results are population-formula
 * estimates, not medical measurements. Any value that cannot be derived
 * from the inputs is returned as `null`.
 */

export const SEX = Object.freeze({ MALE: 'male', FEMALE: 'female' });

const MIN_PLAUSIBLE_OHM = 150;
const MAX_PLAUSIBLE_OHM = 1500;
const BODY_FAT_MIN = 0;
const BODY_FAT_MAX = 75;

/**
 * The HS11 reports impedance in what we assume are tenths of an ohm.
 * Returns null when no impedance was measured or the value is implausible.
 */
export function impedanceOhms(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ohm = raw / 10;
  return ohm >= MIN_PLAUSIBLE_OHM && ohm <= MAX_PLAUSIBLE_OHM ? ohm : null;
}

export function bmi(weightKg, heightCm) {
  if (!isPositive(weightKg) || !isPositive(heightCm)) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/**
 * Body-fat formulas. `compute` receives a complete subject and returns body
 * fat in percent, before calibration and clamping.
 */
export const BODY_FAT_FORMULAS = Object.freeze({
  sun2003: {
    label: 'BIA – Sun et al. 2003 (uses impedance)',
    usesImpedance: true,
    compute: ({ weightKg, heightCm, impedanceOhm, sex }) => {
      const ffm = fatFreeMassSun(weightKg, heightCm, impedanceOhm, sex);
      return ((weightKg - ffm) / weightKg) * 100;
    },
  },
  deurenberg1991: {
    label: 'BMI – Deurenberg et al. 1991 (no impedance)',
    usesImpedance: false,
    compute: ({ weightKg, heightCm, age, sex }) =>
      1.2 * bmi(weightKg, heightCm) + 0.23 * age - 10.8 * maleFlag(sex) - 5.4,
  },
});

export const DEFAULT_FORMULA = 'sun2003';

/**
 * @param {{weightKg:number, impedanceOhm:number|null, heightCm:number, age:number, sex:string}} subject
 * @param {{formula?: string, calibrationOffset?: number}} options
 */
export function bodyFatPercent(subject, { formula = DEFAULT_FORMULA, calibrationOffset = 0 } = {}) {
  const definition = BODY_FAT_FORMULAS[formula];
  if (!definition) throw new Error(`Unknown body-fat formula: ${formula}`);
  if (!hasProfile(subject) || !isPositive(subject.weightKg)) return null;
  if (definition.usesImpedance && !isPositive(subject.impedanceOhm)) return null;

  const raw = definition.compute(subject) + (Number(calibrationOffset) || 0);
  return clamp(raw, BODY_FAT_MIN, BODY_FAT_MAX);
}

/**
 * @typedef {Object} Analysis
 * @property {number} weightKg
 * @property {number|null} impedanceOhm
 * @property {number|null} bmi
 * @property {number|null} bodyFatPercent
 * @property {number|null} fatMassKg
 * @property {number|null} leanMassKg
 * @property {number|null} waterPercent   Total body water, Kushner & Schoeller 1986.
 * @property {number|null} muscleMassKg   Skeletal muscle mass, Janssen et al. 2000.
 * @property {number|null} bmrKcal        Mifflin-St Jeor 1990.
 */

/**
 * @param {import('./protocol.js').Measurement} measurement
 * @param {{heightCm:number|null, age:number|null, sex:string|null}} profile
 * @param {{formula?: string, calibrationOffset?: number}} options
 * @returns {Analysis}
 */
export function analyse(measurement, profile, options = {}) {
  const { weightKg } = measurement;
  const impedanceOhm = impedanceOhms(measurement.impedanceRaw);
  const subject = { ...profile, weightKg, impedanceOhm };
  const profileOk = hasProfile(profile);
  const impedanceOk = profileOk && impedanceOhm !== null;

  const fat = bodyFatPercent(subject, options);
  const fatMassKg = fat === null ? null : (weightKg * fat) / 100;

  return {
    weightKg,
    impedanceOhm,
    bmi: profileOk ? bmi(weightKg, profile.heightCm) : null,
    bodyFatPercent: fat,
    fatMassKg,
    leanMassKg: fatMassKg === null ? null : weightKg - fatMassKg,
    waterPercent: impedanceOk ? (totalBodyWaterKg(subject) / weightKg) * 100 : null,
    muscleMassKg: impedanceOk ? skeletalMuscleMassKg(subject) : null,
    bmrKcal: profileOk ? basalMetabolicRate(subject) : null,
  };
}

function fatFreeMassSun(weightKg, heightCm, ohm, sex) {
  const index = (heightCm * heightCm) / ohm;
  return sex === SEX.MALE
    ? -10.68 + 0.65 * index + 0.26 * weightKg + 0.02 * ohm
    : -9.53 + 0.69 * index + 0.17 * weightKg + 0.02 * ohm;
}

function totalBodyWaterKg({ weightKg, heightCm, impedanceOhm, sex }) {
  const index = (heightCm * heightCm) / impedanceOhm;
  return sex === SEX.MALE
    ? 0.396 * index + 0.143 * weightKg + 8.399
    : 0.382 * index + 0.105 * weightKg + 8.315;
}

function skeletalMuscleMassKg({ heightCm, impedanceOhm, age, sex }) {
  const index = (heightCm * heightCm) / impedanceOhm;
  return 0.401 * index + 3.825 * maleFlag(sex) - 0.071 * age + 5.102;
}

function basalMetabolicRate({ weightKg, heightCm, age, sex }) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === SEX.MALE ? 5 : -161);
}

function hasProfile(p) {
  return (
    p != null &&
    isPositive(p.heightCm) &&
    isPositive(p.age) &&
    (p.sex === SEX.MALE || p.sex === SEX.FEMALE)
  );
}

const maleFlag = (sex) => (sex === SEX.MALE ? 1 : 0);
const isPositive = (n) => Number.isFinite(n) && n > 0;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
