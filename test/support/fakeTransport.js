import { fromHex, toHex } from '../../src/domain/protocol.js';

/**
 * In-memory ScaleTransport. Scripts which notifications the "scale" sends
 * back for each command written.
 */
export class FakeTransport {
  constructor() {
    this.writes = [];
    this.listeners = new Set();
    this.replies = new Map();
    this.failWrites = null;
  }

  /** @param {string} commandHex @param {string[]} notificationsHex */
  onCommand(commandHex, notificationsHex) {
    this.replies.set(commandHex, notificationsHex);
    return this;
  }

  async connect() {
    return { name: 'Fake HS11' };
  }

  async write(bytes) {
    this.writes.push(toHex(bytes));
    if (this.failWrites) throw this.failWrites;
    const replies = this.replies.get(toHex(bytes)) ?? [];
    for (const hex of replies) {
      await Promise.resolve();
      this.emit(hex);
    }
  }

  emit(hex) {
    const bytes = fromHex(hex);
    for (const listener of [...this.listeners]) listener(bytes);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {}
}

/** Deterministic replacement for setTimeout/clearTimeout. */
export class ManualTimers {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.setTimeout = (fn, ms) => {
      const id = this.nextId++;
      this.pending.set(id, { fn, ms });
      return id;
    };
    this.clearTimeout = (id) => this.pending.delete(id);
  }

  fireAll() {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const { fn } of due) fn();
  }

  get count() {
    return this.pending.size;
  }
}
