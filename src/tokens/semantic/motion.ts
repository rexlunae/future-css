/**
 * Motion, elevation, and layer tokens.
 *
 * Durations are deliberately short. Interface motion exists to explain a state
 * change, not to entertain; anything above ~300ms in a UI transition reads as
 * latency. All durations collapse to near-zero under `prefers-reduced-motion`
 * in the emitted CSS, so components can reference them freely.
 */

export const duration = {
  instant: "0ms",
  fast: "120ms",
  normal: "200ms",
  slow: "300ms",
} as const;

/**
 * Easing curves. `standard` is the default for anything entering or moving;
 * `decelerate` for entering, `accelerate` for exiting, so motion appears to
 * settle into place and get out of the way on the way out.
 */
export const easing = {
  linear: "linear",
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  decelerate: "cubic-bezier(0, 0, 0, 1)",
  accelerate: "cubic-bezier(0.3, 0, 1, 1)",
  /*
   * A small overshoot, for a part that is physically thrown -- a switch thumb.
   * Kept under ~5% so it reads as weight, not bounce; anything springier draws
   * the eye on every toggle.
   */
  spring: "cubic-bezier(0.3, 1.25, 0.5, 1)",
} as const;

/**
 * Elevation. Shadows are theme-aware rather than literal, because a shadow that
 * reads as depth on a white canvas reads as a smudge on a near-black one.
 *
 * Each shadow is a list of layers that share their geometry across schemes and
 * differ only in colour. That split is not cosmetic: `light-dark()` accepts
 * colours only, so wrapping a whole shadow in it -- which this file once did --
 * yields an invalid value at computed time, and every `box-shadow` reading the
 * token silently rendered as no shadow at all. The compiler puts `light-dark()`
 * around each layer's colour instead.
 *
 * Shadow colours are the one place a literal colour is correct: a shadow is an
 * absence of light, not a themeable surface, so it has no semantic name to map.
 */
export interface ShadowLayer {
  /** Offset, blur, and spread, e.g. `0 1px 2px 0`. */
  geometry: string;
  light: string;
  dark: string;
}

export const shadow: Record<"raised" | "overlay" | "modal" | "floating" | "dialog", readonly ShadowLayer[]> = {
  floating: [
    { geometry: "0 12px 32px -8px", light: "rgb(16 18 27 / 0.14)", dark: "rgb(0 0 0 / 0.5)" },
  ],
  dialog: [
    { geometry: "0 32px 64px -12px", light: "rgb(16 18 27 / 0.24)", dark: "rgb(0 0 0 / 0.65)" },
  ],
  raised: [
    { geometry: "0 1px 2px 0", light: "rgb(16 18 27 / 0.06)", dark: "rgb(0 0 0 / 0.4)" },
    { geometry: "0 4px 12px -4px", light: "rgb(16 18 27 / 0.08)", dark: "rgb(0 0 0 / 0.3)" },
  ],
  overlay: [
    { geometry: "0 8px 24px -8px", light: "rgb(16 18 27 / 0.12)", dark: "rgb(0 0 0 / 0.5)" },
    { geometry: "0 2px 4px -2px", light: "rgb(16 18 27 / 0.1)", dark: "rgb(0 0 0 / 0.5)" },
  ],
  /*
   * Dialogs and toasts float furthest from the page. The wide, faint layer is
   * what reads as height; the tight one keeps the edge crisp against a canvas
   * of nearly the same lightness.
   */
  modal: [
    { geometry: "0 24px 48px -12px", light: "rgb(16 18 27 / 0.22)", dark: "rgb(0 0 0 / 0.6)" },
    { geometry: "0 2px 6px -1px", light: "rgb(16 18 27 / 0.08)", dark: "rgb(0 0 0 / 0.5)" },
  ],
};

/** A shadow as it resolves in one scheme, for the JSON payload. */
export function shadowFor(layers: readonly ShadowLayer[], scheme: "light" | "dark"): string {
  return layers.map((l) => `${l.geometry} ${l[scheme]}`).join(", ");
}

/** A shadow with `light-dark()` around each colour, valid in a box-shadow. */
export function shadowValue(layers: readonly ShadowLayer[]): string {
  return layers.map((l) => `${l.geometry} light-dark(${l.light}, ${l.dark})`).join(", ");
}

/**
 * Stacking order. A closed scale is what keeps `z-index: 9999` out of
 * application code: if a new layer is needed, it gets a named step here rather
 * than an arbitrary number.
 */
export const zIndex = {
  "0": "0",
  base: "0",
  raised: "10",
  sticky: "100",
  dropdown: "200",
  overlay: "300",
  modal: "400",
  popover: "500",
  toast: "600",
} as const;

/** Minimum interactive target size. WCAG 2.2 target size (minimum) is 24x24. */
export const targetSize = {
  min: "1.5rem",
  comfortable: "2.5rem",
} as const;

export const opacity = {
  disabled: "0.55",
  "hover-overlay": "0.08",
  "pressed-overlay": "0.12",
  "scrim": "0.55",
} as const;