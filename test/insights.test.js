import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANGES,
  filterByRange,
  summarize,
  groupByMonth,
  bmiBand,
  relativeDay,
  change,
} from '../src/domain/insights.js';

const m = (takenAt, weightKg = 70) => ({ takenAt, weightKg, impedanceRaw: 4700 });
const NOW = new Date(2026, 10, 14, 9, 0, 0); // 14 Nov 2026 09:00 local

describe('filterByRange', () => {
  const history = [
    m('2025-10-01T07:00:00'),
    m('2026-08-20T07:00:00'),
    m('2026-10-20T07:00:00'),
    m('2026-11-08T07:00:00'),
    m('2026-11-14T07:00:00'),
  ];

  test('every range has a label', () => {
    for (const r of RANGES) assert.ok(r.key && r.label);
  });

  test('7 days keeps readings from the last week', () => {
    assert.deepEqual(
      filterByRange(history, '7d', NOW).map((x) => x.takenAt),
      ['2026-11-08T07:00:00', '2026-11-14T07:00:00'],
    );
  });

  test('30 days', () => {
    assert.equal(filterByRange(history, '30d', NOW).length, 3);
  });

  test('90 days', () => {
    assert.equal(filterByRange(history, '90d', NOW).length, 4);
  });

  test('1 year and all', () => {
    assert.equal(filterByRange(history, '1y', NOW).length, 4);
    assert.equal(filterByRange(history, 'all', NOW).length, 5);
  });

  test('unknown range means all', () => {
    assert.equal(filterByRange(history, 'forever', NOW).length, 5);
  });
});

describe('summarize', () => {
  test('first-to-last change, average, min and max', () => {
    assert.deepEqual(summarize([76, 75, null, 74.5, 75.5]), {
      count: 4,
      first: 76,
      last: 75.5,
      change: -0.5,
      average: 75.25,
      min: 74.5,
      max: 76,
    });
  });

  test('is null when there are no values', () => {
    assert.equal(summarize([null, undefined]), null);
    assert.equal(summarize([]), null);
  });

  test('avoids floating point noise in the change', () => {
    assert.equal(summarize([73.6, 73.3]).change, -0.3);
  });
});

describe('change', () => {
  test('difference between two values, rounded', () => {
    assert.equal(change(73.3, 73.6), -0.3);
  });

  test('null when either side is missing', () => {
    assert.equal(change(73.3, null), null);
    assert.equal(change(undefined, 70), null);
  });
});

describe('groupByMonth', () => {
  test('groups newest month first, newest reading first', () => {
    const groups = groupByMonth([
      m('2026-10-30T07:00:00'),
      m('2026-11-01T07:00:00'),
      m('2026-11-03T07:00:00'),
    ]);

    assert.deepEqual(
      groups.map((g) => [g.year, g.month, g.items.map((i) => i.takenAt.slice(8, 10))]),
      [
        [2026, 11, ['03', '01']],
        [2026, 10, ['30']],
      ],
    );
  });

  test('is empty for no history', () => {
    assert.deepEqual(groupByMonth([]), []);
  });
});

describe('bmiBand', () => {
  test('WHO adult categories', () => {
    assert.equal(bmiBand(17).key, 'under');
    assert.equal(bmiBand(18.5).key, 'healthy');
    assert.equal(bmiBand(24.9).key, 'healthy');
    assert.equal(bmiBand(25).key, 'over');
    assert.equal(bmiBand(30).key, 'obese');
  });

  test('position runs 0-1 across a 15-40 scale and is clamped', () => {
    assert.equal(bmiBand(15).position, 0);
    assert.equal(bmiBand(27.5).position, 0.5);
    assert.equal(bmiBand(55).position, 1);
  });

  test('null without a BMI', () => {
    assert.equal(bmiBand(null), null);
  });
});

describe('relativeDay', () => {
  test('today and yesterday', () => {
    assert.equal(relativeDay('2026-11-14T06:00:00', NOW), 'Today');
    assert.equal(relativeDay('2026-11-13T23:59:00', NOW), 'Yesterday');
  });

  test('null for anything older', () => {
    assert.equal(relativeDay('2026-11-12T23:59:00', NOW), null);
  });

  test('handles month boundaries', () => {
    assert.equal(relativeDay('2026-10-31T08:00:00', new Date(2026, 10, 1, 9)), 'Yesterday');
  });
});
