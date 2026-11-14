/**
 * DOM wiring. Everything that decides *what* to show lives in the pure
 * modules under ../domain; this file only renders it and handles events.
 */

import { analyse, BODY_FAT_FORMULAS } from '../domain/bodyComposition.js';
import { mergeMeasurements, removeMeasurement, measurementKey, toCsv } from '../domain/history.js';
import { METRICS, metricByKey, formatMetric, metricHeading } from '../domain/metrics.js';
import { normalizeSettings } from '../domain/settings.js';
import {
  readStoredMeasurements,
  deleteStoredMeasurements,
  withPacketLog,
} from '../bluetooth/scaleSync.js';
import { WebBluetoothTransport, isWebBluetoothAvailable } from '../bluetooth/webBluetoothTransport.js';
import { DemoTransport } from '../bluetooth/demoTransport.js';
import { chartGeometry } from './chartGeometry.js';
import { storage } from './storage.js';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_LOG_ENTRIES = 500;

const isDemo = new URLSearchParams(location.search).has('demo');

const state = {
  history: storage.loadHistory(),
  settings: storage.loadSettings(),
  log: [],
  busy: false,
  syncedOnce: false,
};

const transport = withPacketLog(createTransport(), addLogEntry);

function createTransport() {
  if (isDemo) return new DemoTransport();
  return new WebBluetoothTransport({
    onDisconnect: () => {
      setStatus('Scale disconnected');
      note('Device disconnected');
    },
  });
}

// ---------- Rendering ----------

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const toDate = (takenAt) => new Date(takenAt); // ISO without zone = local time

function analysisOf(measurement) {
  const { profile, formula, calibrationOffset } = state.settings;
  return analyse(measurement, profile, { formula, calibrationOffset });
}

function selectedMetrics() {
  return state.settings.metrics.map(metricByKey);
}

function render() {
  document.documentElement.style.setProperty('--accent', state.settings.accentColor);
  document.querySelector('meta[name="theme-color"]').content = state.settings.accentColor;
  renderLatest();
  renderChart();
  renderHistory();
}

function renderLatest() {
  const container = $('latest-metrics');
  container.replaceChildren();
  const latest = state.history.at(-1);
  if (!latest) {
    $('latest-date').textContent = 'No measurements yet.';
    return;
  }
  $('latest-date').textContent = dateFormat.format(toDate(latest.takenAt));
  const analysis = analysisOf(latest);
  for (const metric of selectedMetrics()) {
    const tile = el('div', { className: 'tile' });
    tile.append(
      el('div', { className: 'label', textContent: metric.label }),
      el('div', { className: 'value', textContent: formatMetric(metric, analysis[metric.key]) }),
    );
    container.append(tile);
  }
}

function renderChart() {
  const svg = $('chart');
  svg.replaceChildren();
  const metric = metricByKey(state.settings.chartMetric);
  const box = { width: 640, height: 240, padding: { top: 16, right: 16, bottom: 32, left: 60 } };
  const points = state.history.map((m) => ({
    x: toDate(m.takenAt).getTime(),
    y: analysisOf(m)[metric.key],
    takenAt: m.takenAt,
  }));
  const g = chartGeometry(points, box);
  svg.setAttribute('aria-label', `${metricHeading(metric)} over time`);

  if (g.empty) {
    svg.append(svgEl('text', { x: box.width / 2, y: box.height / 2, 'text-anchor': 'middle', class: 'empty' },
      state.history.length ? `No ${metric.label.toLowerCase()} data — check your profile` : 'Sync to see your trend'));
    return;
  }

  for (const tick of g.yTicks) {
    svg.append(
      svgEl('line', { x1: box.padding.left, x2: box.width - box.padding.right, y1: tick.y, y2: tick.y, class: 'gridline' }),
      svgEl('text', { x: box.padding.left - 8, y: tick.y + 4, 'text-anchor': 'end', class: 'axis-label' },
        tick.value.toFixed(metric.decimals === 0 ? 0 : 1)),
    );
  }
  g.xTicks.forEach((tick, i) => {
    const anchor = g.xTicks.length === 1 ? 'middle' : i === 0 ? 'start' : 'end';
    svg.append(svgEl('text', { x: tick.x, y: box.height - 8, 'text-anchor': anchor, class: 'axis-label' },
      shortDate.format(new Date(tick.value))));
  });
  svg.append(svgEl('path', { d: g.path, class: 'line' }));
  for (const dot of g.dots) {
    const circle = svgEl('circle', { cx: dot.cx, cy: dot.cy, r: 4, class: 'dot' });
    circle.append(svgEl('title', {},
      `${dateFormat.format(toDate(dot.point.takenAt))}: ${formatMetric(metric, dot.point.y)}`));
    svg.append(circle);
  }
}

function renderHistory() {
  const table = $('history-table');
  const metrics = selectedMetrics();
  const headRow = el('tr');
  headRow.append(el('th', { textContent: 'Date' }), ...metrics.map((m) => el('th', { textContent: metricHeading(m) })), el('th'));
  table.tHead.replaceChildren(headRow);

  const rows = [...state.history].reverse().map((m) => {
    const analysis = analysisOf(m);
    const row = el('tr');
    const remove = el('button', { className: 'link', type: 'button', textContent: '✕', title: 'Delete this measurement' });
    remove.setAttribute('aria-label', `Delete measurement from ${dateFormat.format(toDate(m.takenAt))}`);
    remove.dataset.key = measurementKey(m);
    row.append(
      el('td', { textContent: dateFormat.format(toDate(m.takenAt)) }),
      ...metrics.map((metric) => el('td', { textContent: formatMetric(metric, analysis[metric.key]) })),
      el('td', {}, remove),
    );
    return row;
  });
  table.tBodies[0].replaceChildren(...rows);
  $('export-csv').disabled = state.history.length === 0;
  $('clear-history').disabled = state.history.length === 0;
}

function renderSettingsForm() {
  const form = $('settings-form');
  const { profile, formula, calibrationOffset, accentColor, metrics } = state.settings;
  form.heightCm.value = profile.heightCm ?? '';
  form.age.value = profile.age ?? '';
  form.sex.value = profile.sex ?? '';
  form.formula.value = formula;
  form.calibrationOffset.value = calibrationOffset;
  form.accentColor.value = accentColor;
  for (const box of form.querySelectorAll('input[name="metric"]')) box.checked = metrics.includes(box.value);
  $('chart-metric').value = state.settings.chartMetric;
}

function buildStaticControls() {
  $('formula').append(
    ...Object.entries(BODY_FAT_FORMULAS).map(([key, f]) => el('option', { value: key, textContent: f.label })),
  );
  $('chart-metric').append(...METRICS.map((m) => el('option', { value: m.key, textContent: m.label })));
  $('metric-choices').append(
    ...METRICS.map((m) => {
      const label = el('label');
      label.append(el('input', { type: 'checkbox', name: 'metric', value: m.key }), document.createTextNode(m.label));
      return label;
    }),
  );
}

// ---------- Packet log ----------

function addLogEntry({ direction, hex, at }) {
  pushLog(direction, `${time(at)} ${direction === 'tx' ? '→' : '←'} ${hex}`);
}

function note(text, kind = 'note') {
  pushLog(kind, `${time(new Date())} · ${text}`);
}

function pushLog(kind, text) {
  state.log.push({ kind, text });
  if (state.log.length > MAX_LOG_ENTRIES) state.log.shift();
  const list = $('packet-log');
  list.append(el('li', { className: kind, textContent: text }));
  while (list.children.length > MAX_LOG_ENTRIES) list.firstElementChild.remove();
  list.scrollTop = list.scrollHeight;
}

const time = (d) => d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');

// ---------- Actions ----------

async function sync() {
  await runBusy(async () => {
    setStatus('Connecting…');
    const { name } = await transport.connect();
    note(`Connected to ${name}`);
    setStatus(`Reading from ${name}…`);

    const result = await readStoredMeasurements(transport);
    for (const r of result.rejected) note(`Rejected ${r.hex}: ${r.reason}`, 'err');

    const { history, added } = mergeMeasurements(state.history, result.measurements);
    state.history = history;
    storage.saveHistory(history);
    state.syncedOnce = true;
    render();

    const parts = [`${result.measurements.length} on scale`, `${added} new`];
    if (result.rejected.length) parts.push(`${result.rejected.length} rejected`);
    if (!result.complete) parts.push('end marker not received — data may be incomplete');
    setStatus(`Synced: ${parts.join(', ')}`, !result.complete);
    note(`Sync finished (${parts.join(', ')})`);
  });
}

async function deleteOnScale() {
  if (!confirm('Delete all measurements stored on the scale? They stay in this app’s history.')) return;
  await runBusy(async () => {
    await transport.connect();
    await deleteStoredMeasurements(transport);
    note('Sent delete command');
    setStatus('Delete command sent to the scale');
  });
}

async function runBusy(action) {
  if (state.busy) return;
  state.busy = true;
  updateButtons();
  try {
    await action();
  } catch (error) {
    const message = describeError(error);
    setStatus(message, true);
    note(message, 'err');
  } finally {
    state.busy = false;
    updateButtons();
  }
}

function describeError(error) {
  if (error?.name === 'NotFoundError') return 'No device chosen';
  if (error?.name === 'SecurityError') return 'Bluetooth blocked: open the app over HTTPS or localhost';
  if (error?.name === 'NotSupportedError') return `Not an HS11? ${error.message}`;
  return error?.message || String(error);
}

function updateButtons() {
  const canUseBluetooth = isDemo || isWebBluetoothAvailable();
  $('sync').disabled = state.busy || !canUseBluetooth;
  $('delete-on-scale').disabled = state.busy || !state.syncedOnce;
  $('sync').textContent = state.busy ? 'Working…' : 'Connect & sync';
}

function setStatus(text, isError = false) {
  const status = $('status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function exportCsv() {
  const { profile, formula, calibrationOffset } = state.settings;
  const csv = toCsv(state.history, profile, { formula, calibrationOffset });
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = el('a', { href: url, download: `hs11-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateSettings(changes) {
  state.settings = normalizeSettings({ ...state.settings, ...changes });
  storage.saveSettings(state.settings);
  render();
}

function readSettingsForm() {
  const form = $('settings-form');
  return {
    profile: { heightCm: form.heightCm.value, age: form.age.value, sex: form.sex.value },
    formula: form.formula.value,
    calibrationOffset: form.calibrationOffset.value,
    accentColor: form.accentColor.value,
    metrics: [...form.querySelectorAll('input[name="metric"]:checked')].map((b) => b.value),
  };
}

// ---------- DOM helpers ----------

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Start ----------

function start() {
  buildStaticControls();
  renderSettingsForm();
  render();

  $('demo-badge').hidden = !isDemo;
  $('unsupported').hidden = isDemo || isWebBluetoothAvailable();
  if (isDemo) setStatus('Demo mode: no real scale is used');
  updateButtons();

  $('sync').addEventListener('click', sync);
  $('delete-on-scale').addEventListener('click', deleteOnScale);
  $('export-csv').addEventListener('click', exportCsv);
  $('clear-history').addEventListener('click', () => {
    if (!confirm('Delete all saved history from this browser?')) return;
    state.history = [];
    storage.saveHistory([]);
    render();
  });
  $('history-table').addEventListener('click', (event) => {
    const key = event.target.closest('button[data-key]')?.dataset.key;
    if (!key) return;
    state.history = removeMeasurement(state.history, key);
    storage.saveHistory(state.history);
    render();
  });
  $('settings-form').addEventListener('input', () => updateSettings(readSettingsForm()));
  $('settings-form').addEventListener('submit', (e) => e.preventDefault());
  $('chart-metric').addEventListener('change', (e) => updateSettings({ chartMetric: e.target.value }));
  $('copy-log').addEventListener('click', () =>
    navigator.clipboard?.writeText(state.log.map((e) => e.text).join('\n')).then(
      () => setStatus('Log copied'),
      () => setStatus('Could not copy the log', true),
    ),
  );
  $('clear-log').addEventListener('click', () => {
    state.log = [];
    $('packet-log').replaceChildren();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
