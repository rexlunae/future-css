/**
 * Browser binding tests.
 *
 * These run the real bindings against a real DOM in headless Chrome, because the
 * bugs worth catching here are *DOM* bugs: caret placement, selection geometry,
 * focus restoration, and ARIA state. None of them are observable from a DOM-less
 * test, and all of them are where rich text editors actually break.
 *
 * They also serve the TypeScript sources directly, which proves the bindings work
 * as the package ships them -- no bundler, no transpiler, no Rust, no WASM.
 *
 * Skipped when no Chrome is present: the zero-dependency property means this repo
 * must stay installable and testable on a machine with no browser.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findChrome, startServer } from "./server.mjs";

const chromePath = await findChrome();

describe("bindings in a real browser", { skip: chromePath ? false : "no Chrome found" }, () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let chrome: ChildProcess;
  let profileDir: string;
  // The browser-level endpoint does not serve Page or Runtime domains. Those live
  // on a *page target*, so the real session is a second connection made with that
  // target's own webSocketDebuggerUrl, obtained over HTTP.
  let browserWs: WebSocket;
  let ws: WebSocket;
  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  const browserPending = new Map<number, (v: any) => void>();

  before(async () => {
    server = await startServer();
    profileDir = await mkdtemp(join(tmpdir(), "fc-browser-"));

    chrome = spawn(chromePath!, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      "about:blank",
    ]);

    // Chrome prints the DevTools endpoint to stderr on startup. That endpoint is
    // the BROWSER target; page domains require a page target.
    const browserWsUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome did not report a DevTools URL")), 20_000);
      chrome.stderr!.on("data", (chunk: Buffer) => {
        const match = /ws:\/\/[^\s]+/.exec(chunk.toString());
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      chrome.on("exit", (code) => reject(new Error(`Chrome exited early: ${code}`)));
    });

    // Attach to the existing page target over the HTTP discovery endpoint.
    const httpOrigin = browserWsUrl.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "");
    const targets: Array<{ type: string; webSocketDebuggerUrl?: string }> = await (
      await fetch(`${httpOrigin}/json/list`)
    ).json();
    const pageTarget = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error("no page target available from Chrome");

    browserWs = new WebSocket(browserWsUrl);
    await new Promise<void>((r) => browserWs.addEventListener("open", () => r()));
    browserWs.addEventListener("message", (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && browserPending.has(msg.id)) {
        browserPending.get(msg.id)!(msg);
        browserPending.delete(msg.id);
      }
    });

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl!);
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    ws.addEventListener("message", (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url: `${server.origin}/tests/browser/fixture.html` });
    // The load event is not always delivered over this transport, so the wait is
    // unconditional and short rather than racy.
    await new Promise((r) => setTimeout(r, 1000));
  });

  after(async () => {
    try {
      ws?.close();
      browserWs?.close();
      chrome?.kill();
      await server?.close();
      await rm(profileDir, { recursive: true, force: true });
    } catch {
      // Teardown must not fail the suite on a machine that is shutting down.
    }
  });

  /** Sends a CDP command and resolves with its result. */
  function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates an expression in the page and returns its value. */
  async function evaluate(expression: string): Promise<any> {
    const res = await send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const detail = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
      throw new Error(detail.split("\n")[0]);
    }
    // CDP nests the remote-object: { result: { result: { value } } }. The inner
    // `result` is Runtime.evaluate's RemoteObject, so the value is two levels in.
    return res.result?.result?.value;
  }

  /** Loads the binding modules into the page. */
  async function loadBindings(): Promise<void> {
    const result = await evaluate(`
      return Promise.all([
        import('/src/js/editor.js'),
        import('/src/js/menu.js'),
        import('/src/js/grid.js'),
        import('/src/js/webview.js'),
      ]).then(([e, m, g, w]) => {
        globalThis.E = e; globalThis.M = m; globalThis.G = g; globalThis.W = w;
        return 'ok';
      })
    `);
    assert.equal(result, "ok", "binding modules should load with no WASM and no build step");
  }

  it("loads every binding module in a browser with no WASM and no build step", async () => {
    await loadBindings();
    const names = await evaluate(
      `return [typeof E.FutureCssEditor, typeof M.FutureCssMenu, typeof G.FutureCssGrid, typeof W.FutureCssWebview]`,
    );
    assert.deepEqual(names, ["function", "function", "function", "function"]);
  });
  // ---------------------------------------------------------------- editor

  it("wraps a selection in a mark without losing the text", async () => {
    await loadBindings();
    const html = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.focus(); el.innerHTML = 'Hello plain text here';
      const r = document.createRange();
      r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 5);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.applyMark('bold');
      return el.innerHTML;
    `);
    assert.equal(html, "<strong>Hello</strong> plain text here");
  });

  it("reports the applied mark in the toolbar via aria-pressed", async () => {
    // Regression. After wrapping, the browser empties the original text node and
    // parks the caret inside it -- connected, but *outside* the element it just
    // created. The toolbar therefore read "not bold" immediately after bolding,
    // and a second click could not toggle it back off.
    await loadBindings();
    const pressed = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.focus(); el.innerHTML = 'Hello plain text here';
      const r = document.createRange();
      r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 5);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.applyMark('bold');
      return document.querySelector('[data-fc-mark="bold"]').getAttribute('aria-pressed');
    `);
    assert.equal(pressed, "true");
  });

  it("toggles a mark OFF at a collapsed caret, keeping the text", async () => {
    // Regression. `Range.intersectsNode` is false for a zero-length range, so the
    // lookup used to unwrap marks returned nothing and un-bolding silently did
    // nothing -- the single most common toolbar interaction.
    await loadBindings();
    const html = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.focus(); el.innerHTML = 'Hello plain text here';
      const r = document.createRange();
      r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 5);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.applyMark('bold');
      globalThis.ed.applyMark('bold');
      return el.innerHTML;
    `);
    assert.equal(html, "Hello plain text here", "un-bolding must never delete text");
  });

  it("does not report a mark active when only part of the selection has it", async () => {
    // The toolbar must never lie about a partial selection.
    await loadBindings();
    const active = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = '<strong>bo</strong>ld plain';
      const r = document.createRange();
      r.setStart(el.firstChild.firstChild, 0); r.setEnd(el.lastChild, 4);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return globalThis.ed.isMarkActive('bold');
    `);
    assert.equal(active, false);
  });

  it("refuses a javascript: link and leaves the text untouched", async () => {
    await loadBindings();
    const html = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = 'click here';
      const r = document.createRange();
      r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 5);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const original = window.prompt;
      window.prompt = () => 'javascript:alert(1)';
      globalThis.ed.applyMark('link');
      window.prompt = original;
      return el.innerHTML;
    `);
    assert.equal(html, "click here", "a refused link must not be inserted");
  });

  // ----------------------------------------------------------------- grid

  it("keeps exactly one cell tabbable (roving tabindex)", async () => {
    // A grid where every cell is a tab stop needs 9 presses of Tab to leave a
    // 3x3; a 10,000-cell grid is unusable. One tab stop is the whole mechanism.
    await loadBindings();
    const count = await evaluate(`
      globalThis.g = new G.FutureCssGrid({ root: '#grid' });
      return Array.from(document.querySelectorAll('#grid [role="gridcell"]'))
        .filter((c) => c.getAttribute('tabindex') === '0').length;
    `);
    assert.equal(count, 1);
  });

  it("publishes row and column counts for a virtualized grid", async () => {
    await loadBindings();
    const attrs = await evaluate(`
      globalThis.g = new G.FutureCssGrid({ root: '#grid' });
      const root = document.querySelector('#grid');
      return [root.getAttribute('role'), root.getAttribute('aria-rowcount'), root.getAttribute('aria-colcount')];
    `);
    assert.deepEqual(attrs, ["grid", "3", "3"]);
  });

  it("moves the active cell with the arrow keys", async () => {
    await loadBindings();
    const cell = await evaluate(`
      globalThis.g = new G.FutureCssGrid({ root: '#grid' });
      document.querySelector('#grid [role="gridcell"]').focus();
      document.querySelector('#grid').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return globalThis.g.activeCell;
    `);
    assert.deepEqual(cell, { row: 0, col: 1 });
  });

  it("extends the selection with Shift+Arrow", async () => {
    await loadBindings();
    const inSelection = await evaluate(`
      globalThis.g = new G.FutureCssGrid({ root: '#grid' });
      document.querySelector('#grid [role="gridcell"]').focus();
      document.querySelector('#grid').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.querySelector('#grid').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, shiftKey: true }));
      return [
        globalThis.g.isInSelection({ row: 0, col: 1 }),
        globalThis.g.isInSelection({ row: 1, col: 1 }),
        globalThis.g.isInSelection({ row: 1, col: 2 }),
      ];
    `);
    // The anchor stays selected while the focus edge extends: spreadsheet behavior.
    assert.deepEqual(inSelection, [true, true, false]);
  });

  it("opens an input editor when a cell is activated", async () => {
    await loadBindings();
    const hasInput = await evaluate(`
      globalThis.g = new G.FutureCssGrid({ root: '#grid' });
      const cells = Array.from(document.querySelectorAll('#grid [role="gridcell"]'));
      const active = cells.find((c) => c.getAttribute('tabindex') === '0');
      active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return !!active.querySelector('input.fc-grid__cell-input');
    `);
    assert.equal(hasInput, true);
  });

  // ----------------------------------------------------------------- menu

  it("opens the menu and focuses its first item", async () => {
    await loadBindings();
    const focused = await evaluate(`
      const trigger = document.querySelector('#trigger');
      globalThis.m = new M.FutureCssMenu({ menu: document.querySelector('#menu'), invoker: trigger });
      trigger.focus();
      globalThis.m.open({ x: 10, y: 10 });
      return document.activeElement.textContent.trim();
    `);
    assert.equal(focused, "Cut");
  });

  it("skips aria-disabled items during arrow navigation", async () => {
    // A disabled item that still takes focus is a keyboard trap for a menu that
    // offers no way past it.
    //
    // This navigates a *fresh* menu element. Earlier tests construct controllers
    // on the same fixture markup, and each one registers its own keydown listener;
    // reusing the element would have several stale controllers moving focus at
    // once. That is a test-fixture artifact rather than a product bug -- a page
    // has one controller per menu -- but it produces a convincing wrong answer.
    await loadBindings();
    const labels: string[] = await evaluate(`
      const menu = document.querySelector('#menu').cloneNode(true);
      menu.id = 'menu-isolated';
      // Appended beside the original rather than replacing it, so tests that
      // still reference #menu keep working.
      document.body.appendChild(menu);
      const trigger = document.querySelector('#trigger');
      globalThis.m = new M.FutureCssMenu({ menu, invoker: trigger });
      trigger.focus();
      globalThis.m.open({ x: 0, y: 0 });
      const seen = [];
      for (let i = 0; i < 4; i += 1) {
        seen.push(document.activeElement.textContent.trim());
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      }
      return seen;
    `);
    // Cut, Copy, skip Paste, Delete, then wrap back to Cut.
    assert.deepEqual(labels, ["Cut", "Copy", "Delete", "Cut"], "'Paste' is aria-disabled and must be skipped");
  });

  it("restores focus to the invoker on Escape", async () => {
    // The behavior that makes Escape feel right, and without which a menu strands
    // keyboard users at the top of the document.
    await loadBindings();
    const [open, activeId] = await evaluate(`
      const trigger = document.querySelector('#trigger');
      globalThis.m = new M.FutureCssMenu({ menu: document.querySelector('#menu'), invoker: trigger });
      trigger.focus();
      globalThis.m.open({ x: 0, y: 0 });
      document.querySelector('#menu').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return [globalThis.m.isOpen, document.activeElement.id];
    `);
    assert.equal(open, false);
    assert.equal(activeId, "trigger");
  });

  it("moves focus by typeahead", async () => {
    await loadBindings();
    const focused = await evaluate(`
      const trigger = document.querySelector('#trigger');
      globalThis.m = new M.FutureCssMenu({ menu: document.querySelector('#menu'), invoker: trigger });
      globalThis.m.open({ x: 0, y: 0 });
      document.querySelector('#menu').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
      const label = document.activeElement.textContent.trim();
      globalThis.m.close();
      return label;
    `);
    assert.equal(focused, "Delete");
  });

  // -------------------------------------------------------------- webview

  it("applies security attributes to the embedded frame", async () => {
    await loadBindings();
    const [sandbox, referrer, allow] = await evaluate(`
      globalThis.w = new W.FutureCssWebview({ root: '#wv' });
      const f = document.querySelector('#wv iframe');
      return [f.getAttribute('sandbox'), f.getAttribute('referrerpolicy'), f.getAttribute('allow')];
    `);
    assert.ok(sandbox, "a frame must be sandboxed");
    assert.equal(referrer, "strict-origin-when-cross-origin");
    assert.equal(allow, "");
  });

  it("does not grant same-origin by default", async () => {
    // `allow-same-origin` on a frame that also allows scripts would let the embedded
    // page reach this origin's cookies and storage. Omitting it is the default.
    await loadBindings();
    const sameOrigin = await evaluate(`
      globalThis.w = new W.FutureCssWebview({ root: '#wv' });
      return document.querySelector('#wv iframe').getAttribute('sandbox')
        .includes('allow-same-origin');
    `);
    assert.equal(sameOrigin, false);
  });

  it("refuses a javascript: navigation", async () => {
    await loadBindings();
    const [unchanged, state] = await evaluate(`
      globalThis.w = new W.FutureCssWebview({ root: '#wv' });
      const before = document.querySelector('#wv iframe').src;
      globalThis.w.navigate('javascript:alert(1)');
      return [
        document.querySelector('#wv iframe').src === before,
        document.querySelector('#wv').dataset.fcState,
      ];
    `);
    assert.equal(unchanged, true);
    assert.equal(state, "error");
  });

  it("enables back only once there is history to go back to", async () => {
    await loadBindings();
    const [afterFirst, afterSecond] = await evaluate(`
      globalThis.w = new W.FutureCssWebview({ root: '#wv' });
      const back = () => document.querySelector("[data-fc-action='back']").hasAttribute('disabled');
      globalThis.w.navigate('https://example.com/');
      const first = back();
      globalThis.w.navigate('https://example.org/');
      return [first, back()];
    `);
    assert.equal(afterFirst, true, "one navigation means nothing precedes it");
    assert.equal(afterSecond, false);
  });

  it("walks history backwards", async () => {
    await loadBindings();
    const moved = await evaluate(`
      globalThis.w = new W.FutureCssWebview({ root: '#wv' });
      globalThis.w.navigate('https://example.com/');
      globalThis.w.navigate('https://example.org/');
      const moved = globalThis.w.back();
      return [moved, document.querySelector('#wv iframe').src.includes('example.com')];
    `);
    assert.deepEqual(moved, [true, true]);
  });
});
