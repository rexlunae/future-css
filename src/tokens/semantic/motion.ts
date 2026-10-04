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
} as const;

/**
 * Elevation. Shadows are theme-aware rather than literal, because a shadow that
 * reads as depth on a white canvas reads as a smudge on a near-black one.
 */
export const shadow = {
  none: "none",
  "raised-light": "0 1px 2px 0 rgb(16 18 27 / 0.06), 0 1px 3px 0 rgb(16 18 27 / 0.1)",
  "raised-dark": "0 1px 2px 0 rgb(0 0 0 / 0.4), 0 1px 3px 0 rgb(0 0 0 / 0.5)",
  "overlay-light": "0 4px 6px -1px rgb(16 18 27 / 0.1), 0 2px 4px -2px rgb(16 18 27 / 0.1)",
  "overlay-dark": "0 4px 6px -1px rgb(0 0 0 / 0.5), 0 2px 4px -2px rgb(0 0 0 / 0.5)",
} as const;

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