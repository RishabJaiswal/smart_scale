import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  readStoredMeasurements,
  deleteStoredMeasurements,
  syncScaleClock,
  withPacketLog,
} from '../src/bluetooth/scaleSync.js';
import { FakeTransport, ManualTimers } from './support/fakeTransport.js';

const RECORD_A = '67 1F 0F 1E 3B F2 E0 7A 12 00'; // 2023-07-31 15:30:59, 73.6 kg
const RECORD_B = '68 01 07 00 00 F2 D6 70 12 00'; // 2023-08-01 07:00:00, 72.6 kg
const BAD_MONTH = '60 1F 0F 1E 3B F2 E0 7A 12 00';
const END = 'F2 00';

describe('readStoredMeasurements', () => {
  test('writes F2 00 and collects records until the end marker', async () => {
    const transport = new FakeTransport().onCommand('F2 00', [RECORD_A, RECORD_B, END]);

    const result = await readStoredMeasurements(transport);

    assert.deepEqual(transport.writes, ['F2 00']);
    assert.equal(result.complete, true);
    assert.deepEqual(
      result.measurements.map((m) => m.weightKg),
      [73.6, 72.6],
    );
  });

  test('handles several records per notification and a trailing marker', async () => {
    const transport = new FakeTransport().onCommand('F2 00', [`${RECORD_A} ${RECORD_B} ${END}`]);

    const result = await readStoredMeasurements(transport);

    assert.equal(result.measurements.length, 2);
    assert.equal(result.complete, true);
  });

  test('reports invalid records without dropping valid ones', async () => {
    const transport = new FakeTransport().onCommand('F2 00', [BAD_MONTH, RECORD_A, END]);

    const result = await readStoredMeasurements(transport);

    assert.equal(result.measurements.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /month/i);
  });

  test('an empty scale answers with only the end marker', async () => {
    const transport = new FakeTransport().onCommand('F2 00', [END]);

    const result = await readStoredMeasurements(transport);

    assert.deepEqual(result, { measurements: [], rejected: [], complete: true });
  });

  test('stops listening once the end marker arrives', async () => {
    const transport = new FakeTransport().onCommand('F2 00', [RECORD_A, END]);

    await readStoredMeasurements(transport);

    assert.equal(transport.listeners.size, 0);
  });

  test('resolves as incomplete if the scale goes quiet after sending data', async () => {
    const timers = new ManualTimers();
    const transport = new FakeTransport().onCommand('F2 00', [RECORD_A]);

    const pending = readStoredMeasurements(transport, { timers, idleTimeoutMs: 5000 });
    await new Promise((r) => setImmediate(r));
    timers.fireAll();
    const result = await pending;

    assert.equal(result.complete, false);
    assert.equal(result.measurements.length, 1);
    assert.equal(transport.listeners.size, 0);
  });

  test('rejects if the scale never answers', async () => {
    const timers = new ManualTimers();
    const transport = new FakeTransport();

    const pending = readStoredMeasurements(transport, { timers });
    await new Promise((r) => setImmediate(r));
    timers.fireAll();

    await assert.rejects(pending, /no response/i);
    assert.equal(transport.listeners.size, 0);
  });

  test('each notification restarts the idle timer', async () => {
    const timers = new ManualTimers();
    const transport = new FakeTransport();

    const pending = readStoredMeasurements(transport, { timers });
    await new Promise((r) => setImmediate(r));
    transport.emit(RECORD_A);
    transport.emit(RECORD_B);
    assert.equal(timers.count, 1, 'only one idle timer should be armed');
    transport.emit(END);

    const result = await pending;
    assert.equal(result.measurements.length, 2);
    assert.equal(timers.count, 0, 'timer cleared on completion');
  });

  test('a failed write rejects and unsubscribes', async () => {
    const transport = new FakeTransport();
    transport.failWrites = new Error('GATT operation failed');

    await assert.rejects(readStoredMeasurements(transport), /GATT/);
    assert.equal(transport.listeners.size, 0);
  });
});

describe('deleteStoredMeasurements', () => {
  test('writes F2 01', async () => {
    const transport = new FakeTransport();

    await deleteStoredMeasurements(transport);

    assert.deepEqual(transport.writes, ['F2 01']);
  });
});

describe('withPacketLog', () => {
  test('logs every packet sent and received, in order', async () => {
    const log = [];
    const inner = new FakeTransport().onCommand('F2 00', [RECORD_A, END]);
    const transport = withPacketLog(inner, (entry) => log.push(entry));

    await readStoredMeasurements(transport);

    assert.deepEqual(
      log.map(({ direction, hex }) => [direction, hex]),
      [
        ['tx', 'F2 00'],
        ['rx', RECORD_A],
        ['rx', END],
      ],
    );
  });

  test('passes connect and disconnect through', async () => {
    const inner = new FakeTransport();
    const transport = withPacketLog(inner, () => {});

    assert.deepEqual(await transport.connect(), { name: 'Fake HS11' });
    assert.doesNotThrow(() => transport.disconnect());
  });
});

describe('syncScaleClock', () => {
  const NOW = new Date(2026, 10, 15, 9, 34, 7); // local time

  test('writes the device local time and resolves when the scale confirms', async () => {
    const transport = new FakeTransport().onCommand('F1 9B 0F 09 22 07', ['F1 00']);

    const result = await syncScaleClock(transport, NOW);

    assert.deepEqual(transport.writes, ['F1 9B 0F 09 22 07']);
    assert.equal(result.acknowledged, true);
    assert.equal(result.setTo, '2026-11-15T09:34:07');
    assert.equal(transport.listeners.size, 0);
  });

  test('ignores unrelated notifications while waiting for the confirmation', async () => {
    const transport = new FakeTransport().onCommand('F1 9B 0F 09 22 07', [
      '67 1F 0F 1E 3B F2 E0 7A 12 00',
      'F1 00',
    ]);

    assert.equal((await syncScaleClock(transport, NOW)).acknowledged, true);
  });

  test('reports no confirmation if the scale stays silent', async () => {
    const timers = new ManualTimers();
    const transport = new FakeTransport();

    const pending = syncScaleClock(transport, NOW, { timers });
    await new Promise((r) => setImmediate(r));
    timers.fireAll();
    const result = await pending;

    assert.equal(result.acknowledged, false);
    assert.equal(transport.listeners.size, 0);
  });

  test('a failed write rejects and unsubscribes', async () => {
    const transport = new FakeTransport();
    transport.failWrites = new Error('GATT operation failed');

    await assert.rejects(syncScaleClock(transport, NOW), /GATT/);
    assert.equal(transport.listeners.size, 0);
  });
});
