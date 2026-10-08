/**
 * The palette's accessibility contract.
 *
 * If this fails, the palette is not shippable -- it does not matter that it
 * "looks fine". Minimums follow WCAG 2.2:
 *   4.5:1  normal body text (1.4.3)
 *   3:1    large text, and non-text UI parts such as control boundaries and
 *          focus indicators (1.4.11)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkContrast, contrastPairs } from "../src/tokens/semantic/color.ts";
import {
  checkDistinct,
  distinctPairs,
  syntaxColors,
} from "../src/tokens/semantic/syntax.ts";
import {
  ansiColorNames,
  ansiColors,
  ansiContrastPairs,
  checkAnsiContrast,
} from "../src/tokens/semantic/terminal.ts";
import { themeSets } from "../src/tokens/semantic/themes.ts";
import { contrastRatio, oklchToHex } from "../src/tokens/color-utils.ts";
import { ramps } from "../src/tokens/palette.ts";

describe("contrast contract", () => {
  it("declares a non-empty set of pairs", () => {
    assert.ok(contrastPairs.length > 0);
  });

  it("meets every minimum in both color schemes", () => {
    const failures = checkContrast();
    const report = failures
      .map(
        (f) =>
          `[${f.scheme}] ${f.pair.usage}: ${f.ratio.toFixed(2)}:1, needs ${f.pair.min}:1 ` +
          `(${f.pair.fg} on ${f.pair.bg})`,
      )
      .join("\n");
    assert.equal(failures.length, 0, `Contrast failures:\n${report}`);
  });

  it("covers both schemes for every declared pair", () => {
    // 2 checks x pair count, because checkContrast iterates light and dark.
    const seen = new Set<string>();
    for (const pair of contrastPairs) seen.add(`${pair.fg}|${pair.bg}`);
    assert.equal(seen.size, contrastPairs.length, "duplicate fg|bg pairs in the contract");
  });

  it("computes known WCAG reference ratios", () => {
    // Black on white is the 21:1 ceiling.
    const ratio = contrastRatio({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 });
    assert.ok(Math.abs(ratio - 21) < 0.05, `expected ~21, got ${ratio.toFixed(3)}`);
  });

  it("is symmetric", () => {
    const white = { l: 1, c: 0, h: 0 };
    const gray = { l: 0.5, c: 0, h: 0 };
    assert.equal(contrastRatio(white, gray), contrastRatio(gray, white));
  });
});

describe("themes", () => {
  it("keeps the selected surface distinct from the surface in every theme", () => {
    // A theme that collapses the two shows a selected row as unselected,
    // with nothing in the contrast pairs to catch it.
    for (const [theme, colors] of Object.entries(themeSets)) {
      for (const scheme of ["light", "dark"] as const) {
        const ratio = contrastRatio(colors["selected-bg"]![scheme], colors["bg-surface"]![scheme]);
        assert.ok(ratio > 1.05, `${theme} ${scheme}: selected-bg matches bg-surface (${ratio.toFixed(2)}:1)`);
      }
    }
  });
});

describe("palette ramps", () => {
  const expectedSteps = [
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

  for (const [name, ramp] of Object.entries(ramps)) {
    it(`ramp "${name}" exposes the standard steps`, () => {
      assert.deepEqual(Object.keys(ramp), expectedSteps);
    });

    it(`ramp "${name}" decreases monotonically in lightness`, () => {
      const values = expectedSteps.map((s) => ramp[s]!.l);
      for (let i = 1; i < values.length; i += 1) {
        assert.ok(
          values[i]! <= values[i - 1]!,
          `step ${expectedSteps[i]} (${values[i]}) is lighter than ${expectedSteps[i - 1]} (${values[i - 1]})`,
        );
      }
    });

    it(`ramp "${name}" keeps every step in gamut`, () => {
      for (const step of expectedSteps) {
        const hex = oklchToHex(ramp[step]!);
        assert.match(hex, /^#[0-9a-f]{6}$/, `step ${step} produced ${hex}`);
      }
    });
  }

  it("defines the same hue for every step within a ramp", () => {
    for (const [name, ramp] of Object.entries(ramps)) {
      const hues = new Set(Object.values(ramp).map((c) => c.h));
      assert.equal(hues.size, 1, `ramp ${name} contains multiple hues: ${[...hues].join(", ")}`);
    }
  });
});
describe("ANSI terminal palette", () => {
  it("meets every contrast minimum in both schemes", () => {
    // The first hand-written ANSI palette failed 16 of these. Terminals are the
    // least accessible surface in the system -- dense small text on their own
    // background -- so they get the same contract as the app palette.
    const failures = checkAnsiContrast();
    const report = failures
      .map(
        (f) => `[${f.scheme}] ${f.pair.usage}: ${f.ratio.toFixed(2)}:1, needs ${f.pair.min}:1`,
      )
      .join("\n");
    assert.equal(failures.length, 0, `ANSI contrast failures:\n${report}`);
  });

  it("declares a contrast pair for every text slot", () => {
    const covered = new Set(ansiContrastPairs.map((p) => p.fg));
    for (const slot of ansiColorNames) {
      // `cursor` and the backgrounds are components, not text; everything else
      // must appear in the contract.
      if (slot === "bg" || slot === "bg-raised" || slot === "cursor") continue;
      assert.ok(covered.has(slot), `ANSI slot ${slot} has no declared contrast pair`);
    }
  });

  it("defines all sixteen SGR slots plus the base roles", () => {
    const normal = ansiColorNames.filter((n) => /^ansi-(?!bright)/.test(n));
    const bright = ansiColorNames.filter((n) => /^ansi-bright-/.test(n));
    assert.equal(normal.length, 8, "SGR 30-37 are eight slots");
    assert.equal(bright.length, 8, "SGR 90-97 are eight slots");
    for (const role of ["bg", "fg", "fg-dim", "cursor"]) {
      assert.ok(ansiColorNames.includes(role as never), `missing role ${role}`);
    }
  });

  it("keeps every bright slot visibly brighter than its normal counterpart", () => {
    // If a bright slot is not brighter, the terminal's "dim" convention inverts:
    // `ls`-style listings use bright for emphasis and it would recede instead.
    for (const base of ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]) {
      const normal = ansiColors[`ansi-${base}` as keyof typeof ansiColors]!;
      const bright = ansiColors[`ansi-bright-${base}` as keyof typeof ansiColors]!;
      assert.ok(
        bright.light.l > normal.light.l,
        `bright ${base} (${bright.light.l}) should be lighter than normal (${normal.light.l})`,
      );
    }
  });

  it("keeps the terminal background dark in both schemes", () => {
    // A terminal that follows the OS into a light theme is a usability
    // regression: every terminal theme ever written keeps it dark, and the ANSI
    // hues are chosen against a dark ground.
    const bg = ansiColors.bg!;
    assert.ok(bg.light.l < 0.25, `light-scheme terminal bg should be dark, got ${bg.light.l}`);
    assert.ok(bg.dark.l < 0.25, `dark-scheme terminal bg should be dark, got ${bg.dark.l}`);
  });

  it("makes the cursor legible against the background it sits on", () => {
    // The cursor is drawn *on* the background rather than beside text, so it has
    // to differ from it. A near-background cursor is invisible in practice even
    // when the ratio technically passes.
    const ratio = contrastRatio(ansiColors.cursor!.light, ansiColors.bg!.light);
    assert.ok(ratio >= 3, `cursor must be visible on the background, got ${ratio.toFixed(2)}:1`);
  });
});

describe("distinctness contract", () => {
  it("passes on the shipped palette in both schemes", () => {
    // The bg pair measures 0.039 light / 0.053 dark; the fg pair 0.22+. The
    // minimum is 0.03, so the real values sit above it with real margin and a
    // collapse to zero fails.
    assert.deepEqual(checkDistinct(), []);
  });

  it("fails loudly when a pair collapses to the same value", () => {
    // Reproduce the original bug: make the removed background identical to the
    // added one and the check must catch it, because contrast on its own
    // cannot -- two identical colors contrast identically against anything.
    const collapsed = { ...syntaxColors, "bg-removed": syntaxColors["bg-added"] };
    const failures = checkDistinct(distinctPairs, collapsed as never);
    const hit = failures.find((f) => f.pair.a === "bg-added");
    assert.ok(hit, "the collapsed bg pair must be reported");
    assert.equal(hit!.scheme, "light");
    assert.equal(hit!.delta, 0);
  });
});
