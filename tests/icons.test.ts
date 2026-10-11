/**
 * The icon set.
 *
 * Icons are data, so most of what can go wrong is checkable without a
 * browser: a path that uses a command a consumer cannot parse, a name that
 * cannot be an id or an enum variant, a direction icon that forgets to mirror,
 * or a published copy (`dist/icons.json`, the sprite) that has drifted from
 * the source the Dioxus library generates its enum from.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ICON_NAMES, ICONS, iconMarkup, iconSprite, isIconName } from "../src/js/icons.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("icon set", () => {
  it("names every icon in lowercase kebab-case, usable as an id and an enum variant", () => {
    for (const name of ICON_NAMES) assert.match(name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, name);
  });

  it("draws every icon as one path of standard commands inside the 24-unit box", () => {
    for (const name of ICON_NAMES) {
      const { d } = ICONS[name];
      assert.match(d, /^M/, `${name} starts with a moveto`);
      assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, `${name} uses only path commands`);
      // Absolute coordinates only appear after M, L, H, V, C and A in these
      // paths; any number above 24 there would be clipped by the viewBox.
      const numbers = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      assert.ok(numbers.every((n) => Math.abs(n) <= 24), `${name} stays inside the viewBox`);
    }
  });

  it("mirrors exactly the icons that point along the line of text", () => {
    const inline = /(^|-)(start|end)$|^(send|undo|redo|external-link|sidebar)$/;
    for (const name of ICON_NAMES) {
      assert.equal(Boolean((ICONS[name] as { mirror?: boolean }).mirror), inline.test(name), name);
    }
  });

  it("has a standard set large enough for common toolbars", () => {
    for (const name of ["copy", "check", "close", "plus", "search", "edit", "trash", "download", "upload",
      "refresh", "menu", "more-horizontal", "chevron-down", "arrow-start", "info", "warning", "error",
      "send", "stop", "settings", "external-link"]) {
      assert.ok(isIconName(name), `missing ${name}`);
    }
  });
});

describe("icon markup", () => {
  it("is decorative by default", () => {
    const svg = iconMarkup("copy");
    assert.match(svg, /^<svg class="fc-icon" /);
    assert.match(svg, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(svg, /role=/);
    assert.match(svg, /stroke="currentColor"/);
  });

  it("is a named image when given a label, with the label escaped", () => {
    const svg = iconMarkup("error", { label: `Build "failed" & <stopped>` });
    assert.match(svg, /role="img" aria-label="Build &quot;failed&quot; &amp; &lt;stopped>"/);
    assert.doesNotMatch(svg, /aria-hidden/);
  });

  it("adds size and mirror modifiers", () => {
    assert.match(iconMarkup("star", { size: "lg" }), /class="fc-icon fc-icon--lg"/);
    assert.match(iconMarkup("arrow-start"), /class="fc-icon fc-icon--mirror"/);
  });

  it("throws on an unknown name instead of rendering an invisible control", () => {
    assert.throws(() => iconMarkup("nope" as never), RangeError);
    assert.equal(isIconName("constructor"), false, "inherited properties are not icons");
  });

  it("puts every icon in the sprite under a predictable id", () => {
    const sprite = iconSprite();
    for (const name of ICON_NAMES) assert.ok(sprite.includes(`<symbol id="fc-icon-${name}" viewBox="0 0 24 24">`), name);
  });
});

describe("published icon data", () => {
  const json = join(root, "dist", "icons.json");

  it("matches the source, in order, so generated bindings cannot drift", { skip: !existsSync(json) && "run npm run build:css" }, () => {
    const published = JSON.parse(readFileSync(json, "utf8"));
    assert.equal(published.viewBox, "0 0 24 24");
    assert.deepEqual(Object.keys(published.icons), [...ICON_NAMES]);
    for (const name of ICON_NAMES) {
      assert.equal(published.icons[name].d, ICONS[name].d, name);
      assert.equal(published.icons[name].mirror, Boolean((ICONS[name] as { mirror?: boolean }).mirror), name);
    }
    assert.equal(readFileSync(join(root, "dist", "icons.svg"), "utf8"), iconSprite());
  });

  it("styles the icon from the text colour, never a colour token", () => {
    const css = readFileSync(join(root, "src", "css", "components", "icon.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(css, /stroke:\s*currentColor/);
    assert.doesNotMatch(css, /--fc-color-/);
  });
});
