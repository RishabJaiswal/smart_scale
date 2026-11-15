/**
 * Three-way merge of keyed records: what both sides last agreed on
 * (`base`), this device (`local`) and the shared store (`remote`).
 *
 * Comparing against the base tells an addition from a deletion, so no
 * tombstones or timestamps are needed. Pure module.
 *
 * Rules, per key:
 *  - changed on one side only (added, edited or deleted): that change wins;
 *  - edited on one side and deleted on the other: the edit survives;
 *  - edited on both sides: this device wins;
 *  - present on both sides with no base (first sync): the remote wins.
 *
 * @template T
 * @param {{base: T[], local: T[], remote: T[], keyOf: (item: T) => string, same: (a: T, b: T) => boolean}} input
 * @returns {{merged: T[], localChanged: boolean, remoteChanged: boolean}}
 *   `merged` keeps local order, then remote-only items in remote order.
 */
export function threeWayMerge({ base, local, remote, keyOf, same }) {
  const index = (items) => new Map(items.map((item) => [keyOf(item), item]));
  const baseBy = index(base);
  const localBy = index(local);
  const remoteBy = index(remote);

  const merged = [];
  let localChanged = false;
  let remoteChanged = false;

  const resolve = (key) => {
    const b = baseBy.get(key);
    const l = localBy.get(key);
    const r = remoteBy.get(key);
    if (l && r) {
      if (same(l, r)) return l;
      if (!b) return r; // first sync: the shared copy wins
      return same(l, b) ? r : l; // only remote changed -> remote; else this device
    }
    if (l) return !b || !same(l, b) ? l : null; // new or edited here; else deleted remotely
    if (r) return !b || !same(r, b) ? r : null; // new or edited there; else deleted here
    return null;
  };

  for (const key of new Set([...localBy.keys(), ...remoteBy.keys()])) {
    const result = resolve(key);
    const l = localBy.get(key);
    const r = remoteBy.get(key);
    if (result) merged.push(result);
    if (!matches(result, l, same)) localChanged = true;
    if (!matches(result, r, same)) remoteChanged = true;
  }

  return { merged, localChanged, remoteChanged };
}

function matches(result, side, same) {
  if (!result || !side) return !result && !side;
  return same(result, side);
}
