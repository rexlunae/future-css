/**
 * Color math for the token pipeline.
 *
 * Tokens are authored in OKLCH (perceptually uniform, hue-stable) and compiled
 * down to sRGB hex for the emitted CSS. Every conversion here exists so the
 * contrast contract in `contract.ts` can be enforced at build time rather than
 * discovered by eye.
 *
 * Reference: Björn Ottosson's "A perceptual color space for image processing".
 */

export interface Rgb {
  /** sRGB components in the 0..1 range. */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  l: number;
  /** Chroma, roughly 0..0.4. */
  c: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Convert OKLCH to linear sRGB. Values may fall outside the 0..1 gamut. */
export function oklchToLinearRgb({ l, c, h }: Oklch): Rgb {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

/** Convert OKLCH to sRGB, clamping any out-of-gamut result into range. */
export function oklchToRgb(color: Oklch): Rgb {
  const linear = oklchToLinearRgb(color);
  return {
    r: clamp01(gammaEncode(linear.r)),
    g: clamp01(gammaEncode(linear.g)),
    b: clamp01(gammaEncode(linear.b)),
  };
}

const gammaEncode = (linear: number): number =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;

const hex2 = (n: number): string =>
  Math.round(clamp01(n) * 255)
    .toString(16)
    .padStart(2, "0");

/** Format OKLCH as a `#rrggbb` string. */
export function oklchToHex(color: Oklch): string {
  const { r, g, b } = oklchToRgb(color);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Format OKLCH as a `light-dark(light, dark)` value, the modern theming primitive. */
export function lightDark(light: Oklch, dark: Oklch): string {
  return `light-dark(${oklchToHex(light)}, ${oklchToHex(dark)})`;
}

const toLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** WCAG 2.x relative luminance of an sRGB color. */
export function relativeLuminance(color: Oklch): number {
  const { r, g, b } = oklchToRgb(color);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio between two sRGB colors, from 1 to 21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Human-readable report used in build logs and the contrast test. */
export function describeContrast(fg: Oklch, bg: Oklch): string {
  const ratio = contrastRatio(fg, bg);
  return `${ratio.toFixed(2)}:1 (fg ${oklchToHex(fg)} on bg ${oklchToHex(bg)})`;
}

/**
 * Perceptual distance between two colors in OKLab.
 *
 * Contrast ratio answers "is one legible on the other"; this answers "can the
 * two be told apart at all". The questions are independent -- two identical
 * colors contrast identically against anything, which is how the diff row
 * backgrounds were once the same value in dark mode and passed a
 * contrast-only contract without a word (see the syntax palette's
 * `distinctPairs` and issue #18).
 */
export function oklabDistance(a: Oklch, b: Oklch): number {
  const A = { L: a.l, a: a.c * Math.cos((a.h * Math.PI) / 180), b: a.c * Math.sin((a.h * Math.PI) / 180) };
  const B = { L: b.l, a: b.c * Math.cos((b.h * Math.PI) / 180), b: b.c * Math.sin((b.h * Math.PI) / 180) };
  return Math.sqrt((A.L - B.L) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2);
}
