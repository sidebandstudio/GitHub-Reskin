// sRGB color math with fixed rules: WCAG relative luminance with the 0.04045 breakpoint,
// unrounded contrast ratios, channel-wise mixing rounded with floor(v + 0.5), and OKLab.
// No browser color parsing and no locale-dependent formatting.

export const BLACK = "#000000";
export const WHITE = "#ffffff";

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (value) => typeof value === "string" && HEX.test(value);

export function channels(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Moves `a` toward `b` by `t` in sRGB, channel by channel. */
export function mix(a, b, t) {
  const x = channels(a);
  const y = channels(b);
  return toHex(x.map((v, i) => Math.floor(v + (y[i] - v) * t + 0.5)));
}

const linear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminanceCache = new Map();
export function luminance(hex) {
  const key = hex.toLowerCase();
  let value = luminanceCache.get(key);
  if (value === undefined) {
    const [r, g, b] = channels(key).map(linear);
    value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luminanceCache.size > 65536) luminanceCache.clear();
    luminanceCache.set(key, value);
  }
  return value;
}

export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return x > y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05);
}

/** OKLab [L, a, b] for an sRGB hex color, using Björn Ottosson's published matrices. */
export function oklab(hex) {
  const [r, g, b] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The base's safe ink: white on dark bases, black on light bases. Used for every tie. */
export const safeInk = (base) => (base === "dark" ? WHITE : BLACK);

/** Whichever of black and white contrasts more with `background`; ties use the base's safe ink. */
export function bestInk(background, base) {
  const black = contrast(BLACK, background);
  const white = contrast(WHITE, background);
  return black === white ? safeInk(base) : black > white ? BLACK : WHITE;
}

/**
 * The smallest k/255 mix of `color` toward black or white that reaches `minimum` against every
 * background, or against each background's own minimum when `minimum` is an array. When both
 * directions succeed at the same step, the base's safe ink wins. Returns null when no step of
 * either direction passes, as when the backgrounds straddle polarities.
 */
export function fit(color, backgrounds, minimum, base) {
  const ends = base === "dark" ? [WHITE, BLACK] : [BLACK, WHITE];
  const min = (i) => (Array.isArray(minimum) ? minimum[i] : minimum);
  const passes = (candidate) => backgrounds.every((bg, i) => contrast(candidate, bg) >= min(i));
  if (passes(color)) return color;
  for (let k = 1; k <= 255; k++) {
    for (const end of ends) {
      const candidate = mix(color, end, k / 255);
      if (passes(candidate)) return candidate;
    }
  }
  return null;
}
