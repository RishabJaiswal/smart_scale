import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { easeOutCubic, tweenValue, countUpFrames } from '../src/ui/motion.js';

describe('easeOutCubic', () => {
  test('starts at 0, ends at 1, and is fast then slow', () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.ok(easeOutCubic(0.5) > 0.8);
  });

  test('clamps progress outside 0-1', () => {
    assert.equal(easeOutCubic(-1), 0);
    assert.equal(easeOutCubic(2), 1);
  });
});

describe('tweenValue', () => {
  test('moves from the old value to the new one', () => {
    assert.equal(tweenValue(70, 80, 0), 70);
    assert.equal(tweenValue(70, 80, 1), 80);
    assert.ok(tweenValue(70, 80, 0.5) > 75);
  });

  test('works downwards', () => {
    assert.ok(tweenValue(80, 70, 0.5) < 75);
  });
});

describe('countUpFrames', () => {
  test('ends exactly on the target, formatted to the given decimals', () => {
    const frames = countUpFrames(93.3, 92.7, 1, 6);
    assert.equal(frames.length, 6);
    assert.equal(frames.at(-1), '92.7');
    assert.ok(frames.every((f) => /^\d+\.\d$/.test(f)));
  });

  test('is a single frame when nothing changes', () => {
    assert.deepEqual(countUpFrames(92.7, 92.7, 1, 6), ['92.7']);
  });

  test('never overshoots the range between the two values', () => {
    for (const f of countUpFrames(60, 93.3, 1, 20)) {
      assert.ok(Number(f) >= 60 && Number(f) <= 93.3, f);
    }
  });
});
