/**
 * Non-color scales.
 *
 * These are literal values (no light/dark split) because a 4px step is a 4px
 * step in either scheme. Anything that genuinely differs between themes --
 * shadow strength, for instance -- lives in `semantic/` instead.
 */

/**
 * Spacing, in rem. A 4px base unit: `1rem` of spacing equals the root font
 * size, so spacing scales with the user's text preference, which a fixed pixel
 * scale would not.
 */
export const space = {
  "0": "0",
  "px": "0.0625rem",
  "0-5": "0.125rem",
  "1": "0.25rem",
  "1-5": "0.375rem",
  "2": "0.5rem",
  "3": "0.75rem",
  "4": "1rem",
  "5": "1.25rem",
  "6": "1.5rem",
  "8": "2rem",
  "10": "2.5rem",
  "12": "3rem",
  "16": "4rem",
  "20": "5rem",
  "24": "6rem",
  "32": "8rem",
} as const;

/** Font sizes in rem. The scale is fluid; see `fluid()` below. */
export const fontSize = {
  "3xs": "0.625rem",
  "2xs": "0.6875rem",
  "xs": "0.75rem",
  "sm": "0.875rem",
  "md": "1rem",
  "lg": "1.125rem",
  "xl": "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
  "4xl": "2.25rem",
  "5xl": "3rem",
  "6xl": "3.75rem",
} as const;

/**
 * Line heights. Unitless by design: a unitless line height inherits the
 * element's own font size, so a heading and body copy at the same scale keep
 * the same *ratio* of leading to text.
 */
export const lineHeight = {
  none: "1",
  tight: "1.15",
  snug: "1.3",
  normal: "1.5",
  relaxed: "1.65",
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

/**
 * Font families.
 *
 * System stacks are the default on purpose: no webfont download, no layout
 * shift, correct rendering of the user's own language and script, and native
 * hints and small forms in CJK and Devanagari. A product that needs a brand
 * font overrides these three tokens and nothing else.
 */
export const fontFamily = {
  sans: [
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "Noto Sans",
    "sans-serif",
  ].join(", "),
  mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"].join(", "),
} as const;

export const borderRadius = {
  none: "0",
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
  full: "9999px",
} as const;

export const borderWidth = {
  none: "0",
  thin: "1px",
  thick: "2px",
} as const;

export const spacingScale = space;