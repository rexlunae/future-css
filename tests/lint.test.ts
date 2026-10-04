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
    // The linter walks the whole fixture directory, so a second file left behind
    // by the collision suite would be linted too and could report a finding
    // against this run's fixture. Both helpers therefore own both filenames.
    await rm(join(fixtureDir, "fixture2.css"), { force: true });
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
      // `no-class-collision` is filtered out here on purpose. This helper writes
      // exactly one file, so the rule can only fire because the fixture reuses a
      // class name from the real source -- which most of these tests do
      // deliberately, `.fc-btn` and `.fc-u-hidden` among them, to exercise
      // exemptions. Asserting on it here would make every case below a test of
      // naming hygiene rather than of the rule it is about. The collision rule has
      // its own suite below, with a helper that writes the two files it needs.
      if (rule && inFixture && rule[1] !== "no-class-collision") rules.push(rule[1]);
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

describe("colour-literal rule does not flag token names", () => {
  // Regression. The ANSI palette's token names contain colour words
  // (`--fc-term-ansi-red`), so a rule that scanned the whole line flagged all
  // sixteen as literals. The fix strips var() references before scanning; this
  // pins it, because a linter that cries wolf about the system's own token names
  // gets disabled.
  it("allows a token whose name contains a colour word", async () => {
    const rules = await lint(
      "  .fc-term-ansi-red { color: var(--fc-term-ansi-red); }\n" +
        "  .fc-term-ansi-bright-magenta { color: var(--fc-term-ansi-bright-magenta); }",
    );
    assert.deepEqual(rules, []);
  });

  it("still catches a real literal alongside a token reference", async () => {
    const rules = await lint("  .a { color: var(--fc-term-fg) #ff0000; }");
    assert.ok(rules.includes("no-color-literals"));
  });

  it("still catches a bare named colour", async () => {
    const rules = await lint("  .a { color: red; }");
    assert.ok(rules.includes("no-color-literals"));
  });

  it("still catches a hex literal", async () => {
    const rules = await lint("  .a { background-color: #ff0000; }");
    assert.ok(rules.includes("no-color-literals"));
  });

  it("ignores a colour word that appears only in a selector", async () => {
    const rules = await lint("  .fc-danger { color: var(--fc-color-danger-text); }");
    assert.deepEqual(rules, []);
  });
});

/**
 * Cross-file class collisions.
 *
 * The single-file `lint` helper cannot express this rule: it needs the same class
 * declared in two *different* files, which is the whole point. So this suite
 * writes its own pair of fixtures and reads the rules reported for the first.
 *
 * The rule exists because `.fc-grid` was an auto-fit layout primitive in
 * fc.layout and the data grid in fc.components at the same time. Cascade layers
 * resolved it silently, so the data grid inherited `grid-template-columns` and
 * rendered four columns of data as two. Every rule involved was individually
 * correct, which is why review missed it.
 */
describe("lint: no-class-collision", () => {
  /** Writes two files into the fixture dir and returns the rules reported for the first. */
  async function lintPair(first, second) {
    const run = queue.then(async () => {
      await writeFile(
        join(fixtureDir, "fixture.css"),
        `@layer fc.components {\n${first}\n}\n`,
        "utf8",
      );
      await writeFile(
        join(fixtureDir, "fixture2.css"),
        `@layer fc.layout {\n${second}\n}\n`,
        "utf8",
      );

      let out = "";
      try {
        const { stdout } = await execFileAsync(
          "node",
          [join(projectRoot, "tools", "lint-css.mjs")],
          { cwd: projectRoot },
        );
        out = stdout;
      } catch (err) {
        out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      }

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

  it("catches one class declared in two files", async () => {
    const rules = await lintPair(
      "  .fc-thing { color: var(--fc-color-text-default); }",
      "  .fc-thing { display: grid; }",
    );
    assert.ok(
      rules.includes("no-class-collision"),
      `expected no-class-collision, got ${JSON.stringify(rules)}`,
    );
  });

  it("does not flag distinct classes across two files", async () => {
    const rules = await lintPair(
      "  .fc-alpha { color: var(--fc-color-text-default); }",
      "  .fc-beta { display: grid; }",
    );
    assert.deepEqual(rules, [], "unrelated classes in separate files are normal");
  });

  it("allows one class restyled across states in a single file", async () => {
    // The false positive that matters most: a component legitimately styles the
    // same class in its rest, hover, and forced-colors branches. Flagging that
    // would make the rule unusable on day one.
    //
    // Pairs the repeated class in file one against an unrelated class in file
    // two, so the only way this can fire is if repeats within a file count.
    const rules = await lintPair(
      `  .fc-flip { color: var(--fc-color-text-default); }
  .fc-flip:hover { color: var(--fc-color-text-muted); }
  @media (forced-colors: active) { .fc-flip { color: ButtonText; } }`,
      "  .fc-unrelated { display: grid; }",
    );
    assert.deepEqual(rules, [], "repeats within one file are not collisions");
  });

  it("ignores an element a component styles inside a prose block", async () => {
    // `.fc-doc :is(code)` references code without claiming the name `code`. Only a
    // selector whose *subject* is the class claims ownership. The names here are
    // deliberately unlike anything in the real source, so this asserts the rule's
    // behaviour rather than tripping over a genuine collision elsewhere.
    const rules = await lintPair(
      "  .fc-doc :is(code) { color: var(--fc-color-text-default); }",
      "  .fc-snip { display: grid; }",
    );
    assert.deepEqual(rules, [], "a descendant reference is not an ownership claim");
  });
});
