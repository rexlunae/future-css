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
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { JsAccelerator } from "../src/js/accelerator.ts";
import { diffLines, diffStats, type DiffLine } from "../src/js/diff.ts";

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
 * `diffLines` now exists twice: Myers in JavaScript and Myers in Rust. A
 * divergence there is the worst bug this system can have, because a user gets
 * correct results on one path and wrong results on the other with no signal
 * telling them which they saw. Every offset pair and every line attribution is
 * compared, not a summary.
 *
 * The comparison runs through the crate's `parity` example rather than the .wasm
 * module, because the crate is not yet wired to JS. That is the point of it: the
 * algorithm is verified equal *before* anything depends on it being equal.
 */
describe("fc-diff and the JS diff agree", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  const normalize = (lines: readonly DiffLine[]) =>
    lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine]);

  const cases: [string, string][] = [
    ["a\nb\nc", "a\nx\nc"],
    ["", "new"],
    ["gone", ""],
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
  ];

  for (const [before, after] of cases) {
    it(`agree on ${JSON.stringify(before).slice(0, 24)} -> ${JSON.stringify(after).slice(0, 24)}`, () => {
      const js = diffLines(before, after);
      const jsStats = diffStats(js);
      const raw = execFileSync(
        "cargo",
        ["run", "-q", "-p", "fc-diff", "--example", "parity", "--", before, after],
        { cwd: repoRoot, encoding: "utf8" },
      );
      const rust = JSON.parse(raw);

      assert.deepEqual(
        rust.lines.map((l: DiffLine) => [l.kind, l.text, l.oldLine, l.newLine]),
        normalize(js),
        "every line kind, text, and 1-based number must match",
      );
      assert.equal(rust.added, jsStats.added);
      assert.equal(rust.removed, jsStats.removed);
      assert.equal(rust.identical, jsStats.identical);
    });
  }
});
