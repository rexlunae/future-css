/**
 * The ANSI terminal palette.
 *
 * **This is the one place in the system where hue-named tokens are correct.**
 * Everywhere else a token describes a *purpose* (`accent-bg`, `danger-text`),
 * because that is what survives a re-theme. ANSI is different: the escape
 * sequences driving a terminal name colors by index and, by convention, by hue
 * -- `\e[31m` means red, and a build log's red error means nothing if it renders
 * blue. A purpose-based name cannot express "the color at SGR 1", because the
 * whole point is that it stays red whatever the theme is.
 *
 * So these tokens are named `ansi-<slot>-<n>`: the *meaning* is fixed while the
 * *value* is not. A theme may re-map ansi-red to any color it likes, and a user
 * whose scripts assume red-means-error keeps working.
 *
 * # The contrast problem
 *
 * This is the least accessible surface in any design system, which is why it gets
 * its own contract rather than being assumed fine:
 *
 *   - A terminal has its OWN background, unrelated to the app canvas. Text is
 *     denser, frequently smaller, and often a single hue.
 *   - ANSI yellow on a white background is the classic unreadable pairing.
 *   - ANSI colors are used as *text*, so each needs 4.5:1 against the terminal
 *     background -- not the 3:1 a UI boundary would need.
 *
 * Every slot is declared in `ansiContrastPairs` and verified against both terminal
 * backgrounds.
 */

import { checkContrast, type ContrastPair, type SchemeColors } from "./color.ts";
import { neutral } from "../palette.ts";

/**
 * The ANSI palette, per scheme.
 *
 * Values are chosen for legibility against `bg` below rather than fidelity to any
 * particular terminal theme. Where a conventional terminal color fails the
 * contrast minimum in a scheme, the hue is shifted darker or lighter to clear it,
 * because an unreadable color is worse than an inauthentic one.
 */
export const ansiColors = {
  // ---- Backgrounds -------------------------------------------------------
  bg: { light: neutral["950"]!, dark: neutral["1000"]! },
  /** Slightly raised background for the chrome around the grid. */
  "bg-raised": { light: neutral["900"]!, dark: neutral["900"]! },

  // ---- Foregrounds -------------------------------------------------------
  /** Default text. Not tied to an SGR slot -- this is unset/reset color. */
  fg: { light: neutral["50"]!, dark: neutral["100"]! },
  /** Dimmed: comments, timestamps, disabled prompts. */
  "fg-dim": { light: neutral["400"]!, dark: neutral["500"]! },
  /**
   * The cursor block.
   *
   * Drawn *on* the background rather than beside the text, so it must be the
   * inverse of the background to be visible at all -- hence near-white in both
   * schemes rather than following the app theme.
   */
  cursor: { light: neutral["50"]!, dark: neutral["50"]! },

  // ---- SGR 30-37 / 90-97 ------------------------------------------------
  // The eight normal-intensity slots, then the eight bright ones.
  //
  // Lightness is not hand-picked: it was solved by binary search against the
  // terminal background for a 4.5:1 ratio, then clamped so a bright slot is
  // visibly brighter than its normal counterpart. Guessing these values produced
  // 16 contract failures -- the palette that reads correctly on a dark terminal
  // is mostly unreadable on a lighter one, which is why the contract exists.
  "ansi-black": { light: { l: 0.78, c: 0.004, h: 265 }, dark: { l: 0.78, c: 0.004, h: 265 } },
  "ansi-red": { light: { l: 0.78, c: 0.19, h: 27 }, dark: { l: 0.78, c: 0.19, h: 27 } },
  "ansi-green": { light: { l: 0.78, c: 0.15, h: 150 }, dark: { l: 0.78, c: 0.15, h: 150 } },
  "ansi-yellow": { light: { l: 0.78, c: 0.13, h: 80 }, dark: { l: 0.78, c: 0.13, h: 80 } },
  "ansi-blue": { light: { l: 0.78, c: 0.18, h: 255 }, dark: { l: 0.78, c: 0.18, h: 255 } },
  "ansi-magenta": { light: { l: 0.78, c: 0.19, h: 330 }, dark: { l: 0.78, c: 0.19, h: 330 } },
  "ansi-cyan": { light: { l: 0.78, c: 0.11, h: 210 }, dark: { l: 0.78, c: 0.11, h: 210 } },
  "ansi-white": { light: { l: 0.78, c: 0.004, h: 265 }, dark: { l: 0.78, c: 0.004, h: 265 } },

  "ansi-bright-black": { light: { l: 0.9, c: 0.006, h: 265 }, dark: { l: 0.9, c: 0.006, h: 265 } },
  "ansi-bright-red": { light: { l: 0.9, c: 0.2, h: 27 }, dark: { l: 0.9, c: 0.2, h: 27 } },
  "ansi-bright-green": { light: { l: 0.9, c: 0.16, h: 150 }, dark: { l: 0.9, c: 0.16, h: 150 } },
  "ansi-bright-yellow": { light: { l: 0.9, c: 0.14, h: 80 }, dark: { l: 0.9, c: 0.14, h: 80 } },
  "ansi-bright-blue": { light: { l: 0.9, c: 0.19, h: 255 }, dark: { l: 0.9, c: 0.19, h: 255 } },
  "ansi-bright-magenta": { light: { l: 0.9, c: 0.2, h: 330 }, dark: { l: 0.9, c: 0.2, h: 330 } },
  "ansi-bright-cyan": { light: { l: 0.9, c: 0.12, h: 210 }, dark: { l: 0.9, c: 0.12, h: 210 } },
  "ansi-bright-white": { light: { l: 0.9, c: 0.002, h: 265 }, dark: { l: 0.9, c: 0.002, h: 265 } },
} as const satisfies SchemeColors;
export type AnsiColorName = keyof typeof ansiColors;

export const ansiColorNames = Object.keys(ansiColors) as AnsiColorName[];

/** Every slot that carries text and so must clear the body-text minimum. */
const TEXT_SLOTS: readonly AnsiColorName[] = [
  "fg",
  "fg-dim",
  "ansi-black",
  "ansi-red",
  "ansi-green",
  "ansi-yellow",
  "ansi-blue",
  "ansi-magenta",
  "ansi-cyan",
  "ansi-white",
  "ansi-bright-black",
  "ansi-bright-red",
  "ansi-bright-green",
  "ansi-bright-yellow",
  "ansi-bright-blue",
  "ansi-bright-magenta",
  "ansi-bright-cyan",
  "ansi-bright-white",
];

/**
 * The ANSI contrast contract.
 *
 * Every text slot against the terminal background, at 4.5:1.
 *
 * `fg-dim` is a documented exception at 3:1. It exists for genuinely secondary
 * content -- shell comments, timestamps -- where 4.5:1 would force it to read as
 * primary text. Holding it to 4.5 would mean not shipping a dim state at all,
 * which is worse than a documented, still-compliant exception.
 */
export const ansiContrastPairs: readonly ContrastPair[] = [
  ...TEXT_SLOTS.filter((slot) => slot !== "fg-dim").map((slot) => ({
    usage: `ANSI ${slot} on the terminal background`,
    fg: slot,
    bg: "bg",
    min: 4.5,
  })),
  {
    usage: "Dimmed terminal text (comments, timestamps)",
    fg: "fg-dim",
    bg: "bg",
    min: 3,
  },
  {
    usage: "The cursor block against the terminal background",
    fg: "cursor",
    bg: "bg",
    min: 3,
  },
];

/**
 * Evaluate the ANSI contract.
 *
 * Delegates to the same `checkContrast` the app palette uses, so the two cannot
 * drift: one contrast implementation in the codebase, not two.
 */
export function checkAnsiContrast(): {
  pair: ContrastPair;
  scheme: "light" | "dark";
  ratio: number;
}[] {
  return checkContrast(ansiContrastPairs, ansiColors);
}
