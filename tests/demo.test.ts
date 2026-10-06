/**
 * Demo server smoke test.
 *
 * Nothing else imports demo/server.mjs: the browser tests run against their own
 * fixture server. So a syntax error in it left `npm run check` green while
 * `npm run demo` crashed on startup. Starting it here is the cheapest way to make
 * that failure visible to the gate.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startDemoServer } from "../demo/server.mjs";

describe("demo server", () => {
  it("serves the page and a type-stripped binding", async () => {
    const server = await startDemoServer(0);
    try {
      const page = await fetch(`${server.origin}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
      await page.body?.cancel();

      const binding = await fetch(`${server.origin}/src/js/editor.js`);
      assert.equal(binding.status, 200);
      assert.match(binding.headers.get("content-type") ?? "", /^text\/javascript/);
      await binding.body?.cancel();
    } finally {
      await server.close();
    }
  });
});
