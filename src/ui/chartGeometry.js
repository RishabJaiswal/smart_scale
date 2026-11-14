/**
 * Pure layout maths for the trend chart: maps data points to SVG
 * coordinates and picks axis ticks. No DOM access.
 */

/**
 * @param {{x: number, y: number|null}[]} points  x is typically epoch ms.
 * @param {{width: number, height: number, padding: {top:number,right:number,bottom:number,left:number}}} box
 */
export function chartGeometry(points, { width, height, padding }) {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length === 0) return { empty: true, path: '', dots: [], yTicks: [], xTicks: [] };

  const left = padding.left;
  const right = width - padding.right;
  const top = padding.top;
  const bottom = height - padding.bottom;

  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const [yMin, yMax, step] = niceRange(Math.min(...ys), Math.max(...ys));

  const sx = (x) => (xMax === xMin ? (left + right) / 2 : left + ((x - xMin) / (xMax - xMin)) * (right - left));
  const sy = (y) => bottom - ((y - yMin) / (yMax - yMin)) * (bottom - top);

  const dots = valid.map((p) => ({ cx: round(sx(p.x)), cy: round(sy(p.y)), point: p }));
  const path = dots.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.cx},${d.cy}`).join(' ');

  const yTicks = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) {
    yTicks.push({ value: round(v), y: round(sy(v)) });
  }

  const xTicks =
    xMax === xMin
      ? [{ value: xMin, x: round(sx(xMin)) }]
      : [
          { value: xMin, x: round(sx(xMin)) },
          { value: xMax, x: round(sx(xMax)) },
        ];

  return { empty: false, path, dots, yTicks, xTicks };
}

/** Rounded axis bounds with ~4 ticks. */
function niceRange(min, max) {
  if (min === max) {
    const pad = Math.abs(min) * 0.02 || 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step, step];
}

const round = (n) => Math.round(n * 100) / 100;
