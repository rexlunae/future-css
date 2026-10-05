/**
 * Syntax highlighting palette for code blocks and code editors.
 *
 * # Why this needs its own contract, like the ANSI palette
 *
 * A code surface is dense, small, and read for long stretches, and every one of
 * these colors carries *meaning*: a string that does not look different from an
 * identifier is not merely ugly, it is a bug you cannot see. So each role is
 * declared in `syntaxContrastPairs` and verified against the code background in
 * both schemes, exactly as `terminal.ts` does for ANSI.
 *
 * # Why these values are not hand-picked
 *
 * They were solved by binary search: for each role's hue and chroma, find the
 * lightness whose contrast against the code background is just above 4.5:1, then
 * round in whichever direction moves *away* from the background so the shipped
 * 2dp value cannot land under the minimum. Guessing produced roles at 4.44:1 --
 * failures invisible to the eye and caught only by the contract, which is the
 * whole reason the contract exists.
 *
 * # Hue assignment
 *
 * Hues follow the convention programmers already have in their fingers from every
 * major editor theme, so highlighting feels familiar rather than novel: keywords
 * purple, strings green, numbers amber, functions blue, types red.
 */

import { checkContrast, type ContrastPair, type SchemeColors } from "./color.ts";
import type { Oklch } from "../color-utils.ts";
import { oklabDistance } from "../color-utils.ts";
import { neutral } from "../palette.ts";

export const syntaxColors = {
  // ---- Surfaces -----------------------------------------------------------
  /*
   * The code background follows the app theme, unlike a terminal's. A terminal
   * emulates another program and must stay dark; a code block is part of this
   * document and belongs in the theme the reader chose.
   */
  bg: { light: neutral["50"]!, dark: neutral["900"]! },
  /** Unchanged rows in a diff, and inert gutters. */
  "bg-subtle": { light: neutral["100"]!, dark: neutral["800"]! },
  "bg-inset": { light: neutral["0"]!, dark: neutral["950"]! },
  /**
   * The code block's boundary stroke.
   *
   * A separate token rather than reusing `bg-inset`: the inset surface is the
   * *inside* of a control, while this is the edge of the block against the page.
   * Pointing the boundary at the inset surface was wrong -- white-on-near-white
   * measured 1.04:1, which is invisible, and the contrast contract caught it.
   *
   * The two schemes need *different* lightnesses, so a single ramp step cannot
   * serve both: `neutral[400]` reaches 2.76:1 in light but only 2.73:1 in dark,
   * and `neutral[500]` is 4.46/2.73. Every symmetric choice fails one scheme.
   * Solved independently per scheme, which is the same reason `focus-ring` is
   * authored as two values rather than a ramp lookup.
   */
  "border-default": { light: { l: 0.63, c: 0.01, h: 265 }, dark: { l: 0.5, c: 0.01, h: 265 } },

  // ---- Diff backgrounds ---------------------------------------------------
  /*
   * Added and removed rows must be told apart by surface as well as by the sign
   * glyph, because the glyph is the *only* cue that survives a printer and a
   * monochrome terminal.
   *
   * These were originally both `neutral[100]`/`neutral[900]` -- i.e. identical.
   * In dark mode both resolved to the same value as `bg` itself, so a changed
   * row rendered exactly like an unchanged one and the two were indistinguishable
   * by colour. Nothing caught it: both passed contrast, because two identical
   * backgrounds contrast identically. The contract verifies legibility, not
   * distinctness, so that gap had to be closed here.
   *
   * The tints are anchored on the same hues as `added-fg`/`removed-fg` and kept
   * very low-chroma, since this is a full-row wash and must stay quiet enough
   * that the syntax tokens drawn on top of it still read. The lightnesses are
   * solved against `bg`, not picked by eye.
   */
  "bg-added": { light: { l: 0.955, c: 0.022, h: 150 }, dark: { l: 0.238, c: 0.03, h: 150 } },
  "bg-removed": { light: { l: 0.955, c: 0.022, h: 27 }, dark: { l: 0.238, c: 0.03, h: 27 } },

  // ---- Plain text ---------------------------------------------------------
  fg: { light: neutral["900"]!, dark: neutral["100"]! },

  // ---- Token roles --------------------------------------------------------
  // Solved against `bg`. `comment` is held to 4.5 like every other role rather
  // than the 3 a "secondary text" role might justify: a comment is frequently
  // the only prose in a line, and comments are read constantly.
  comment: { light: { l: 0.53, c: 0.01, h: 265 }, dark: { l: 0.59, c: 0.01, h: 265 } },
  keyword: { light: { l: 0.55, c: 0.13, h: 300 }, dark: { l: 0.61, c: 0.13, h: 300 } },
  string: { light: { l: 0.52, c: 0.11, h: 150 }, dark: { l: 0.58, c: 0.11, h: 150 } },
  number: { light: { l: 0.54, c: 0.12, h: 80 }, dark: { l: 0.6, c: 0.12, h: 80 } },
  function: { light: { l: 0.52, c: 0.11, h: 225 }, dark: { l: 0.59, c: 0.11, h: 225 } },
  type: { light: { l: 0.55, c: 0.13, h: 27 }, dark: { l: 0.61, c: 0.13, h: 27 } },
  operator: { light: { l: 0.53, c: 0.01, h: 265 }, dark: { l: 0.59, c: 0.01, h: 265 } },
  punctuation: { light: { l: 0.53, c: 0.008, h: 265 }, dark: { l: 0.59, c: 0.008, h: 265 } },
  property: { light: { l: 0.53, c: 0.12, h: 255 }, dark: { l: 0.59, c: 0.12, h: 255 } },
  constant: { light: { l: 0.55, c: 0.11, h: 330 }, dark: { l: 0.61, c: 0.11, h: 330 } },
  tag: { light: { l: 0.55, c: 0.13, h: 27 }, dark: { l: 0.61, c: 0.13, h: 27 } },
  attribute: { light: { l: 0.54, c: 0.11, h: 80 }, dark: { l: 0.6, c: 0.11, h: 80 } },
  regexp: { light: { l: 0.55, c: 0.11, h: 330 }, dark: { l: 0.61, c: 0.11, h: 330 } },
  heading: { light: { l: 0.54, c: 0.14, h: 255 }, dark: { l: 0.59, c: 0.14, h: 255 } },
  link: { light: { l: 0.52, c: 0.12, h: 225 }, dark: { l: 0.58, c: 0.12, h: 225 } },
  invalid: { light: { l: 0.55, c: 0.16, h: 27 }, dark: { l: 0.61, c: 0.16, h: 27 } },

  // ---- Diff foregrounds ---------------------------------------------------
  /*
   * Added and removed text take a hue, not a background tint alone. Colour is
   * never the only cue: each side also differs in glyph (+/-) and in the
   * `data-fc-diff` attribute, so the distinction survives both a colour-blind
   * reader and forced-colors mode.
   */
  "added-fg": { light: { l: 0.42, c: 0.11, h: 150 }, dark: { l: 0.78, c: 0.13, h: 150 } },
  "removed-fg": { light: { l: 0.44, c: 0.14, h: 27 }, dark: { l: 0.76, c: 0.13, h: 27 } },
} as const satisfies SchemeColors;

export type SyntaxColorName = keyof typeof syntaxColors;
export const syntaxColorNames = Object.keys(syntaxColors) as SyntaxColorName[];

/** Roles that render as text directly on the code background. */
const TEXT_ROLES: readonly SyntaxColorName[] = [
  "fg", "comment", "keyword", "string", "number", "function", "type",
  "operator", "punctuation", "property", "constant", "tag", "attribute",
  "regexp", "heading", "link", "invalid",
];

export const syntaxContrastPairs: readonly ContrastPair[] = [
  ...TEXT_ROLES.map((role) => ({
    usage: `Syntax ${role} on the code background`,
    fg: role,
    bg: "bg",
    min: 4.5,
  })),
  // Diff foregrounds sit on the *tinted* row backgrounds, not on `bg`, so each
  // is checked against the background it is actually drawn on.
  { usage: "Added diff line text", fg: "added-fg", bg: "bg-added", min: 4.5 },
  { usage: "Removed diff line text", fg: "removed-fg", bg: "bg-removed", min: 4.5 },
  { usage: "Code text on the inset surface (gutter, line numbers)", fg: "fg", bg: "bg-inset", min: 4.5 },
  { usage: "Code text on a subtle surface (unchanged diff rows)", fg: "fg", bg: "bg-subtle", min: 4.5 },
  // A code block is a UI surface, so its boundary needs non-text contrast
  // against the page it sits on (WCAG 1.4.11). The canvas is aliased into this
  // namespace so the whole contract can be evaluated by one call.
  { usage: "Code surface boundary against the canvas", fg: "border-default", bg: "canvas-ref", min: 3 },
];

/** The app canvas, aliased in so the boundary pair above stays in one namespace. */
export const codeBoundaryReference = {
  "canvas-ref": { light: neutral["25"]!, dark: neutral["950"]! },
} as const satisfies SchemeColors;

/** Evaluate the syntax contract, including the canvas boundary reference. */
export function checkSyntaxContrast(): ReturnType<typeof checkContrast> {
  return checkContrast(syntaxContrastPairs, { ...syntaxColors, ...codeBoundaryReference });
}
/**
 * Pairs that must be *told apart*, not merely legible.
 *
 * Contrast ratio cannot express this: two identical colors contrast identically
 * against anything, which is exactly how `bg-added` and `bg-removed` were once
 * the same value in dark mode and the contract passed without a word. Each pair
 * is checked in both schemes at build time on OKLab distance, so a collapse to
 * zero fails loudly instead of passing silently.
 */
export const distinctPairs = [
  { usage: "Added vs removed diff row background", a: "bg-added", b: "bg-removed", min: 0.03 },
  { usage: "Added vs removed diff row text", a: "added-fg", b: "removed-fg", min: 0.03 },
] as const;

export type DistinctPair = (typeof distinctPairs)[number];

export function checkDistinct(
  pairs: readonly DistinctPair[] = distinctPairs,
  colors: Record<string, Record<"light" | "dark", Oklch>> = syntaxColors as never,
): { pair: DistinctPair; scheme: "light" | "dark"; delta: number }[] {
  const failures: { pair: DistinctPair; scheme: "light" | "dark"; delta: number }[] = [];
  for (const pair of pairs) {
    for (const scheme of ["light", "dark"] as const) {
      const a = colors[pair.a]?.[scheme];
      const b = colors[pair.b]?.[scheme];
      if (!a || !b) {
        throw new Error(`Distinct pair references unknown token: ${pair.a} / ${pair.b}`);
      }
      const delta = oklabDistance(a, b);
      if (delta < pair.min) {
        failures.push({ pair, scheme, delta });
      }
    }
  }
  return failures;
}
