/**
 * Menu traversal: the JS twin on its own, then the twin against `fc-context-menu`.
 *
 * The parity half matters most. The binding picks a model at runtime, so a
 * divergence means a keyboard user lands on a different item depending on
 * whether a WASM file happened to load -- and nothing on screen says which.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

import { MenuModel, WasmMenuModel } from "../src/js/menu.ts";
import type { MenuModelLike, MenuWasmModule } from "../src/js/menu.ts";

// Mirrors the demo: a separator, a disabled item, and two checkbox items.
const LABELS = ["Cut", "Copy", "", "Paste", "Wrap lines", "Line numbers", "", "Delete"];
const FOCUSABLE = [true, true, false, false, true, true, false, true];

describe("MenuModel", () => {
  it("opens on the first focusable item", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusFirst();
    assert.equal(m.activeIndex, 0);
  });

  it("skips a separator and a disabled item in one arrow press", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.setActive(1);
    m.move(1);
    assert.equal(LABELS[m.activeIndex], "Wrap lines");
  });

  it("wraps at both ends", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusLast();
    assert.equal(LABELS[m.activeIndex], "Delete");
    m.move(1);
    assert.equal(m.activeIndex, 0);
    m.move(-1);
    assert.equal(LABELS[m.activeIndex], "Delete");
  });

  it("keeps a large negative delta in range", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusFirst();
    m.move(-1_000_003);
    assert.ok(FOCUSABLE[m.activeIndex], "landed on a focusable item");
  });

  it("accumulates typed characters into one search", () => {
    // "l" alone finds "Line numbers"; "w" then "r" must find "Wrap lines"
    // rather than restarting at "r" and matching nothing.
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusFirst();
    assert.equal(m.typeahead("w"), true);
    assert.equal(m.typeahead("r"), true);
    assert.equal(LABELS[m.activeIndex], "Wrap lines");
  });

  it("cycles when the same character repeats", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusFirst();
    m.typeahead("c");
    assert.equal(LABELS[m.activeIndex], "Copy", "searches from the item after Cut");
    m.typeahead("c");
    assert.equal(LABELS[m.activeIndex], "Cut", "and wraps");
  });

  it("cycles on a shifted repeat rather than searching for a doubled letter", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusFirst();
    m.typeahead("C");
    m.typeahead("c");
    assert.equal(LABELS[m.activeIndex], "Cut");
  });

  it("never lands on a disabled match", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusFirst();
    assert.equal(m.typeahead("p"), false, "Paste is disabled");
    assert.equal(m.activeIndex, 0, "a failed search does not move focus");
  });

  it("drops a dead prefix so the next character starts fresh", () => {
    const m = new MenuModel(LABELS, FOCUSABLE);
    m.focusFirst();
    m.typeahead("z");
    assert.equal(m.typeahead("d"), true);
    assert.equal(LABELS[m.activeIndex], "Delete");
  });

  it("answers -1 when nothing is focusable", () => {
    const m = new MenuModel(["A", "B"], [false, false]);
    m.focusFirst();
    assert.equal(m.activeIndex, -1);
    m.move(1);
    assert.equal(m.activeIndex, -1);
  });
});

describe("fc-context-menu and MenuModel agree", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const wasmDir = join(repoRoot, "dist", "wasm", "fc-context-menu", "web");
  const built = existsSync(join(wasmDir, "fc_context_menu.js"));
  const skip = built ? false : "run `npm run build:wasm` first";

  let mod: MenuWasmModule;
  before(async () => {
    if (!built) return;
    mod = (await import(join(wasmDir, "fc_context_menu.js"))) as MenuWasmModule;
    await mod.default({ module_or_path: await readFile(join(wasmDir, "fc_context_menu_bg.wasm")) });
  });

  type Op = readonly ["move", number] | readonly ["first"] | readonly ["last"] | readonly ["type", string] | readonly ["reset"] | readonly ["set", number];

  function apply(m: MenuModelLike, op: Op): unknown {
    switch (op[0]) {
      case "move": return m.move(op[1]);
      case "first": return m.focusFirst();
      case "last": return m.focusLast();
      case "type": return m.typeahead(op[1]);
      case "reset": return m.resetTypeahead();
      case "set": return m.setActive(op[1]);
    }
  }

  /** Runs `ops` on both models and requires the same answer after every step. */
  function agree(labels: string[], focusable: boolean[], ops: readonly Op[]): void {
    const js = new MenuModel(labels, focusable);
    const wasm = new WasmMenuModel(mod, labels, focusable);
    ops.forEach((op, step) => {
      const a = apply(js, op);
      const b = apply(wasm, op);
      const where = `step ${step} (${op.join(" ")})`;
      assert.equal(b, a, `return value diverged at ${where}`);
      assert.equal(wasm.activeIndex, js.activeIndex, `active index diverged at ${where}`);
    });
  }

  it("agrees on arrows, Home and End across separators and disabled items", { skip }, () => {
    agree(LABELS, FOCUSABLE, [
      ["first"], ["move", 1], ["move", 1], ["move", 1], ["move", 1], ["move", 1],
      ["move", -1], ["move", -2], ["last"], ["move", 7], ["move", -1_000_003], ["first"],
    ]);
  });

  it("agrees on typeahead: buffering, cycling, misses, and resets", { skip }, () => {
    agree(LABELS, FOCUSABLE, [
      ["first"], ["type", "c"], ["type", "c"], ["type", "c"], ["type", "w"], ["type", "r"],
      ["type", "z"], ["type", "d"], ["reset"], ["type", "l"], ["type", "i"], ["type", "x"],
      ["type", "P"], ["type", "D"], ["type", "d"], ["type", "W"], ["type", "R"], ["move", 1], ["type", ""],
    ]);
  });

  it("agrees when focus starts nowhere or outside the list", { skip }, () => {
    agree(LABELS, FOCUSABLE, [["move", 1], ["set", 99], ["move", -1], ["set", -1], ["type", "d"]]);
  });

  it("agrees on non-ASCII labels, including an astral repeat", { skip }, () => {
    // An astral character is two UTF-16 code units and one Rust char. Taking
    // `query[0]` in JS would break the repeating rule on exactly this input.
    const labels = ["Élan", "éclair", "😀 Smile", "😀 Grin", "Ärger", "Straße", "İstanbul", "ΟΔΟΣ"];
    const focusable = labels.map(() => true);
    agree(labels, focusable, [
      ["type", "é"], ["type", "é"], ["type", "😀"], ["type", "😀"], ["type", "😀"],
      ["reset"], ["type", "Ä"], ["type", "s"], ["type", "t"], ["reset"], ["type", "İ"],
      ["reset"], ["type", "Ο"], ["type", "Δ"],
    ]);
  });

  it("agrees on degenerate menus", { skip }, () => {
    agree([], [], [["first"], ["last"], ["move", 1], ["type", "a"]]);
    agree(["A", "B"], [false, false], [["first"], ["move", 1], ["type", "a"]]);
    agree(["Only"], [true], [["first"], ["move", 5], ["move", -5], ["type", "o"], ["type", "o"]]);
  });
});
