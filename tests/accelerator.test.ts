/**
 * Accelerator tests.
 *
 * The JS fallback is the correctness baseline: if the two implementations ever
 * disagree, the WASM path is wrong for anyone whose browser silently fell back,
 * and they would have no way to tell. These tests pin the shared behavior so a
 * divergence fails here rather than in an application.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORE_ABI_VERSION,
  JsAccelerator,
  WASM_THRESHOLD_BYTES,
  createAccelerator,
} from "../src/js/accelerator.ts";

/** "aé😀b" — the minimal string that separates byte, UTF-16 unit, and character. */
const MIXED = "aé😀b";

describe("JsAccelerator", () => {
  const acc = new JsAccelerator();

  it("reports a zero ABI, since the JS path has none", () => {
    assert.equal(acc.abiVersion, 0);
    assert.equal(acc.kind, "js");
  });

  it("counts characters, not UTF-16 units", () => {
    // The string is 5 UTF-16 units but 4 characters.
    assert.equal(MIXED.length, 5);
    assert.equal(acc.countChars(MIXED, 0, MIXED.length), 4);
  });

  it("counts a single emoji as one character", () => {
    assert.equal(acc.countChars("😀", 0, 2), 1);
  });

  it("slices by UTF-16 offsets", () => {
    assert.equal(acc.slice(MIXED, 0, 1), "a");
    assert.equal(acc.slice(MIXED, 1, 2), "é");
    assert.equal(acc.slice(MIXED, 2, 4), "😀");
  });

  it("never splits a surrogate pair", () => {
    // The whole point of the divergence from String.slice: a lone surrogate
    // renders as a replacement glyph and corrupts any text it is stored in.
    const result = acc.slice(MIXED, 2, 3);
    assert.equal(result, "😀", "must return the whole character, not half of one");
  });

  it("treats an empty range inside a surrogate pair as empty", () => {
    // Regression. Offset 3 sits between the two halves of the emoji at 2-3, a
    // caret position that cannot exist in character terms.
    //
    // The intuitive fix -- expanding the range outward to cover the character --
    // is wrong here: it turns an empty selection into half a character. The
    // correct behavior is to advance the endpoint, leaving the range empty.
    //
    // Found by tests/wasm.test.ts, which compares every offset pair against the
    // Rust implementation; the two disagreed on exactly this case.
    assert.equal(acc.slice(MIXED, 3, 3), "", "must stay empty");
    assert.equal(acc.countChars(MIXED, 3, 3), 0);
  });

  it("treats a range starting inside a pair as empty", () => {
    // Same reasoning for a range whose start is mid-pair: there is no whole
    // character to return, so the result is empty rather than partial.
    assert.equal(acc.slice(MIXED, 3, 4), "");
    assert.equal(acc.countChars(MIXED, 3, 4), 0);
  });

  it("advances rather than expands, on both endpoints", () => {
    // [2,3) ends inside the emoji -> [2,4), the whole character.
    assert.equal(acc.slice(MIXED, 2, 3), "😀");
    // [3,4) starts inside it -> [4,4), empty.
    assert.equal(acc.slice(MIXED, 3, 4), "");
    // A range covering the emoji entirely is unaffected.
    assert.equal(acc.slice(MIXED, 2, 4), "😀");
  });

  it("clamps out-of-range offsets instead of throwing", () => {
    assert.equal(acc.slice("abc", 0, 99), "abc");
    assert.equal(acc.slice("abc", -5, 2), "ab");
    assert.equal(acc.slice("abc", 2, 1), "", "a backwards range is empty, not an error");
  });

  it("handles the empty string", () => {
    assert.equal(acc.slice("", 0, 0), "");
    assert.equal(acc.countChars("", 0, 0), 0);
  });

  it("counts CJK by character", () => {
    // Each CJK character is one UTF-16 unit and one character.
    assert.equal(acc.countChars("日本語テキスト", 0, 7), 7);
  });

  it("never throws on any offset combination", () => {
    // A fuzz sweep rather than a few cases: the clamp logic has branches only
    // specific offsets reach.
    for (const text of ["", "a", "ab", MIXED, "🌍🌎🌏", "a🌍b"]) {
      for (let start = -2; start <= text.length + 2; start += 1) {
        for (let end = -2; end <= text.length + 2; end += 1) {
          assert.doesNotThrow(() => acc.slice(text, start, end));
          assert.doesNotThrow(() => acc.countChars(text, start, end));
        }
      }
    }
  });
});
describe("createAccelerator selection", () => {
  it('honors mode "none" without attempting a load', async () => {
    let called = false;
    const { accelerator, reason } = await createAccelerator("none", {
      loadWasm: async () => {
        called = true;
        return {};
      },
    });
    assert.equal(called, false, '"none" must not issue a network request');
    assert.equal(reason, "explicit-none");
    assert.equal(accelerator.kind, "js");
  });

  it('stays on the JS path below the size threshold in "auto"', async () => {
    const { accelerator, reason } = await createAccelerator("auto", {
      documentSize: WASM_THRESHOLD_BYTES - 1,
      loadWasm: async () => {
        throw new Error("must not be called");
      },
    });
    assert.equal(reason, "below-threshold");
    assert.equal(accelerator.kind, "js");
  });

  it("falls back when the module fails to load", async () => {
    const { accelerator, reason } = await createAccelerator("wasm", {
      loadWasm: async () => {
        throw new Error("network down");
      },
    });
    // A broken module must not take the editor down with it.
    assert.equal(reason, "load-failed");
    assert.equal(accelerator.kind, "js");
  });

  it("falls back on an ABI mismatch and explains why", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      const { accelerator, reason } = await createAccelerator("wasm", {
        loadWasm: async () => ({
          default: async () => ({ kind: "wasm", abiVersion: CORE_ABI_VERSION + 1 }),
        }),
      });
      assert.equal(accelerator.kind, "js");
      assert.equal(reason, "load-failed");
      assert.ok(
        warnings.some((w) => w.includes("ABI")),
        "a version skew must be explained, not silently swallowed",
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  it("accepts a module whose ABI matches", async () => {
    const wasm = { kind: "wasm" as const, abiVersion: CORE_ABI_VERSION };
    const { accelerator, reason } = await createAccelerator("wasm", {
      loadWasm: async () => ({ default: async () => wasm }),
    });
    assert.equal(accelerator.kind, "wasm");
    assert.equal(reason, "explicit-wasm");
  });

  it("rejects a module with no default export", async () => {
    const { accelerator, reason } = await createAccelerator("wasm", {
      loadWasm: async () => ({}),
    });
    assert.equal(accelerator.kind, "js");
    assert.equal(reason, "load-failed");
  });

  it("never throws, whatever the loader does", async () => {
    // The promise of the abstraction: a consumer never needs a try/catch.
    for (const loadWasm of [
      async () => {
        throw new Error("boom");
      },
      async () => null,
      async () => ({ default: "not a function" }),
      async () => ({ default: async () => null }),
    ]) {
      const result = await createAccelerator("wasm", { loadWasm: loadWasm as never });
      assert.ok(result.accelerator, "must always resolve to an accelerator");
    }
  });
});
