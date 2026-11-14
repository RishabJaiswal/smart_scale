/**
 * A pretend HS11 for trying the UI without hardware (open with ?demo).
 * Speaks the same byte protocol as the real scale.
 */

import { READ_STORED_COMMAND, DELETE_STORED_COMMAND, encodeRecord, toHex } from '../domain/protocol.js';

/** @implements {import('./scaleSync.js').ScaleTransport} */
export class DemoTransport {
  constructor({ now = () => new Date(), random = Math.random } = {}) {
    this.listeners = new Set();
    this.stored = generateReadings(now(), random);
  }

  async connect() {
    await delay(300);
    return { name: 'Demo HS11' };
  }

  async write(bytes) {
    await delay(100);
    const command = toHex(bytes);
    if (command === toHex(READ_STORED_COMMAND)) {
      // Two records per notification, then the end marker, like a real dump.
      for (let i = 0; i < this.stored.length; i += 2) {
        const chunk = this.stored.slice(i, i + 2).map(encodeRecord);
        this.emit(concat(chunk));
        await delay(60);
      }
      this.emit(Uint8Array.of(0xf2, 0x00));
    } else if (command === toHex(DELETE_STORED_COMMAND)) {
      this.stored = [];
    }
  }

  emit(bytes) {
    for (const listener of [...this.listeners]) listener(bytes);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {}
}

function generateReadings(today, random) {
  const readings = [];
  let weight = 76;
  for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
    if (random() < 0.25) continue;
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(7, Math.floor(random() * 50), Math.floor(random() * 60), 0);
    weight += (random() - 0.6) * 0.5;
    readings.push({
      takenAt: localTimestamp(d),
      weightKg: Math.round(weight * 10) / 10,
      impedanceRaw: random() < 0.1 ? 0 : Math.round(4600 + random() * 300),
    });
  }
  return readings;
}

function localTimestamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function concat(arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
