/**
 * DOM wiring. Everything that decides *what* to show lives in the pure
 * modules under ../domain; this file renders it and handles events.
 */

import { analyse, BODY_FAT_FORMULAS } from '../domain/bodyComposition.js';
import { mergeMeasurements, removeMeasurement, measurementKey, toCsv } from '../domain/history.js';
import {
  METRICS,
  metricByKey,
  formatMetric,
  formatMetricValue,
  formatChange,
  changeDirection,
} from '../domain/metrics.js';
import { normalizeSettings, activeProfile } from '../domain/settings.js';
import {
  profileById,
  nextProfileName,
  measurementsOf,
  unassignedOf,
  assignMeasurements,
  releaseProfile,
  defaultAssignee,
  suggestProfile,
} from '../domain/profiles.js';
import {
  RANGES,
  filterByRange,
  summarize,
  groupByMonth,
  bmiBand,
  relativeDay,
  change,
} from '../domain/insights.js';
import {
  readStoredMeasurements,
  deleteStoredMeasurements,
  withPacketLog,
} from '../bluetooth/scaleSync.js';
import { WebBluetoothTransport, isWebBluetoothAvailable } from '../bluetooth/webBluetoothTransport.js';
import { DemoTransport } from '../bluetooth/demoTransport.js';
import { chartGeometry } from './chartGeometry.js';
import { readableTextOn } from './color.js';
import { storage } from './storage.js';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_LOG_ENTRIES = 500;
const SPARKLINE_POINTS = 14;
const VIEWS = ['today', 'trends', 'history', 'settings'];
const ACCENT_PRESETS = ['#0f766e', '#2563eb', '#4f46e5', '#9333ea', '#db2777', '#dc2626', '#ea580c', '#15803d', '#475569'];
const ARROWS = { up: '▲', down: '▼', same: '→' };

const isDemo = new URLSearchParams(location.search).has('demo');

const state = {
  ...storage.load(), // { settings, history }
  log: [],
  /** Keys ticked in the assign inbox, and keys already offered a default tick. */
  picked: new Set(),
  offered: new Set(),
  busy: false,
  syncedOnce: false,
  view: 'today',
};

const transport = withPacketLog(createTransport(), addLogEntry);

function createTransport() {
  if (isDemo) return new DemoTransport();
  return new WebBluetoothTransport({
    onDisconnect: () => note('Device disconnected'),
  });
}

// ---------- Formatting ----------

const fmt = {
  dateTime: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  time: new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }),
  dayMonth: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }),
  weekdayDay: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' }),
  monthYear: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }),
};
const toDate = (takenAt) => new Date(takenAt); // ISO without zone = local time

function whenLabel(takenAt) {
  const relative = relativeDay(takenAt, new Date());
  const date = toDate(takenAt);
  return relative ? `${relative}, ${fmt.time.format(date)}` : fmt.dateTime.format(date);
}

const current = () => activeProfile(state.settings);
/** The active profile's readings, oldest first. */
const readings = () => measurementsOf(state.history, current().id);
const unassigned = () => unassignedOf(state.history, state.settings.profiles);

/** Each reading is analysed with the profile it belongs to. */
function analysisOf(measurement) {
  const profile = profileById(state.settings.profiles, measurement.profileId);
  return analyse(measurement, profile, {
    formula: profile?.formula,
    calibrationOffset: profile?.calibrationOffset,
  });
}

const profileComplete = () => {
  const { heightCm, age, sex } = current();
  return Boolean(heightCm && age && sex);
};

function saveHistory(history) {
  state.history = history;
  storage.saveHistory(history);
}

/** Text node(s) for a change: aria-hidden arrow + signed value. */
function changeNodes(metric, delta, suffix = '') {
  const direction = changeDirection(metric, delta);
  if (!direction) return [];
  return [
    el('span', { className: 'arrow', ariaHidden: 'true', textContent: ARROWS[direction] }),
    document.createTextNode(` ${formatChange(metric, delta)}${suffix}`),
  ];
}

// ---------- Rendering ----------

function render() {
  applyAccent();
  renderProfileSwitcher();
  renderUnassigned();
  renderToday();
  renderTrends();
  renderHistory();
}

function applyAccent() {
  const root = document.documentElement.style;
  root.setProperty('--accent', state.settings.accentColor);
  root.setProperty('--on-accent', readableTextOn(state.settings.accentColor));
  document.querySelector('meta[name="theme-color"]').content = state.settings.accentColor;
}

function renderProfileSwitcher() {
  const { profiles } = state.settings;
  const select = $('profile-switcher');
  select.replaceChildren(...profiles.map((p) => el('option', { value: p.id, textContent: p.name })));
  select.value = current().id;
  $('profile-avatar').textContent = current().name.trim().charAt(0).toUpperCase();
}

function renderUnassigned() {
  const waiting = unassigned();
  $('unassigned-card').hidden = waiting.length === 0;
  if (waiting.length === 0) return;

  const { profiles } = state.settings;
  const target = $('assign-target');
  const targetId = profileById(profiles, target.value)?.id ?? current().id;
  target.replaceChildren(...profiles.map((p) => el('option', { value: p.id, textContent: p.name })));
  target.value = targetId;

  const keys = new Set(waiting.map(measurementKey));
  for (const key of [...state.picked]) if (!keys.has(key)) state.picked.delete(key);

  const weight = metricByKey('weightKg');
  $('unassigned-list').replaceChildren(
    ...[...waiting].reverse().map((m) => {
      const key = measurementKey(m);
      const suggestion = profileById(profiles, suggestProfile(m, state.history, profiles));
      // Offer a tick once, for readings that look like the active profile's.
      if (!state.offered.has(key)) {
        state.offered.add(key);
        if (suggestion?.id === current().id) state.picked.add(key);
      }
      const box = el('input', { type: 'checkbox', checked: state.picked.has(key) });
      box.dataset.key = key;
      return el('li', {},
        el('label', {},
          box,
          el('span', { className: 'when' },
            whenLabel(m.takenAt),
            el('small', { textContent: suggestion ? `Looks like ${suggestion.name}` : '' })),
          el('strong', { textContent: formatMetric(weight, m.weightKg) })));
    }),
  );
  updateAssignControls();
}

function updateAssignControls() {
  const total = unassigned().length;
  const picked = state.picked.size;
  $('unassigned-title').textContent = `${total} reading${total === 1 ? '' : 's'} to assign`;
  $('assign-toggle-all').textContent = picked === total ? 'Select none' : 'Select all';
  $('assign-button').textContent = picked ? `Assign ${picked}` : 'Assign';
  $('assign-button').disabled = picked === 0;
  $('discard-unassigned').disabled = picked === 0;
}

function renderToday() {
  const own = readings();
  const latest = own.at(-1);
  $('empty-state').hidden = Boolean(latest);
  $('today-content').hidden = !latest;
  $('empty-title').textContent =
    state.settings.profiles.length > 1 ? `No readings for ${current().name} yet` : 'No readings yet';
  if (!latest) return;

  const previous = own.at(-2);
  const analysis = analysisOf(latest);
  const previousAnalysis = previous ? analysisOf(previous) : null;
  const weight = metricByKey('weightKg');

  $('hero-when').textContent = whenLabel(latest.takenAt);
  $('hero-weight').textContent = formatMetricValue(weight, latest.weightKg);
  $('hero-delta').replaceChildren(
    ...(previous
      ? changeNodes(weight, change(latest.weightKg, previous.weightKg),
          ` since ${fmt.dayMonth.format(toDate(previous.takenAt))}`)
      : [document.createTextNode('First reading')]),
  );
  renderSparkline(own.slice(-SPARKLINE_POINTS));

  $('profile-prompt').hidden = profileComplete();
  renderBmi(analysis.bmi);

  const shown = state.settings.metrics.filter((key) => key !== 'weightKg' && key !== 'bmi');
  $('metric-grid').replaceChildren(
    ...shown.map((key) => {
      const metric = metricByKey(key);
      const value = analysis[key];
      const delta = previousAnalysis ? change(value, previousAnalysis[key]) : null;
      const valueEl = el('div', { className: 'metric-value' });
      const number = formatMetricValue(metric, value);
      valueEl.append(number === '' ? '—' : number);
      if (number !== '' && metric.unit) valueEl.append(el('small', { textContent: metric.unit }));
      return el('div', { className: 'card' },
        el('div', { className: 'metric-label', textContent: metric.label }),
        valueEl,
        el('div', { className: 'metric-delta' }, ...changeNodes(metric, delta)),
      );
    }),
  );
}

function renderBmi(bmi) {
  const band = state.settings.metrics.includes('bmi') ? bmiBand(bmi) : null;
  $('bmi-card').hidden = !band;
  if (!band) return;
  $('bmi-value').textContent = formatMetricValue(metricByKey('bmi'), bmi);
  $('bmi-band').textContent = band.label;
  $('bmi-marker').style.left = `${band.position * 100}%`;
}

function renderSparkline(readings) {
  const svg = $('sparkline');
  const width = 300;
  const height = 64;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const g = chartGeometry(
    readings.map((m) => ({ x: toDate(m.takenAt).getTime(), y: m.weightKg })),
    { width, height, padding: { top: 8, right: 0, bottom: 0, left: 0 } },
  );
  svg.replaceChildren(gradient('spark-fill', 0.22));
  if (g.empty || g.dots.length < 2) return;
  svg.append(svgEl('path', { d: g.area, class: 'area' }), svgEl('path', { d: g.path, class: 'line' }));
}

// ----- Trends -----

const chart = { dots: [], focus: -1, metric: null, box: null };

function renderTrends() {
  const { chartMetric, chartRange } = state.settings;
  const metric = metricByKey(chartMetric);

  for (const button of $('range-control').children) {
    button.setAttribute('aria-checked', String(button.dataset.range === chartRange));
  }
  for (const chip of $('metric-chips').children) {
    chip.setAttribute('aria-checked', String(chip.dataset.metric === chartMetric));
  }

  const own = readings();
  const inRange = filterByRange(own, chartRange, new Date());
  const points = inRange.map((m) => ({
    x: toDate(m.takenAt).getTime(),
    y: analysisOf(m)[metric.key],
    takenAt: m.takenAt,
  }));
  const stats = summarize(points.map((p) => p.y));

  $('chart-title').textContent = metric.unit ? `${metric.label} (${metric.unit})` : metric.label;
  $('chart-latest').textContent = stats ? `${stats.count} reading${stats.count === 1 ? '' : 's'}` : '';
  renderChart(points, metric, stats, own.length);
  renderStats(metric, stats);
}

function renderChart(points, metric, stats, totalReadings) {
  const svg = $('chart');
  const width = $('chart-wrap').clientWidth;
  if (!width) return; // hidden; rendered again when the tab opens
  const height = 240;
  const box = { width, height, padding: { top: 16, right: 12, bottom: 28, left: 44 } };
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren(gradient('chart-fill', 0.18));

  const g = chartGeometry(points, box);
  Object.assign(chart, { dots: g.dots, focus: -1, metric, box });
  hideTooltip();

  if (g.empty) {
    svg.setAttribute('aria-label', 'No data in this range');
    const message = totalReadings === 0
      ? 'Sync to see your trend'
      : profileComplete() || metric.key === 'weightKg' || metric.key === 'impedanceOhm'
        ? 'No readings in this range'
        : 'Add your profile in Settings to see this';
    svg.append(svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'empty' }, message));
    return;
  }

  svg.setAttribute('aria-label',
    `${metric.label}: ${stats.count} readings, from ${formatMetric(metric, stats.first)} to ` +
    `${formatMetric(metric, stats.last)}. Use left and right arrow keys to read each value.`);

  const decimals = Math.max(0, metric.decimals - (g.yTicks.every((t) => Number.isInteger(t.value)) ? 1 : 0));
  for (const tick of g.yTicks) {
    svg.append(
      svgEl('line', { x1: box.padding.left, x2: width - box.padding.right, y1: tick.y, y2: tick.y, class: 'gridline' }),
      svgEl('text', { x: box.padding.left - 8, y: tick.y + 4, 'text-anchor': 'end', class: 'axis-label' },
        tick.value.toFixed(decimals)),
    );
  }
  g.xTicks.forEach((tick, i) => {
    const anchor = g.xTicks.length === 1 ? 'middle' : i === 0 ? 'start' : 'end';
    svg.append(svgEl('text', { x: tick.x, y: height - 6, 'text-anchor': anchor, class: 'axis-label' },
      fmt.dayMonth.format(new Date(tick.value))));
  });
  if (g.dots.length > 1) svg.append(svgEl('path', { d: g.area, class: 'area' }));
  svg.append(svgEl('path', { d: g.path, class: 'line' }));
  if (g.dots.length <= 40) {
    for (const dot of g.dots) svg.append(svgEl('circle', { cx: dot.cx, cy: dot.cy, r: 4, class: 'dot' }));
  }
  svg.append(
    svgEl('line', { id: 'crosshair', class: 'crosshair', y1: box.padding.top, y2: height - box.padding.bottom, visibility: 'hidden' }),
    svgEl('circle', { id: 'focus-dot', class: 'focus-dot', r: 6, visibility: 'hidden' }),
  );
}

function focusPoint(index) {
  if (!chart.dots.length) return;
  chart.focus = Math.max(0, Math.min(chart.dots.length - 1, index));
  const dot = chart.dots[chart.focus];
  const crosshair = $('crosshair');
  const focusDot = $('focus-dot');
  crosshair.setAttribute('x1', dot.cx);
  crosshair.setAttribute('x2', dot.cx);
  crosshair.setAttribute('visibility', 'visible');
  focusDot.setAttribute('cx', dot.cx);
  focusDot.setAttribute('cy', dot.cy);
  focusDot.setAttribute('visibility', 'visible');

  const tooltip = $('chart-tooltip');
  $('tooltip-value').textContent = formatMetric(chart.metric, dot.point.y);
  $('tooltip-date').textContent = fmt.dateTime.format(toDate(dot.point.takenAt));
  tooltip.hidden = false;
  const half = tooltip.offsetWidth / 2;
  tooltip.style.left = `${Math.max(half, Math.min(chart.box.width - half, dot.cx))}px`;
  tooltip.style.top = `${Math.max(0, dot.cy - tooltip.offsetHeight - 14)}px`;
}

function hideTooltip() {
  $('chart-tooltip').hidden = true;
  $('crosshair')?.setAttribute('visibility', 'hidden');
  $('focus-dot')?.setAttribute('visibility', 'hidden');
}

function nearestDotIndex(clientX) {
  const x = clientX - $('chart').getBoundingClientRect().left;
  let best = 0;
  chart.dots.forEach((d, i) => {
    if (Math.abs(d.cx - x) < Math.abs(chart.dots[best].cx - x)) best = i;
  });
  return best;
}

function renderStats(metric, stats) {
  const tiles = stats
    ? [
        ['Change', el('span', {}, ...changeNodes(metric, stats.change))],
        ['Average', formatMetric(metric, stats.average)],
        ['Lowest', formatMetric(metric, stats.min)],
        ['Highest', formatMetric(metric, stats.max)],
      ]
    : [];
  $('stats').replaceChildren(
    ...tiles.map(([label, value]) =>
      el('div', { className: 'card' },
        el('div', { className: 'metric-label', textContent: label }),
        el('div', { className: 'metric-value' }, value),
      ),
    ),
  );
}

// ----- History -----

function renderHistory() {
  const own = readings();
  const count = own.length;
  const who = state.settings.profiles.length > 1 ? ` for ${current().name}` : '';
  $('history-count').textContent = count
    ? `${count} reading${count === 1 ? '' : 's'}${who}, saved in this browser`
    : `No readings${who} yet.`;
  $('export-csv').disabled = state.history.length === 0;
  $('clear-history').disabled = count === 0;

  const previousOf = new Map(own.map((m, i) => [measurementKey(m), own[i - 1]]));
  const weight = metricByKey('weightKg');
  const metrics = state.settings.metrics.map(metricByKey);

  $('history-list').replaceChildren(
    ...groupByMonth(own).map((group) => {
      const list = el('div', { className: 'card month-list' },
        ...group.items.map((m) => {
          const date = toDate(m.takenAt);
          const previous = previousOf.get(measurementKey(m));
          const analysis = analysisOf(m);
          const remove = el('button', { type: 'button', className: 'ghost danger', textContent: 'Delete reading' });
          remove.dataset.key = measurementKey(m);
          const move = el('select', {},
            ...state.settings.profiles.map((p) => el('option', { value: p.id, textContent: p.name })),
            el('option', { value: '', textContent: 'Unassigned' }));
          move.value = m.profileId;
          move.dataset.moveKey = measurementKey(m);
          return el('details', { className: 'reading' },
            el('summary', {},
              el('span', { className: 'reading-date' },
                el('strong', { textContent: fmt.weekdayDay.format(date) }),
                el('span', { textContent: fmt.time.format(date) })),
              el('span', { className: 'reading-weight' },
                formatMetric(weight, m.weightKg),
                el('small', {}, ...(previous ? changeNodes(weight, change(m.weightKg, previous.weightKg)) : []))),
            ),
            el('div', { className: 'reading-detail' },
              el('dl', {}, ...metrics.flatMap((metric) => [
                el('dt', { textContent: metric.label }),
                el('dd', { textContent: formatMetric(metric, analysis[metric.key]) }),
              ])),
              el('div', { className: 'move-row' }, el('label', {}, 'Belongs to', move), remove),
            ),
          );
        }),
      );
      return el('section', { className: 'month' },
        el('h2', { textContent: fmt.monthYear.format(new Date(group.year, group.month - 1, 1)) }),
        list);
    }),
  );
}

// ----- Settings -----

function renderSettingsForm() {
  const form = $('settings-form');
  const { accentColor, metrics, profiles } = state.settings;
  const profile = current();
  $('profile-chips').replaceChildren(
    ...profiles.map((p) => {
      const chip = el('button', { type: 'button', role: 'radio', className: 'chip', textContent: p.name });
      chip.dataset.profile = p.id;
      chip.setAttribute('aria-checked', String(p.id === profile.id));
      return chip;
    }),
  );
  $('delete-profile').disabled = profiles.length === 1;
  $('delete-profile').title = profiles.length === 1 ? 'The last profile cannot be deleted' : '';
  $('bodyfat-legend').textContent = profiles.length > 1 ? `Body fat for ${profile.name}` : 'Body fat';
  form.profileName.value = profile.name;
  form.heightCm.value = profile.heightCm ?? '';
  form.age.value = profile.age ?? '';
  form.sex.value = profile.sex ?? '';
  form.formula.value = profile.formula;
  form.calibrationOffset.value = profile.calibrationOffset;
  form.accentColor.value = accentColor;
  for (const box of form.querySelectorAll('input[name="metric"]')) box.checked = metrics.includes(box.value);
  renderSwatches();
}

function renderSwatches() {
  for (const swatch of $('swatches').querySelectorAll('button.swatch')) {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.color === state.settings.accentColor));
  }
}

function buildStaticControls() {
  $('formula').append(
    ...Object.entries(BODY_FAT_FORMULAS).map(([key, f]) => el('option', { value: key, textContent: f.label })),
  );
  $('range-control').append(
    ...RANGES.map((r) => {
      const b = el('button', { type: 'button', role: 'radio', textContent: r.label });
      b.dataset.range = r.key;
      return b;
    }),
  );
  $('metric-chips').append(
    ...METRICS.map((m) => {
      const b = el('button', { type: 'button', role: 'radio', className: 'chip', textContent: m.label });
      b.dataset.metric = m.key;
      return b;
    }),
  );
  $('metric-choices').append(
    ...METRICS.map((m) =>
      el('label', { className: 'chip' },
        el('input', { type: 'checkbox', name: 'metric', value: m.key }),
        document.createTextNode(m.label)),
    ),
  );
  $('swatches').prepend(
    ...ACCENT_PRESETS.map((color) => {
      const b = el('button', { type: 'button', className: 'swatch', title: color });
      b.dataset.color = color;
      b.style.setProperty('--swatch', color);
      b.setAttribute('aria-label', `Accent ${color}`);
      return b;
    }),
  );
}

function readSettingsForm() {
  const form = $('settings-form');
  const edited = {
    id: current().id,
    name: form.profileName.value,
    heightCm: form.heightCm.value,
    age: form.age.value,
    sex: form.sex.value,
    formula: form.formula.value,
    calibrationOffset: form.calibrationOffset.value,
  };
  return {
    profiles: state.settings.profiles.map((p) => (p.id === edited.id ? edited : p)),
    accentColor: form.accentColor.value,
    metrics: [...form.querySelectorAll('input[name="metric"]:checked')].map((b) => b.value),
  };
}

let savedTimer;
function updateSettings(changes, { announce = false } = {}) {
  state.settings = normalizeSettings({ ...state.settings, ...changes });
  storage.saveSettings(state.settings);
  render();
  renderSwatches();
  if (announce) {
    const saved = $('saved-indicator');
    saved.textContent = 'Saved ✓';
    saved.style.opacity = '1';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { saved.style.opacity = '0'; }, 1500);
  }
}

// ----- Profiles -----

function switchProfile(id) {
  updateSettings({ activeProfileId: id });
  renderSettingsForm();
}

function addProfile() {
  const { profiles } = state.settings;
  const id = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  updateSettings(
    { profiles: [...profiles, { id, name: nextProfileName(profiles) }], activeProfileId: id },
    { announce: true },
  );
  renderSettingsForm();
  const name = $('settings-form').profileName;
  name.focus();
  name.select();
}

function deleteProfile() {
  const profile = current();
  const count = readings().length;
  const consequence = count
    ? ` Their ${count} reading${count === 1 ? '' : 's'} will become unassigned, not deleted.`
    : '';
  if (!confirm(`Delete the profile "${profile.name}"?${consequence}`)) return;
  saveHistory(releaseProfile(state.history, profile.id));
  updateSettings(
    { profiles: state.settings.profiles.filter((p) => p.id !== profile.id) },
    { announce: true },
  );
  renderSettingsForm();
}

function assignPicked() {
  const target = profileById(state.settings.profiles, $('assign-target').value);
  if (!target || state.picked.size === 0) return;
  const count = state.picked.size;
  saveHistory(assignMeasurements(state.history, state.picked, target.id));
  state.picked.clear();
  render();
  setStatus(`Assigned ${count} reading${count === 1 ? '' : 's'} to ${target.name}`);
}

function discardPicked() {
  const count = state.picked.size;
  if (!count || !confirm(`Delete ${count} unassigned reading${count === 1 ? '' : 's'} from this browser?`)) return;
  saveHistory(state.history.filter((m) => !state.picked.has(measurementKey(m))));
  state.picked.clear();
  render();
}

// ---------- Routing ----------

function route() {
  const view = location.hash.slice(1);
  state.view = VIEWS.includes(view) ? view : 'today';
  for (const section of document.querySelectorAll('[data-view]')) {
    section.hidden = section.dataset.view !== state.view;
  }
  for (const link of document.querySelectorAll('[data-tab]')) {
    if (link.dataset.tab === state.view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (state.view === 'trends') renderTrends();
  window.scrollTo({ top: 0 });
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

const time = (d) =>
  d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');

// ---------- Actions ----------

async function sync() {
  await runBusy(async () => {
    setStatus('Connecting…');
    const { name } = await transport.connect();
    note(`Connected to ${name}`);
    setStatus(`Reading from ${name}…`);

    const result = await readStoredMeasurements(transport);
    for (const r of result.rejected) note(`Rejected ${r.hex}: ${r.reason}`, 'err');

    // With one profile new readings are theirs; with several the user maps them.
    const profileId = defaultAssignee(state.settings.profiles);
    const incoming = result.measurements.map((m) => ({ ...m, profileId }));
    const { history, added } = mergeMeasurements(state.history, incoming);
    saveHistory(history);
    state.syncedOnce = true;
    render();

    const toAssign = profileId === null && added > 0 ? ' to assign' : '';
    const parts = [added === 0 ? 'no new readings' : `${added} new reading${added === 1 ? '' : 's'}${toAssign}`];
    if (result.rejected.length) parts.push(`${result.rejected.length} rejected (see packet log)`);
    if (!result.complete) parts.push('end marker not received, data may be incomplete');
    setStatus(`Synced: ${parts.join(', ')}`, !result.complete);
    note(`Sync finished: ${result.measurements.length} on scale, ${parts.join(', ')}`);
  });
}

async function deleteOnScale() {
  if (!confirm('Delete all readings stored on the scale? They stay in this app.')) return;
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
  const sync = $('sync');
  sync.disabled = state.busy || !canUseBluetooth;
  sync.classList.toggle('busy', state.busy);
  sync.querySelector('.sync-label').textContent = state.busy ? 'Syncing' : 'Sync';
  $('delete-on-scale').disabled = state.busy || !state.syncedOnce;
}

function setStatus(text, isError = false) {
  const status = $('status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function exportCsv() {
  const csv = toCsv(state.history, state.settings.profiles);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = el('a', { href: url, download: `hs11-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function gradient(id, opacity) {
  const stop = (offset, alpha) =>
    svgEl('stop', { offset, style: `stop-color: var(--accent-ink); stop-opacity: ${alpha}` });
  const linear = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  linear.append(stop('0%', opacity), stop('100%', 0));
  const defs = svgEl('defs');
  defs.append(linear);
  return defs;
}

// ---------- Start ----------

function bindEvents() {
  window.addEventListener('hashchange', route);
  $('sync').addEventListener('click', sync);
  $('delete-on-scale').addEventListener('click', deleteOnScale);
  $('export-csv').addEventListener('click', exportCsv);
  $('clear-history').addEventListener('click', () => {
    const id = current().id;
    if (!confirm(`Delete all of ${current().name}'s saved readings from this browser?`)) return;
    saveHistory(state.history.filter((m) => m.profileId !== id));
    render();
  });
  $('history-list').addEventListener('click', (event) => {
    const key = event.target.closest('button[data-key]')?.dataset.key;
    if (!key || !confirm('Delete this reading from this browser?')) return;
    saveHistory(removeMeasurement(state.history, key));
    render();
  });
  $('history-list').addEventListener('change', (event) => {
    const key = event.target.dataset?.moveKey;
    if (!key) return;
    saveHistory(assignMeasurements(state.history, [key], event.target.value || null));
    render();
  });

  $('profile-switcher').addEventListener('change', (e) => switchProfile(e.target.value));
  $('profile-chips').addEventListener('click', (e) => {
    const id = e.target.closest('[data-profile]')?.dataset.profile;
    if (id) switchProfile(id);
  });
  $('add-profile').addEventListener('click', addProfile);
  $('delete-profile').addEventListener('click', deleteProfile);

  $('unassigned-list').addEventListener('change', (e) => {
    const key = e.target.dataset?.key;
    if (!key) return;
    if (e.target.checked) state.picked.add(key);
    else state.picked.delete(key);
    updateAssignControls();
  });
  $('assign-toggle-all').addEventListener('click', () => {
    const keys = unassigned().map(measurementKey);
    state.picked = new Set(state.picked.size === keys.length ? [] : keys);
    renderUnassigned();
  });
  $('assign-button').addEventListener('click', assignPicked);
  $('discard-unassigned').addEventListener('click', discardPicked);

  $('range-control').addEventListener('click', (e) => {
    const range = e.target.closest('[data-range]')?.dataset.range;
    if (range) updateSettings({ chartRange: range });
  });
  $('metric-chips').addEventListener('click', (e) => {
    const metric = e.target.closest('[data-metric]')?.dataset.metric;
    if (metric) updateSettings({ chartMetric: metric });
  });

  const chartSvg = $('chart');
  chartSvg.addEventListener('pointermove', (e) => focusPoint(nearestDotIndex(e.clientX)));
  chartSvg.addEventListener('pointerdown', (e) => focusPoint(nearestDotIndex(e.clientX)));
  chartSvg.addEventListener('pointerleave', hideTooltip);
  chartSvg.addEventListener('focus', () => focusPoint(chart.dots.length - 1));
  chartSvg.addEventListener('blur', hideTooltip);
  chartSvg.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in moves) focusPoint(chart.focus + moves[e.key]);
    else if (e.key === 'Home') focusPoint(0);
    else if (e.key === 'End') focusPoint(chart.dots.length - 1);
    else return;
    e.preventDefault();
  });
  new ResizeObserver(() => state.view === 'trends' && renderTrends()).observe($('chart-wrap'));

  const form = $('settings-form');
  form.addEventListener('input', () => updateSettings(readSettingsForm(), { announce: true }));
  form.addEventListener('change', () => {
    updateSettings(readSettingsForm(), { announce: true });
    renderSettingsForm(); // show normalised values, refresh profile chips
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('swatches').addEventListener('click', (e) => {
    const color = e.target.closest('button.swatch')?.dataset.color;
    if (!color) return;
    form.accentColor.value = color;
    updateSettings({ accentColor: color }, { announce: true });
  });

  $('copy-log').addEventListener('click', () =>
    navigator.clipboard?.writeText(state.log.map((e) => e.text).join('\n')).then(
      () => setStatus('Packet log copied'),
      () => setStatus('Could not copy the log', true),
    ),
  );
  $('clear-log').addEventListener('click', () => {
    state.log = [];
    $('packet-log').replaceChildren();
  });
}

function start() {
  buildStaticControls();
  storage.saveSettings(state.settings); // persist any migration to profiles
  storage.saveHistory(state.history);
  renderSettingsForm();
  bindEvents();
  route();
  render();

  $('demo-badge').hidden = !isDemo;
  $('unsupported').hidden = isDemo || isWebBluetoothAvailable();
  if (isDemo) setStatus('Demo mode: a pretend scale, no Bluetooth used');
  updateButtons();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
