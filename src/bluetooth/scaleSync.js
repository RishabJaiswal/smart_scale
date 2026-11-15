/**
 * Scale conversations, written against the small ScaleTransport interface
 * so they can run against Web Bluetooth, a demo scale, or a test fake.
 *
 * @typedef {Object} ScaleTransport
 * @property {() => Promise<{name: string}>} connect
 * @property {(bytes: Uint8Array) => Promise<void>} write  Write to the command characteristic.
 * @property {(listener: (bytes: Uint8Array) => void) => () => void} subscribe
 *   Listen to data-characteristic notifications; returns an unsubscribe function.
 * @property {() => void} disconnect
 */

import {
  READ_STORED_COMMAND,
  DELETE_STORED_COMMAND,
  parseNotification,
  encodeSetClock,
  isSetClockAck,
  toHex,
  asBytes,
} from '../domain/protocol.js';
import { localTimestamp } from '../domain/insights.js';

export const DEFAULT_IDLE_TIMEOUT_MS = 10_000;

/**
 * @typedef {Object} ReadResult
 * @property {import('../domain/protocol.js').Measurement[]} measurements
 * @property {{hex: string, reason: string}[]} rejected
 * @property {boolean} complete  False if the scale went quiet before the end marker.
 */

/**
 * Ask the scale for its stored measurements (F2 00) and collect the replies
 * until the end marker, or until no packet has arrived for `idleTimeoutMs`.
 *
 * @param {ScaleTransport} transport
 * @returns {Promise<ReadResult>}
 */
export function readStoredMeasurements(
  transport,
  { idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, timers = globalThis } = {},
) {
  return new Promise((resolve, reject) => {
    const measurements = [];
    const rejected = [];
    let packetsReceived = 0;
    let settled = false;
    let timer = null;

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      unsubscribe();
      outcome();
    };

    const onIdle = () =>
      finish(() =>
        packetsReceived === 0
          ? reject(new Error('No response from the scale. Step on it to wake it, then retry.'))
          : resolve({ measurements, rejected, complete: false }),
      );

    const armIdleTimer = () => {
      timers.clearTimeout(timer);
      timer = timers.setTimeout(onIdle, idleTimeoutMs);
    };

    const unsubscribe = transport.subscribe((bytes) => {
      if (settled) return;
      packetsReceived++;
      const parsed = parseNotification(bytes);
      measurements.push(...parsed.measurements);
      rejected.push(...parsed.rejected);
      if (parsed.endOfData) {
        finish(() => resolve({ measurements, rejected, complete: true }));
      } else {
        armIdleTimer();
      }
    });

    armIdleTimer();
    transport.write(READ_STORED_COMMAND).catch((error) => finish(() => reject(error)));
  });
}

/**
 * Ask the scale to delete its stored measurements (F2 01).
 * @param {ScaleTransport} transport
 */
export function deleteStoredMeasurements(transport) {
  return transport.write(DELETE_STORED_COMMAND);
}

export const CLOCK_ACK_TIMEOUT_MS = 4_000;

/**
 * Set the scale's clock to the given moment in this device's local time
 * and wait for the scale to confirm with F1 00.
 *
 * Experimental: see `encodeSetClock`. `acknowledged: false` means the
 * command was sent but the scale said nothing back.
 *
 * @param {ScaleTransport} transport
 * @param {Date} now
 * @returns {Promise<{acknowledged: boolean, setTo: string}>}
 */
export function syncScaleClock(
  transport,
  now = new Date(),
  { timeoutMs = CLOCK_ACK_TIMEOUT_MS, timers = globalThis } = {},
) {
  const command = encodeSetClock({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  });
  const setTo = localTimestamp(now);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      unsubscribe();
      outcome();
    };
    const unsubscribe = transport.subscribe((bytes) => {
      if (isSetClockAck(bytes)) finish(() => resolve({ acknowledged: true, setTo }));
    });
    const timer = timers.setTimeout(
      () => finish(() => resolve({ acknowledged: false, setTo })),
      timeoutMs,
    );
    transport.write(command).catch((error) => finish(() => reject(error)));
  });
}

/**
 * @typedef {{direction: 'tx'|'rx', hex: string, at: Date}} PacketLogEntry
 */

/**
 * Decorate a transport so every packet written or notified is reported.
 * @param {ScaleTransport} transport
 * @param {(entry: PacketLogEntry) => void} onPacket
 * @returns {ScaleTransport}
 */
export function withPacketLog(transport, onPacket, now = () => new Date()) {
  const log = (direction, bytes) => onPacket({ direction, hex: toHex(asBytes(bytes)), at: now() });
  return {
    connect: () => transport.connect(),
    disconnect: () => transport.disconnect(),
    write: (bytes) => {
      log('tx', bytes);
      return transport.write(bytes);
    },
    subscribe: (listener) =>
      transport.subscribe((bytes) => {
        log('rx', bytes);
        listener(bytes);
      }),
  };
}
