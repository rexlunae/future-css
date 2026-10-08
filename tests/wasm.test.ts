/**
 * WASM integration tests.
 *
 * These load the real compiled modules and check them against the JS
 * implementation. Unit tests inside the Rust crates prove the algorithms are
 * right in isolation; these prove the modules actually instantiate, that the
 * exports survive the bindgen boundary, and — most importantly — that the WASM
 * and JS paths agree.
 *
 * A divergence between the two would be the worst possible bug in this design:
 * the WASM path is an optimization, so a mismatch means users get correct
 * results on one path and wrong results on the other, silently.
 *
 * Skipped when `dist/wasm` is absent, so `npm test` works before a WASM build.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

import { JsAccelerator } from "../src/js/accelerator.ts";
import { diffLines, diffStats } from "../src/js/diff.ts";
import { summarizeStatus, orderEntries, diffCounts } from "../src/js/git.ts";
import { SELECT_WASM_ABI, SelectModel, WasmSelectModel, isCompatibleSelectModule } from "../src/js/select.ts";
import type { SelectOption, SelectWasmModule } from "../src/js/select.ts";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const wasmDir = join(projectRoot, "dist", "wasm", "fc-model", "web");

/** True once `npm run build:wasm` has produced the web build. */
const built = existsSync(join(wasmDir, "fc_model.js"));

/** The string that separates byte, UTF-16-unit, and character offsets. */
const MIXED = "aé😀b";

type WasmModule = {
  default: (input?: { module_or_path?: Uint8Array }) => Promise<void>;
  abiVersion: () => number;
  TextBuffer: new (text: string) => {
    length16: () => number;
    charCount: () => number;
    countChars: (start: number, end: number) => number;
    slice16: (start: number, end: number) => string;
    lines16: () => unknown[];
    text: string;
  };
};

async function loadModule(): Promise<WasmModule> {
  // The web build is used deliberately: the nodejs bindgen target emits broken
  // CommonJS in the pinned CLI (0.2.118), which `docs/WASM.md` records.
  const mod = (await import(join(wasmDir, "fc_model.js"))) as WasmModule;
  const bytes = await readFile(join(wasmDir, "fc_model_bg.wasm"));
  await mod.default({ module_or_path: bytes });
  return mod;
}

describe("WASM module", { skip: built ? false : "run `npm run build:wasm` first" }, () => {
  it("instantiates and exports its ABI version", async () => {
    const mod = await loadModule();
    assert.equal(typeof mod.abiVersion, "function");
    assert.equal(typeof mod.abiVersion(), "number");
    // A hard check against the known value: a mismatch here means the JS and
    // WASM layers were built from different sources.
    assert.equal(mod.abiVersion(), 1);
  });

  it("constructs a buffer and reports UTF-16 length", async () => {
    const mod = await loadModule();
    const buf = new mod.TextBuffer(MIXED);
    // 5 UTF-16 units: the emoji is a surrogate pair.
    assert.equal(buf.length16(), 5);
  });

  it("reports character count distinct from UTF-16 length", async () => {
    const mod = await loadModule();
    const buf = new mod.TextBuffer(MIXED);
    assert.equal(buf.charCount(), 4);
  });

  it("slices by UTF-16 offsets", async () => {
    const mod = await loadModule();
    const buf = new mod.TextBuffer(MIXED);
    assert.equal(buf.slice16(0, 1), "a");
    assert.equal(buf.slice16(1, 2), "é");
    assert.equal(buf.slice16(2, 4), "😀");
  });

  it("returns one range per line", async () => {
    const mod = await loadModule();
    const buf = new mod.TextBuffer("one\ntwo\nthree");
    assert.equal(buf.lines16().length, 3);
  });
});

describe("WASM and JS agree", { skip: built ? false : "run `npm run build:wasm` first" }, () => {
  /**
   * The core contract: the two implementations must produce identical results.
   * Any divergence means users get different answers depending on which path
   * their browser took, with no way for them to tell.
   */
  it("agree on character counts for every offset", async () => {
    const mod = await loadModule();
    const js = new JsAccelerator();
    const buf = new mod.TextBuffer(MIXED);

    for (let start = 0; start <= MIXED.length; start += 1) {
      for (let end = start; end <= MIXED.length; end += 1) {
        const fromWasm = buf.countChars(start, end);
        const fromJs = js.countChars(MIXED, start, end);
        assert.equal(
          fromWasm,
          fromJs,
          `countChars(${start}, ${end}) disagreed: wasm=${fromWasm} js=${fromJs}`,
        );
      }
    }
  });

  it("agree on slices that do not split a surrogate pair", async () => {
    const mod = await loadModule();
    const js = new JsAccelerator();
    const buf = new mod.TextBuffer(MIXED);

    for (let start = 0; start <= MIXED.length; start += 1) {
      for (let end = start; end <= MIXED.length; end += 1) {
        // Both implementations clamp a split-surrogate range to the whole
        // character, so they must agree here too -- including on the cases
        // where JS's native slice would return a lone surrogate.
        const fromWasm = buf.slice16(start, end);
        const fromJs = js.slice(MIXED, start, end);
        assert.equal(fromWasm, fromJs, `slice16(${start}, ${end}) disagreed`);
      }
    }
  });

  it("agree on CJK text", async () => {
    const mod = await loadModule();
    const js = new JsAccelerator();
    const text = "日本語テキスト";
    const buf = new mod.TextBuffer(text);
    assert.equal(buf.charCount(), js.countChars(text, 0, text.length));
    assert.equal(buf.slice16(0, 3), js.slice(text, 0, 3));
  });

  it("agree on emoji-only text", async () => {
    const mod = await loadModule();
    const js = new JsAccelerator();
    const text = "🌍🌎🌏";
    const buf = new mod.TextBuffer(text);
    assert.equal(buf.charCount(), 3);
    assert.equal(buf.charCount(), js.countChars(text, 0, text.length));
  });
});
/**
 * fc-diff parity.
 *
 * `diffLines` exists twice: Myers in JavaScript and Myers in Rust. A divergence
 * there is the worst bug this system can have, because a user gets correct
 * results on one path and wrong results on the other with no signal telling them
 * which they saw. Every line attribution and every count is compared, not a
 * summary.
 *
 * These run against the compiled `.wasm` module, not the crate directly. The
 * crate-level example was the right check while `fc-diff` had no binding layer;
 * now that it emits a module, the boundary is part of what has to be correct, and
 * testing only the Rust side would leave the encoding unverified -- which is
 * where a sign convention or an off-by-one in the wire format would hide.
 */
describe("fc-diff and the JS diff agree", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const wasmDir = join(repoRoot, "dist", "wasm", "fc-diff", "web");
  const diffBuilt = existsSync(join(wasmDir, "fc_diff.js"));

  type DiffModule = {
    default: (input?: { module_or_path?: Uint8Array }) => Promise<void>;
    diffKinds: (before: string, after: string) => Int32Array;
    diffOldLines: (before: string, after: string) => Int32Array;
    diffNewLines: (before: string, after: string) => Int32Array;
    diffTextAt: (before: string, after: string, index: number) => string;
    diffStats: (before: string, after: string) => Int32Array;
    diffIdentical: (before: string, after: string) => boolean;
    lineCount: (text: string) => number;
  };

  let mod: DiffModule;

  const KIND = ["equal", "add", "remove"] as const;

  before(async () => {
    // The web build deliberately: the nodejs bindgen target emits broken
    // CommonJS in the pinned CLI (0.2.118), which `docs/WASM.md` records.
    mod = (await import(join(wasmDir, "fc_diff.js"))) as DiffModule;
    await mod.default({ module_or_path: await readFile(join(wasmDir, "fc_diff_bg.wasm")) });
  });

  /**
   * Decodes the wire format back into the JS shape. Written as the consumer
   * would, so it fails if the encoding and the documented layout disagree.
   */
  const fromWasm = (before: string, after: string) => {
    const kinds = Array.from(mod.diffKinds(before, after));
    const old = Array.from(mod.diffOldLines(before, after));
    const neu = Array.from(mod.diffNewLines(before, after));
    return kinds.map((kind, i) => ({
      kind: KIND[kind],
      text: mod.diffTextAt(before, after, i),
      // -1 means "no line on this side". It must never decode to a line 0,
      // which would invent a line number that was never there.
      oldLine: old[i] === -1 ? null : old[i],
      newLine: neu[i] === -1 ? null : neu[i],
    }));
  };

  const cases: [string, string][] = [
    ["a\nb\nc", "a\nx\nc"],
    ["", "new"],
    ["gone", ""],
    ["", ""],
    ["", " "],
    ["same", "same"],
    ["a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nX\nY\ne\nf\ng\nh"],
    ["1\n2\n3\n4\n5", "5\n4\n3\n2\n1"],
    ["a\n\n\nb", "a\nb"],
    ["x", "x\nx\nx"],
    ["l1\nl2", "totally\ndifferent\ncontent\nhere"],
    ["a\r\nb", "a\r\nc"],
    // The Rust splitter scans bytes for terminators rather than normalising
    // with replace and split, so every terminator shape is pinned here.
    ["a\rb\rc", "a\rx\rc"],
    ["a\r\r\nb", "a\n\nb"],
    ["a\r\n", "a\r"],
    ["\n", "\r\n"],
    ["a\n\n", "a\n"],
    ["a\r\nb\rc\nd", "a\nb\nc\nd\n"],
    ["fn f() {}\nfn g() {}", "fn f() {}\nfn h() {}"],
    ["a\nb\nc\na\nb\nc", "c\nb\na"],
    // Non-ASCII: text crosses as UTF-8 bytes and must come back identical.
    ["héllo\nwörld", "héllo\nworld"],
    ["😀 emoji line", "plain"],
  ];

  describe("parity", { skip: diffBuilt ? false : "run `npm run build:wasm` first" }, () => {
    for (const [before, after] of cases) {
      it(`agree on ${JSON.stringify(before).slice(0, 22)} -> ${JSON.stringify(after).slice(0, 22)}`, () => {
        const js = diffLines(before, after);
        assert.deepEqual(
          fromWasm(before, after).map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
          js.map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
          "every line kind, text, and 1-based number must match",
        );

        const jsStats = diffStats(js);
        const [added, removed] = Array.from(mod.diffStats(before, after));
        assert.equal(added, jsStats.added, "added count must match");
        assert.equal(removed, jsStats.removed, "removed count must match");
        assert.equal(mod.diffIdentical(before, after), jsStats.identical);
      });
    }
  });

  describe("wire format", { skip: diffBuilt ? false : "run `npm run build:wasm` first" }, () => {
    it("uses -1, never 0, for a line absent on one side", () => {
      // 0 would be a value no real 1-based line number takes, and would render
      // as a line number for a line that never existed.
      const old = Array.from(mod.diffOldLines("a", "a\nb"));
      const neu = Array.from(mod.diffNewLines("a", "a\nb"));
      assert.equal(old[1], -1, "an added line has no number in the original");
      assert.equal(neu[1], 2);
      assert.ok(![...old, ...neu].includes(0), "0 must never appear as a line number");
    });

    it("returns empty rather than trapping for an out-of-range index", () => {
      // A JS caller indexing past the end should see no text, not lose the module.
      assert.equal(mod.diffTextAt("a\nb", "a\nx", 99), "");
      assert.equal(mod.diffTextAt("", "", 0), "");
    });

    it("counts an empty document as having no lines", () => {
      assert.equal(mod.lineCount(""), 0, "an empty document has no lines");
      assert.equal(mod.lineCount("a\n"), 1, "a trailing newline is a terminator");
      assert.equal(mod.diffKinds("", "new").length, 1);
    });
  });
});

/**
 * fc-select parity.
 *
 * The Rust model and the JS twin must agree on navigation, or a user gets a
 * listbox that behaves differently depending on whether WASM loaded. Same rule
 * as `fc-diff`: compare the actual outputs, never a summary.
 *
 * Disabled options are the case worth encoding. Omitting them from a binding is
 * silent -- the call returns a plausible index and nothing looks wrong until
 * someone tries to pick the option they were just moved onto -- so the flags
 * cross the boundary explicitly and are asserted here.
 */
describe("fc-select and the JS model agree", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const wasmDir = join(repoRoot, "dist", "wasm", "fc-select", "web");
  const selectBuilt = existsSync(join(wasmDir, "fc_select.js"));

  type SelectModule = {
    default: (input?: { module_or_path?: Uint8Array }) => Promise<void>;
    selectOpen: (
      values: string[], labels: string[], groups: string[],
      disabled: number[], current: string,
    ) => number;
    selectIndexOf: (values: string[], value: string) => number;
    selectLabelAt: (labels: string[], index: number) => string;
    selectFilter: (labelKeys: string[], valueKeys: string[], needle: string) => Int32Array;
    selectMove: (
      values: string[], labels: string[], disabled: number[],
      committed: string, delta: number,
    ) => Int32Array;
    selectTypeahead: (
      values: string[], labels: string[], disabled: number[],
      committed: string, query: string,
    ) => Int32Array;
  };

  let mod: SelectModule;
  before(async () => {
    mod = (await import(join(wasmDir, "fc_select.js"))) as SelectModule;
    await mod.default({ module_or_path: await readFile(join(wasmDir, "fc_select_bg.wasm")) });
  });

  // Grouped like a real provider list, with one unavailable entry.
  const VALUES = ["opus-5", "sonnet-5", "gpt-5", "o3", "llama-4"];
  const LABELS = ["Claude Opus 5", "Claude Sonnet 5", "GPT-5", "o3", "Llama 4 (local)"];
  const GROUPS = ["Anthropic", "Anthropic", "OpenAI", "OpenAI", "Local"];
  const DISABLED = [0, 0, 0, 0, 1];
  // Matching entry points take keys the binding has folded; see `Folding` in
  // the crate. Passing raw labels would test a contract nobody calls.
  const fold = (xs: string[]) => xs.map((x) => x.toLowerCase());
  const LABEL_KEYS = fold(LABELS);
  const VALUE_KEYS = fold(VALUES);

  describe("navigation", { skip: selectBuilt ? false : "run `npm run build:wasm` first" }, () => {
    it("opens on the committed value rather than the first option", () => {
      // Re-opening an unchanged control must not move the highlight, or the
      // control appears to reset itself.
      assert.equal(mod.selectOpen(VALUES, LABELS, GROUPS, DISABLED, "gpt-5"), 2);
      assert.equal(mod.selectOpen(VALUES, LABELS, GROUPS, DISABLED, "opus-5"), 0);
    });

    it("falls back to the first option when the committed value has vanished", () => {
      // A provider list can change under a control holding a stale value.
      assert.equal(mod.selectOpen(VALUES, LABELS, GROUPS, DISABLED, "retired-model"), 0);
    });

    it("moves the highlight by one, skipping unavailable options", () => {
      const [active] = Array.from(mod.selectMove(VALUES, LABELS, DISABLED, "gpt-5", 1));
      assert.equal(active, 3, "gpt-5 -> o3");
      // Wraps past the last, disabled option back to the first.
      const [wrapped] = Array.from(mod.selectMove(VALUES, LABELS, DISABLED, "o3", 1));
      assert.equal(wrapped, 0, "must skip the disabled Llama, not stop on it");
    });

    it("moves backwards, wrapping from the first option", () => {
      const [active] = Array.from(mod.selectMove(VALUES, LABELS, DISABLED, "opus-5", -1));
      assert.equal(active, 3, "stepping up past the disabled option lands on o3");
    });

    it("finds a value by its stable id, not its label", () => {
      assert.equal(mod.selectIndexOf(VALUES, "o3"), 3);
      assert.equal(mod.selectIndexOf(VALUES, "nope"), -1, "absent value is -1, not 0");
    });
  });

  describe("filter", { skip: selectBuilt ? false : "run `npm run build:wasm` first" }, () => {
    it("matches substrings case-insensitively, which a prefix match would miss", () => {
      // The distinction that separates this from a menu's typeahead: "sonnet"
      // occurs inside "Claude Sonnet 5" but does not start it.
      assert.deepEqual(Array.from(mod.selectFilter(LABEL_KEYS, VALUE_KEYS, "sonnet")), [1]);
      assert.deepEqual(Array.from(mod.selectFilter(LABEL_KEYS, VALUE_KEYS, "gpt")), [2]);
      assert.deepEqual(Array.from(mod.selectFilter(LABEL_KEYS, VALUE_KEYS, "local")), [4],
        "an unavailable option is still a real option and stays listed");
    });

    it("restores every option for an empty query", () => {
      assert.equal(Array.from(mod.selectFilter(LABEL_KEYS, VALUE_KEYS, "")).length, LABELS.length);
    });

    it("returns nothing rather than every option for a query that matches nothing", () => {
      assert.deepEqual(Array.from(mod.selectFilter(LABEL_KEYS, VALUE_KEYS, "zzz")), []);
    });
  });

  describe("typeahead", { skip: selectBuilt ? false : "run `npm run build:wasm` first" }, () => {
    it("never selects an unavailable option", () => {
      // "L" only prefixes "Llama 4 (local)", which is disabled. Selecting it
      // would move the user onto an option they cannot choose.
      const [active, matched] = Array.from(
        mod.selectTypeahead(VALUES, LABEL_KEYS, DISABLED, "", "l"),
      );
      assert.equal(matched, 0, "must report no match");
      assert.equal(active, 0, "highlight stays where it was");
    });

    it("reports no match for a prefix that is absent", () => {
      const [, matched] = Array.from(
        mod.selectTypeahead(VALUES, LABEL_KEYS, DISABLED, "", "z"),
      );
      assert.equal(matched, 0, "a failed search must not report success");
    });

    it("finds a real prefix", () => {
      const [active, matched] = Array.from(
        mod.selectTypeahead(VALUES, LABEL_KEYS, DISABLED, "", "c"),
      );
      assert.equal(matched, 1);
      assert.equal(LABELS[active], "Claude Sonnet 5");
    });
  });

  describe("degenerate input", { skip: selectBuilt ? false : "run `npm run build:wasm` first" }, () => {
    it("survives an empty option list without trapping", () => {
      assert.equal(mod.selectOpen([], [], [], [], ""), -1);
      assert.deepEqual(Array.from(mod.selectMove([], [], [], "", 1)), [-1, -1]);
      assert.deepEqual(Array.from(mod.selectTypeahead([], [], [], "", "a")), [-1, 0]);
      assert.deepEqual(Array.from(mod.selectFilter([], [], "x")), []);
    });

    it("returns an empty label rather than trapping out of range", () => {
      assert.equal(mod.selectLabelAt(LABELS, 99), "");
      assert.equal(mod.selectLabelAt(LABELS, -1), "");
    });
  });
});

/**
 * fc-git parity.
 *
 * The Rust summary and the JS twin must agree on every count, order, and line
 * stat, or a user sees a different working tree depending on whether WASM loaded.
 *
 * The case that matters most is `diffCounts`. `fileSummary` is what every badge
 * and every `data-fc-*` count in the git surface is built from, so a divergence
 * there does not look like a bug -- it looks like the repository changed.
 */
describe("fc-git and the JS model agree", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const wasmDir = join(repoRoot, "dist", "wasm", "fc-git", "web");
  const gitBuilt = existsSync(join(wasmDir, "fc_git.js"));

  type GitModule = {
    default: (input?: { module_or_path?: Uint8Array }) => Promise<void>;
    summarize_status_js: (codes: Int32Array) => Uint32Array;
    order_entries_js: (codes: Int32Array) => Uint32Array;
    diff_counts_js: (before: string | undefined, after: string | undefined) => Uint32Array;
  };

  let mod: GitModule;
  before(async () => {
    mod = (await import(join(wasmDir, "fc_git.js"))) as GitModule;
    await mod.default({ module_or_path: await readFile(join(wasmDir, "fc_git_bg.wasm")) });
  });

  // Codes matching the JS `IndexState` order.
  const ADDED = 0, MODIFIED = 1, DELETED = 2, RENAMED = 3, UNTRACKED = 4, CONFLICTED = 5;
  const NONE = 255;

  describe("status counts", { skip: gitBuilt ? false : "run `npm run build:wasm` first" }, () => {
    const CASES: Array<{ name: string; codes: number[] }> = [
      { name: "a clean tree", codes: [] },
      { name: "staged only", codes: [MODIFIED, NONE] },
      { name: "worktree only", codes: [NONE, MODIFIED] },
      { name: "changed in both", codes: [MODIFIED, MODIFIED] },
      { name: "several untracked", codes: [NONE, UNTRACKED, NONE, UNTRACKED] },
      { name: "conflicted in both", codes: [CONFLICTED, CONFLICTED] },
      { name: "conflicted in the index only", codes: [CONFLICTED, NONE] },
      { name: "conflicted in the worktree only", codes: [NONE, CONFLICTED] },
      { name: "added, deleted, and renamed", codes: [ADDED, NONE, DELETED, NONE, RENAMED, NONE] },
      { name: "an unknown code is absent, not guessed", codes: [99, 99, MODIFIED, NONE] },
      {
        name: "a mixed tree",
        codes: [
          MODIFIED, NONE, NONE, UNTRACKED, MODIFIED, MODIFIED,
          CONFLICTED, CONFLICTED, ADDED, NONE,
        ],
      },
    ];

    for (const testCase of CASES) {
      it(testCase.name, () => {
        const wasm = mod.summarize_status_js(Int32Array.from(testCase.codes));
        const js = summarizeStatus(entriesFromCodes(testCase.codes));
        assert.deepEqual([...wasm], [js.staged, js.unstaged, js.conflicted, js.untracked],
          `WASM ${[...wasm]} vs JS [${js.staged}, ${js.unstaged}, ${js.conflicted}, ${js.untracked}]`);
      });
    }
  });

  describe("ordering", { skip: gitBuilt ? false : "run `npm run build:wasm` first" }, () => {
    it("agrees on which entries need attention first", () => {
      const codes = [MODIFIED, NONE, MODIFIED, MODIFIED, CONFLICTED, CONFLICTED, NONE, UNTRACKED];
      assertOrderAgrees(mod, codes, "conflicts first, then both-sided, then the rest");
    });

    it("agrees on an empty tree", () => {
      assert.deepEqual([...mod.order_entries_js(new Int32Array(0))], []);
    });

    it("agrees on a long tree with many ties", () => {
      // Stability is only observable with ties, and the WASM and JS sorts are
      // separate implementations of it.
      const codes = new Array(40).fill([MODIFIED, NONE]).flat();
      assertOrderAgrees(mod, codes, "a long tree with many ties");
    });

    it("agrees when ranks tie and paths are in reverse order", () => {
      // The case that exposed the boundary limitation: same rank throughout, and
      // deliberately not in path order, so a tie-break difference cannot hide.
      const codes = [UNTRACKED, NONE, UNTRACKED, NONE, UNTRACKED, NONE];
      assertOrderAgrees(mod, codes, "all ties, deliberately unsorted paths");
    });
  });

  describe("line counts", { skip: gitBuilt ? false : "run `npm run build:wasm` first" }, () => {
    const REVISIONS: Array<[string | undefined, string | undefined]> = [
      ["a\nb\n", "a\nc\nd\n"],
      [undefined, "a\nb\n"],
      ["a\nb\n", undefined],
      [undefined, undefined],
      ["a\nb\n", "a\nb\n"],
      ["a\n", "a"],
      ["a", "a\n"],
      ["a\nb\n", "x\n"],
      ["", "x"],
      ["x", ""],
      ["", ""],
      ["one\ntwo\nthree\nfour\n", "one\nTWO\nthree\nfour\n"],
      ["a\n\n\nb\n", "a\n\n\nb\nc\n"],
      ["unicode ✓ ünïcødé\n", "unicode ✓ ünïcødé\nnew ✓\n"],
      ["x".repeat(500) + "\n", "x".repeat(500) + "\ny\n"],
      // Empty and near-empty inputs, where the trim's two loops can meet in the
      // middle. A release-only integer wrap lived here and reported a file as
      // having billions of changed lines.
      ["", ""],
      ["", "a\n"],
      ["a\n", ""],
      ["\n", "\n"],
      ["\n", "a\n\n"],
      ["\n\n\n", "\n"],
      ["a", ""],
      ["", "a"],
    ];

    for (const [before, after] of REVISIONS) {
      it(`agrees on ${JSON.stringify(before?.slice(0, 18))} -> ${JSON.stringify(after?.slice(0, 18))}`, () => {
        const wasm = [...mod.diff_counts_js(before, after)];
        const js = diffCounts(before, after);
        assert.deepEqual(wasm, [js.added, js.removed], `WASM ${wasm} vs JS ${JSON.stringify(js)}`);
      });
    }
  });
});

/** Rebuilds JS status entries from the same interleaved codes the WASM takes. */
function entriesFromCodes(codes: number[]): Parameters<typeof summarizeStatus>[0] {
  const out: Array<{ path: string; index?: never; worktree?: never }> = [];
  for (let i = 0; i < codes.length; i += 2) {
    // The path is the entry's position, zero-padded so that lexical order equals
    // numeric order: `orderEntries` sorts paths with `localeCompare`, which puts
    // "10" before "9", and an unpadded index would make both implementations sort
    // correctly but differently from what the assertion reads as expected.
    const entry: Record<string, never | string> = { path: String(i / 2).padStart(6, "0") };
    if (codes[i] !== 255) entry.index = STATE_NAMES[codes[i]];
    if (codes[i + 1] !== 255) entry.worktree = STATE_NAMES[codes[i + 1]];
    out.push(entry as never);
  }
  return out;
}

const STATE_NAMES: Record<number, "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted"> = {
  0: "added", 1: "modified", 2: "deleted", 3: "renamed", 4: "untracked", 5: "conflicted",
};

/**
 * Compares WASM ordering against the JS twin.
 *
 * Both are fed entries tagged with their *position* as the path, so the JS result
 * is read back as positions directly. Tagging with the state code instead would
 * silently collapse duplicates -- every entry here shares one of four codes, so
 * `indexOf` would return the first match for all of them and the comparison would
 * pass while testing nothing.
 */
function assertOrderAgrees(
  mod: { order_entries_js: (codes: Int32Array) => Uint32Array },
  codes: number[],
  label: string,
): void {
  const entries = entriesFromCodes(codes);
  // Feed both sides in *path* order. `order_entries_js` breaks ties by input order
  // because paths never cross into the WASM module -- see the crate's
  // `order_entries` doc. Feeding unsorted input made the two disagree, which is
  // real but not a parity bug: the JS twin is allowed to sort by path, and the
  // caller is required to present it sorted. This assert is the *contract*, and
  // it fails loudly if either side changes how it orders ties.
  const byPath = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const sortedCodes = byPath.map((entry) => [
    entry.index === undefined ? 255 : STATE_NAMES_CODES[entry.index],
    entry.worktree === undefined ? 255 : STATE_NAMES_CODES[entry.worktree],
  ]).flat();

  const wasm = [...mod.order_entries_js(Int32Array.from(sortedCodes))];
  const js = orderEntries(entries).map((entry) => Number(entry.path));
  assert.deepEqual(wasm, js, label);
}

const STATE_NAMES_CODES: Record<string, number> = {
  added: 0, modified: 1, deleted: 2, renamed: 3, untracked: 4, conflicted: 5,
};

/**
 * The shipped adapter vs the JS twin, driven identically.
 *
 * This is the test the stateless boundary could not support before
 * `selectMoveFrom` / `selectTypeaheadFrom` existed: those entry points accept
 * the *visible* set, which is what makes filtered navigation expressible at
 * all. Every operation below runs on both models and both must agree after
 * each one -- the assertion names the operation, so a divergence points at the
 * exact call rather than at an end state.
 */
describe("the shipped WasmSelectModel adapter and the JS twin agree", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const wasmDir = join(repoRoot, "dist", "wasm", "fc-select", "web");
  const adapterBuilt = existsSync(join(wasmDir, "fc_select.js"));

  const ITEMS: SelectOption[] = [
    { value: "opus-5", label: "Claude Opus 5", group: "Anthropic" },
    { value: "sonnet-5", label: "Claude Sonnet 5", group: "Anthropic" },
    { value: "gpt-5", label: "GPT-5", group: "OpenAI" },
    { value: "o3", label: "o3", group: "OpenAI" },
    { value: "llama-4", label: "Llama 4 (local)", group: "Local", disabled: true },
  ];

  // Every computation that crosses the boundary, plus the filtered cases that
  // were parity-blind until the boundary could express them.
  const OPS: Array<[string, ...unknown[]]> = [
    ["open", "gpt-5"],
    ["move", 1],
    ["move", 1], // wraps past the disabled tail onto the first option
    ["move", -1],
    ["filter", "cla"], // narrows to the two Anthropic options
    ["move", 1], // filtered move: the case move_by used to seed wrongly
    ["move", -1],
    ["typeahead", "s"],
    ["typeahead", "o"], // extends the buffer
    ["typeahead", "z"], // no match anywhere: buffer must clear on both sides
    ["close", false], // Escape restores
    ["open", "opus-5"],
    ["close", true], // commits the highlight
    ["setCommitted", "gpt-5"],
    ["open", undefined],
    ["focusFirst"],
    ["focusLast"], // must stop on o3, not the disabled Llama
    ["setActive", 3],
    ["filter", ""], // empty query restores everything
    ["move", 1],
  ];

  it(
    "agrees after every operation, including filtered ones",
    { skip: adapterBuilt ? false : "run `npm run build:wasm` first" },
    async () => {
      const mod = (await import(join(wasmDir, "fc_select.js"))) as unknown as SelectWasmModule;
      await mod.default({ module_or_path: await readFile(join(wasmDir, "fc_select_bg.wasm")) });

      const js = new SelectModel(ITEMS);
      const wasm = new WasmSelectModel(mod, ITEMS);

      const stateOf = (m: SelectModel | WasmSelectModel) => ({
        visible: [...m.visibleIndices()],
        active: m.activeIndex,
        committed: m.committedValue,
      });

      for (const [op, ...args] of OPS) {
        // Same call, same receiver shape, compared immediately -- not at the
        // end, where one early divergence would drown the rest.
        (js as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...args);
        (wasm as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...args);
        assert.deepEqual(stateOf(wasm), stateOf(js), `diverged after ${op}(${args.join(", ")})`);
      }
    },
  );

  it(
    "accepts only a module built for the adapter's wire format",
    { skip: adapterBuilt ? false : "run `npm run build:wasm` first" },
    async () => {
      const mod = (await import(join(wasmDir, "fc_select.js"))) as unknown as SelectWasmModule;
      await mod.default({ module_or_path: await readFile(join(wasmDir, "fc_select_bg.wasm")) });
      assert.equal(mod.selectAbi?.(), SELECT_WASM_ABI, "crate SELECT_ABI and adapter SELECT_WASM_ABI must move together");
      assert.ok(isCompatibleSelectModule(mod));
      // A pre-v2 module exports no version at all; a future one exports another.
      // Both must be refused so useWasm keeps the JS model.
      assert.equal(isCompatibleSelectModule({}), false, "a cached v1 module must be refused");
      assert.equal(isCompatibleSelectModule({ selectAbi: () => SELECT_WASM_ABI + 1 }), false);
    },
  );

  // Folding moved from Rust into the adapter, so these are the cases where a
  // fold done in the wrong place or by the wrong rule would show: non-ASCII
  // case pairs, a dotted capital I that folds to two code units, a Greek word
  // whose final sigma folds differently from a medial one, and a buffer whose
  // keystrokes differ only in case.
  const UNICODE_ITEMS: SelectOption[] = [
    { value: "ärger", label: "Ärger" },
    { value: "istanbul", label: "İstanbul" },
    { value: "odos", label: "ΟΔΟΣ" },
    { value: "osa", label: "ΟΣΑ" },
    { value: "aardvark", label: "Aardvark" },
    { value: "abacus", label: "ABACUS" },
  ];
  const UNICODE_OPS: Array<[string, ...unknown[]]> = [
    ["open", undefined],
    ["filter", "  ÄR "], // trimmed and folded on both sides
    ["filter", "İST"],
    ["filter", "οδος"], // ς at the end of the folded label, σ in the query
    ["filter", "ΟΔΟΣ"], // the query folds its own final sigma to ς
    ["filter", ""],
    ["typeahead", "Ο"],
    ["typeahead", "Σ"], // "ΟΣ" folds to "ος", which does not prefix "οσα"; folding
                        // per keystroke would give "οσ" and wrongly match
    ["close", false],
    ["open", undefined],
    ["typeahead", "A"],
    ["typeahead", "a"], // differs only in case: not a repeat, so "aa" is searched
    ["typeahead", "B"],
  ];

  it(
    "agrees on case folding beyond ASCII",
    { skip: adapterBuilt ? false : "run `npm run build:wasm` first" },
    async () => {
      const mod = (await import(join(wasmDir, "fc_select.js"))) as unknown as SelectWasmModule;
      await mod.default({ module_or_path: await readFile(join(wasmDir, "fc_select_bg.wasm")) });

      const js = new SelectModel(UNICODE_ITEMS);
      const wasm = new WasmSelectModel(mod, UNICODE_ITEMS);
      const stateOf = (m: SelectModel | WasmSelectModel) => ({
        visible: [...m.visibleIndices()],
        active: m.activeIndex,
        committed: m.committedValue,
      });

      for (const [op, ...args] of UNICODE_OPS) {
        const jsResult = (js as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...args);
        const wasmResult = (wasm as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...args);
        assert.deepEqual(wasmResult, jsResult, `return value diverged after ${op}(${args.join(", ")})`);
        assert.deepEqual(stateOf(wasm), stateOf(js), `diverged after ${op}(${args.join(", ")})`);
      }
      // Pin the outcomes too, so both sides cannot agree on a wrong answer.
      assert.deepEqual(js.filter("ΟΔΟΣ"), [2], "final sigma must fold to match");
      assert.deepEqual(js.filter("  ÄR "), [0]);
    },
  );
});
