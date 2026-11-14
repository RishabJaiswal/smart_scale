import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry } from '../src/ui/chartGeometry.js';

const box = { width: 300, height: 100, padding: { top: 10, right: 10, bottom: 20, left: 40 } };

describe('chartGeometry', () => {
  test('is empty with no points', () => {
    assert.equal(chartGeometry([], box).empty, true);
  });

  test('maps the extremes to the plot corners', () => {
    const g = chartGeometry(
      [
        { x: 0, y: 70 },
        { x: 10, y: 80 },
      ],
      box,
    );

    assert.equal(g.empty, false);
    const [first, last] = g.dots;
    assert.equal(first.cx, 40);
    assert.equal(last.cx, 290);
    assert.ok(first.cy > last.cy, 'higher values are drawn higher up');
    assert.ok(first.cy <= 80 && last.cy >= 10, 'stays within the plot area');
    assert.match(g.path, /^M40(\.0+)?,[\d.]+ L290(\.0+)?,[\d.]+$/);
  });

  test('centres a single point and gives a non-zero y range', () => {
    const g = chartGeometry([{ x: 5, y: 72 }], box);
    assert.equal(g.dots[0].cx, 165);
    assert.ok(g.yTicks.length >= 2);
    assert.ok(g.yTicks.every((t) => Number.isFinite(t.y)));
  });

  test('skips points with null y', () => {
    const g = chartGeometry(
      [
        { x: 0, y: 70 },
        { x: 1, y: null },
        { x: 2, y: 71 },
      ],
      box,
    );
    assert.equal(g.dots.length, 2);
  });
});

describe('chartGeometry area', () => {
  test('closes the line down to the baseline for a filled area', () => {
    const g = chartGeometry(
      [
        { x: 0, y: 70 },
        { x: 10, y: 80 },
      ],
      box,
    );
    assert.equal(g.area, `${g.path} L290,80 L40,80 Z`);
  });

  test('area is empty for an empty chart', () => {
    assert.equal(chartGeometry([], box).area, '');
  });
});
