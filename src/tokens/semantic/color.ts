/**
 * Semantic color tokens.
 *
 * Components consume these tokens exclusively. A component must never reference
 * a primitive (`accent.600`) directly: primitives are an implementation detail
 * that themes are free to remap, and a hard reference is what makes a theme
 * impossible to change later.
 *
 * Naming shape is `<role>-<variant>[-<state>]`:
 *   bg-*        surfaces
 *   text-*      foregrounds on the surfaces above
 *   border-*    strokes, including the non-text contrast requirement
 *   accent-*    the primary action/brand family
 *   success|warning|danger|info-*  status families
 *   focus-*     focus indicator
 *
 * Each pairing is declared in `contrastPairs` so the contract is checked, not
 * assumed.
 */

import { contrastRatio, type Oklch } from "../color-utils.ts";
import { accent, danger, info, neutral, success, warning } from "../palette.ts";

export interface ContrastPair {
  /** Human-readable description of where this pair is used. */
  usage: string;
  fg: string;
  bg: string;
  /** Minimum WCAG 2.2 ratio: 4.5 for body text, 3 for large text and UI parts. */
  min: number;
}

const white: Oklch = { l: 1, c: 0, h: 0 };
const black: Oklch = { l: 0, c: 0, h: 0 };

/**
 * `light` applies under a light color scheme, `dark` under a dark one. The
 * compiler emits these as `light-dark(light, dark)`, so a single
 * `color-scheme` declaration switches the whole system with no extra CSS.
 */
export const semanticColors = {
  // ---- Surfaces -----------------------------------------------------------
  // Numbered aliases retain role names; order is not a lightness scale.
  "surface-depth-0": { light: neutral["25"]!, dark: neutral["950"]! },
  "surface-depth-1": { light: neutral["0"]!, dark: neutral["900"]! },
  "surface-depth-2": { light: neutral["0"]!, dark: neutral["800"]! },
  "surface-depth-3": { light: neutral["0"]!, dark: neutral["900"]! },
  "surface-depth-4": { light: neutral["100"]!, dark: black },
  "bg-canvas": { light: neutral["25"]!, dark: neutral["950"]! },
  "bg-surface": { light: neutral["0"]!, dark: neutral["900"]! },
  "bg-raised": { light: neutral["0"]!, dark: neutral["800"]! },
  "bg-overlay": { light: neutral["0"]!, dark: neutral["900"]! },
  "bg-sunken": { light: neutral["100"]!, dark: black },
  "bg-subtle": { light: neutral["100"]!, dark: neutral["900"]! },
  "bg-muted": { light: neutral["200"]!, dark: neutral["800"]! },
  /*
   * The movable part of a control -- a switch thumb, a slider handle. Light in
   * both schemes: a thumb in the dark surface colour read as a hole punched in
   * the track rather than a part sitting on it.
   */
  "bg-thumb": { light: white, dark: neutral["25"]! },
  /*
   * A deliberately inverted surface (tooltips, marketing bands, image
   * overlays). It exists so `text-inverse` has a real surface to pair against;
   * without it, "inverse text" has no defined background and the contrast
   * contract has nothing to verify.
   */
  "bg-inverse": { light: neutral["900"]!, dark: neutral["0"]! },
  /*
   * Secondary text on an inverted surface. This cannot simply reuse
   * `text-muted`, which is tuned to be legible on a *light* background -- the
   * same value on a dark background collapses to roughly 1.8:1. Inverted
   * surfaces need their own foreground ramp.
   */
  "text-inverse-muted": { light: neutral["300"]!, dark: neutral["700"]! },

  // ---- Foregrounds --------------------------------------------------------
  "text-default": { light: neutral["900"]!, dark: neutral["25"]! },
  "text-muted": { light: neutral["700"]!, dark: neutral["300"]! },
  "text-subtle": { light: neutral["600"]!, dark: neutral["400"]! },
  "text-inverse": { light: neutral["0"]!, dark: neutral["1000"]! },
  /*
   * The foreground for text sitting on a *solid* accent fill. In light mode the
   * fill is a deep blue, so the label is white; in dark mode the fill is a light
   * blue, so the label must be near-black. Hard-coding white here is one of the
   * most common dark-mode accessibility failures.
   */
  "text-on-accent": { light: white, dark: neutral["1000"]! },
  /* Same reasoning as text-on-accent: the danger fill flips lightness by scheme. */
  "text-on-danger": { light: white, dark: neutral["1000"]! },

  // State names keep components independent of the brand's selected surface.
  "selected-bg": { light: accent["50"]!, dark: accent["950"]! },
  "selected-fg": { light: accent["700"]!, dark: accent["200"]! },
  "disabled-bg": { light: neutral["100"]!, dark: neutral["900"]! },
  "disabled-fg": { light: neutral["700"]!, dark: neutral["300"]! },
  "disabled-border": { light: neutral["300"]!, dark: neutral["700"]! },
  "text-on-success": { light: white, dark: neutral["1000"]! },
  "text-on-info": { light: white, dark: neutral["1000"]! },
  "text-on-warning": { light: neutral["1000"]!, dark: neutral["1000"]! },

  // ---- Borders ------------------------------------------------------------
  "border-default": { light: neutral["300"]!, dark: neutral["700"]! },
  "border-subtle": { light: neutral["200"]!, dark: neutral["800"]! },
  "border-strong": { light: neutral["500"]!, dark: neutral["500"]! },
  // Non-text contrast (WCAG 1.4.11): interactive control boundaries need 3:1
  // against their adjacent background, which is a *different* token from the
  // purely decorative borders above.
  "border-interactive": { light: neutral["600"]!, dark: neutral["400"]! },

  // ---- Accent / primary ---------------------------------------------------
  "accent-bg": { light: accent["600"]!, dark: accent["400"]! },
  "accent-bg-hover": { light: accent["700"]!, dark: accent["300"]! },
  "accent-bg-active": { light: accent["800"]!, dark: accent["200"]! },
  "accent-bg-subtle": { light: accent["50"]!, dark: accent["900"]! },
  "accent-text": { light: accent["700"]!, dark: accent["200"]! },
  "accent-border": { light: accent["600"]!, dark: accent["400"]! },

  // ---- Success ------------------------------------------------------------
  "success-bg": { light: success["700"]!, dark: success["300"]! },
  "success-bg-hover": { light: success["800"]!, dark: success["200"]! },
  "success-bg-active": { light: success["900"]!, dark: success["100"]! },
  "success-text": { light: success["800"]!, dark: success["200"]! },
  "success-bg-subtle": { light: success["50"]!, dark: success["950"]! },
  "success-border": { light: success["600"]!, dark: success["400"]! },

  // warning-text on warning-bg is 3.90:1 light and 1.78:1 dark. The
  // solid fill uses text-on-warning instead; status text stays on its subtle fill.
  // ---- Warning ------------------------------------------------------------
  "warning-bg": { light: warning["500"]!, dark: warning["400"]! },
  "warning-bg-hover": { light: warning["400"]!, dark: warning["300"]! },
  "warning-bg-active": { light: warning["300"]!, dark: warning["200"]! },
  "warning-text": { light: warning["900"]!, dark: warning["100"]! },
  "warning-bg-subtle": { light: warning["50"]!, dark: warning["950"]! },
  "warning-border": { light: warning["600"]!, dark: warning["500"]! },

  // ---- Danger -------------------------------------------------------------
  "danger-bg": { light: danger["600"]!, dark: danger["400"]! },
  "danger-bg-hover": { light: danger["700"]!, dark: danger["300"]! },
  "danger-bg-active": { light: danger["800"]!, dark: danger["200"]! },
  "danger-text": { light: danger["700"]!, dark: danger["200"]! },
  "danger-bg-subtle": { light: danger["50"]!, dark: danger["950"]! },
  "danger-border": { light: danger["600"]!, dark: danger["400"]! },

  // ---- Info ---------------------------------------------------------------
  "info-bg": { light: info["700"]!, dark: info["300"]! },
  "info-bg-hover": { light: info["800"]!, dark: info["200"]! },
  "info-bg-active": { light: info["900"]!, dark: info["100"]! },
  "info-text": { light: info["800"]!, dark: info["200"]! },
  "info-bg-subtle": { light: info["50"]!, dark: info["950"]! },
  "info-border": { light: info["600"]!, dark: info["400"]! },

  // ---- Focus --------------------------------------------------------------
  // Two tokens rather than one so high-contrast modes can swap in a
  // double-color ring that stays visible on any background.
  "focus-ring": { light: accent["600"]!, dark: accent["300"]! },
  "focus-ring-offset": { light: white, dark: neutral["950"]! },
} as const satisfies Record<string, { light: Oklch; dark: Oklch }>;

export type SemanticColorName = keyof typeof semanticColors;

export const semanticColorNames = Object.keys(semanticColors) as SemanticColorName[];

const lightSet: Record<string, Oklch> = Object.fromEntries(
  semanticColorNames.map((n) => [n, semanticColors[n].light]),
);
const darkSet: Record<string, Oklch> = Object.fromEntries(
  semanticColorNames.map((n) => [n, semanticColors[n].dark]),
);

/**
 * The checked contrast contract.
 *
 * Single source of truth for "is this palette accessible". A test asserts every
 * pair clears its minimum in both schemes, so a later palette tweak that breaks
 * legality fails CI instead of shipping.
 */
export const contrastPairs: readonly ContrastPair[] = [
  { usage: "Default text inside selected rows", fg: "text-default", bg: "selected-bg", min: 4.5 },
  { usage: "Secondary text inside selected rows", fg: "text-muted", bg: "selected-bg", min: 4.5 },
  { usage: "Subtle text inside selected rows", fg: "text-subtle", bg: "selected-bg", min: 4.5 },
  { usage: "Accent label on hover", fg: "text-on-accent", bg: "accent-bg-hover", min: 4.5 },
  { usage: "Accent label on active", fg: "text-on-accent", bg: "accent-bg-active", min: 4.5 },
  { usage: "Text on depth 0", fg: "text-default", bg: "surface-depth-0", min: 4.5 },
  { usage: "Text on depth 1", fg: "text-default", bg: "surface-depth-1", min: 4.5 },
  { usage: "Text on depth 2", fg: "text-default", bg: "surface-depth-2", min: 4.5 },
  { usage: "Text on depth 3", fg: "text-default", bg: "surface-depth-3", min: 4.5 },
  { usage: "Text on depth 4", fg: "text-default", bg: "surface-depth-4", min: 4.5 },
  { usage: "Selected text on its state surface", fg: "selected-fg", bg: "selected-bg", min: 4.5 },
  { usage: "Disabled control label", fg: "disabled-fg", bg: "disabled-bg", min: 4.5 },
  { usage: "Disabled text on canvas", fg: "disabled-fg", bg: "bg-canvas", min: 4.5 },
  { usage: "Disabled text on surface", fg: "disabled-fg", bg: "bg-surface", min: 4.5 },
  // Disabled boundaries carry no interactive meaning (WCAG exempts inactive controls).
  { usage: "Decorative disabled boundary", fg: "disabled-border", bg: "disabled-bg", min: 1 },
  { usage: "Label on success solid", fg: "text-on-success", bg: "success-bg", min: 4.5 },
  { usage: "Label on success solid-hover", fg: "text-on-success", bg: "success-bg-hover", min: 4.5 },
  { usage: "Label on success solid-active", fg: "text-on-success", bg: "success-bg-active", min: 4.5 },
  { usage: "Label on warning solid", fg: "text-on-warning", bg: "warning-bg", min: 4.5 },
  { usage: "Label on warning solid-hover", fg: "text-on-warning", bg: "warning-bg-hover", min: 4.5 },
  { usage: "Label on warning solid-active", fg: "text-on-warning", bg: "warning-bg-active", min: 4.5 },
  { usage: "Label on danger solid-active", fg: "text-on-danger", bg: "danger-bg-active", min: 4.5 },
  { usage: "Label on info solid", fg: "text-on-info", bg: "info-bg", min: 4.5 },
  { usage: "Label on info solid-hover", fg: "text-on-info", bg: "info-bg-hover", min: 4.5 },
  { usage: "Label on info solid-active", fg: "text-on-info", bg: "info-bg-active", min: 4.5 },
  { usage: "Body text on the page canvas", fg: "text-default", bg: "bg-canvas", min: 7 },
  { usage: "Body text on a raised surface (cards, panels)", fg: "text-default", bg: "bg-surface", min: 7 },
  { usage: "Secondary text / helper copy", fg: "text-muted", bg: "bg-surface", min: 4.5 },
  { usage: "De-emphasised text, still readable", fg: "text-subtle", bg: "bg-surface", min: 4.5 },
  { usage: "Inverse text on an inverted surface (tooltip, overlay)", fg: "text-inverse", bg: "bg-inverse", min: 7 },
  { usage: "Secondary text on an inverted surface (tooltip, overlay)", fg: "text-inverse-muted", bg: "bg-inverse", min: 4.5 },
  { usage: "Accent text (links) on canvas", fg: "accent-text", bg: "bg-canvas", min: 4.5 },
  { usage: "Label on a solid accent button", fg: "text-on-accent", bg: "accent-bg", min: 4.5 },
  { usage: "Label on a solid danger button", fg: "text-on-danger", bg: "danger-bg", min: 4.5 },
  { usage: "Label on a hovered danger button", fg: "text-on-danger", bg: "danger-bg-hover", min: 4.5 },
  { usage: "Accent text on a subtle accent background", fg: "accent-text", bg: "accent-bg-subtle", min: 4.5 },
  { usage: "Interactive control boundary (WCAG 1.4.11)", fg: "border-interactive", bg: "bg-canvas", min: 3 },
  { usage: "Focus ring against the canvas (WCAG 1.4.11)", fg: "focus-ring", bg: "bg-canvas", min: 3 },
  { usage: "Focus ring against a surface", fg: "focus-ring", bg: "bg-surface", min: 3 },
  { usage: "Success text on a subtle success background", fg: "success-text", bg: "success-bg-subtle", min: 4.5 },
  { usage: "Success text on the canvas", fg: "success-text", bg: "bg-canvas", min: 4.5 },
  { usage: "Warning text on a subtle warning background", fg: "warning-text", bg: "warning-bg-subtle", min: 4.5 },
  { usage: "Danger text on a subtle danger background", fg: "danger-text", bg: "danger-bg-subtle", min: 4.5 },
  { usage: "Danger text on the canvas", fg: "danger-text", bg: "bg-canvas", min: 4.5 },
  { usage: "Info text on a subtle info background", fg: "info-text", bg: "info-bg-subtle", min: 4.5 },
  { usage: "Muted text on a muted (hovered) surface", fg: "text-muted", bg: "bg-muted", min: 4.5 },
  { usage: "Muted text on a sunken surface", fg: "text-muted", bg: "bg-sunken", min: 4.5 },
  // The navigation sidebar sits on bg-subtle: links, headings and counts.
  { usage: "Filled field text on its fill", fg: "text-default", bg: "bg-subtle", min: 4.5 },
  { usage: "Filled field underline on its fill (WCAG 1.4.11)", fg: "border-interactive", bg: "bg-subtle", min: 3 },
  { usage: "Hovered filled field text on its fill", fg: "text-default", bg: "bg-muted", min: 4.5 },
  { usage: "Muted text on a subtle surface (sidebar)", fg: "text-muted", bg: "bg-subtle", min: 4.5 },
  { usage: "De-emphasised text on a subtle surface (sidebar)", fg: "text-subtle", bg: "bg-subtle", min: 4.5 },
  // Overlays (dialog, popover, toast) sit on bg-raised, which is a different
  // lightness from bg-surface in dark mode, so the pairs are restated for it.
  { usage: "Body text on a raised overlay (dialog, popover, toast)", fg: "text-default", bg: "bg-raised", min: 7 },
  { usage: "Secondary text on a raised overlay", fg: "text-muted", bg: "bg-raised", min: 4.5 },
  { usage: "Form control boundary on a surface (WCAG 1.4.11)", fg: "border-interactive", bg: "bg-surface", min: 3 },
  { usage: "Invalid form control boundary on a surface (WCAG 1.4.11)", fg: "danger-border", bg: "bg-surface", min: 3 },
  { usage: "Checked control and selected-tab indicator on a surface (WCAG 1.4.11)", fg: "accent-border", bg: "bg-surface", min: 3 },
  // The off switch is a border-strong track on a surface, carrying a bg-thumb.
  { usage: "Off switch track on a surface (WCAG 1.4.11)", fg: "border-strong", bg: "bg-surface", min: 3 },
  { usage: "Off switch thumb on its track (WCAG 1.4.11)", fg: "bg-thumb", bg: "border-strong", min: 3 },
  { usage: "Warning text on the canvas (field warnings, inline status)", fg: "warning-text", bg: "bg-canvas", min: 4.5 },
];

/**
 * A `{ light, dark }` token map of the shape `checkContrast` needs.
 *
 * Exported as a type so other palettes -- notably the terminal's ANSI set, which
 * must satisfy the same guarantees -- can be checked by the same function rather
 * than reimplementing the loop and risking the two drifting apart.
 */
export type SchemeColors = Record<string, { light: Oklch; dark: Oklch }>;

/** Build the per-scheme lookup tables `checkContrast` resolves against. */
export function schemeSets(
  colors: SchemeColors,
): { light: Record<string, Oklch>; dark: Record<string, Oklch> } {
  const names = Object.keys(colors);
  return {
    light: Object.fromEntries(names.map((n) => [n, colors[n]!.light])),
    dark: Object.fromEntries(names.map((n) => [n, colors[n]!.dark])),
  };
}

/** Evaluate a contract. Returns failures only, keeping CI output short. */
export function checkContrast(
  pairs: readonly ContrastPair[] = contrastPairs,
  colors: SchemeColors = semanticColors,
): { pair: ContrastPair; scheme: "light" | "dark"; ratio: number }[] {
  const sets = schemeSets(colors);
  const failures: { pair: ContrastPair; scheme: "light" | "dark"; ratio: number }[] = [];
  for (const pair of pairs) {
    for (const scheme of ["light", "dark"] as const) {
      const set = sets[scheme];
      const fg = set[pair.fg];
      const bg = set[pair.bg];
      if (!fg || !bg) {
        throw new Error(`Contrast pair references unknown token: ${pair.fg} / ${pair.bg}`);
      }
      const ratio = contrastRatio(fg, bg);
      if (ratio < pair.min) {
        failures.push({ pair, scheme, ratio });
      }
    }
  }
  return failures;
}