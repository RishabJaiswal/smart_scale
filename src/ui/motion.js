/**
 * Small motion helpers. The maths is pure and tested; the two functions
 * at the bottom touch the DOM and do nothing when the user prefers
 * reduced motion.
 */

export function easeOutCubic(progress) {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
}

export function tweenValue(from, to, progress) {
  return from + (to - from) * easeOutCubic(progress);
}

/** The strings a number passes through on its way from `from` to `to`. */
export function countUpFrames(from, to, decimals, steps) {
  if (from === to || steps <= 1) return [to.toFixed(decimals)];
  return Array.from({ length: steps }, (_, i) =>
    tweenValue(from, to, (i + 1) / steps).toFixed(decimals),
  );
}

export function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

const lastShown = new WeakMap();
const COUNT_MS = 500;

/**
 * Show `value` in `element` via `paint(text)`, counting from the value it
 * showed before. The first value an element shows appears immediately.
 */
export function showNumber(element, value, decimals, paint) {
  const previous = lastShown.get(element);
  lastShown.set(element, value);
  const final = value.toFixed(decimals);
  if (previous === undefined || previous === value || prefersReducedMotion()) {
    paint(final);
    return;
  }
  const start = performance.now();
  const frame = (now) => {
    if (lastShown.get(element) !== value) return; // superseded by a newer value
    const progress = (now - start) / COUNT_MS;
    paint(progress >= 1 ? final : tweenValue(previous, value, progress).toFixed(decimals));
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Restart a CSS animation class on an element. */
export function replay(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // force a reflow so the animation starts over
  element.classList.add(className);
}
