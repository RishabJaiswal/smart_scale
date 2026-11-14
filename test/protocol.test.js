import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_STORED_COMMAND,
  DELETE_STORED_COMMAND,
  parseRecord,
  parseNotification,
  toHex,
  fromHex,
  encodeRecord,
} from '../src/domain/protocol.js';

const EXAMPLE = '67 1F 0F 1E 3B F2 E0 7A 12 00';

describe('commands', () => {
  test('read stored measurements is F2 00', () => {
    assert.equal(toHex(READ_STORED_COMMAND), 'F2 00');
  });

  test('delete stored measurements is F2 01', () => {
    assert.equal(toHex(DELETE_STORED_COMMAND), 'F2 01');
  });
});

describe('hex helpers', () => {
  test('round-trips bytes through upper-case spaced hex', () => {
    assert.equal(toHex(fromHex(EXAMPLE)), EXAMPLE);
  });

  test('fromHex accepts lower case and no spaces', () => {
    assert.deepEqual([...fromHex('f200')], [0xf2, 0x00]);
  });

  test('fromHex rejects odd-length input', () => {
    assert.throws(() => fromHex('F2 0'), /hex/i);
  });
});

describe('parseRecord', () => {
  test('decodes the known example packet', () => {
    const result = parseRecord(fromHex(EXAMPLE));

    assert.equal(result.ok, true);
    assert.deepEqual(result.measurement, {
      takenAt: '2023-07-31T15:30:59',
      weightKg: 73.6,
      impedanceRaw: 4730,
    });
  });

  test('weight uses the low nibble of b5 as the high bits', () => {
    // b5 = F1, b6 = 00 -> 0x100 = 256 -> 25.6 kg
    const result = parseRecord(fromHex('67 1F 0F 1E 3B F1 00 00 00 00'));
    assert.equal(result.measurement.weightKg, 25.6);
  });

  test('impedance is little-endian over three bytes', () => {
    const result = parseRecord(fromHex('67 1F 0F 1E 3B F2 E0 01 02 03'));
    assert.equal(result.measurement.impedanceRaw, 0x030201);
  });

  test('year is high nibble of b0 plus 2017', () => {
    const result = parseRecord(fromHex('9C 01 00 00 00 F2 E0 00 00 00'));
    assert.equal(result.measurement.takenAt, '2026-12-01T00:00:00');
  });

  const invalid = [
    ['wrong length', '67 1F 0F 1E 3B F2 E0 7A 12', /length/i],
    ['month 0', '60 1F 0F 1E 3B F2 E0 7A 12 00', /month/i],
    ['month 13', '6D 1F 0F 1E 3B F2 E0 7A 12 00', /month/i],
    ['day 0', '67 00 0F 1E 3B F2 E0 7A 12 00', /day/i],
    ['31 June', '66 1F 0F 1E 3B F2 E0 7A 12 00', /day/i],
    ['29 Feb in a non-leap year', '62 1D 0F 1E 3B F2 E0 7A 12 00', /day/i],
    ['hour 24', '67 1F 18 1E 3B F2 E0 7A 12 00', /hour/i],
    ['minute 60', '67 1F 0F 3C 3B F2 E0 7A 12 00', /minute/i],
    ['second 60', '67 1F 0F 1E 3C F2 E0 7A 12 00', /second/i],
    ['scale type not F', '67 1F 0F 1E 3B E2 E0 7A 12 00', /scale type/i],
    ['zero weight', '67 1F 0F 1E 3B F0 00 7A 12 00', /weight/i],
  ];

  for (const [name, hex, reason] of invalid) {
    test(`rejects ${name}`, () => {
      const result = parseRecord(fromHex(hex));
      assert.equal(result.ok, false);
      assert.match(result.reason, reason);
    });
  }

  test('accepts 29 Feb in a leap year', () => {
    // 2024 = 2017 + 7 -> 0x72, day 0x1D
    const result = parseRecord(fromHex('72 1D 0F 1E 3B F2 E0 7A 12 00'));
    assert.equal(result.ok, true);
    assert.equal(result.measurement.takenAt, '2024-02-29T15:30:59');
  });
});

describe('parseNotification', () => {
  test('a single record notification yields one measurement', () => {
    const result = parseNotification(fromHex(EXAMPLE));

    assert.equal(result.measurements.length, 1);
    assert.equal(result.measurements[0].weightKg, 73.6);
    assert.equal(result.endOfData, false);
    assert.deepEqual(result.rejected, []);
  });

  test('multiple records in one notification are all decoded in order', () => {
    const bytes = fromHex(
      '67 1F 0F 1E 3B F2 E0 7A 12 00' + // 73.6 kg
        '68 01 07 00 00 F2 D6 70 12 00', // 1 Aug 2023 07:00:00, 72.6 kg
    );

    const result = parseNotification(bytes);

    assert.deepEqual(
      result.measurements.map((m) => [m.takenAt, m.weightKg]),
      [
        ['2023-07-31T15:30:59', 73.6],
        ['2023-08-01T07:00:00', 72.6],
      ],
    );
  });

  test('the 2-byte F2 00 marks the end of data', () => {
    const result = parseNotification(fromHex('F2 00'));

    assert.equal(result.endOfData, true);
    assert.deepEqual(result.measurements, []);
    assert.deepEqual(result.rejected, []);
  });

  test('records followed by the end marker in one notification', () => {
    const result = parseNotification(fromHex(EXAMPLE + ' F2 00'));

    assert.equal(result.measurements.length, 1);
    assert.equal(result.endOfData, true);
  });

  test('10-byte records starting F2 00 are skipped, not rejected', () => {
    const result = parseNotification(fromHex('F2 00 01 02 03 04 05 06 07 08' + EXAMPLE));

    assert.equal(result.measurements.length, 1);
    assert.deepEqual(result.rejected, []);
    assert.equal(result.endOfData, false);
  });

  test('invalid records are reported and do not stop valid ones', () => {
    const result = parseNotification(fromHex('60 1F 0F 1E 3B F2 E0 7A 12 00' + EXAMPLE));

    assert.equal(result.measurements.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].hex, '60 1F 0F 1E 3B F2 E0 7A 12 00');
    assert.match(result.rejected[0].reason, /month/i);
  });

  test('a trailing fragment shorter than a record is rejected as truncated', () => {
    const result = parseNotification(fromHex(EXAMPLE + ' 67 1F 0F'));

    assert.equal(result.measurements.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /truncated/i);
  });

  test('an empty notification yields nothing', () => {
    const result = parseNotification(new Uint8Array());
    assert.deepEqual(result, { measurements: [], rejected: [], endOfData: false });
  });

  test('accepts a DataView, as delivered by Web Bluetooth', () => {
    const bytes = fromHex(EXAMPLE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(parseNotification(view).measurements.length, 1);
  });
});

describe('encodeRecord', () => {
  test('is the inverse of parseRecord for the known example', () => {
    const { measurement } = parseRecord(fromHex(EXAMPLE));
    assert.equal(toHex(encodeRecord(measurement)), EXAMPLE);
  });

  test('round-trips arbitrary valid measurements', () => {
    const m = { takenAt: '2031-12-31T23:59:58', weightKg: 150.3, impedanceRaw: 0x0a0b0c };
    assert.deepEqual(parseRecord(encodeRecord(m)).measurement, m);
  });

  test('refuses years the 4-bit field cannot hold', () => {
    assert.throws(
      () => encodeRecord({ takenAt: '2016-01-01T00:00:00', weightKg: 70, impedanceRaw: 0 }),
      /year/i,
    );
  });
});
