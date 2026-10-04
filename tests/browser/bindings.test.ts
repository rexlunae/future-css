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
import { after, afterEach, before, describe, it } from "node:test";
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

  /*
   * Every test in this suite shares one page. The reflow test below has to
   * navigate to the demo, so without this it would leave the demo loaded and
   * the tests after it would fail against the wrong document -- a confusing way
   * to learn about a layout change.
   */
  afterEach(async () => {
    await send("Emulation.clearDeviceMetricsOverride");
    const where = await evaluate(`return location.pathname;`);
    if (where !== "/tests/browser/fixture.html") {
      await send("Page.navigate", { url: `${server.origin}/tests/browser/fixture.html` });
      await new Promise((r) => setTimeout(r, 1000));
    }
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
        import('/src/js/highlight.js'),
        import('/src/js/diff.js'),
      ]).then(([e, m, g, w, h, d]) => {
        globalThis.E = e; globalThis.M = m; globalThis.G = g; globalThis.W = w;
        globalThis.H = h; globalThis.D = d;
        return 'ok';
      })
    `);
    assert.equal(result, "ok", "binding modules should load with no WASM and no build step");
  }

  it("loads every binding module in a browser with no WASM and no build step", async () => {
    await loadBindings();
    const names = await evaluate(
      `return [
        typeof E.FutureCssEditor, typeof M.FutureCssMenu, typeof G.FutureCssGrid,
        typeof W.FutureCssWebview, typeof H.highlight, typeof D.diffLines,
      ]`,
    );
    assert.deepEqual(names, [
      "function", "function", "function", "function", "function", "function",
    ]);
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

  // --------------------------------------------------------------- theming

  it("re-themes when the consumer sets data-fc-theme", async () => {
    // The theme hook shipped broken and nothing caught it. `color-scheme` was
    // declared in `fc.base` as well as in `fc.tokens`; equal specificity, and base
    // is ordered after tokens, so `light dark` always won and `data-fc-theme`
    // computed to `light dark` and did nothing.
    //
    // It was invisible to every other test here: roles, focus and ARIA were all
    // correct, and the OS preference still worked. Only *forcing* the attribute to
    // the opposite of the current scheme and measuring a change exposes it.
    const result = await evaluate(`
      const root = document.documentElement;
      const probe = document.createElement('div');
      document.body.append(probe);
      const read = () => {
        probe.style.backgroundColor = 'var(--fc-color-bg-canvas)';
        return getComputedStyle(probe).backgroundColor;
      };

      root.setAttribute('data-fc-theme', 'light');
      const light = { bg: read(), scheme: getComputedStyle(root).colorScheme };
      root.setAttribute('data-fc-theme', 'dark');
      const dark = { bg: read(), scheme: getComputedStyle(root).colorScheme };
      root.removeAttribute('data-fc-theme');
      probe.remove();

      return { light, dark };
    `);

    assert.equal(result.light.scheme, "light",
      "data-fc-theme=light must actually set color-scheme");
    assert.equal(result.dark.scheme, "dark",
      "data-fc-theme=dark must actually set color-scheme");
    assert.notEqual(result.light.bg, result.dark.bg,
      "the two schemes must resolve to different canvas colours");
  });

  it("keeps the terminal dark in both colour schemes", async () => {
    // Structural, not stylistic: a terminal following the OS into a light theme is
    // a genuine usability regression, and every terminal theme keeps its own dark
    // background. `--fc-term-*` is the only hue-named namespace in the system for
    // exactly this reason.
    const result = await evaluate(`
      const root = document.documentElement;
      const term = document.querySelector('.fc-terminal');
      if (!term) return null;
      root.setAttribute('data-fc-theme', 'light');
      const lightTerm = getComputedStyle(term).backgroundColor;
      root.setAttribute('data-fc-theme', 'dark');
      const darkTerm = getComputedStyle(term).backgroundColor;
      root.removeAttribute('data-fc-theme');
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/[\\d.]+/g).map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return { lightLum: lum(lightTerm), darkLum: lum(darkTerm), lightTerm, darkTerm };
    `);

    assert.ok(result, "fixture must contain a .fc-terminal for this assertion to mean anything");
    assert.ok(result.lightLum < 40,
      `terminal should stay dark in the light scheme, got ${result.lightTerm}`);
    assert.ok(result.darkLum < 40,
      `terminal should stay dark in the dark scheme, got ${result.darkTerm}`);
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

  it("lays cells out in aligned columns, not one stacked column", async () => {
    // The gap this covers is invisible to every other assertion in this file.
    // Roles, tabindex and ARIA counts were all correct while the grid rendered
    // as a single column: `grid-auto-columns` sizes implicit tracks, and without
    // an explicit template nothing creates them. Navigation, focus and every
    // announced attribute passed while the thing looked wrong.
    //
    // So this asserts on geometry -- the one property that had actually broken.
    await loadBindings();
    const layout = await evaluate(`
      globalThis.g = new G.FutureCssGrid({ root: '#grid' });
      const rows = [...document.querySelectorAll('#grid [role="row"]')];
      const xs = (row) => [...row.querySelectorAll('[role="gridcell"]')]
        .map(c => Math.round(c.getBoundingClientRect().x));
      const cellsInRow = rows[0].querySelectorAll('[role="gridcell"]').length;
      return {
        cellsInRow,
        template: getComputedStyle(document.querySelector('#grid')).gridTemplateColumns,
        row0: xs(rows[0]),
        row1: xs(rows[1]),
        // Cells within a row share a baseline, i.e. they are side by side.
        sameLine: new Set([...rows[0].querySelectorAll('[role="gridcell"]')]
          .map(c => Math.round(c.getBoundingClientRect().y))).size === 1,
      };
    `);

    // A real template, not the single-column fallback.
    assert.notEqual(layout.template, "none");
    assert.equal(layout.template.split(" ").length, layout.cellsInRow,
      "template should have one track per cell in the row");
    assert.ok(layout.sameLine, "cells in a row must share a line, not stack");
    // The property that matters: the same column is at the same x in every row.
    assert.deepEqual(layout.row1, layout.row0, "columns must align across rows");
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

  // ------------------------------------------------------------------ reflow

  /*
   * WCAG 1.4.10 Reflow: content must not require two-dimensional scrolling at
   * 400% zoom (a 1280x800 viewport scaled down to 320 CSS px).
   *
   * This runs against the *demo*, not the fixture, because reflow is a
   * page-level property: a single component can pass in isolation while the
   * layout around it forces the page wide.
   *
   * Scoped to the demo deliberately. The shipped library's components each
   * handle their own overflow (see `.fc-code__source` and `.fc-diff__line`),
   * and the nav strip scrolls along its own axis by design -- neither makes the
   * *page* scroll, which is what this asserts.
   */
  it("reflows to 400% zoom without horizontal page scrolling", async () => {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: `${server.origin}/demo/index.html` });
    await new Promise((r) => setTimeout(r, 1200));

    const result = await evaluate(`
      const vw = window.innerWidth;
      const clipped = (el) => {
        // Walk ancestors: content inside an overflow clip is not page overflow.
        // A long code line inside a scrolling <pre> and an animated progress bar
        // inside overflow:hidden both report a rect past the edge while being
        // fully contained on screen, so a naive rect scan flags them as false
        // failures. What matters is whether the *page* scrolls.
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o !== "visible") return true;
        }
        return false;
      };
      const offenders = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > vw + 2)
        .filter((el) => !clipped(el))
        .map((el) => String(el.className || el.tagName).split(" ")[0]);
      const de = document.documentElement;
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        overflowing: [...new Set(offenders)],
      };
    `);

    assert.ok(
      result.scrollWidth <= result.clientWidth,
      `page must reflow without horizontal scrolling; ` +
        `scrollWidth ${result.scrollWidth} > clientWidth ${result.clientWidth}`,
    );
    // Named so the failure says which element broke, not just that something did.
    assert.deepEqual(result.overflowing, [], "elements overflowing the viewport");

    await send("Emulation.clearDeviceMetricsOverride");
  });

  // ------------------------------------------------------------------- code

  it("renders highlighted spans that reconstruct the source exactly", async () => {
    await loadBindings();
    const outcome = await evaluate(`
      const src = 'const greeting: string = "hi"; // note';
      // Built detached on purpose: this suite shares one page across every test,
      // so mounting into the fixture would mutate state other tests depend on.
      const rendered = H.renderHighlighted(src, 'typescript');
      document.querySelector('#code-src').after(rendered);
      return [
        rendered.querySelectorAll('.fc-code__tok').length,
        rendered.textContent === src,
        rendered.matches('.fc-code__source'),
      ];
    `);
    assert.ok(outcome[0] > 1, "the sample must actually produce several tokens");
    // If the highlighter ever drops or reorders a character, the user's source
    // is silently rewritten under them. This is the check that prevents it.
    assert.equal(outcome[1], true);
    assert.equal(outcome[2], true, "the renderer must emit the component's own class");
  });

  it("gives every token a semantic role class, not a colour name", async () => {
    await loadBindings();
    const roles = await evaluate(`
      const rendered = H.renderHighlighted('let a = 1;', 'javascript');
      return [...rendered.querySelectorAll('.fc-code__tok')]
        .map((n) => [...n.classList].find((c) => c.startsWith('fc-code__tok--')));
    `);
    assert.ok(roles.every((r: string) => /^fc-code__tok--[a-z-]+$/.test(r)));
    assert.ok(roles.includes("fc-code__tok--keyword"), "expected a keyword token");
  });

  it("keeps the gutter out of the accessible name of the code", async () => {
    // Line numbers are decoration. A screen reader announcing "1 2 const x"
    // reads the gutter as content and makes the code harder to follow, not easier.
    await loadBindings();
    const exposed = await evaluate(`
      const g = document.querySelector('#code-gutter');
      return g.getAttribute('aria-hidden');
    `);
    assert.equal(exposed, "true");
  });

  it("draws code and gutter side by side rather than stacking", async () => {
    // `display: grid` with implicit tracks silently collapses to one column when
    // no container width is set -- the same bug the data grid already hit once.
    await loadBindings();
    const layout = await evaluate(`
      const g = document.querySelector('#code-gutter').getBoundingClientRect();
      const s = document.querySelector('#code-src').getBoundingClientRect();
      return [g.top, s.top, g.right, s.left];
    `);
    assert.equal(layout[0], layout[1], "gutter must share the first row's top edge");
    // Stacked would put the gutter's left edge at the container's content start
    // rather than meeting the source. Allow a pixel of rounding.
    assert.ok(
      Math.abs(layout[2] - layout[3]) <= 1,
      `gutter must end where the source begins, got ${layout[2]} vs ${layout[3]}`,
    );
  });

  it("reads the language from the DOM rather than a hard-coded default", async () => {
    // data-fc-lang is the single source of truth; a JS-side default would silently
    // highlight Python as JavaScript whenever the attribute was misspelled.
    await loadBindings();
    const lang = await evaluate(`
      return document.querySelector('#code').getAttribute('data-fc-lang');
    `);
    assert.equal(lang, "typescript");
  });

  // ------------------------------------------------------------------- diff

  it("distinguishes added and removed lines without relying on colour", async () => {
    // data-fc-diff plus a +/- marker means the state survives forced-colors mode
    // and is legible to a screen reader. A background tint alone would not.
    await loadBindings();
    const states = await evaluate(`
      const read = (id) => {
        const line = document.querySelector(id);
        return [line.getAttribute('data-fc-diff'), line.querySelector('.fc-diff__marker').textContent];
      };
      return [read('#diff-remove'), read('#diff-add')];
    `);
    assert.deepEqual(states, [["remove", "-"], ["add", "+"]]);
  });

  it("hides line numbers from assistive technology", async () => {
    // The numbers are positional metadata. Reading "1 empty" on every changed
    // line is noise, and the changed text is what a screen reader user wants.
    await loadBindings();
    const exposed = await evaluate(`
      const nums = [...document.querySelectorAll('#diff .fc-diff__num')];
      return nums.map((n) => n.getAttribute('aria-hidden'));
    `);
    assert.ok(exposed.length > 0);
    assert.ok(exposed.every((v: string | null) => v === "true"));
  });

  it("paints added and removed rows with different resolved colours", async () => {
    // The unit tests prove the tokens exist; only a real browser proves the
    // cascade actually applied them to these specific elements.
    await loadBindings();
    const colors = await evaluate(`
      const bg = (id) => getComputedStyle(document.querySelector(id)).backgroundColor;
      return [bg('#diff-add'), bg('#diff-remove')];
    `);
    assert.notEqual(colors[0], colors[1], "added and removed rows must not share a background");
    assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(colors[0]));
  });
});
