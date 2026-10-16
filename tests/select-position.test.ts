import assert from "node:assert/strict";
import { test } from "node:test";
import { FutureCssSelect } from "../src/js/select.ts";

test("a flipped select stays above the trigger, inside the viewport, and clears stale edges", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { innerHeight: 800 } });
  const properties = new Map<string, string>();
  let anchor = { top: 730, bottom: 760, left: 200, width: 120 };
  const binding = Object.assign(Object.create(FutureCssSelect.prototype), {
    invoker: { getBoundingClientRect: () => anchor },
    list: { style: { setProperty: (key: string, value: string) => properties.set(key, value) } },
  });
  try {
    binding.position();
    const bottom = 800 - parseFloat(properties.get("inset-block-end")!);
    const popupHeight = 190;
    assert.ok(bottom - popupHeight >= 0, "every option is inside the viewport");
    assert.equal(bottom, anchor.top - 2, "the popup ends just before its trigger");
    assert.equal(properties.get("inset-block-start"), "auto");
    anchor = { ...anchor, top: 100, bottom: 130 };
    binding.position();
    assert.equal(properties.get("inset-block-end"), "auto", "reopening below clears the old end edge");
    assert.equal(parseFloat(properties.get("inset-block-start")!), anchor.bottom + 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
