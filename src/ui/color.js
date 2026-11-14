/** WCAG contrast helpers for the user-chosen accent colour. Pure. */

const DARK_TEXT = '#111418';
const LIGHT_TEXT = '#ffffff';

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White text when it reaches 4.5:1 on the colour, otherwise near-black. */
export function readableTextOn(hex) {
  return contrastRatio(hex, LIGHT_TEXT) >= 4.5 ? LIGHT_TEXT : DARK_TEXT;
}
