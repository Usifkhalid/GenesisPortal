/**
 * accent.js — can this company colour be made accessible by the design system?
 *
 * tokens.css derives every brand value from one --brand-accent with CSS
 * relative-colour arithmetic. A server cannot run CSS, so this module carries
 * the same arithmetic as numbers, once. The browser (the colour picker's live
 * verdict) and the backend (rejecting a colour on save) both import this file,
 * so there are exactly two statements of the rule, the CSS and this, and a test
 * (backend/tests/accent.test.js) reads the constants out of tokens.css and
 * fails if they drift apart.
 *
 * The rule: for the accent, the derived values must clear
 *   - 4.5:1  the label colour (-on) on the fill
 *   - 4.5:1  the ink (-ink) on every ground, light and dark theme
 *   - 3:1    the edge (-edge) on every ground, light and dark theme
 *
 * The CSS clamps are built so that holds for every hue; this checks it on the
 * colour actually chosen, after the gamut mapping a screen has to do, and so
 * also rejects anything that is not a six-digit hex colour.
 */

/** Constants that mirror tokens.css. The test compares them to the file. */
export const ACCENT_RULES = Object.freeze({
  /** Luminance above which the label on a fill is black, else white. */
  labelThreshold: 0.179,
  fillBand: [0.26, 0.88],
  inkLight: { min: 0.2, max: 0.46 },
  inkDarkFloor: 0.78,
  inkDarkChromaCap: 0.2,
  inkDarkChromaScale: 0.9,
  edgeLightMax: 0.56,
  edgeDarkBand: [0.56, 0.72],
});

/** Contrast the rule demands of text-like and line-like uses. */
export const MIN_TEXT = 4.5;
export const MIN_EDGE = 3;

/**
 * The neutral grounds an accent sits on (tokens.css stone scale). Text-like
 * uses (ink) are checked on all four steps; the edge is a hairline on the page
 * and on a card, which is all tokens.css promises for it.
 */
export const GROUNDS = Object.freeze({
  light: ['#ffffff', '#f8f5f0', '#f1ede7', '#eae5e0'],
  dark: ['#15201a', '#0d1611', '#1c2921', '#243229'],
});
export const EDGE_GROUNDS = Object.freeze({
  light: ['#ffffff', '#f8f5f0'],
  dark: ['#15201a', '#0d1611'],
});

export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/* ------------------------------------------------------------ colour maths */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToLinear(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
}

function linearToHex(rgb) {
  return `#${rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function hexToOklch(hex) {
  const [L, a, b] = linearToOklab(hexToLinear(hex));
  return { l: L, c: Math.hypot(a, b), h: Math.atan2(b, a) };
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** OKLCH to hex, reducing chroma until the colour fits sRGB, as a screen does. */
function oklchToHex({ l, c, h }) {
  const at = (chroma) => oklabToLinear([l, chroma * Math.cos(h), chroma * Math.sin(h)]);
  let rgb = at(c);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid;
      else hi = mid;
    }
    rgb = at(lo);
  }
  return linearToHex(rgb);
}

/** WCAG relative luminance of a hex colour. */
export function luminance(hex) {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* -------------------------------------------------------------- derivation */

const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
const R = ACCENT_RULES;

/**
 * The brand values tokens.css derives from an accent, as hex colours.
 * @param {string} accent  "#rrggbb"
 */
export function deriveAccent(accent) {
  const { l, c, h } = hexToOklch(accent);
  const fill = oklchToHex({ l: clamp(R.fillBand[0], l, R.fillBand[1]), c, h });
  const on = luminance(accent) > R.labelThreshold ? '#000000' : '#ffffff';

  return {
    fill,
    on,
    inkLight: oklchToHex({ l: clamp(R.inkLight.min, Math.min(l, R.inkLight.max), 1), c, h }),
    edgeLight: oklchToHex({ l: Math.min(l, R.edgeLightMax), c, h }),
    inkDark: oklchToHex({
      l: Math.max(l, R.inkDarkFloor),
      c: Math.min(c, R.inkDarkChromaCap) * R.inkDarkChromaScale,
      h,
    }),
    edgeDark: oklchToHex({ l: clamp(R.edgeDarkBand[0], l, R.edgeDarkBand[1]), c, h }),
  };
}

/**
 * @typedef {object} AccentVerdict
 * @property {boolean} ok
 * @property {string | null} normalized  the lower-case hex, or null when malformed
 * @property {{ id: string, ratio: number, min: number, pass: boolean }[]} checks
 * @property {string[]} failed  ids of the checks that failed ('format' when malformed)
 * @property {ReturnType<typeof deriveAccent> | null} derived
 */

/**
 * Judges a colour against the rule above.
 * @param {unknown} value
 * @returns {AccentVerdict}
 */
export function checkAccent(value) {
  if (typeof value !== 'string' || !HEX_COLOUR.test(value)) {
    return { ok: false, normalized: null, checks: [], failed: ['format'], derived: null };
  }

  const normalized = value.toLowerCase();
  const derived = deriveAccent(normalized);
  const worst = (colour, grounds) => Math.min(...grounds.map((g) => contrast(colour, g)));

  const checks = [
    { id: 'label', ratio: contrast(derived.on, derived.fill), min: MIN_TEXT },
    { id: 'inkLight', ratio: worst(derived.inkLight, GROUNDS.light), min: MIN_TEXT },
    { id: 'inkDark', ratio: worst(derived.inkDark, GROUNDS.dark), min: MIN_TEXT },
    { id: 'edgeLight', ratio: worst(derived.edgeLight, EDGE_GROUNDS.light), min: MIN_EDGE },
    { id: 'edgeDark', ratio: worst(derived.edgeDark, EDGE_GROUNDS.dark), min: MIN_EDGE },
  ].map((check) => ({ ...check, pass: check.ratio >= check.min }));

  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  return { ok: failed.length === 0, normalized, checks, failed, derived };
}
