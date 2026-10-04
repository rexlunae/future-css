/**
 * CSS architecture linter tests.
 *
 * A linter with no tests is a linter that silently stops working. Each case
 * below pairs a violation that MUST be caught with a legitimate pattern that
 * MUST NOT be, because the second kind of bug -- a linter that cries wolf --
 * is what gets a lint rule quietly deleted.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
// The fixture lives inside src/css because that is the only directory the
// linter walks. The name is unique to this test file so a concurrent run cannot
// observe a half-written fixture: node:test executes files in parallel, and
// both the write and the linter invocation are asynchronous.
const fixtureDir = join(projectRoot, "src", "css", "__linttest_lint__");

/**
 * Serialises the write-then-lint sequence.
 *
 * Two overlapping runs would otherwise race: one test's fixture could replace
 * another's mid-lint, producing failures that depend on scheduling rather than
 * on behaviour. Declared before `lint` so the helper can reference it.
 */
let queue = Promise.resolve();

/**
 * Run the linter and return the rules it reported **for the fixture only**.
 *
 * The linter always walks the entire src/css tree, so its raw output also
 * contains findings from the real source files. Asserting against that raw list
 * couples these tests to the sources: any legitimate finding elsewhere would
 * fail unrelated assertions, and the result would depend on which files happened
 * to be clean at the time.
 *
 * Filtering to the fixture's own findings makes each assertion depend only on the
 * fixture, which is what these tests are actually about.
 */
async function lint(css, layer = "fc.components") {
  const run = queue.then(async () => {
    await writeFile(
      join(fixtureDir, "fixture.css"),
      `@layer ${layer} {\n${css}\n}\n`,
      "utf8",
    );
    let out = "";
    try {
      const { stdout } = await execFileAsync(
        "node",
        [join(projectRoot, "tools", "lint-css.mjs")],
        {
          cwd: projectRoot,
        },
      );
      out = stdout;
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    // Findings are printed as "  <path>:<line>" followed by "    [rule] ...".
    // Keep only the block whose path is this run's fixture.
    const fixtureBase = resolve(join(fixtureDir, "fixture.css"));
    const rules = [];
    let inFixture = false;
    for (const line of out.split("\n")) {
      const header = line.match(/^\s{2}(\S+):(\d+)\s*$/);
      if (header) {
        inFixture = resolve(header[1]) === fixtureBase;
        continue;
      }
      const rule = line.match(/\[([a-z-]+)\]/);
      if (rule && inFixture) rules.push(rule[1]);
    }
    return rules;
  });
  queue = run.catch(() => undefined);
  return run;
}

before(async () => {
  await mkdir(fixtureDir, { recursive: true });
});


after(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
  await rm(await mkdtemp(join(tmpdir(), "fc-lint-")), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
});

describe("linter detects violations", () => {
  const cases = [
    ["physical margin", "  .a { margin-left: 1rem; }", "logical-properties"],
    ["physical padding", "  .a { padding-right: 2rem; }", "logical-properties"],
    [
      "physical border radius",
      "  .a { border-top-left-radius: 0.25rem; }",
      "logical-properties",
    ],
    ["physical offset", "  .a { left: 0; }", "logical-properties"],
    ["text-align: left", "  .a { text-align: left; }", "logical-values"],
    ["colour literal hex", "  .a { color: #ff0000; }", "no-color-literals"],
    [
      "colour literal rgb",
      "  .a { background-color: rgb(0,0,0); }",
      "no-color-literals",
    ],
    [
      "colour literal named",
      "  .a { border-color: red; }",
      "no-color-literals",
    ],
    ["px spacing", "  .a { padding: 12px; }", "no-px"],
    [
      "important inside a component",
      "  .a { color: var(--x) !important; }",
      "no-important",
    ],
    [
      "outline removed while focused",
      "  .a:focus-visible { outline: none; }",
      "preserve-focus",
    ],
    [
      "outline removed on hover",
      "  .a:hover { outline: none; }",
      "preserve-focus",
    ],
    ["transition all", "  .a { transition: all 1s; }", "no-transition-all"],
    ["raw z-index", "  .a { z-index: 9999; }", "z-index-scale"],
    ["id selector", "  #app { color: var(--x); }", "no-id-selectors"],
    [
      "over-qualified selector",
      "  .a.b { color: var(--x); }",
      "no-over-qualified",
    ],
  ] as const;

  for (const [name, css, rule] of cases) {
    it(`catches ${name}`, async () => {
      const rules = await lint(css);
      assert.ok(
        rules.includes(rule),
        `expected "${rule}" for ${css.trim()}, got: ${rules.join(", ") || "none"}`,
      );
    });
  }
});

describe("linter permits legitimate patterns", () => {
  const cases: ReadonlyArray<readonly [string, string, string?]> = [
    [
      "logical properties",
      "  .a { margin-inline-start: 1rem; padding-block: 2rem; }",
    ],
    ["text-align: start", "  .a { text-align: start; }"],
    ["text-align: center", "  .a { text-align: center; }"],
    ["token colours only", "  .a { color: var(--fc-color-text-default); }"],
    ["rem units", "  .a { padding: 0.75rem; }"],
    [
      "outline removed only for non-keyboard focus",
      "  .b:focus:not(:focus-visible) { outline: none; }",
    ],
    [
      "utilities may use display:none !important",
      "  .fc-u-hidden { display: none !important; }",
      "fc.utilities",
    ],
    [
      "reduced-motion block",
      `  @media (prefers-reduced-motion: reduce) {
    .a { transition-duration: 0.01ms !important; }
  }`,
    ],
    [
      "explicit transition list",
      "  .a { transition: color 1s, background 1s; }",
    ],
    ["token z-index", "  .a { z-index: var(--fc-z-modal); }"],
    [
      "attribute selector",
      "  .a[data-state='open'] { color: var(--fc-color-text-default); }",
    ],
    ["single-class selectors", "  .a { color: var(--fc-color-text-default); }"],
  ];

  for (const [name, css, layer = "fc.components"] of cases) {
    it(`allows ${name}`, async () => {
      const rules = await lint(css, layer);
      assert.deepEqual(
        rules,
        [],
        `expected no violations for ${name}, got: ${rules.join(", ")}`,
      );
    });
  }
});

describe("linter ignores comments", () => {
  it("does not flag property names mentioned in prose", async () => {
    const rules = await lint(`  /*
   * Discussion of margin-left, #ff0000 and transition: all is documentation,
   * not a declaration, and must not be reported.
   */
  .a { color: var(--fc-color-text-default); }`);
    assert.deepEqual(rules, []);
  });
});

describe("linter handles multi-line and inline rules alike", () => {
  it("treats an inline rule the same as an expanded one", async () => {
    const [inline, expanded] = await Promise.all([
      lint("  .a { margin-left: 1rem; }"),
      lint("  .a {\n    margin-left: 1rem;\n  }"),
    ]);
    assert.deepEqual(inline, expanded);
    assert.ok(inline.includes("logical-properties"));
  });
});

/**
 * These two rules are file-scoped rather than line-scoped: they need to know
 * whether the file as a whole addressed reduced motion and forced colors. That
 * makes them easier to get wrong, so each gets explicit coverage.
 */
describe("linter file-scoped motion rules", () => {
  it("flags keyframes with no reduced-motion consideration", async () => {
    const rules = await lint(`  .a { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(1turn); } }`);
    assert.ok(rules.includes("reduced-motion"), `got: ${rules.join(", ")}`);
  });

  it("flags keyframes with no forced-colors block", async () => {
    const rules = await lint(`  @media (prefers-reduced-motion: reduce) {
    .a { animation: none; }
  }
  @keyframes spin { to { transform: rotate(1turn); } }`);
    assert.ok(rules.includes("forced-colors"), `got: ${rules.join(", ")}`);
  });

  it("allows a file that addresses both", async () => {
    const rules = await lint(`  @media (prefers-reduced-motion: reduce) {
    .a { animation: none; }
  }
  @media (forced-colors: active) {
    .a { background-color: Canvas; }
  }
  @keyframes spin { to { transform: rotate(1turn); } }`);
    assert.deepEqual(rules, []);
  });

  it("does not fire on a file with no keyframes", async () => {
    const rules = await lint("  .a { color: var(--fc-color-text-default); }");
    assert.deepEqual(rules, []);
  });
});
