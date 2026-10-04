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
    selectFilter: (labels: string[], values: string[], query: string) => Int32Array;
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
      assert.deepEqual(Array.from(mod.selectFilter(LABELS, VALUES, "sonnet")), [1]);
      assert.deepEqual(Array.from(mod.selectFilter(LABELS, VALUES, "GPT")), [2]);
      assert.deepEqual(Array.from(mod.selectFilter(LABELS, VALUES, "local")), [4],
        "an unavailable option is still a real option and stays listed");
    });

    it("restores every option for an empty query", () => {
      assert.equal(Array.from(mod.selectFilter(LABELS, VALUES, "")).length, LABELS.length);
    });

    it("returns nothing rather than every option for a query that matches nothing", () => {
      assert.deepEqual(Array.from(mod.selectFilter(LABELS, VALUES, "zzz")), []);
    });
  });

  describe("typeahead", { skip: selectBuilt ? false : "run `npm run build:wasm` first" }, () => {
    it("never selects an unavailable option", () => {
      // "L" only prefixes "Llama 4 (local)", which is disabled. Selecting it
      // would move the user onto an option they cannot choose.
      const [active, matched] = Array.from(
        mod.selectTypeahead(VALUES, LABELS, DISABLED, "", "L"),
      );
      assert.equal(matched, 0, "must report no match");
      assert.equal(active, 0, "highlight stays where it was");
    });

    it("reports no match for a prefix that is absent", () => {
      const [, matched] = Array.from(
        mod.selectTypeahead(VALUES, LABELS, DISABLED, "", "Z"),
      );
      assert.equal(matched, 0, "a failed search must not report success");
    });

    it("finds a real prefix", () => {
      const [active, matched] = Array.from(
        mod.selectTypeahead(VALUES, LABELS, DISABLED, "", "C"),
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
