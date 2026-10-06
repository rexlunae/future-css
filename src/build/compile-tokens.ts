/**
 * Token compiler: TypeScript token definitions -> CSS custom properties.
 *
 * The design decision this file encodes: **tokens are authored in TypeScript,
 * not in CSS.** Authoring in TS buys three things CSS alone cannot give us:
 *
 *   1. Type safety -- a typo in a token name is a compile error, not a silently
 *      empty `var()` that falls back to nothing at runtime.
 *   2. Executable contracts -- contrast ratios, ramp completeness, and naming
 *      rules are ordinary functions that run in CI.
 *   3. One source for every output -- the same definitions emit CSS custom
 *      properties, a JSON payload for native platforms, and docs tables.
 *
 * Output is intentionally plain. The generated CSS is a readable, inspectable
 * artifact a consumer can diff or vendor, and it ships with no runtime JS.
 *
 * Run: node src/build/compile-tokens.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { oklchToHex } from "../tokens/color-utils.ts";
import { checkContrast, semanticColors, semanticColorNames } from "../tokens/semantic/color.ts";
import { ansiColorNames, ansiColors, checkAnsiContrast } from "../tokens/semantic/terminal.ts";
import {
  checkDistinct,
  checkSyntaxContrast,
  codeBoundaryReference,
  syntaxColorNames,
  syntaxColors,
} from "../tokens/semantic/syntax.ts";
import {
  borderRadius,
  borderWidth,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  space,
} from "../tokens/index.ts";
import {
  duration,
  easing,
  opacity,
  shadow,
  shadowFor,
  shadowValue,
  targetSize,
  zIndex,
} from "../tokens/semantic/motion.ts";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");
const outDir = resolve(projectRoot, "dist");

/** Every token in the system is emitted with this prefix. */
const PREFIX = "--fc";

export interface EmittedToken {
  name: string;
  value: string;
  /** Set when the token resolves differently under light and dark schemes. */
  light?: string;
  dark?: string;
}

const tokens: EmittedToken[] = [];

const addLiteralGroup = (group: string, values: Record<string, string>): void => {
  for (const [key, value] of Object.entries(values)) {
    tokens.push({ name: `${PREFIX}-${group}-${key}`, value });
  }
};

// ---- Elevation ----------------------------------------------------------
// light-dark() wraps each layer's colour, never the whole shadow: it accepts
// colours only, and a wrapped shadow is invalid at computed time.
for (const [key, layers] of Object.entries(shadow)) {
  tokens.push({
    name: `${PREFIX}-shadow-${key}`,
    value: shadowValue(layers),
    light: shadowFor(layers, "light"),
    dark: shadowFor(layers, "dark"),
  });
}

// ---- Themes -------------------------------------------------------------
// A theme is a partial re-mapping of the semantic color layer. Authoring a
// brand theme means overriding these, and nothing else -- spacing, type, and
// motion stay identical, so a theme can never accidentally break layout.

// ---- Colors -------------------------------------------------------------
for (const name of semanticColorNames) {
  const { light, dark } = semanticColors[name];
  const lightHex = oklchToHex(light);
  const darkHex = oklchToHex(dark);
  tokens.push({
    name: `${PREFIX}-color-${name}`,
    value: `light-dark(${lightHex}, ${darkHex})`,
    light: lightHex,
    dark: darkHex,
  });
}

// ---- ANSI terminal palette ---------------------------------------------
// Separate namespace (fc-color-ansi-*) because these are hue-fixed by protocol
// rather than meaning-based, and because a terminal has its own background that
// deliberately ignores the app theme.
for (const name of ansiColorNames) {
  const { light, dark } = ansiColors[name];
  // The `term-` prefix is not cosmetic. The ANSI set defines `bg`, `fg` and
  // `bg-raised`, all of which the app palette also defines; the unique-name guard
  // caught the collision rather than letting one silently overwrite the other.
  // A terminal background is genuinely a different thing from the app canvas, so
  // they must not share a name.
  tokens.push({
    name: `${PREFIX}-term-${name}`,
    value: `light-dark(${oklchToHex(light)}, ${oklchToHex(dark)})`,
    light: oklchToHex(light),
    dark: oklchToHex(dark),
  });
}

// ---- Syntax highlighting palette ----------------------------------------
// Separate namespace (`fc-code-*`) from both the app palette and the ANSI set.
// A code block follows the app theme, but its colors carry *syntactic meaning*
// rather than brand meaning, so they must not be remapped by a brand theme --
// and they must not collide with `fc-color-*` names, several of which
// (bg, fg, border-default) exist in both.
for (const name of syntaxColorNames) {
  const { light, dark } = syntaxColors[name];
  tokens.push({
    name: `${PREFIX}-code-${name}`,
    value: `light-dark(${oklchToHex(light)}, ${oklchToHex(dark)})`,
    light: oklchToHex(light),
    dark: oklchToHex(dark),
  });
}

// ---- Literal scales -----------------------------------------------------
addLiteralGroup("space", space);
addLiteralGroup("font-size", fontSize);
addLiteralGroup("line-height", lineHeight);
addLiteralGroup("font-weight", fontWeight);
addLiteralGroup("font-family", fontFamily);
addLiteralGroup("radius", borderRadius);
addLiteralGroup("border-width", borderWidth);
addLiteralGroup("duration", duration);
addLiteralGroup("easing", easing);
addLiteralGroup("z", zIndex);
addLiteralGroup("opacity", opacity);

// A handful of targets need paired numbers, which a flat scale cannot express.
tokens.push(
  { name: `${PREFIX}-size-target-min`, value: targetSize.min },
  { name: `${PREFIX}-size-target-comfortable`, value: targetSize.comfortable },
  { name: `${PREFIX}-size-content-max`, value: "75ch" },
  { name: `${PREFIX}-size-measure`, value: "65ch" },
  { name: `${PREFIX}-border-width-focus`, value: borderWidth.thick },
);

/** Duplicate-name detection: a silent overwrite here is very hard to spot downstream. */
function assertUniqueNames(list: readonly EmittedToken[]): void {
  const seen = new Set<string>();
  for (const token of list) {
    if (seen.has(token.name)) {
      throw new Error(`Duplicate token name emitted: ${token.name}`);
    }
    seen.add(token.name);
  }
}

const GENERATED_HEADER = `/*!
 * future-css design tokens -- GENERATED FILE, DO NOT EDIT.
 * Source: src/tokens (see README)
 * Regenerate: npm run build:tokens
 */`;

function renderTokenBlock(): string {
  const byGroup = new Map<string, EmittedToken[]>();
  for (const token of tokens) {
    // --fc-color-bg-canvas -> color
    const group = token.name.slice(PREFIX.length + 1).split("-")[0]!;
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(token);
    else byGroup.set(group, [token]);
  }

  const chunks: string[] = [];
  for (const [group, groupTokens] of [...byGroup].sort(([a], [b]) => a.localeCompare(b))) {
    chunks.push(`  /* ${group} */`);
    for (const token of groupTokens) {
      chunks.push(`  ${token.name}: ${token.value};`);
    }
    chunks.push("");
  }
  return chunks.join("\n").trimEnd();
}

function buildTokensCss(): string {
  return `${GENERATED_HEADER}
@layer fc.tokens {
  :root {
${renderTokenBlock()}
  }

  /*
   * Schemes. "light dark" tells the UA to pick based on the user's OS/browser
   * setting -- this is the default and requires no JavaScript. An author
   * override (a theme switcher in the UI) only ever changes these two
   * declarations; because every themed token is a light-dark() pair, that alone
   * re-themes the whole system.
   */
  :root {
    color-scheme: light dark;
  }

  [data-fc-theme="light"] {
    color-scheme: light;
  }

  [data-fc-theme="dark"] {
    color-scheme: dark;
  }

  /*
   * Forced colors (Windows High Contrast). The OS overrides component colors
   * here, so the tokens that matter are the focus ones: a focus ring drawn from
   * a suppressed token would disappear entirely.
   */
  @media (forced-colors: active) {
    :root {
      --fc-color-focus-ring: Highlight;
      --fc-color-focus-ring-offset: Canvas;
    }
  }
}
`;
}

async function main(): Promise<void> {
  assertUniqueNames(tokens);

  // All three contracts in one gate. The ANSI palette is the least accessible
  // surface in the system -- dense small text, its own background, hue-fixed
  // slots -- so it gets the same treatment as the app palette rather than an
  // exemption. The syntax palette joins them because every color it defines
  // carries syntactic meaning: an illegible keyword color is a bug you cannot
  // see, not merely an ugly one.
  const failures = [
    ...checkContrast(),
    ...checkAnsiContrast(),
    ...checkSyntaxContrast(),
  ];
  // Distinctness is a second contract, not a contrast variant: two identical
  // colors pass every contrast check against anything, which is how the diff
  // row backgrounds once collapsed. See issue #18.
  const indistinct = checkDistinct();
  if (failures.length > 0 || indistinct.length > 0) {
    console.error("Contrast contract violated:\n");
    for (const { pair, scheme, ratio } of failures) {
      console.error(`  [${scheme}] ${pair.usage}: ${ratio.toFixed(2)}:1 (needs ${pair.min}:1)`);
    }
    if (indistinct.length > 0) {
      console.error("\nDistinctness contract violated:\n");
      for (const { pair, scheme, delta } of indistinct) {
        console.error(`  [${scheme}] ${pair.usage}: OKLab distance ${delta.toFixed(4)} (needs ${pair.min})`);
      }
    }
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "tokens.css"), `${buildTokensCss()}\n`, "utf8");

  // A JSON payload for native platforms (Swift/Kotlin) and Figma, so token
  // drift between platforms is detectable by diffing this file.
  const json = Object.fromEntries(
    [...tokens]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => [t.name, t.light && t.dark ? { light: t.light, dark: t.dark } : t.value]),
  );
  await writeFile(resolve(outDir, "tokens.json"), `${JSON.stringify(json, null, 2)}\n`, "utf8");

  const themed = tokens.filter((t) => t.light).length;
  console.log(
    `tokens: emitted ${tokens.length} custom properties (${themed} theme-aware) -> dist/tokens.css`,
  );
}

await main();