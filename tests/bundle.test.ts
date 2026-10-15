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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("declares color-scheme only in the tokens layer", () => {
    // `color-scheme` decides how every `light-dark()` pair resolves, so a stray
    // declaration in a later layer silently overrides the theme switcher.
    //
    // It was in `fc.base` while `[data-fc-theme]` lives in `fc.tokens`. Equal
    // specificity, and base is ordered after tokens -- so `light dark` always won
    // and `data-fc-theme="light"` computed to `light dark` and did nothing. The
    // switcher looked wired up, responded to clicks, and changed no colour.
    //
    // This asserts on the layer each declaration lives in, because a plain
    // "does the bundle mention color-scheme" check would pass either way.
    const layerOf = (index: number): string => {
      const before = css.slice(0, index);
      const open = [...before.matchAll(/@layer\s+([\w.]+)\s*\{/g)];
      return open.length ? open[open.length - 1]![1]! : "(unlayered)";
    };

    const declarations = [...css.matchAll(/color-scheme\s*:/g)];
    assert.ok(declarations.length > 0, "the bundle should declare color-scheme somewhere");

    for (const match of declarations) {
      const layer = layerOf(match.index!);
      assert.equal(
        layer,
        "fc.tokens",
        `color-scheme is declared in ${layer}; only fc.tokens may own it, ` +
          `or a consumer's data-fc-theme override will be silently ignored`,
      );
    }
  });

  it("exposes a theme override hook that can actually win", () => {
    // The hook has to out-specify the default, or it is decoration. `html` plus an
    // attribute selector beats a bare `:root`, which is why the selector is
    // written this way rather than as a custom property.
    assert.match(css, /\[data-fc-theme="light"\]/);
    assert.match(css, /\[data-fc-theme="dark"\]/);
  });

  it("never wraps a whole shadow in light-dark()", () => {
    // light-dark() accepts colours only. A shadow wrapped in it is invalid at
    // computed time, so every box-shadow reading the token rendered as no shadow
    // at all -- with no error, because an invalid custom property is not a parse
    // failure. The browser suite checks the computed result; this catches the
    // emitted form without a browser.
    const shadows = [...css.matchAll(/^\s*(--fc-shadow-[\w-]+):\s*([^;]+);/gm)];
    assert.ok(shadows.length >= 3, "expected the raised, overlay and modal shadows");
    for (const [, name, value] of shadows) {
      assert.doesNotMatch(value!, /^light-dark\(/, `${name} wraps a whole shadow in light-dark()`);
    }
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
      "fc-field",
      "fc-input",
      "fc-check",
      "fc-switch",
      "fc-card",
      "fc-badge",
      "fc-tag",
      "fc-alert",
      "fc-dialog",
      "fc-popover",
      "fc-tooltip",
      "fc-toast",
      "fc-tabs",
      "fc-breadcrumb",
      "fc-pagination",
      "fc-spinner",
      "fc-shimmer-text",
      "fc-agent-status",
      "fc-skeleton",
      "fc-progress",
      "fc-avatar",
      "fc-empty",
      "fc-disclosure",
      "fc-reasoning",
      "fc-cite",
      "fc-sources",
      "fc-suggestion",
      "fc-table",
      "fc-table-wrap",
      "fc-dl",
      "fc-nav",
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
/*
 * The fixture page is only a test if it keeps up: a component added without a
 * fixture is a component nobody has looked at in RTL, dark, or at 320px. The
 * browser suite checks what the page draws; this checks nothing is missing
 * from it, and needs no build or browser.
 */
describe("fixture page", () => {
  it("keeps fixture IDs unique so ARIA references are unambiguous", () => {
    const page = readFileSync(join(projectRoot, "demo", "fixtures.html"), "utf8");
    // Double-quoted, single-quoted and unquoted values are all valid HTML.
    const ids = [...page.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    const seen = new Set<string>();
    const duplicates = ids.filter((id) => {
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    });
    assert.deepEqual(duplicates, [], "IDs must be unique across the complete fixture document");
  });

  it("has a fixture for every component", () => {
    const page = readFileSync(join(projectRoot, "demo", "fixtures.html"), "utf8");
    const fixtures = new Set([...page.matchAll(/data-fixture="([^"]+)"/g)].map((m) => m[1]));
    const missing = readdirSync(join(projectRoot, "src", "css", "components"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => file.slice(0, -".css".length))
      .filter((name) => !fixtures.has(name));
    assert.deepEqual(missing, [], "add a [data-fixture] section to demo/fixtures.html");
  });
});
