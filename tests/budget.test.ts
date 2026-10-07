/**
 * Performance budget, measured on the built per-layer files.
 *
 * The budget holds the line on what one page pays, not on the full bundle:
 * consumers load layers + tokens + base plus only the components they render,
 * so the full bundle's size is reported here but never fails the check. See
 * the "Performance budget" section of docs/PLAN.md for why.
 *
 * Sizes are minified bytes, measured with the in-repo stripper so the check
 * adds no dependency. Skipped when `dist/` is absent, so `npm test` works
 * before a build.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { stripCss } from "../src/build/strip-css.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = join(root, "dist");
const hasDist = existsSync(join(dist, "future-css.css"));

const KB = 1024;
const BUDGET = {
  foundation: 16 * KB,
  component: 7 * KB,
  typicalPage: 40 * KB,
} as const;

const FOUNDATION = ["layers.css", "reset.css", "tokens.css", "base.css"];
// The chat page is the reference because it is the use case the library is
// built around; its three components are among the largest.
const TYPICAL_PAGE = [
  ...FOUNDATION,
  "layout.css",
  "utilities.css",
  "components/button.css",
  "components/chat.css",
  "components/composer.css",
];

const size = (file: string): number =>
  Buffer.byteLength(stripCss(readFileSync(join(dist, file), "utf8")));
const total = (files: readonly string[]): number =>
  files.reduce((sum, file) => sum + size(file), 0);
const kb = (bytes: number): string => `${(bytes / KB).toFixed(1)} KB`;

describe("stripCss", () => {
  it("removes comments, including /*! banners", () => {
    // A default minifier keeps /*! comments; the budget measures the CSS a
    // consumer's minifier could send without them.
    assert.equal(stripCss("/*! banner */a{color:red}/* note */"), "a{color:red}");
  });

  it("keeps the whitespace that changes meaning", () => {
    assert.equal(stripCss("a :hover { x: calc(1px + 2px) ; }"), "a :hover{x: calc(1px + 2px)}");
  });

  it("leaves strings intact", () => {
    assert.equal(stripCss('a{content:"  /* not a comment */  ;"}'), 'a{content:"  /* not a comment */  ;"}');
  });
});

describe("performance budget", { skip: hasDist ? false : "run `npm run build` first" }, () => {
  it(`keeps layers + reset + tokens + base under ${kb(BUDGET.foundation)}`, () => {
    const bytes = total(FOUNDATION);
    assert.ok(bytes < BUDGET.foundation, `foundation is ${kb(bytes)}`);
  });

  it(`keeps every component under ${kb(BUDGET.component)}`, () => {
    // Enumerate the sources, not dist/components: the build never clears dist,
    // so a removed or renamed component's stale output would still be measured.
    const over = readdirSync(join(root, "src", "css", "components"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => [file, size(join("components", file))] as const)
      .filter(([, bytes]) => bytes >= BUDGET.component)
      .map(([file, bytes]) => `${file} (${kb(bytes)})`);
    assert.deepEqual(over, [], `components over budget: ${over.join(", ")}`);
  });

  it(`keeps a typical chat page under ${kb(BUDGET.typicalPage)}`, () => {
    const bytes = total(TYPICAL_PAGE);
    assert.ok(bytes < BUDGET.typicalPage, `typical page is ${kb(bytes)}`);
  });

  it("reports the full bundle without gating on it", (t) => {
    const minified = stripCss(readFileSync(join(dist, "future-css.css"), "utf8"));
    t.diagnostic(
      `full bundle: ${kb(Buffer.byteLength(minified))} minified, ` +
        `${kb(gzipSync(minified).length)} minified + gzip`,
    );
  });
});
