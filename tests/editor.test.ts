/**
 * Editor binding tests.
 *
 * The selection logic is the part that decides what the toolbar *claims* about
 * the current selection, so it gets the most coverage. A toolbar that reports
 * Bold as active over a half-bold selection is a lie, and it is the kind of lie
 * that erodes trust in an editor.
 *
 * These run without a DOM. `selection.ts` and `urls.ts` are pure functions over
 * nodes, so the browser is exercised where it is genuinely needed (see
 * `editor.dom.test.ts`, which is skipped when no DOM implementation is present).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkUrl, isSafeUrl } from "../src/js/urls.ts";

describe("URL safety", () => {
  const allowed = [
    "https://example.com",
    "http://example.com",
    "HTTPS://EXAMPLE.COM",
    "mailto:someone@example.com",
    "tel:+15551234567",
    "ftp://files.example.com",
    "  https://example.com  ",
    "/absolute/path",
    "./relative",
    "../parent",
    "#fragment",
    "?query=1",
    "plain-relative",
  ];

  for (const url of allowed) {
    it(`allows ${JSON.stringify(url)}`, () => {
      assert.ok(isSafeUrl(url), `${url} should be allowed`);
    });
  }

  const blocked: ReadonlyArray<readonly [string, string]> = [
    ["javascript:alert(1)", "javascript"],
    ["JavaScript:alert(1)", "javascript"],
    // The tab is the classic bypass: browsers strip control characters from URLs
    // before parsing, so `java\tscript:` reaches the same place.
    ["java\tscript:alert(1)", "javascript"],
    ["java\nscript:alert(1)", "javascript"],
    [" javascript:alert(1)", "javascript"],
    ["data:text/html,<script>alert(1)</script>", "data"],
    ["vbscript:msgbox(1)", "vbscript"],
    ["file:///etc/passwd", "file"],
    ["blob:https://example.com/uuid", "blob"],
    ["about:blank", "about"],
    ["unknownscheme:payload", "unknownscheme"],
    ["jAvAsCrIpT:alert(1)", "javascript"],
  ];

  for (const [url, scheme] of blocked) {
    it(`blocks ${JSON.stringify(url)}`, () => {
      assert.equal(isSafeUrl(url), false, `${url} must be blocked`);
      const verdict = checkUrl(url);
      assert.equal(verdict.safe, false);
      if (!verdict.safe) {
        assert.equal(verdict.scheme, scheme.toLowerCase());
      }
    });
  }

  it("uses an allowlist, not a blocklist", () => {
    // A scheme nobody has thought of yet must fail closed. This is the property
    // that makes the filter future-proof; a blocklist is always one behind.
    for (const scheme of ["jar", "view-source", "chrome", "resource", "wyciwyg"]) {
      assert.equal(isSafeUrl(`${scheme}:payload`), false, `${scheme}: must fail closed`);
    }
  });

  it("explains why a URL was refused", () => {
    // A boolean forces callers to either say nothing or invent their own wording,
    // and "link blocked" with no reason gets reported as a bug.
    const dangerous = checkUrl("javascript:alert(1)");
    assert.equal(dangerous.safe, false);
    if (!dangerous.safe) assert.equal(dangerous.reason, "dangerous-scheme");

    const unknown = checkUrl("madeup:thing");
    assert.equal(unknown.safe, false);
    if (!unknown.safe) assert.equal(unknown.reason, "unknown-scheme");

    assert.deepEqual(checkUrl("https://example.com"), { safe: true });
  });

  it("isSafeUrl always agrees with checkUrl", () => {
    // Two entry points for one decision is a drift risk; this pins them together.
    const cases = [...allowed, ...blocked.map(([u]) => u), "", "   ", "://x"];
    for (const url of cases) {
      assert.equal(
        isSafeUrl(url),
        checkUrl(url).safe,
        `disagreement on ${JSON.stringify(url)}`,
      );
    }
  });

  it("handles empty and whitespace input without throwing", () => {
    assert.doesNotThrow(() => isSafeUrl(""));
    assert.doesNotThrow(() => isSafeUrl("   "));
    assert.doesNotThrow(() => checkUrl(""));
  });
});