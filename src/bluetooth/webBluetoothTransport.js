/**
 * ScaleTransport backed by the Web Bluetooth API.
 *
 * NOT covered by automated tests: it needs a browser with Web Bluetooth and
 * a real HS11. Keep logic here minimal; protocol handling lives in
 * ../domain/protocol.js and ./scaleSync.js.
 */

import {
  SERVICE_UUID,
  COMMAND_CHARACTERISTIC_UUID,
  DATA_CHARACTERISTIC_UUID,
  asBytes,
} from '../domain/protocol.js';

export function isWebBluetoothAvailable(nav = globalThis.navigator) {
  return Boolean(nav && nav.bluetooth && typeof nav.bluetooth.requestDevice === 'function');
}

/** @implements {import('./scaleSync.js').ScaleTransport} */
export class WebBluetoothTransport {
  /**
   * @param {{bluetooth?: Bluetooth, onDisconnect?: () => void}} [options]
   */
  constructor({ bluetooth = globalThis.navigator?.bluetooth, onDisconnect = () => {} } = {}) {
    this.bluetooth = bluetooth;
    this.onDisconnect = onDisconnect;
    this.device = null;
    this.command = null;
    this.data = null;
    this.listeners = new Set();
    this.handleNotification = (event) => {
      // Copy: the browser may reuse the underlying buffer.
      const bytes = Uint8Array.from(asBytes(event.target.value));
      for (const listener of [...this.listeners]) listener(bytes);
    };
  }

  get isConnected() {
    return Boolean(this.device?.gatt?.connected && this.command && this.data);
  }

  async connect() {
    if (this.isConnected) return { name: this.deviceName };

    if (!this.device) {
      // The HS11 does not advertise fff0, so it must be picked from all devices.
      this.device = await this.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [0xfff0],
      });
      this.device.addEventListener('gattserverdisconnected', () => {
        this.command = null;
        this.data = null;
        this.onDisconnect();
      });
    }

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.command = await service.getCharacteristic(COMMAND_CHARACTERISTIC_UUID);
    this.data = await service.getCharacteristic(DATA_CHARACTERISTIC_UUID);
    this.data.addEventListener('characteristicvaluechanged', this.handleNotification);
    await this.data.startNotifications();

    return { name: this.deviceName };
  }

  get deviceName() {
    return this.device?.name || 'Unnamed device';
  }

  async write(bytes) {
    if (!this.command) throw new Error('Not connected to the scale');
    const c = this.command;
    if (c.properties?.write && c.writeValueWithResponse) return c.writeValueWithResponse(bytes);
    if (c.properties?.writeWithoutResponse && c.writeValueWithoutResponse) {
      return c.writeValueWithoutResponse(bytes);
    }
    return c.writeValue(bytes);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forget the device so the next connect() shows the chooser again. */
  forget() {
    this.disconnect();
    this.device = null;
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }
}
