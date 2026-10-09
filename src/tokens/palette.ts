/**
 * Primitive color ramps.
 *
 * These are the only hand-authored colors in the system. Everything else --
 * semantic tokens, component tokens, docs examples -- must be expressed in
 * terms of these ramps, never literal hex.
 *
 * Ramp steps follow a shared lightness ladder so that step *N* carries the
 * same visual weight across every hue. Chroma varies per hue because OKLCH
 * chroma limits are hue-dependent (blue sustains more chroma than yellow at
 * the same perceived lightness).
 */

import type { Oklch } from "./color-utils.ts";

/** A ramp is authored as `[step, lightness, chroma]` triples at a fixed hue. */
type Stop = readonly [number, number, number];

const ramp = (h: number, stops: readonly Stop[]): Record<string, Oklch> => {
  const out: Record<string, Oklch> = {};
  for (const [step, l, c] of stops) {
    out[String(step)] = { l, c, h };
  }
  return out;
};

export type RampName = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export type Ramp = Record<string, Oklch>;

/**
 * Neutral ramp, hue 265. Slightly cool rather than pure grey: pure greys read
 * as "dead" next to saturated accents and shift the perceived hue of adjacent
 * colors depending on the display's white point.
 */
export const neutral: Ramp = ramp(265, [
  [0, 1, 0],
  [1000, 0, 0],
  [25, 0.985, 0.002],
  [50, 0.967, 0.004],
  [100, 0.93, 0.006],
  [200, 0.87, 0.008],
  [300, 0.79, 0.01],
  [400, 0.68, 0.012],
  [500, 0.56, 0.014],
  [600, 0.45, 0.014],
  [700, 0.36, 0.012],
  [800, 0.27, 0.01],
  [900, 0.17, 0.008],
  [950, 0.12, 0.007],
]);

/** Accent / primary. Hue 255 -- trustworthy, high contrast against neutrals. */
export const accent: Ramp = ramp(255, [
  [0, 1, 0],
  [1000, 0, 0],
  [25, 0.985, 0.012],
  [50, 0.96, 0.03],
  [100, 0.91, 0.055],
  [200, 0.84, 0.09],
  [300, 0.76, 0.13],
  [400, 0.68, 0.17],
  [500, 0.6, 0.2],
  [600, 0.52, 0.2],
  [700, 0.45, 0.17],
  [800, 0.39, 0.13],
  [900, 0.33, 0.095],
  [950, 0.24, 0.07],
]);

/** Success. Hue 150 -- deliberately shifted toward teal so it is not confused with a pure "green = go" traffic light. */
export const success: Ramp = ramp(150, [
  [0, 1, 0],
  [1000, 0, 0],
  [25, 0.985, 0.014],
  [50, 0.96, 0.045],
  [100, 0.91, 0.09],
  [200, 0.85, 0.14],
  [300, 0.78, 0.17],
  [400, 0.7, 0.17],
  [500, 0.62, 0.15],
  [600, 0.53, 0.13],
  [700, 0.45, 0.11],
  [800, 0.38, 0.09],
  [900, 0.31, 0.07],
  [950, 0.22, 0.055],
]);

/** Warning. Hue 80. Yellow is the hardest hue to keep legible: the light steps are where most systems fail, so chroma is held low. */
export const warning: Ramp = ramp(80, [
  [0, 1, 0],
  [1000, 0, 0],
  [25, 0.985, 0.02],
  [50, 0.97, 0.06],
  [100, 0.92, 0.11],
  [200, 0.86, 0.16],
  [300, 0.8, 0.18],
  [400, 0.74, 0.17],
  [500, 0.66, 0.15],
  [600, 0.56, 0.13],
  [700, 0.47, 0.11],
  [800, 0.4, 0.09],
  [900, 0.33, 0.07],
  [950, 0.23, 0.05],
]);

/** Danger / destructive. Hue 27 -- red is the only hue that must not be used as the sole carrier of meaning. */
export const danger: Ramp = ramp(27, [
  [0, 1, 0],
  [1000, 0, 0],
  [25, 0.985, 0.012],
  [50, 0.96, 0.045],
  [100, 0.91, 0.08],
  [200, 0.84, 0.13],
  [300, 0.76, 0.175],
  [400, 0.68, 0.21],
  [500, 0.59, 0.215],
  [600, 0.51, 0.2],
  [700, 0.43, 0.17],
  [800, 0.36, 0.14],
  [900, 0.29, 0.11],
  [950, 0.2, 0.08],
]);

/** Info. Hue 225 -- between the accent blue and a cyan, for advisory messaging that must not read as an action. */
export const info: Ramp = ramp(225, [
  [0, 1, 0],
  [1000, 0, 0],
  [25, 0.985, 0.012],
  [50, 0.96, 0.035],
  [100, 0.91, 0.06],
  [200, 0.84, 0.09],
  [300, 0.76, 0.11],
  [400, 0.68, 0.12],
  [500, 0.6, 0.115],
  [600, 0.52, 0.1],
  [700, 0.44, 0.085],
  [800, 0.37, 0.07],
  [900, 0.31, 0.055],
  [950, 0.22, 0.04],
]);

export const ramps = { neutral, accent, success, warning, danger, info } as const satisfies Record<RampName, Ramp>;

/**
 * The step keys every ramp is expected to expose. Verified by a test.
 *
 * Note the endpoints: step 0 is pure white and step 1000 is pure black. A ramp
 * that runs out of steps at the extremes is the classic cause of a dark-mode
 * surface that is "almost, but not quite" black and a light-mode surface that is
 * visibly grey.
 */
export const rampSteps: readonly string[] = [
  "0",
  "25",
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
  "1000",
];

/** Independent rainbow hues keep Pride decoration separate from status colors. */
export const prideStripes = Object.fromEntries(
  [['red',25,0.52,0.2],['orange',55,0.54,0.15],['yellow',95,0.55,0.12],['green',150,0.5,0.15],['blue',255,0.5,0.2],['violet',305,0.5,0.2]].map(([name,hue,lightness,chroma])=>[name,{
    light:{l:Number(lightness),c:Number(chroma),h:Number(hue)},
    dark:{l:0.8,c:name==='yellow'?0.09:0.12,h:Number(hue)},
  }]),
) as Record<'red'|'orange'|'yellow'|'green'|'blue'|'violet',{light:Oklch;dark:Oklch}>;
