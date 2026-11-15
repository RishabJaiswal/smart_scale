/**
 * Lenovo HS11 (Chipsea CST34M97) BLE protocol.
 *
 * Pure module: no DOM, no Bluetooth. Turns bytes into measurements.
 * Source: https://gist.github.com/bendtherules/4f90fb0eba6f2ffd4847d8ab448c0eb1
 */

export const SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
export const COMMAND_CHARACTERISTIC_UUID = '0000fff1-0000-1000-8000-00805f9b34fb';
export const DATA_CHARACTERISTIC_UUID = '0000fff4-0000-1000-8000-00805f9b34fb';

export const READ_STORED_COMMAND = Uint8Array.of(0xf2, 0x00);
export const DELETE_STORED_COMMAND = Uint8Array.of(0xf2, 0x01);

export const RECORD_LENGTH = 10;
const BASE_YEAR = 2017;
const SCALE_TYPE_NIBBLE = 0xf;
const MARKER = [0xf2, 0x00];

/**
 * @typedef {Object} Measurement
 * @property {string} takenAt  Scale-local timestamp, `YYYY-MM-DDTHH:mm:ss` (no zone).
 * @property {number} weightKg
 * @property {number} impedanceRaw  As sent by the scale; assumed tenths of an ohm.
 */

/**
 * @typedef {{ ok: true, measurement: Measurement } | { ok: false, reason: string }} RecordResult
 */

/** @param {Uint8Array|DataView|ArrayBuffer|number[]} input */
export function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof DataView) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return Uint8Array.from(input);
}

/** @returns {string} e.g. `F2 00` */
export function toHex(input) {
  return [...asBytes(input)]
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

/** @param {string} hex e.g. `F2 00` or `f200` */
export function fromHex(hex) {
  const compact = hex.replace(/\s+/g, '');
  if (compact.length % 2 !== 0 || /[^0-9a-f]/i.test(compact)) {
    throw new Error(`Invalid hex string: "${hex}"`);
  }
  const bytes = new Uint8Array(compact.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Decode one 10-byte measurement record.
 * @returns {RecordResult}
 */
export function parseRecord(input) {
  const b = asBytes(input);
  if (b.length !== RECORD_LENGTH) {
    return invalid(`Record length is ${b.length}, expected ${RECORD_LENGTH}`);
  }

  const year = (b[0] >> 4) + BASE_YEAR;
  const month = b[0] & 0x0f;
  const [, day, hour, minute, second] = b;

  if (month < 1 || month > 12) return invalid(`Month ${month} out of range 1-12`);
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return invalid(`Day ${day} out of range 1-${maxDay}`);
  if (hour > 23) return invalid(`Hour ${hour} out of range 0-23`);
  if (minute > 59) return invalid(`Minute ${minute} out of range 0-59`);
  if (second > 59) return invalid(`Second ${second} out of range 0-59`);

  const scaleType = b[5] >> 4;
  if (scaleType !== SCALE_TYPE_NIBBLE) {
    return invalid(`Scale type nibble ${scaleType.toString(16).toUpperCase()}, expected F`);
  }

  const weightTenths = ((b[5] & 0x0f) << 8) + b[6];
  if (weightTenths === 0) return invalid('Weight is zero');

  return {
    ok: true,
    measurement: {
      takenAt: formatLocalTimestamp(year, month, day, hour, minute, second),
      weightKg: weightTenths / 10,
      impedanceRaw: b[7] + (b[8] << 8) + (b[9] << 16),
    },
  };
}

/**
 * @typedef {Object} NotificationResult
 * @property {Measurement[]} measurements
 * @property {{ hex: string, reason: string }[]} rejected
 * @property {boolean} endOfData  True when the 2-byte F2 00 end marker was seen.
 */

/**
 * Decode one notification from the data characteristic. A notification may
 * hold several 10-byte records; records starting F2 00 are skipped; a
 * trailing 2-byte F2 00 marks the end of the stored data.
 * @returns {NotificationResult}
 */
export function parseNotification(input) {
  const bytes = asBytes(input);
  /** @type {NotificationResult} */
  const result = { measurements: [], rejected: [], endOfData: false };

  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;

    if (remaining === MARKER.length && startsWithMarker(bytes, offset)) {
      result.endOfData = true;
      break;
    }

    if (remaining < RECORD_LENGTH) {
      result.rejected.push({
        hex: toHex(bytes.subarray(offset)),
        reason: `Truncated record: ${remaining} of ${RECORD_LENGTH} bytes`,
      });
      break;
    }

    const record = bytes.subarray(offset, offset + RECORD_LENGTH);
    offset += RECORD_LENGTH;

    if (startsWithMarker(record, 0)) continue;

    const parsed = parseRecord(record);
    if (parsed.ok) {
      result.measurements.push(parsed.measurement);
    } else {
      result.rejected.push({ hex: toHex(record), reason: parsed.reason });
    }
  }

  return result;
}

function startsWithMarker(bytes, offset) {
  return bytes[offset] === MARKER[0] && bytes[offset + 1] === MARKER[1];
}

function invalid(reason) {
  return { ok: false, reason };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatLocalTimestamp(year, month, day, hour, minute, second) {
  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:${p(second)}`;
}

/**
 * Build a 10-byte record from a measurement. Used by the demo scale and to
 * prove the decoder; the real scale never receives these.
 * @param {Measurement} measurement
 */
export function encodeRecord({ takenAt, weightKg, impedanceRaw }) {
  const [year, month, day, hour, minute, second] = takenAt.split(/[-T:]/).map(Number);
  const yearField = year - BASE_YEAR;
  if (yearField < 0 || yearField > 0xf) {
    throw new Error(`Year ${year} cannot be encoded (supported ${BASE_YEAR}-${BASE_YEAR + 15})`);
  }
  const weightTenths = Math.round(weightKg * 10);
  if (weightTenths <= 0 || weightTenths > 0xfff) throw new Error(`Weight ${weightKg} kg out of range`);

  return Uint8Array.of(
    (yearField << 4) | month,
    day,
    hour,
    minute,
    second,
    (SCALE_TYPE_NIBBLE << 4) | (weightTenths >> 8),
    weightTenths & 0xff,
    impedanceRaw & 0xff,
    (impedanceRaw >> 8) & 0xff,
    (impedanceRaw >> 16) & 0xff,
  );
}

const SET_CLOCK_COMMAND = 0xf1;

/**
 * Command that sets the scale's clock: F1, year (big-endian), month (1-12),
 * day, hour, minute, second.
 *
 * NOT in the HS11 protocol notes. It is the clock command openScale uses
 * for 1byone scales, which share this service and the F2 00 / F2 01
 * commands; whether the HS11 honours it is unverified.
 */
export function encodeSetClock({ year, month, day, hour, minute, second }) {
  if (month < 1 || month > 12) throw new Error(`Month ${month} out of range 1-12`);
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) throw new Error(`Day ${day} out of range 1-${maxDay}`);
  if (hour < 0 || hour > 23) throw new Error(`Hour ${hour} out of range 0-23`);
  if (minute < 0 || minute > 59) throw new Error(`Minute ${minute} out of range 0-59`);
  if (second < 0 || second > 59) throw new Error(`Second ${second} out of range 0-59`);
  return Uint8Array.of(SET_CLOCK_COMMAND, year >> 8, year & 0xff, month, day, hour, minute, second);
}

/** The scale is expected to confirm a clock change with the 2 bytes F1 00. */
export function isSetClockAck(input) {
  const b = asBytes(input);
  return b.length === 2 && b[0] === SET_CLOCK_COMMAND && b[1] === 0x00;
}
