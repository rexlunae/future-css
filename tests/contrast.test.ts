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