import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { threeWayMerge } from '../src/domain/merge.js';

const item = (id, value) => ({ id, value });
const merge = (base, local, remote) =>
  threeWayMerge({ base, local, remote, keyOf: (x) => x.id, same: (a, b) => a.value === b.value });
const ids = (result) => result.merged.map((x) => `${x.id}=${x.value}`).sort();

describe('threeWayMerge', () => {
  test('nothing changed anywhere', () => {
    const all = [item('a', 1)];
    const result = merge(all, all, all);
    assert.deepEqual(ids(result), ['a=1']);
    assert.equal(result.localChanged, false);
    assert.equal(result.remoteChanged, false);
  });

  test('added locally goes to the remote', () => {
    const result = merge([], [item('a', 1)], []);
    assert.deepEqual(ids(result), ['a=1']);
    assert.equal(result.localChanged, false);
    assert.equal(result.remoteChanged, true);
  });

  test('added remotely comes to local', () => {
    const result = merge([], [], [item('a', 1)]);
    assert.deepEqual(ids(result), ['a=1']);
    assert.equal(result.localChanged, true);
    assert.equal(result.remoteChanged, false);
  });

  test('deleted locally is deleted remotely', () => {
    const result = merge([item('a', 1), item('b', 2)], [item('b', 2)], [item('a', 1), item('b', 2)]);
    assert.deepEqual(ids(result), ['b=2']);
    assert.equal(result.remoteChanged, true);
  });

  test('deleted remotely is deleted locally', () => {
    const result = merge([item('a', 1), item('b', 2)], [item('a', 1), item('b', 2)], [item('b', 2)]);
    assert.deepEqual(ids(result), ['b=2']);
    assert.equal(result.localChanged, true);
  });

  test('deleted on both sides stays deleted', () => {
    assert.deepEqual(ids(merge([item('a', 1)], [], [])), []);
  });

  test('edited locally wins over an untouched remote', () => {
    const result = merge([item('a', 1)], [item('a', 5)], [item('a', 1)]);
    assert.deepEqual(ids(result), ['a=5']);
    assert.equal(result.remoteChanged, true);
    assert.equal(result.localChanged, false);
  });

  test('edited remotely wins over an untouched local', () => {
    const result = merge([item('a', 1)], [item('a', 1)], [item('a', 7)]);
    assert.deepEqual(ids(result), ['a=7']);
    assert.equal(result.localChanged, true);
  });

  test('edited on both sides: this device wins', () => {
    assert.deepEqual(ids(merge([item('a', 1)], [item('a', 5)], [item('a', 7)])), ['a=5']);
  });

  test('an edit survives a delete on the other side', () => {
    assert.deepEqual(ids(merge([item('a', 1)], [item('a', 5)], [])), ['a=5']);
    assert.deepEqual(ids(merge([item('a', 1)], [], [item('a', 7)])), ['a=7']);
  });

  test('first sync with no shared history: the remote wins a clash', () => {
    const result = merge([], [item('a', 5), item('b', 2)], [item('a', 7), item('c', 3)]);
    assert.deepEqual(ids(result), ['a=7', 'b=2', 'c=3']);
    assert.equal(result.localChanged, true);
    assert.equal(result.remoteChanged, true);
  });
});
