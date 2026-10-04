/**
 * Bundle integrity tests.
 *
 * These check the *assembled* output, not the sources. That distinction matters:
 * the bundle was previously missing the entire token layer, so every
 * `var(--fc-color-*)` reference resolved to nothing and the stylesheet rendered
 * unstyled. Nothing failed. The linter passed (it reads sources), the token tests
 * passed (they read tokens.css), and the contrast contract passed (it validates
 * values that were never in the bundle at all).
 *
 * An unresolved custom property is valid CSS, so no amount of source-level
 * testing catches this class of bug. Only inspecting the artifact does.
 *
 * Skipped when `dist/` is absent, so `npm test` works before a build.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const bundlePath = join(projectRoot, "dist", "future-css.css");
const hasBundle = existsSync(bundlePath);

const css = hasBundle ? readFileSync(bundlePath, "utf8") : "";

describe("bundle", { skip: hasBundle ? false : "run `npm run build` first" }, () => {
  it("contains the token layer", () => {
    // The defect: tokens.css is generated, so it is not in BUNDLE_ORDER and was
    // silently excluded.
    assert.match(css, /@layer fc\.tokens\s*\{/);
  });

  it("defines tokens, not merely references them", () => {
    // Counting occurrences of the name is not enough -- every component
    // *references* these tokens. The definition form is what must be present.
    for (const token of [
      "--fc-color-bg-canvas",
      "--fc-color-text-default",
      "--fc-color-accent-bg",
      "--fc-color-focus-ring",
      "--fc-space-4",
      "--fc-size-target-min",
      // The ANSI palette uses its own namespace: a terminal background is not
      // the app canvas, and the duplicate-name guard rejects sharing a name.
      "--fc-term-bg",
      "--fc-term-fg",
      "--fc-term-ansi-red",
      "--fc-term-cursor",
    ]) {
      assert.match(
        css,
        new RegExp(`^\\s*${token}:`, "m"),
        `bundle is missing the definition of ${token}`,
      );
    }
  });

  it("declares the layer order before any layer content", () => {
    const order = css.indexOf("@layer fc.reset, fc.tokens");
    const firstBlock = css.search(/@layer fc\.[a-z]+\s*\{/);
    assert.ok(order !== -1, "the layer-order statement is missing");
    assert.ok(
      order < firstBlock,
      "layer order must be declared before any @layer block, or the first " +
        "layer's precedence is fixed by source order instead of intent",
    );
  });

  it("parses as CSS without a dropped rule", () => {
    // A malformed construct (an unterminated comment, a stray token) makes the
    // parser discard everything after it, which is how the token layer vanished.
    // Balanced braces and no stray comment terminators are a cheap proxy.
    const opens = (css.match(/\{/g) ?? []).length;
    const closes = (css.match(/\}/g) ?? []).length;
    assert.equal(opens, closes, "unbalanced braces suggest a parse failure");

    // Every layer block should be closed.
    const layerBlocks = (css.match(/@layer fc\.[a-z]+ \{/g) ?? []).length;
    assert.ok(layerBlocks >= 6, `expected several layer blocks, saw ${layerBlocks}`);
  });

  it("inlines no stray text from the generated banner", () => {
    // The banner contained `src/tokens/**/*.ts`, and the `**/` inside it closed
    // the comment-stripping pattern early, leaving a literal `*.ts` at the top of
    // the bundle and breaking the parse of everything after it.
    assert.doesNotMatch(css, /^\*\.ts/m);
  });

  it("includes every registered component", () => {
    // Class names, not filenames: the button block is `.fc-btn` and the tool
    // call block is `.fc-tool`. Asserting on filenames would pass while the
    // component was absent, which is the failure this test exists to prevent.
    const blocks = [
      "fc-btn",
      "fc-chat",
      "fc-msg",
      "fc-tool",
      "fc-editor",
      "fc-toolbar",
      "fc-menu",
      "fc-grid",
      "fc-webview",
      "fc-terminal",
    ];
    for (const block of blocks) {
      assert.match(
        css,
        new RegExp(`\\.${block}(?![\\w-])`),
        `bundle is missing the ${block} block`,
      );
    }
  });
});