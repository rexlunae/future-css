/**
 * Component slots and type roles: the two extension points docs/TOKENS.md
 * documents that the contrast contract cannot see.
 *
 * A slot is read as `var(--fc-<slot>, <semantic fallback>)`. If a refactor
 * drops the outer `var()`, the component still renders correctly -- it just
 * stops honouring the consumer's override, and nothing else notices. The same
 * is true of a type role whose class or token goes missing: headings fall back
 * to inherited type and still look plausible. Both are silent, so both are
 * pinned here (coverage entries 3 and 15 in docs/SEMANTIC-COVERAGE.md).
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { typeRoles } from "../src/tokens/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const cssDir = join(root, "src", "css");
// Comments are stripped so a slot named in prose cannot stand in for one read in code.
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (path: string) => stripComments(readFileSync(join(cssDir, path), "utf8"));

/**
 * The slot table from docs/TOKENS.md ("Component slots"), with the semantic
 * token each one must fall back to. Colour fallbacks are `--fc-color-*`, so the
 * default stays inside the contrast contract; an override leaves it, which is
 * what TOKENS.md tells the consumer.
 */
const SLOTS: Record<string, Record<string, string>> = {
  "components/card.css": {"card-bg":"color-bg-surface"},
  "components/masthead.css": {"masthead-bg":"color-bg-surface","masthead-fg":"color-text-default","masthead-muted":"color-text-muted","masthead-disabled-fg":"color-disabled-fg","masthead-focus":"color-focus-ring"},
  "components/button.css": {
    "btn-primary-bg": "color-accent-bg",
    "btn-primary-bg-hover": "color-accent-bg-hover",
    "btn-primary-bg-active": "color-accent-bg-active",
    "btn-primary-fg": "color-text-on-accent",
    "btn-primary-border": "color-accent-border",
  },
  "components/chat.css": {
    "chat-bg": "color-bg-canvas",
    "chat-fg": "color-text-default",
    "chat-gap": "space-4",
    "chat-message-measure": "size-measure",
  },
  "components/composer.css": {
    "composer-bg": "color-bg-surface",
    "composer-fg": "color-text-default",
    "composer-radius": "radius-2xl",
  },
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A read of `slot` whose fallback is exactly `fallback`, not a longer name sharing its prefix. */
const slotPattern = (slot: string, fallback: string, flags = "") =>
  new RegExp(`var\\(--fc-${escape(slot)},\\s*var\\(--fc-${escape(fallback)}\\s*[,)]`, flags);

const allCss = (dir: string): string =>
  readdirSync(dir, { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory() ? allCss(join(dir, entry.name)) : entry.name.endsWith(".css") ? stripComments(readFileSync(join(dir, entry.name), "utf8")) : "",
    )
    .join("\n");

describe("component slots", () => {
  for (const [file, slots] of Object.entries(SLOTS)) {
    const css = read(file);
    for (const [slot, fallback] of Object.entries(slots)) {
      it(`${file} reads --fc-${slot} over --fc-${fallback} everywhere`, () => {
        // Every read, not just one: a slot honoured in the rest state but
        // dropped from :hover is still a broken override.
        const reads = css.match(new RegExp(`var\\(--fc-${escape(slot)}[,)]`, "g")) ?? [];
        const withFallback = css.match(slotPattern(slot, fallback, "g")) ?? [];
        assert.ok(reads.length > 0, `--fc-${slot} is never read`);
        assert.equal(withFallback.length, reads.length, `a read of --fc-${slot} lacks the --fc-${fallback} fallback`);
      });
    }
  }

  it("never sets a documented slot inside the library", () => {
    // A slot the library assigns is no longer the consumer's: their value
    // would lose to whichever rule sets it, depending on layer order.
    const css = allCss(cssDir);
    for (const slot of Object.values(SLOTS).flatMap(Object.keys)) {
      assert.doesNotMatch(css, new RegExp(`--fc-${escape(slot)}\\s*:`), `--fc-${slot} is set in src/css`);
    }
  });

  it("rejects a missing, misspelled or commented-out fallback", () => {
    const pattern = slotPattern("chat-bg", "color-bg-canvas");
    assert.match("background-color: var(--fc-chat-bg, var(--fc-color-bg-canvas));", pattern);
    assert.doesNotMatch("background-color: var(--fc-chat-bg);", pattern);
    assert.doesNotMatch("background-color: var(--fc-color-bg-canvas);", pattern);
    assert.doesNotMatch("background-color: var(--fc-chat-bg, var(--fc-color-bg-canvas-typo));", pattern);
    assert.doesNotMatch(stripComments("/* var(--fc-chat-bg, var(--fc-color-bg-canvas)) */"), pattern);
  });
});

/** The role vocabulary docs/TOKENS.md promises consumers. */
const DOCUMENTED_ROLES = [
  "body", "body-small", "title",
  "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6",
  "code", "label",
];

describe("type roles", () => {
  const roles = Object.keys(typeRoles);
  const typeCss = read("type.css");

  it("defines exactly the documented roles", () => {
    // Pinned separately from typeRoles: deriving both sides from the token map
    // would let a role vanish from tokens, classes and test at once.
    assert.deepEqual([...roles].sort(), [...DOCUMENTED_ROLES].sort());
  });

  it("gives every role a class that applies its font and tracking", () => {
    for (const role of roles) {
      const rule = typeCss.match(new RegExp(`\\.fc-type-${escape(role)}\\s*\\{([^}]*)\\}`));
      assert.ok(rule, `.fc-type-${role} is missing from type.css`);
      assert.match(rule[1]!, new RegExp(`font:\\s*var\\(--fc-type-${escape(role)}\\)`));
      assert.match(rule[1]!, new RegExp(`letter-spacing:\\s*var\\(--fc-type-${escape(role)}-tracking\\)`));
    }
  });

  it("has no class for a role the tokens do not define", () => {
    const classes = [...typeCss.matchAll(/\.fc-type-([a-z0-9-]+)\s*\{/g)].map((m) => m[1]);
    assert.deepEqual(classes.sort(), [...roles].sort());
  });

  it("drives body and heading type in base.css", () => {
    // Base reading the roles is what lets one token change a whole app's ramp.
    const base = read("base.css");
    for (const role of ["body", "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6"]) {
      assert.match(base, new RegExp(`font:\\s*var\\(--fc-type-${role}\\)`), `base.css does not read --fc-type-${role}`);
    }
  });

  const tokensPath = join(root, "dist", "tokens.css");
  it("defines every role and its tracking in tokens.css", { skip: existsSync(tokensPath) ? false : "run `npm run build` first" }, () => {
    const tokens = readFileSync(tokensPath, "utf8");
    for (const role of roles) {
      assert.match(tokens, new RegExp(`--fc-type-${escape(role)}:`), `--fc-type-${role} is not defined`);
      assert.match(tokens, new RegExp(`--fc-type-${escape(role)}-tracking:`), `--fc-type-${role}-tracking is not defined`);
    }
  });
});
