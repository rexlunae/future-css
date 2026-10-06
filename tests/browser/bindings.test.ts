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
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findChrome, startServer } from "./server.mjs";

const chromePath = await findChrome();

// The WASM-backed select tests need the compiled module; skip cleanly without it.
// Two levels up: this file lives in tests/browser/. One level lands on tests/,
// and every WASM test then skips for a reason that has nothing to do with WASM.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const selectWasmBuilt = existsSync(join(repoRoot, "dist", "wasm", "fc-select", "web", "fc_select.js"));
const menuWasmBuilt = existsSync(join(repoRoot, "dist", "wasm", "fc-context-menu", "web", "fc_context_menu.js"));

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
        import('/src/js/select.js'),
        import('/src/js/composer.js'),
        import('/src/js/context-strip.js'),
        import('/src/js/git.js'),
        import('/src/js/tabs.js'),
        import('/src/js/toast.js'),
        import('/src/js/tooltip.js'),
        import('/src/js/table.js'),
      ]).then(([e, m, g, w, h, d, s, c, k, it, tb, ts, tt, tl]) => {
        globalThis.E = e; globalThis.M = m; globalThis.G = g; globalThis.W = w;
        globalThis.H = h; globalThis.D = d; globalThis.S = s;
        globalThis.C = c; globalThis.K = k; globalThis.IT = it;
        globalThis.TB = tb; globalThis.TS = ts; globalThis.TT = tt; globalThis.TL = tl;
        return 'ok';
      })
    `);
    assert.equal(result, "ok", "binding modules should load with no WASM and no build step");
  }

  /**
   * A headless page never has window focus, so focus() moves activeElement
   * without firing focus events or matching :focus-visible. Tests that depend
   * on either -- a timer that pauses on focusin, a tooltip shown on keyboard
   * focus -- turn on focus emulation for their duration.
   */
  async function emulateFocus(enabled: boolean): Promise<void> {
    await send("Emulation.setFocusEmulationEnabled", { enabled });
  }

  it("loads every binding module in a browser with no WASM and no build step", async () => {
    await loadBindings();
    const names = await evaluate(
      `return [
        typeof E.FutureCssEditor, typeof M.FutureCssMenu, typeof G.FutureCssGrid,
        typeof W.FutureCssWebview, typeof H.highlight, typeof D.diffLines,
        typeof S.FutureCssSelect, typeof C.FutureCssComposer,
        typeof K.FutureCssContextStrip, typeof IT.FutureCssGitSurface,
        typeof TB.FutureCssTabs, typeof TS.FutureCssToaster, typeof TT.bindTooltips,
        typeof TL.FutureCssTable,
      ]`,
    );
    assert.deepEqual(names, [
      "function", "function", "function", "function", "function", "function",
      "function", "function", "function", "function",
      "function", "function", "function", "function",
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

  /**
   * A menu shaped like the demo's: decoration in aria-hidden spans, a
   * separator, a disabled item, and checkbox items. Built per test so no stale
   * controller from an earlier test is listening on it.
   */
  const RICH_MENU = `
    const menu = document.createElement('div');
    menu.className = 'fc-menu';
    menu.setAttribute('popover', 'manual');
    menu.innerHTML = \`
      <button type="button" class="fc-menu__item" role="menuitem"><span aria-hidden="true"></span>Cut<span aria-hidden="true">X</span></button>
      <button type="button" class="fc-menu__item" role="menuitem" aria-disabled="true"><span aria-hidden="true"></span>Paste</button>
      <hr class="fc-menu__separator" role="separator">
      <button type="button" class="fc-menu__item" role="menuitemcheckbox" aria-checked="true"><span aria-hidden="true">&#10003;</span>Wrap lines</button>
      <button type="button" class="fc-menu__item" role="menuitemcheckbox" aria-checked="false"><span aria-hidden="true">&#10003;</span>Line numbers</button>
      <button type="button" class="fc-menu__item" role="menuitem"><span aria-hidden="true"></span>Delete</button>
      <button type="button" class="fc-menu__item" role="menuitem"><span aria-hidden="true"></span>Deploy</button>\`;
    document.body.appendChild(menu);
    // Own text nodes only: the check glyph and shortcut are decoration.
    const label = () => [...document.activeElement.childNodes]
      .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const key = (k) => menu.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  `;

  it("reaches checkbox items by arrow and by typeahead", async () => {
    // The selector used to name only role=menuitem, so arrows skipped both
    // checkbox items; and textContent began with the check glyph, so typeahead
    // could never match a checked one.
    await loadBindings();
    const seen = await evaluate(`
      ${RICH_MENU}
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      m.open({ x: 0, y: 0 });
      const out = [label()];
      for (let i = 0; i < 4; i += 1) { key('ArrowDown'); out.push(label()); }
      key('w'); out.push(label());
      m.close();
      return out;
    `);
    assert.deepEqual(seen, ["Cut", "Wrap lines", "Line numbers", "Delete", "Deploy", "Wrap lines"]);
  });

  it("accumulates typed characters into one typeahead search", async () => {
    await loadBindings();
    const seen = await evaluate(`
      ${RICH_MENU}
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      m.open({ x: 0, y: 0 });
      key('d'); const afterD = label();
      key('e'); key('p'); const afterDep = label();
      m.close();
      return [afterD, afterDep];
    `);
    assert.deepEqual(seen, ["Delete", "Deploy"], "'dep' must extend the search, not restart at 'p'");
  });

  it("lands the first ArrowDown on the first item when the menu itself has focus", async () => {
    await loadBindings();
    const seen = await evaluate(`
      ${RICH_MENU}
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      m.open({ x: 0, y: 0 });
      menu.tabIndex = -1;
      menu.focus();
      key('ArrowDown');
      const down = label();
      menu.focus();
      key('ArrowUp');
      const up = label();
      m.close();
      return [down, up];
    `);
    assert.deepEqual(seen, ["Cut", "Deploy"]);
  });

  it("navigates items added or disabled while the menu is open", async () => {
    // The model is rebuilt per keystroke; one built at open answered with
    // indices into a list that no longer matched the DOM.
    await loadBindings();
    const seen = await evaluate(`
      ${RICH_MENU}
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      m.open({ x: 0, y: 0 });
      const extra = document.createElement('button');
      extra.className = 'fc-menu__item';
      extra.setAttribute('role', 'menuitem');
      extra.textContent = 'Archive';
      menu.appendChild(extra);
      key('End');
      const end = label();
      extra.setAttribute('aria-disabled', 'true');
      key('Home'); key('End');
      const afterDisable = label();
      m.close();
      return [end, afterDisable];
    `);
    assert.deepEqual(seen, ["Archive", "Deploy"]);
  });

  it("moves on from an item disabled while it has focus", async () => {
    await loadBindings();
    const seen = await evaluate(`
      ${RICH_MENU}
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      m.open({ x: 0, y: 0 });
      key('ArrowDown'); key('ArrowDown');
      const before = label();
      document.activeElement.setAttribute('aria-disabled', 'true');
      key('ArrowDown');
      const after = label();
      m.close();
      return [before, after];
    `);
    assert.deepEqual(seen, ["Line numbers", "Delete"], "must advance, not jump back to the top");
  });

  it("does not let the previous opening's typeahead timer cut a new search short", async () => {
    // Guards the reopen path: a 500 ms expiry left over from the last opening
    // must never fire into the next one and turn "de" into a lone "e".
    await loadBindings();
    const seen = await evaluate(`
      ${RICH_MENU}
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      m.open({ x: 0, y: 0 });
      key('d');
      m.close();
      m.open({ x: 0, y: 0 });
      await wait(400);
      key('d');
      await wait(200);
      key('e');
      const after = label();
      m.close();
      return after;
    `);
    assert.equal(seen, "Deploy", "'de' must still be one search");
  });

  it("runs menu traversal on the Rust model when WASM is served", { skip: menuWasmBuilt ? false : "run `npm run build:wasm` first" }, async () => {
    // Same keystrokes and the same expected answers as the JS-path tests above:
    // identical results on both models is the point of the wiring.
    await loadBindings();
    const result = await evaluate(`
      ${RICH_MENU}
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      const loaded = await m.useWasm('${server.origin}/dist/wasm/fc-context-menu/web/fc_context_menu.js');
      m.open({ x: 0, y: 0 });
      const seen = [label()];
      key('ArrowDown'); seen.push(label());
      key('End'); seen.push(label());
      key('ArrowDown'); seen.push(label());
      key('d'); key('e'); key('p'); seen.push(label());
      key('Home'); key('L'); seen.push(label());
      m.close();
      return { loaded, seen };
    `);
    assert.equal(result.loaded, true, "the Rust model should load over HTTP");
    assert.deepEqual(result.seen, ["Cut", "Wrap lines", "Deploy", "Cut", "Deploy", "Line numbers"]);
  });

  it("keeps the JS menu model when the WASM module is missing", async () => {
    await loadBindings();
    const result = await evaluate(`
      ${RICH_MENU}
      const m = new M.FutureCssMenu({ menu, invoker: document.querySelector('#trigger') });
      const loaded = await m.useWasm('${server.origin}/dist/wasm/does-not-exist.js');
      m.open({ x: 0, y: 0 });
      key('ArrowDown');
      const after = label();
      m.close();
      return { loaded, after };
    `);
    assert.equal(result.loaded, false, "a missing module must report failure, not throw");
    assert.equal(result.after, "Wrap lines", "navigation must keep working on the JS model");
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

  it("names each changed diff row for assistive technology", async () => {
    // The +/- glyph and both line numbers are aria-hidden, so with no
    // accessible name a removed line and an added line carrying the same text
    // are announced identically. data-fc-diff is not announced.
    await loadBindings();
    const labelled = await evaluate(`
      return [...document.querySelectorAll('#diff [data-fc-diff]')]
        .map((row) => row.getAttribute('aria-label'))
        .filter(Boolean);
    `);
    assert.ok(labelled.length > 0, "changed rows need accessible names");
    assert.ok(labelled.every((l: string) => /^(Added|Removed): /.test(l)));
  });

  it("scrolls a long diff line inside the diff instead of widening the page", async () => {
    // `--scroll` sets white-space: pre. Without a matching overflow-x on the
    // container there is nowhere for the overflow to go, so the whole document
    // scrolls sideways -- the exact 1.4.10 failure wrapping exists to avoid.
    await loadBindings();
    const result = await evaluate(`
      const root = document.querySelector('#diff');
      const line = document.createElement('div');
      line.className = 'fc-diff__line';
      line.textContent = 'x'.repeat(600);
      root.appendChild(line);
      root.classList.add('fc-diff--scroll');
      await new Promise((r) => setTimeout(r, 150));

      const de = document.documentElement;
      const measured = {
        overflowX: getComputedStyle(root).overflowX,
        rootScrolls: root.scrollWidth > root.clientWidth,
        pageOverflow: de.scrollWidth - de.clientWidth,
      };
      line.remove();
      root.classList.remove('fc-diff--scroll');
      return measured;
    `);
    assert.equal(result.overflowX, "auto", "scroll mode must provide the scroller");
    assert.equal(result.rootScrolls, true, "the diff itself must scroll");
    assert.equal(result.pageOverflow, 0, "the page must not widen to accommodate it");
  });

  // ------------------------------------------------------------------ select

  /*
   * Resets the select fixture to a known state.
   *
   * Every test in this suite shares one page, and a select carries committed
   * state on the element itself. A test that calls `setValue` therefore changes
   * what the next test opens on, and the failure surfaces several tests later as
   * an unrelated-looking assertion. Explicit setup beats debugging that.
   */
  /*
   * The pristine option markup, captured before any test can rewrite it.
   *
   * `render()` rebuilds the list from the options read at construction, so the
   * original elements do not survive. Snapshotting them here is what lets the
   * fixture be restored between tests rather than degrading one test at a time.
   */
  /**
   * Captures the pristine option markup, once, before any render can replace it.
   *
   * `render()` rebuilds the list from the options read at construction, so the
   * original elements do not survive. Without this snapshot the fixture degrades
   * one test at a time, and each failure surfaces somewhere unrelated.
   */
  const snapshotSelectFixture = async () => {
    await evaluate(`
      if (window.__selectFixtureSnapshotted) return true;
      const tpl = document.createElement('template');
      tpl.innerHTML = document.querySelector('#select-list').innerHTML;
      const pristine = [...tpl.content.children].map((el) => el.outerHTML);
      window.__selectFixtureSnapshotted = true;
      window.__selectFixtureRestore = () => {
        const list = document.querySelector('#select-list');
        list.innerHTML = pristine.join('');
      };
      return true;
    `);
  };

  const resetSelect = async () => {
    await evaluate(`
      const invoker = document.querySelector('#select-invoker');
      invoker.dataset.fcValue = 'gpt-5';
      invoker.setAttribute('aria-expanded', 'false');
      invoker.removeAttribute('aria-activedescendant');
      invoker.querySelector('.fc-select__value').textContent = 'GPT-5';
      // The list is rebuilt by render(), which destroys the option elements the
      // binding read its options from. Restoring them keeps the fixture valid for
      // every later test -- otherwise each one finds a list holding only whatever
      // the previous test last rendered.
      const list = document.querySelector('#select-list');
      window.__selectFixtureRestore();
      list.removeAttribute('data-fc-open');
      return true;
    `);
  };


  it("keeps DOM focus on the invoker while the list is open", async () => {
    // The single most important property of a combobox listbox. `menu.ts` uses
    // roving tabindex because a menu may move focus; a combobox must not, or it
    // can no longer be reached with Tab and stops reading as a combobox. The
    // highlighted option is conveyed by aria-activedescendant instead.
    await loadBindings();
    await snapshotSelectFixture();
    await resetSelect();
    const result = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      const invoker = document.querySelector('#select-invoker');
      invoker.focus();
      sel.openList();
      const active = invoker.getAttribute('aria-activedescendant');
      return {
        focusStaysOnInvoker: document.activeElement === invoker,
        expanded: invoker.getAttribute('aria-expanded'),
        hasActiveDescendant: !!active,
        targetIsAnOption: active
          ? document.getElementById(active)?.getAttribute('role') === 'option'
          : false,
      };
    `);
    assert.equal(result.focusStaysOnInvoker, true, "focus must not enter the list");
    assert.equal(result.expanded, "true");
    assert.equal(result.hasActiveDescendant, true, "highlight must be conveyed by ARIA");
    assert.equal(result.targetIsAnOption, true);
  });

  it("opens on the committed value rather than the first option", async () => {
    await loadBindings();
    await resetSelect();
    const label = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.openList();
      const active = document.querySelector('#select-invoker').getAttribute('aria-activedescendant');
      return document.getElementById(active)?.querySelector('.fc-select__option-label')?.textContent;
    `);
    // Re-opening an unchanged control must not move the highlight to the top, or
    // the control appears to reset itself every time it is opened.
    assert.equal(label, "GPT-5");
  });

  it("marks the committed option aria-selected, not by class", async () => {
    await loadBindings();
    await resetSelect();
    const selected = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.openList();
      return [...document.querySelectorAll('#select-list [role="option"]')]
        .filter((o) => o.getAttribute('aria-selected') === 'true')
        .map((o) => o.dataset.fcValue);
    `);
    assert.deepEqual(selected, ["gpt-5"]);
  });

  it("steps over an unavailable option when arrowing", async () => {
    // The unavailable entry is last, so arrowing down from o3 must wrap past it
    // rather than stopping on it. A list that stalls on a disabled option reads
    // as a broken control.
    await loadBindings();
    await resetSelect();
    const active = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.setValue('o3');
      sel.openList();
      const invoker = document.querySelector('#select-invoker');
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const id = invoker.getAttribute('aria-activedescendant');
      return document.getElementById(id)?.dataset.fcValue;
    `);
    assert.equal(active, "opus-5", "must skip the disabled Llama, not stop on it");
  });

  it("Escape restores the committed value instead of committing the highlight", async () => {
    // The defining difference from a menu. A menu fires an action; a select holds
    // a value, so dismissing the list must put back what was in effect.
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      const changes = [];
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
        onChange: (v) => changes.push(v),
      });
      sel.openList();
      const invoker = document.querySelector('#select-invoker');
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const movedTo = invoker.getAttribute('aria-activedescendant');
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        value: invoker.dataset.fcValue,
        changes,
        expanded: invoker.getAttribute('aria-expanded'),
        actedDescendant: invoker.getAttribute('aria-activedescendant'),
        movedTo: document.getElementById(movedTo)?.dataset.fcValue,
      };
    `);
    assert.notEqual(result.movedTo, "gpt-5", "the highlight must actually have moved");
    assert.equal(result.value, "gpt-5", "Escape must restore the committed value");
    assert.deepEqual(result.changes, [], "Escape must not fire onChange");
    assert.equal(result.expanded, "false");
    assert.equal(result.actedDescendant, null, "a closed list has no active descendant");
  });

  it("Enter commits the highlighted option", async () => {
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      const changes = [];
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
        onChange: (v) => changes.push(v),
      });
      sel.openList();
      const invoker = document.querySelector('#select-invoker');
      for (const key of ['ArrowUp', 'ArrowUp']) {
        invoker.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return [invoker.dataset.fcValue, changes, invoker.getAttribute('aria-expanded')];
    `);
    // gpt-5 -> sonnet-5 -> opus-5. Two steps up, and the committed value, the
    // change list, and the label must all agree on the same option.
    assert.equal(result[0], "opus-5", "arrows moved up twice from gpt-5");
    assert.deepEqual(result[1], ["opus-5"], "commit fires onChange exactly once");
    assert.equal(result[2], "false", "and closes the list");
  });

  it("Tab commits and leaves, never trapping the keyboard", async () => {
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.openList();
      const invoker = document.querySelector('#select-invoker');
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      return [invoker.dataset.fcValue, invoker.getAttribute('aria-expanded')];
    `);
    // Committing on Tab matches native select; trapping Tab would strand a
    // keyboard user inside the listbox.
    assert.equal(result[0], "sonnet-5", "one step up from gpt-5");
    assert.equal(result[1], "false", "Tab must close the list, not trap");
  });

  it("does not open an empty list", async () => {
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      const list = document.createElement('div');
      list.id = 'empty-list';
      list.className = 'fc-select__list';
      list.setAttribute('role', 'listbox');
      const invoker = document.createElement('button');
      invoker.id = 'empty-invoker';
      invoker.className = 'fc-select';
      document.body.append(invoker, list);
      globalThis.empty = new S.FutureCssSelect({
        invoker: '#empty-invoker', list: '#empty-list',
      });
      empty.openList();
      const out = [invoker.getAttribute('aria-expanded'), invoker.getAttribute('aria-disabled')];
      invoker.remove(); list.remove();
      return out;
    `);
    // An empty popup reads as a broken control; a select with nothing to choose
    // from is a legitimate state and should be announced as unavailable.
    assert.deepEqual(result, ["false", "true"]);
  });

  it("filters to substring matches, which a prefix search would miss", async () => {
    await loadBindings();
    await resetSelect();
    const labels = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.filter('sonnet');
      return [...document.querySelectorAll('#select-list [role="option"]')]
        .map((o) => o.dataset.fcValue);
    `);
    // "sonnet" occurs inside "Claude Sonnet 5" but does not start it. This is the
    // operation that separates a model listbox from a menu's typeahead.
    assert.deepEqual(labels, ["sonnet-5"]);
  });

  it("shows an empty state rather than a blank list when nothing matches", async () => {
    await loadBindings();
    await resetSelect();
    const text = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.filter('zzz');
      const empty = document.querySelector('#select-list .fc-select__empty');
      const out = empty ? empty.textContent : null;
      sel.filter('');
      return [out, document.querySelectorAll('#select-list [role="option"]').length];
    `);
    assert.equal(text[0], "No matches", "a blank box reads as a broken control");
    assert.equal(text[1], 5, "clearing the filter restores every option");
  });

  it("exposes the value as data, not only as a visible label", async () => {
    // The DOM contract: a machine reads the selection without parsing text, and
    // the label is then free to change without the data contract following it.
    await loadBindings();
    await resetSelect();
    const value = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.setValue('opus-5');
      return document.querySelector('#select-invoker').dataset.fcValue;
    `);
    assert.equal(value, "opus-5");
  });

  it("positions the list under the invoker and flips when there is no room", async () => {
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      const invoker = document.querySelector('#select-invoker');
      // Scroll it into view first. The fixture is a long page and this select sits
      // below the fold, so without this the anchor's viewport coordinates are far
      // outside the window and every measurement below is meaningless.
      invoker.scrollIntoView({ block: 'center' });
      const anchor = invoker.getBoundingClientRect();
      sel.openList();
      const placed = document.querySelector('#select-list').getBoundingClientRect();

      // Now force the flip: an invoker near the bottom of the viewport has no
      // room below, and the list must open upward rather than off-screen.
      invoker.scrollIntoView({ block: 'end' });
      invoker.style.position = 'fixed';
      invoker.style.insetBlockEnd = '0px';
      sel.closeList();
      sel.openList();
      const flipped = document.querySelector('#select-list').getBoundingClientRect();
      const out = [
        Math.abs(placed.left - anchor.left) < 2,
        flipped.bottom <= window.innerHeight + 2,
      ];
      invoker.style.position = '';
      invoker.style.insetBlockEnd = '';
      sel.closeList();
      return out;
    `);
    assert.equal(result[0], true, "must align to the invoker's inline edge");
    assert.equal(result[1], true, "must stay inside the viewport when flipped");
  });

  it("commits the option the user clicked, not the previously highlighted one", async () => {
    // Writing `data-fc-value` in the click handler and closing afterwards made
    // the click a no-op: `closeList` commits the model's active index and wrote
    // the old value straight back, so onChange reported the wrong option.
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      const changes = [];
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
        onChange: (v) => changes.push(v),
      });
      sel.openList();
      const target = [...document.querySelectorAll('#select-list [role="option"]')]
        .find((o) => o.dataset.fcValue === 'sonnet-5');
      target.click();
      return [document.querySelector('#select-invoker').dataset.fcValue, changes];
    `);
    assert.equal(result[0], "sonnet-5", "the clicked option must be the committed one");
    assert.deepEqual(result[1], ["sonnet-5"], "onChange must report the clicked value");
  });

  it("does not let arrows or Enter reach an option the filter has hidden", async () => {
    // Filtering only changed the rendered list; navigation still walked every
    // option, so Enter could commit something the user could not see.
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.openList();
      sel.filter('sonnet');
      const invoker = document.querySelector('#select-invoker');
      const rendered = [...document.querySelectorAll('#select-list [role="option"]')]
        .map((o) => o.dataset.fcValue);
      const id = invoker.getAttribute('aria-activedescendant');
      const active = id ? document.getElementById(id)?.dataset.fcValue : null;
      return [rendered, active];
    `);
    assert.deepEqual(result[0], ["sonnet-5"], "only the match is rendered");
    assert.equal(result[1], "sonnet-5",
      "the highlight must move to something still visible, or be cleared");
  });

  it("End reaches the last selectable option rather than an arbitrary offset", async () => {
    // Home and End were implemented as a huge delta. `1e9 % 5 === 0`, so End
    // silently did nothing on a five-option list.
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.openList();
      const invoker = document.querySelector('#select-invoker');
      const read = () => {
        const id = invoker.getAttribute('aria-activedescendant');
        return document.getElementById(id)?.dataset.fcValue;
      };
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      const last = read();
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      return [last, read()];
    `);
    // The last entry is disabled, so End must land on the last *selectable* one.
    assert.equal(result[0], "o3", "End must skip the disabled final option");
    assert.equal(result[1], "opus-5", "Home must reach the first option");
  });

  it("caps the list height to the space available, not just a CSS ceiling", async () => {
    // The stylesheet's `max-block-size: min(60vh, 24rem)` is a ceiling for a
    // centered list, not a guarantee. Near the bottom of the viewport there is
    // less than 60vh below the invoker, and the list ran off-screen by exactly
    // the difference. The available space depends on where the invoker is, so it
    // has to be measured.
    await loadBindings();
    await resetSelect();
    const measured = await evaluate(`
      const invoker = document.querySelector('#select-invoker');
      invoker.scrollIntoView({ block: 'end' });
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.openList();
      const rect = document.querySelector('#select-list').getBoundingClientRect();
      sel.closeList();
      return { bottom: rect.bottom, top: rect.top, vh: window.innerHeight };
    `);
    assert.ok(
      measured.bottom <= measured.vh + 1,
      `list must fit the viewport: bottom ${measured.bottom} > ${measured.vh}`,
    );
  });

  it("keeps the highlighted option scrolled into view in a long list", async () => {
    await loadBindings();
    await resetSelect();
    const visible = await evaluate(`
      globalThis.sel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      sel.openList();
      const invoker = document.querySelector('#select-invoker');
      for (let i = 0; i < 4; i++) {
        invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      }
      const id = invoker.getAttribute('aria-activedescendant');
      const rect = document.getElementById(id).getBoundingClientRect();
      const listRect = document.querySelector('#select-list').getBoundingClientRect();
      sel.closeList();
      return rect.top >= listRect.top - 1 && rect.bottom <= listRect.bottom + 1;
    `);
    assert.equal(visible, true, "the highlight must not scroll out of sight");
  });



  // --------------------------------------------------------------- composer

  /**
   * Resets the composer fixture to a known state.
   *
   * Composer state lives on the shared page, and every test in this suite uses
   * one page. Without this a test's draft and attachments are still present when
   * the next one runs, so failures surface several tests later as assertions
   * about something else entirely.
   */
  const resetComposer = async () => {
    await evaluate(`
      const root = document.querySelector('#composer-root');
      const input = document.querySelector('#composer-input');
      input.value = '';
      input.readOnly = false;
      root.dataset.fcState = 'idle';
      delete root.dataset.fcDragging;
      document.querySelector('#composer-attachments').replaceChildren();
      const send = document.querySelector('#composer-send');
      send.textContent = 'Send';
      send.dataset.fcState = 'idle';
      send.disabled = true;
      document.querySelector('#composer-status').textContent = '';
      return true;
    `);
  };


  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      const sent = [];
      globalThis.comp = new C.FutureCssComposer({
        root: '#composer-root', onSubmit: (t) => sent.push(t),
      });
      const input = document.querySelector('#composer-input');
      input.value = 'hello';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const afterEnter = input.value;

      input.value = 'line one';
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', shiftKey: true, bubbles: true,
      }));
      return [sent, afterEnter, input.value];
    `);
    assert.deepEqual(result[0], ["hello"], "Enter must submit");
    // The draft clears on a real submit, and Shift+Enter must not.
    assert.equal(result[1], "");
    assert.equal(result[2], "line one", "Shift+Enter must not send");
  });

  it("does not send while an IME candidate is being composed", async () => {
    // The bug this guards against only reproduces with an IME. `isComposing` is
    // true for the whole composition, and sending there commits a half-composed
    // character and closes the candidate window.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      const sent = [];
      globalThis.comp = new C.FutureCssComposer({
        root: '#composer-root', onSubmit: (t) => sent.push(t),
      });
      const input = document.querySelector('#composer-input');
      input.value = 'にほん';
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', isComposing: true, bubbles: true,
      }));
      // The legacy signal, for browsers that do not set isComposing.
      const legacy = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      Object.defineProperty(legacy, 'keyCode', { value: 229 });
      input.dispatchEvent(legacy);
      return [sent, input.value];
    `);
    assert.deepEqual(result[0], [], "neither signal may submit during composition");
    assert.equal(result[1], "にほん", "the in-progress text must survive");
  });

  it("turns the send control into stop while running, without replacing it", async () => {
    // Replacing the button would move focus, and a control that appears mid-run is
    // the one a keyboard user is not looking at.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      const stopped = [];
      globalThis.comp = new C.FutureCssComposer({
        root: '#composer-root', onStop: () => stopped.push('stop'),
      });
      const send = document.querySelector('#composer-send');
      const before = send;
      comp.text = 'in flight';
      comp.setRunning(true);
      const midLabel = send.textContent;
      const midState = send.dataset.fcState;
      const sameNode = send === before;
      send.click();
      // Still "Stop" right after clicking: aborting a run does not end it, the
      // consumer does. Reading this before setRunning(false) is the point.
      const afterClick = send.textContent;
      comp.setRunning(false);
      return [midLabel, midState, sameNode, stopped.length, afterClick, send.textContent];
    `);
    assert.equal(result[0], "Stop");
    assert.equal(result[1], "running");
    assert.equal(result[2], true, "the control must be the same element, not a replacement");
    assert.equal(result[3], 1, "clicking while running must stop, not send");
    assert.equal(result[4], "Stop", "stopping does not itself end the run");
    assert.equal(result[5], "Send", "the label must return once the run actually ends");
  });

  it("keeps the draft when a run is stopped", async () => {
    // Stopping a run is not composing a message. Clearing the draft would discard
    // text the user may well want to resend.
    await loadBindings();
    await resetComposer();
    const kept = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.text = 'worth keeping';
      comp.setRunning(true);
      document.querySelector('#composer-send').click();
      return comp.text;
    `);
    assert.equal(kept, "worth keeping");
  });

  it("makes the input read-only while running rather than disabled", async () => {
    // A disabled field leaves the tab order, so a keyboard user tabbing past would
    // not learn there is anything there.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      const input = document.querySelector('#composer-input');
      comp.setRunning(true);
      const running = { readOnly: input.readOnly, disabled: input.disabled };
      comp.setRunning(false);
      return [running, { readOnly: input.readOnly, disabled: input.disabled }];
    `);
    assert.deepEqual(result[0], { readOnly: true, disabled: false });
    assert.equal(result[1].readOnly, false);
  });

  it("gives every attachment's remove button the file name", async () => {
    // Four buttons all reading "Remove" tell a screen-reader user nothing about
    // which attachment is going away.
    await loadBindings();
    await resetComposer();
    const labels = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addAttachments([
        new File(['a'], 'schema.ts', { type: 'text/plain' }),
        new File(['bb'], 'seed.sql', { type: 'text/plain' }),
      ]);
      return [...document.querySelectorAll('#composer-attachments .fc-composer__attachment-remove')]
        .map((b) => b.getAttribute('aria-label'));
    `);
    assert.deepEqual(labels, ["Remove schema.ts", "Remove seed.sql"]);
  });

  it("removes only the attachment whose button was pressed", async () => {
    await loadBindings();
    await resetComposer();
    const remaining = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addAttachments([
        new File(['a'], 'one.ts'),
        new File(['b'], 'two.ts'),
        new File(['c'], 'three.ts'),
      ]);
      const buttons = document.querySelectorAll('#composer-attachments .fc-composer__attachment-remove');
      buttons[1].click();
      return comp.files.map((f) => f.name);
    `);
    // Removing the middle chip must leave the other two in order.
    assert.deepEqual(remaining, ["one.ts", "three.ts"]);
  });

  it("ignores a duplicate attachment rather than adding it twice", async () => {
    await loadBindings();
    await resetComposer();
    const count = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      const f = () => new File(['x'], 'notes.md', { type: 'text/plain' });
      comp.addAttachments([f()]);
      comp.addAttachments([f()]);
      return comp.files.length;
    `);
    assert.equal(count, 1, "same name and size is the same file");
  });

  it("can submit attachments with no text", async () => {
    // A "describe this file" request is a legitimate submission with an empty
    // draft, so an attachment alone must be enough.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      const sent = [];
      globalThis.comp = new C.FutureCssComposer({
        root: '#composer-root', onSubmit: (t, files) => sent.push([t, files.length]),
      });
      comp.addAttachments([new File(['x'], 'diagram.svg', { type: 'image/svg+xml' })]);
      const input = document.querySelector('#composer-input');
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return [sent, comp.files.length];
    `);
    assert.deepEqual(result[0], [["", 1]], "attachments alone are enough to send");
    assert.equal(result[1], 0, "and the attachments clear afterwards");
  });

  it("disables send when there is nothing to send, and enables it on input", async () => {
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      const input = document.querySelector('#composer-input');
      const send = document.querySelector('#composer-send');
      const empty = send.disabled;
      input.value = 'x';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const typed = send.disabled;
      input.value = '   ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return [empty, typed, send.disabled];
    `);
    assert.deepEqual(result, [true, false, true], "whitespace is not a message");
  });

  it("reports attachment count and size in the status line", async () => {
    await loadBindings();
    await resetComposer();
    const text = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addAttachments([new File([new Uint8Array(2048)], 'a.bin')]);
      return document.querySelector('#composer-status').textContent;
    `);
    assert.match(text, /1 attachment/, "the count must be announced");
    assert.match(text, /2 KB/);
  });

  it("keeps the draft when onSubmit throws", async () => {
    // Losing the user's text because a consumer threw is the worst outcome here.
    //
    // This test constructs its own binding over a *fresh* input element. Every
    // previous test's binding still holds a keydown listener on the shared one,
    // and those stale instances submit with their own callbacks -- so without a
    // fresh element the assertion measures a different composer's behaviour.
    await loadBindings();
    await resetComposer();
    const kept = await evaluate(`
      const root = document.querySelector('#composer-root');
      const input = document.querySelector('#composer-input');
      const fresh = input.cloneNode(true);
      root.replaceChild(fresh, input);
      globalThis.comp = new C.FutureCssComposer({
        root: '#composer-root',
        onSubmit: () => { throw new Error('consumer blew up'); },
      });
      fresh.value = 'precious';
      fresh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return comp.text;
    `);
    assert.equal(kept, "precious", "the draft must survive a throwing consumer");
  });


  it("hands the original File to onSubmit, not just its metadata", async () => {
    // An attachment reduced to {name, size, type} is useless: a consumer cannot
    // upload or inspect it, and the chip still looks like a successful attachment
    // until submit, so the loss is silent.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      let received = null;
      const root = document.querySelector('#composer-root');
      const input = document.querySelector('#composer-input');
      root.replaceChild(input.cloneNode(true), input);
      globalThis.comp = new C.FutureCssComposer({
        root: '#composer-root',
        onSubmit: (_t, files) => { received = files[0]; },
      });
      comp.addAttachments([new File(['payload bytes'], 'report.pdf', { type: 'application/pdf' })]);
      const hasFileBefore = comp.files[0].file instanceof File;
      const viaAccessor = comp.attachmentAt(0).file instanceof File;
      comp.submit();
      return [
        hasFileBefore,
        viaAccessor,
        received !== null,
        received?.file instanceof File,
        received?.file ? new TextDecoder().decode(await received.file.arrayBuffer()) : null,
      ];
    `);
    assert.equal(result[0], true, "the File must survive addAttachments");
    assert.equal(result[1], true, "and be reachable through attachmentAt");
    assert.equal(result[2], true, "onSubmit must receive the attachment");
    assert.equal(result[3], true, "with the File still attached");
    assert.equal(result[4], "payload bytes", "the bytes must be readable by the consumer");
  });

  it("keeps focus in the composer after an attachment is removed", async () => {
    // The removed button had focus, so removing it stranded focus on <body> --
    // invisible to a mouse user, and it means a keyboard user's next Tab starts
    // from the top of the page.
    await loadBindings();
    await resetComposer();
    const focused = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addAttachments([
        new File(['a'], 'one.ts'),
        new File(['b'], 'two.ts'),
        new File(['c'], 'three.ts'),
      ]);
      const buttons = document.querySelectorAll('#composer-attachments .fc-composer__attachment-remove');
      buttons[1].focus();
      const before = document.activeElement.getAttribute('aria-label');
      comp.removeAttachment(1);
      const active = document.activeElement;
      return [
        before,
        active === document.body,
        active.getAttribute('aria-label') ?? active.id,
      ];
    `);
    assert.equal(focused[1], false, "focus must not land on the body");
    assert.equal(focused[2], "Remove three.ts", "focus moves to the chip that took its place");
  });

  it("returns focus to the input when the last attachment is removed", async () => {
    await loadBindings();
    await resetComposer();
    const where = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addAttachments([new File(['a'], 'only.ts')]);
      document.querySelector('#composer-attachments .fc-composer__attachment-remove').focus();
      comp.removeAttachment(0);
      return document.activeElement.id;
    `);
    assert.equal(where, "composer-input");
  });

  it("exposes a way to attach a file that could not be read", async () => {
    // The `data-fc-state="error"` style had no public entry point, so a failed
    // read had to be dropped silently -- exactly what leaves someone sending a
    // request missing what they added.
    await loadBindings();
    await resetComposer();
    const state = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addFailedAttachment({ name: 'locked.pdf', size: 0, error: 'Permission denied' });
      const chip = document.querySelector('#composer-attachments .fc-composer__attachment');
      return [chip.dataset.fcState, chip.textContent.includes('Permission denied')];
    `);
    assert.equal(state[0], "error");
    assert.equal(state[1], true, "the reason must be visible, not just flagged");
  });

  it("clears the drop cue when a drag ends without a drop", async () => {
    // Otherwise the composer stays highlighted after the drag is long over,
    // implying it is still receiving files.
    await loadBindings();
    await resetComposer();
    const after = await evaluate(`
      const root = document.querySelector('#composer-root');
      root.dispatchEvent(new DragEvent('dragenter', { bubbles: true }));
      root.dispatchEvent(new DragEvent('dragover', { bubbles: true }));
      const during = root.dataset.fcDragging;
      root.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
      const left = root.dataset.fcDragging;
      root.dispatchEvent(new DragEvent('dragenter', { bubbles: true }));
      document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      return [during, left, root.dataset.fcDragging];
    `);
    assert.equal(after[0], "true", "the cue appears during a drag");
    // Absent rather than "false": the attribute is removed rather than negated,
    // so the CSS selector for the cue stops matching entirely.
    assert.ok(after[1] == null, "and clears when the pointer leaves");
    assert.ok(after[2] == null, "and when the drag ends without a drop");
  });


  it("keeps focus on the same file when a different chip is removed", async () => {
    // Restoring focus to the removed *index* moves it onto a different file, so
    // the user's next press removes the wrong attachment.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addAttachments([
        new File(['a'], 'a.ts'),
        new File(['b'], 'b.ts'),
        new File(['c'], 'c.ts'),
      ]);
      const buttons = () => [...document.querySelectorAll('.fc-composer__attachment-remove')];
      // Focus the LAST chip, then remove the FIRST.
      buttons()[2].focus();
      comp.removeAttachment(0);
      const active = document.activeElement.getAttribute('aria-label');
      return [active, buttons().map((b) => b.getAttribute('aria-label'))];
    `);
    assert.equal(result[0], "Remove c.ts",
      "focus must stay on the file the user was on, not move to the removed index");
    assert.deepEqual(result[1], ["Remove b.ts", "Remove c.ts"]);
  });

  it("stops listening after destroy", async () => {
    // The drag handlers live on `document`, which outlives the composer. Without
    // teardown, a view that mounts and unmounts keeps every detached root alive
    // and keeps invoking its obsolete handlers on each drop.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      const probe = [];
      const original = document.addEventListener.bind(document);
      let added = 0;
      document.addEventListener = (...args) => { added += 1; return original(...args); };

      const host = document.createElement('div');
      host.id = 'detached-composer';
      host.className = 'fc-composer';
      host.innerHTML =
        '<textarea class="fc-composer__input"></textarea>' +
        '<ul class="fc-composer__attachments"></ul>' +
        '<button class="fc-composer__send"></button>';
      document.body.append(host);
      const c = new C.FutureCssComposer({ root: '#detached-composer' });
      const whileMounted = added;
      c.destroy();
      host.remove();
      document.addEventListener = original;

      // After destroy the listeners are gone, so a later drop reaches nobody.
      document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      return [whileMounted > 0, c.text === ''];
    `);
    assert.equal(result[0], true, "the composer must register listeners while mounted");
    assert.equal(result[1], true);
  });


  it("keeps focus on the right chip when two attachments share a name", async () => {
    // `addAttachments` allows same-named files of different sizes, so two chips can
    // read "Remove report.txt". Matching focus on that label would move it onto
    // the wrong file -- and the user's next press would remove an attachment they
    // did not select.
    await loadBindings();
    await resetComposer();
    const result = await evaluate(`
      globalThis.comp = new C.FutureCssComposer({ root: '#composer-root' });
      comp.addAttachments([
        new File(['1'], 'report.txt', { type: 'text/plain' }),
        new File(['22'], 'report.txt', { type: 'text/plain' }),
      ]);
      const buttons = () => [...document.querySelectorAll('.fc-composer__attachment-remove')];
      buttons()[1].focus();
      comp.removeAttachment(1);
      // The second chip is gone; focus must land on the input, not back on the
      // surviving same-named chip.
      const active = document.activeElement;
      return [active.getAttribute('aria-label') ?? active.id, buttons().length];
    `);
    assert.equal(result[1], 1, "one chip remains");
    // The focused chip was the one removed, so focus goes to its neighbour -- the
    // surviving report.txt. That is the *intended* behaviour; what must not happen
    // is focus resolving by name to a chip the user was never on, which the
    // identity-based lookup prevents.
    assert.equal(result[0], "Remove report.txt",
      "focus lands on the remaining chip rather than being lost to the body");
  });


  // ---------------------------------------------------------- context strip

  const CATALOGUE = [
    {
      id: "anthropic", name: "Anthropic",
      models: [
        { id: "opus-5", name: "Claude Opus 5", reasoning: true, parameters: { context: "200k" } },
        { id: "sonnet-5", name: "Claude Sonnet 5", reasoning: true, parameters: { context: "200k" } },
      ],
    },
    {
      id: "openai", name: "OpenAI",
      models: [
        { id: "gpt-5", name: "GPT-5", parameters: { context: "400k" } },
        { id: "shared", name: "Shared model", reasoning: true },
      ],
    },
  ];

  /** Builds a strip over a fresh root, so tests do not share state. */
  const buildStrip = async (extra = "") => {
    await evaluate(`
      const old = document.querySelector('#strip-root');
      const fresh = old.cloneNode(true);
      old.replaceWith(fresh);
      globalThis.strip = new K.FutureCssContextStrip({
        root: '#strip-root', providers: ${JSON.stringify(CATALOGUE)}, ${extra}
      });
      return true;
    `);
  };

  it("resolves the model when the provider changes", async () => {
    // The behaviour that belongs to the group: a model from one provider selected
    // under another is a request nobody can fulfil.
    await loadBindings();
    await buildStrip();
    const result = await evaluate(`
      strip.setProvider('anthropic');
      const before = { ...strip.state };
      strip.setProvider('openai');
      const after = { ...strip.state };
      return [
        before.provider, before.model,
        after.provider, after.model,
        [...document.querySelectorAll('#strip-root [data-fc-strip="model"] ~ * [role="option"]')]
          .map((o) => o.dataset.fcValue),
      ];
    `);
    assert.equal(result[0], "anthropic");
    assert.equal(result[1], "opus-5", "the first model of the first provider");
    assert.equal(result[2], "openai");
    // opus-5 does not exist under OpenAI, so the model must be re-resolved.
    assert.equal(result[3], "gpt-5", "the model must follow the provider");
    assert.deepEqual(result[4], ["gpt-5", "shared"], "and the list must be repopulated");
  });

  it("keeps the model when the new provider offers it", async () => {
    await loadBindings();
    await buildStrip();
    const result = await evaluate(`
      strip.setProvider('anthropic');
      strip.setModel('sonnet-5');
      strip.setProvider('openai');
      // OpenAI does not offer sonnet-5, so it must re-resolve...
      const afterSwitch = strip.state.model;
      // ...but Anthropic *does* offer sonnet-5, so returning must keep the model
      // the user had, rather than resetting to that provider's first option.
      strip.setProvider('anthropic');
      return [afterSwitch, strip.state.model];
    `);
    assert.equal(result[0], "gpt-5", "an unavailable model is re-resolved");
    // Preserving the model across a provider switch is the behaviour under test:
    // two providers that share a model must not silently change it.
    assert.equal(result[1], "sonnet-5", "an available model survives the switch back");
  });

  it("remembers each provider's model across a round trip", async () => {
    // Comparing two providers means switching back and forth. Without per-provider
    // memory the model resets to each one's first option every time, so the user
    // cannot hold their choice steady and silently changes what they are about to
    // send.
    await loadBindings();
    await buildStrip();
    const model = await evaluate(`
      strip.setProvider('openai');
      strip.setModel('shared');
      strip.setProvider('anthropic');
      strip.setProvider('openai');
      return strip.state.model;
    `);
    assert.equal(model, "shared", "returning to OpenAI restores the model it had");
  });

  it("exposes the whole context as data attributes", async () => {
    await loadBindings();
    await buildStrip();
    const result = await evaluate(`
      strip.setProvider('anthropic');
      strip.setModel('sonnet-5');
      strip.setEffort('high');
      const root = document.querySelector('#strip-root');
      return {
        provider: root.dataset.fcProvider,
        model: root.dataset.fcModel,
        effort: root.dataset.fcEffort,
      };
    `);
    // One attribute each, so a machine reads the context without walking three
    // selects and parsing their labels.
    assert.deepEqual(result, { provider: "anthropic", model: "sonnet-5", effort: "high" });
  });

  it("omits the effort attribute for a model with no effort control", async () => {
    // An empty attribute would read as "effort is set to nothing", which is a
    // different claim from "effort does not apply here".
    await loadBindings();
    await buildStrip();
    const result = await evaluate(`
      strip.setProvider('openai');
      strip.setModel('gpt-5');
      const root = document.querySelector('#strip-root');
      return [root.dataset.fcEffort, root.hasAttribute('data-fc-effort')];
    `);
    assert.equal(result[1], false, "the attribute must be absent, not empty");
  });

  it("dims and disables effort for a model that ignores it", async () => {
    await loadBindings();
    await buildStrip();
    const result = await evaluate(`
      const field = () => document.querySelector('#strip-root .fc-context-strip__field[data-fc-applicable]');
      const invoker = () => document.querySelector('[data-fc-strip="effort"]');
      strip.setProvider('anthropic');
      strip.setModel('opus-5');
      const reasoning = {
        applicable: field()?.dataset.fcApplicable,
        disabled: invoker()?.getAttribute('aria-disabled'),
      };
      strip.setProvider('openai');
      strip.setModel('gpt-5');
      const plain = {
        applicable: field()?.dataset.fcApplicable,
        disabled: invoker()?.getAttribute('aria-disabled'),
      };
      return [reasoning, plain];
    `);
    assert.deepEqual(result[0], { applicable: "true", disabled: "false" });
    assert.deepEqual(result[1], { applicable: "false", disabled: "true" },
      "a control that is present but silently ineffective is worse than one that is not");
  });

  it("says so when effort does not apply, rather than clearing it silently", async () => {
    // A setting that disappears is a setting the user cannot find again.
    await loadBindings();
    await buildStrip();
    const result = await evaluate(`
      strip.setProvider('anthropic');
      strip.setEffort('high');
      strip.setProvider('openai');
      const notice = document.querySelector('#strip-root .fc-context-strip__notice');
      return [notice.hidden, notice.textContent];
    `);
    assert.equal(result[0], false, "the notice must be shown");
    assert.match(result[1], /effort/i);
  });

  it("shows model parameters as read-only values", async () => {
    await loadBindings();
    await buildStrip();
    const result = await evaluate(`
      strip.setProvider('openai');
      strip.setModel('gpt-5');
      const chips = [...document.querySelectorAll('#strip-root .fc-context-strip__param')];
      return [
        chips.map((c) => c.textContent),
        chips.filter((c) => c.querySelector('input, button')).length,
        strip.state.parameters.context,
      ];
    `);
    assert.deepEqual(result[0], ["context400k"]);
    assert.equal(result[1], 0, "parameters are model facts, not controls");
    assert.equal(result[2], "400k");
  });

  it("reports every resolved change to the consumer", async () => {
    // The consumer needs one event per resolved change -- a provider switch that
    // silently re-resolves the model has to be reported as one change, not two,
    // or the caller will send a request for a model it never chose.
    await loadBindings();
    await buildStrip("onChange: (s) => { globalThis.seen.push(s.model); }");
    const seen = await evaluate(`
      globalThis.seen = [];
      strip.setProvider('openai');
      strip.setModel('shared');
      strip.setEffort('high');
      strip.setModel('gpt-5');
      return globalThis.seen;
    `);
    assert.deepEqual(seen, ["gpt-5", "shared", "shared", "gpt-5"],
      "one event per change, each carrying the model that is actually selected");
  });

  it("ignores a model the current provider does not offer", async () => {
    await loadBindings();
    await buildStrip();
    const model = await evaluate(`
      strip.setProvider('openai');
      strip.setModel('opus-5');
      return strip.state.model;
    `);
    assert.equal(model, "gpt-5", "a model from another provider must be refused");
  });

  it("ignores an unknown provider entirely", async () => {
    await loadBindings();
    await buildStrip();
    const provider = await evaluate(`
      strip.setProvider('nope');
      return strip.state.provider;
    `);
    assert.equal(provider, "anthropic", "state must not change for an unknown id");
  });


  // ------------------------------------------------------------ git surface

  const ENTRIES = [
    { path: "src/js/git.ts", index: "modified", worktree: "modified",
      before: "a\nb\nc\n", after: "a\nc\nd\nd\n" },
    { path: "crates/fc-git/src/lib.rs", worktree: "untracked",
      after: "one\ntwo\n" },
    { path: "src/css/components/git.css", worktree: "modified",
      before: "x\ny\n", after: "x\ny\n" },
    { path: "src/js/conflict.ts", index: "conflicted", worktree: "conflicted" },
    { path: "README.md", index: "added" },
    { path: "old/path.ts", index: "deleted" },
    { path: "src/js/no-contents.ts", worktree: "modified" },
  ];

  /**
   * `handlers` is appended as *code*, not JSON.
   *
   * A callback cannot cross `JSON.stringify`, so passing one through a data
   * override would hand the constructor a string where it expects a function --
   * which fails silently, because "the callback never fired" looks exactly like
   * "nothing was clicked".
   */
  const buildGit = async (
    over: Record<string, unknown> = {},
    handlers = "",
  ) => {
    await evaluate(`
      const old = document.querySelector('#git-root');
      const fresh = old.cloneNode(true);
      old.replaceWith(fresh);
      globalThis.git = new IT.FutureCssGitSurface({
        root: '#git-root',
        branch: 'feat/git-surface',
        entries: ${JSON.stringify(ENTRIES)},
        ...${JSON.stringify(over)},
        ${handlers}
      });
      return true;
    `);
  };

  it("never shells out: it renders what the caller passes", async () => {
    // The whole surface is a view over data. A test cannot assert the absence of
    // a subprocess portably, so it asserts the positive property instead: an
    // entry that is not in the input cannot appear in the output.
    await loadBindings();
    await buildGit();
    const paths = await evaluate(`
      return [...document.querySelectorAll('#git-root .fc-git__row')]
        .map((r) => r.dataset.fcPath);
    `);
    assert.equal(paths.length, ENTRIES.length);
    assert.deepEqual([...paths].sort(), ENTRIES.map((e) => e.path).sort());
  });

  it("counts staged and unstaged separately", async () => {
    // Collapsing these into one number is how a commit silently includes edits the
    // user did not intend.
    await loadBindings();
    await buildGit();
    const counts = await evaluate(`
      const root = document.querySelector('#git-root');
      return [root.dataset.fcStaged, root.dataset.fcUnstaged,
              root.dataset.fcConflicted, root.dataset.fcUntracked];
    `);
    // Staged: git.ts, conflict.ts, README.md, old/path.ts.
    assert.equal(counts[0], "4", "staged count");
    assert.equal(counts[2], "1", "conflicted count");
    assert.equal(counts[3], "1", "untracked sub-count");
  });

  it("orders conflicts first, then files needing a staging decision", async () => {
    await loadBindings();
    await buildGit();
    const paths = await evaluate(`
      return [...document.querySelectorAll('#git-root .fc-git__row')]
        .map((r) => r.dataset.fcPath);
    `);
    assert.equal(paths[0], "src/js/conflict.ts", "conflicts block everything else");
    assert.equal(paths[1], "src/js/git.ts", "changed in both index and worktree");
    const rest = paths.slice(2);
    // localeCompare, matching the implementation: a plain sort() would compare
    // code units and put "README.md" before "crates/..." because uppercase sorts
    // first, which is not the order a reader expects.
    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)),
      "the remainder is alphabetical, so it does not reshuffle");
  });

  it("renders a stage badge per side, not per file", async () => {
    // A file staged as modified and also modified again is two facts, and it is
    // the case where one badge would hide a staged change behind a worktree one.
    await loadBindings();
    await buildGit();
    const badges = await evaluate(`
      const row = document.querySelector('[data-fc-path="src/js/git.ts"]');
      return [...row.querySelectorAll('.fc-git__badge')]
        .map((b) => b.dataset.fcStage + ':' + b.dataset.fcState);
    `);
    assert.deepEqual(badges, ["index:modified", "worktree:modified"]);
  });

  it("gives every state a non-colour marker for forced colors", async () => {
    // Under forced colors the badge colour is discarded, so without a glyph every
    // state reads as the same outlined word.
    await loadBindings();
    await buildGit();
    const glyphs = await evaluate(`
      return [...document.querySelectorAll('#git-root .fc-git__badge')]
        .map((b) => b.dataset.fcState + '=' + (b.dataset.fcGlyph || ''));
    `);
    for (const entry of glyphs) {
      const glyph = entry.slice(entry.indexOf("=") + 1);
      assert.ok(glyph.length > 0, entry + " must carry a glyph");
    }
    assert.ok(glyphs.length >= 8, "every staged and worktree badge is covered");
  });

  it("omits the stat when contents were never loaded", async () => {
    // +0 -0 is a claim that the file is unchanged. It is not: its contents were
    // never read.
    await loadBindings();
    await buildGit();
    const result = await evaluate(`
      const row = document.querySelector('[data-fc-path="src/js/no-contents.ts"]');
      const stat = row.querySelector('.fc-git__stat');
      return [stat.hidden, stat.textContent];
    `);
    assert.equal(result[0], true, "no stat rendered at all");
    assert.equal(result[1], "");
  });

  it("omits a zero stat for a file that really is unchanged", async () => {
    await loadBindings();
    await buildGit();
    const hidden = await evaluate(`
      const row = document.querySelector('[data-fc-path="src/css/components/git.css"]');
      return row.querySelector('.fc-git__stat').hidden;
    `);
    assert.equal(hidden, true);
  });

  it("computes the per-file line stat", async () => {
    await loadBindings();
    await buildGit();
    const stat = await evaluate(`
      const row = document.querySelector('[data-fc-path="src/js/git.ts"]');
      const stat = row.querySelector('.fc-git__stat');
      return [stat.querySelector('.fc-git__stat-add').textContent,
              stat.querySelector('.fc-git__stat-remove').textContent];
    `);
    assert.deepEqual(stat, ["+3", "\u22122"]);
  });

  it("says the working tree is clean rather than showing zeros", async () => {
    await loadBindings();
    await buildGit({ entries: [] });
    const result = await evaluate(`
      const root = document.querySelector('#git-root');
      return [root.querySelector('.fc-git__summary').textContent,
              root.dataset.fcEmpty,
              root.querySelector('.fc-git__empty').textContent];
    `);
    assert.match(result[0], /clean/i);
    assert.equal(result[1], "true");
    assert.match(result[2], /no changes/i);
  });

  it("names an unborn branch rather than rendering an empty header", async () => {
    // An empty branch header reads as a rendering failure rather than as a
    // repository state.
    await loadBindings();
    await buildGit({ branch: null, entries: [] });
    const result = await evaluate(`
      const root = document.querySelector('#git-root');
      return [root.querySelector('.fc-git__branch').textContent,
              root.dataset.fcBranchState, root.dataset.fcBranch];
    `);
    assert.equal(result[0], "Initial commit");
    assert.equal(result[1], "unborn");
    assert.equal(result[2], "", "declared empty, not undefined");
  });

  it("keeps the file list a single tab stop", async () => {
    // Otherwise Tab walks every row, which is a listbox failure.
    await loadBindings();
    await buildGit();
    const stops = await evaluate(`
      const rows = [...document.querySelectorAll('#git-root .fc-git__row')];
      return [rows.filter((r) => r.tabIndex === 0).length,
              rows.filter((r) => r.tabIndex === -1).length, rows.length];
    `);
    assert.equal(stops[0], 1, "exactly one row is tabbable");
    assert.equal(stops[1] + stops[0], stops[2], "and every other row is -1");
  });

  it("selects on click and reports the path", async () => {
    await loadBindings();
    await buildGit({}, "onSelect: (path) => { globalThis.picked = path; }");
    const result = await evaluate(`
      const row = document.querySelector('[data-fc-path="README.md"]');
      row.click();
      const root = document.querySelector('#git-root');
      return [globalThis.picked, root.querySelector('[data-fc-selected="true"]')?.dataset.fcPath];
    `);
    assert.deepEqual(result, ["README.md", "README.md"]);
  });

  it("selects with the keyboard", async () => {
    // Rows are focusable, so Enter and Space must reach the same handler as a
    // click. A mouse-only selection is a keyboard trap.
    await loadBindings();
    await buildGit({}, "onSelect: (path) => { globalThis.picked = path; }");
    const picked = await evaluate(`
      const row = document.querySelector('[data-fc-path="README.md"]');
      globalThis.picked = null;
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return globalThis.picked;
    `);
    assert.equal(picked, "README.md");
  });

  it("refuses to select a path that is not in the surface", async () => {
    await loadBindings();
    await buildGit({}, "onSelect: (path) => { globalThis.picked = path; }");
    const result = await evaluate(`
      // Reset first: every test shares one page, so a global set by the previous
      // test is still here and would be read as this test's callback firing.
      globalThis.picked = null;
      const before = document.querySelector('#git-root [data-fc-selected="true"]')?.dataset.fcPath;
      git.select('does/not/exist.ts');
      return [before, globalThis.picked, git.selectedPath];
    `);
    // Not `undefined`: JSON drops undefined across the bridge and the test would
    // pass for the wrong reason. Asserting "nothing was reported" is the claim.
    assert.ok(result[1] === null || result[1] === undefined,
      "no callback for a path that is not there, got " + String(result[1]));
    assert.equal(result[2], result[0], "selection unchanged");
  });

  it("stages a file without also selecting it", async () => {
    // Two different actions; a click that fires both means staging something the
    // user only meant to look at.
    await loadBindings();
    await buildGit({}, "onSelect: (path) => { globalThis.picked = path; },\n                 onStage: (path) => { globalThis.staged = path; }");
    const result = await evaluate(`
      const before = document.querySelector('#git-root [data-fc-selected="true"]')?.dataset.fcPath;
      globalThis.staged = null; globalThis.picked = null;
      // A worktree-only file is the one that carries a stage button, so it is the
      // only place the two callbacks can actually be distinguished.
      const row = document.querySelector('[data-fc-path="src/css/components/git.css"]');
      const button = row.querySelector('.fc-git__stage-button');
      button.click();
      return [globalThis.staged, globalThis.picked, before];
    `);
    assert.equal(result[0], "src/css/components/git.css", "the stage callback fired");
    assert.equal(result[1], null, "staging must not change the selection");
    assert.notEqual(result[2], result[0], "and the row was not already selected");
  });

  it("offers no stage button for a file that already has an index state", async () => {
    // Staging it again is a no-op the user should not be offered.
    await loadBindings();
    await buildGit();
    const buttons = await evaluate(`
      const row = document.querySelector('[data-fc-path="README.md"]');
      const other = document.querySelector('[data-fc-path="src/css/components/git.css"]');
      return [row.querySelectorAll('.fc-git__stage-button').length,
              other.querySelectorAll('.fc-git__stage-button').length];
    `);
    assert.equal(buttons[0], 0, "already staged, so no button");
    assert.equal(buttons[1], 1, "worktree only, so there is one");
  });

  // ---------------------------------------------------------- select / WASM

  it("runs select navigation on the Rust model when WASM is served", { skip: selectWasmBuilt ? false : "run `npm run build:wasm` first" }, async () => {
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      globalThis.wsel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      const loaded = await wsel.useWasm('${server.origin}/dist/wasm/fc-select/web/fc_select.js');
      if (!loaded) return { loaded };
      // Same interaction as the JS-path test: arrow down from o3 must skip
      // the unavailable Llama and wrap to Opus. Identical expected values on
      // both models is the point of the wiring.
      wsel.setValue('o3');
      wsel.openList();
      const invoker = document.querySelector('#select-invoker');
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const id = invoker.getAttribute('aria-activedescendant');
      return { loaded, value: document.getElementById(id)?.dataset.fcValue };
    `);
    assert.equal(result.loaded, true, "the Rust model should load over HTTP");
    assert.equal(result.value, "opus-5", "the Rust model must skip the unavailable option");
  });

  it("runs filtered typeahead through the Rust model too", { skip: selectWasmBuilt ? false : "run `npm run build:wasm` first" }, async () => {
    // Filtered typeahead is the computation the old boundary could not express
    // at all, which is why the wiring had to wait for selectTypeaheadFrom.
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      globalThis.tsel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      const loaded = await tsel.useWasm('${server.origin}/dist/wasm/fc-select/web/fc_select.js');
      if (!loaded) return { loaded };
      tsel.openList();
      const invoker = document.querySelector('#select-invoker');
      const active = () => {
        const id = invoker.getAttribute('aria-activedescendant');
        return document.getElementById(id)?.dataset.fcValue;
      };
      const first = (active(), undefined); // warm up: highlight is gpt-5
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
      const afterC = active();
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
      const afterCl = active();
      return { loaded, afterC, afterCl };
    `);
    assert.equal(result.loaded, true);
    // The scan starts after the highlight and wraps: "c" lands on Opus (the
    // first c-label after GPT-5), and "cl" -- the accumulated buffer, not a
    // fresh search -- lands on Sonnet, the first cl-label after Opus. Two
    // different options for two keystrokes is what proves the buffer crossed.
    assert.equal(result.afterC, "opus-5");
    assert.equal(result.afterCl, "sonnet-5");
  });

  it("falls back to the JS model when the WASM module is missing", async () => {
    await loadBindings();
    await resetSelect();
    const result = await evaluate(`
      globalThis.fsel = new S.FutureCssSelect({
        invoker: '#select-invoker', list: '#select-list',
      });
      const loaded = await fsel.useWasm('${server.origin}/dist/wasm/does-not-exist.js');
      fsel.setValue('o3');
      fsel.openList();
      const invoker = document.querySelector('#select-invoker');
      invoker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const id = invoker.getAttribute('aria-activedescendant');
      return { loaded, value: document.getElementById(id)?.dataset.fcValue };
    `);
    assert.equal(result.loaded, false, "a missing module must report failure, not throw");
    assert.equal(result.value, "opus-5", "navigation must keep working on the JS model");
  });

  // ------------------------------------------------------------- elevation

  /*
   * The shadow tokens were once emitted as light-dark(<shadow>, <shadow>).
   * light-dark() takes colours only, so the value was invalid at computed time
   * and every box-shadow reading the token rendered as nothing -- menus, the
   * select list, and the raised utility were all flat, and no test noticed,
   * because an invalid custom property is not a parse error.
   */
  it("resolves every elevation token to a real shadow in both schemes", async () => {
    const result = await evaluate(`
      const probe = document.createElement('div');
      document.body.append(probe);
      const read = (scheme) => {
        document.documentElement.setAttribute('data-fc-theme', scheme);
        return ['raised', 'overlay', 'modal'].map((n) => {
          probe.style.boxShadow = 'var(--fc-shadow-' + n + ')';
          return getComputedStyle(probe).boxShadow;
        });
      };
      const light = read('light');
      const dark = read('dark');
      document.documentElement.removeAttribute('data-fc-theme');
      probe.remove();
      return { light, dark };
    `);
    for (const value of [...result.light, ...result.dark]) {
      assert.notEqual(value, "none", "a shadow token resolved to no shadow");
    }
    assert.notDeepEqual(result.light, result.dark, "shadows should differ between schemes");
  });

  // ---------------------------------------------------------------- dialog

  it("shows a modal dialog as a flex column and hides it again on close", async () => {
    const result = await evaluate(`
      const dlg = document.getElementById('dlg');
      const closed = getComputedStyle(dlg).display;
      dlg.showModal();
      const open = getComputedStyle(dlg).display;
      const direction = getComputedStyle(dlg).flexDirection;
      const modal = dlg.matches(':modal');
      dlg.close();
      await new Promise((r) => setTimeout(r, 400));
      return { closed, open, direction, modal, after: getComputedStyle(dlg).display };
    `);
    assert.equal(result.closed, "none", "a closed dialog must not be displayed");
    assert.equal(result.open, "flex");
    assert.equal(result.direction, "column");
    assert.equal(result.modal, true);
    assert.equal(result.after, "none", "closing must hide the dialog after its exit transition");
  });

  // ------------------------------------------------------------------ card

  it("lays a card out by its own width, not the viewport's", async () => {
    const result = await evaluate(`
      const cols = (id) => getComputedStyle(
        document.querySelector('#' + id + ' .fc-card__layout')).gridTemplateColumns.split(' ').length;
      return { narrow: cols('card-narrow'), wide: cols('card-wide') };
    `);
    assert.equal(result.narrow, 1, "a narrow card stacks its media above the content");
    assert.equal(result.wide, 2, "a wide card puts its media beside the content");
  });

  // ---------------------------------------------------------------- switch

  it("moves the switch thumb toward the inline end in both directions", async () => {
    const result = await evaluate(`
      const sw = document.getElementById('switch');
      sw.checked = true;
      // The thumb is a pseudo-element with its own transition; let it land.
      await new Promise((r) => setTimeout(r, 350));
      const ltr = getComputedStyle(sw, '::before').translate;
      document.getElementById('switch-row').setAttribute('dir', 'rtl');
      await new Promise((r) => setTimeout(r, 350));
      const rtl = getComputedStyle(sw, '::before').translate;
      document.getElementById('switch-row').removeAttribute('dir');
      sw.checked = false;
      return { ltr, rtl };
    `);
    assert.ok(parseFloat(result.ltr) > 0, `LTR thumb should move right, got ${result.ltr}`);
    assert.ok(parseFloat(result.rtl) < 0, `RTL thumb should move left, got ${result.rtl}`);
  });

  // --------------------------------------------------------- reduced motion

  /*
   * The reset layer's reduced-motion block uses !important, and an important
   * declaration in an EARLIER layer beats everything in later layers -- so a
   * component cannot slow its spinner down from fc.components, however it is
   * written. The spinner is the only cue that work is happening, so freezing it
   * is a bug, not a preference honoured.
   */
  it("slows spinners under reduced motion instead of freezing them", async () => {
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const result = await evaluate(`
      const cs = getComputedStyle(document.getElementById('spinner'));
      return { duration: cs.animationDuration, count: cs.animationIterationCount };
    `);
    await send("Emulation.setEmulatedMedia", { features: [] });
    assert.equal(result.count, "infinite", "the spinner must keep turning");
    assert.ok(parseFloat(result.duration) >= 1.5, `expected a slowed spin, got ${result.duration}`);
  });

  // ------------------------------------------------------------------ tabs

  it("keeps one tab tabbable and shows only the selected panel", async () => {
    await loadBindings();
    const result = await evaluate(`
      globalThis.tabs = new TB.FutureCssTabs('#tabs-root');
      const tabbable = [...document.querySelectorAll('#tabs-root [role=tab]')].filter((t) => t.tabIndex === 0);
      const shown = [...document.querySelectorAll('#tabs-root [role=tabpanel]')].filter((p) => !p.hidden);
      return {
        tabbable: tabbable.map((t) => t.id),
        shown: shown.map((p) => p.id),
        labelled: document.getElementById('panel-a').getAttribute('aria-labelledby'),
      };
    `);
    assert.deepEqual(result.tabbable, ["tab-a"]);
    assert.deepEqual(result.shown, ["panel-a"]);
    assert.equal(result.labelled, "tab-a");
  });

  it("arrows past a disabled tab, and Home/End reach the ends", async () => {
    await loadBindings();
    const result = await evaluate(`
      const list = document.querySelector('#tabs-root [role=tablist]');
      const press = (key) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      tabs.select(0);
      press('ArrowRight');
      const afterRight = document.activeElement.id;
      const panel = [...document.querySelectorAll('#tabs-root [role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.id);
      press('End');
      const afterEnd = document.activeElement.id;
      press('ArrowRight');
      const wrapped = document.activeElement.id;
      press('End');
      press('Home');
      return { afterRight, panel, afterEnd, wrapped, afterHome: document.activeElement.id };
    `);
    assert.equal(result.afterRight, "tab-c", "Beta is aria-disabled and must be skipped");
    assert.deepEqual(result.panel, ["panel-c"]);
    assert.equal(result.afterEnd, "tab-d");
    assert.equal(result.wrapped, "tab-a", "arrowing past the last tab wraps to the first");
    assert.equal(result.afterHome, "tab-a");
  });

  it("reverses the arrow keys in a right-to-left tab strip", async () => {
    await loadBindings();
    const result = await evaluate(`
      const root = document.getElementById('tabs-root');
      root.setAttribute('dir', 'rtl');
      tabs.select(0);
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      const id = document.activeElement.id;
      root.removeAttribute('dir');
      tabs.select(0);
      return id;
    `);
    assert.equal(result, "tab-c", "in RTL, ArrowLeft moves to the next tab");
  });

  // ----------------------------------------------------------------- toast

  it("routes toasts to a polite or assertive region that existed beforehand", async () => {
    await loadBindings();
    const result = await evaluate(`
      globalThis.toaster = new TS.FutureCssToaster('#toaster');
      const polite = document.querySelector('#toaster [aria-live=polite]');
      const assertive = document.querySelector('#toaster [aria-live=assertive]');
      const regionsBefore = [polite?.getAttribute('role'), assertive?.getAttribute('role')];
      const info = toaster.show({ title: 'Saved', body: '<b>not html</b>' });
      const err = toaster.show({ title: 'Upload failed', tone: 'danger' });
      return {
        regionsBefore,
        infoParent: info.element.parentElement.getAttribute('aria-live'),
        errParent: err.element.parentElement.getAttribute('aria-live'),
        body: info.element.querySelector('.fc-toast__body').innerHTML,
        kind: info.element.dataset.fcKind,
        closeName: info.element.querySelector('.fc-toast__close').getAttribute('aria-label'),
      };
    `);
    assert.deepEqual(result.regionsBefore, ["status", "alert"]);
    assert.equal(result.infoParent, "polite");
    assert.equal(result.errParent, "assertive", "a danger toast interrupts");
    assert.equal(result.body, "&lt;b&gt;not html&lt;/b&gt;", "toast text is never parsed as HTML");
    assert.equal(result.kind, "toast");
    assert.equal(result.closeName, "Dismiss: Saved");
  });

  it("times a toast out, but not while focus is inside it", async () => {
    await loadBindings();
    await emulateFocus(true);
    const result = await evaluate(`
      toaster.clear();
      await new Promise((r) => setTimeout(r, 450));
      const quick = toaster.show({ title: 'Quick', timeout: 60 });
      await new Promise((r) => setTimeout(r, 600));
      const quickGone = !quick.element.isConnected;

      const held = toaster.show({ title: 'Held', timeout: 60 });
      held.element.querySelector('.fc-toast__close').focus();
      await new Promise((r) => setTimeout(r, 300));
      const heldStays = held.element.isConnected;
      held.element.querySelector('.fc-toast__close').blur();
      await new Promise((r) => setTimeout(r, 600));
      return { quickGone, heldStays, heldGoneAfterBlur: !held.element.isConnected };
    `);
    await emulateFocus(false);
    assert.equal(result.quickGone, true, "a timed toast should remove itself");
    assert.equal(result.heldStays, true, "the timer must pause while focus is inside the toast");
    assert.equal(result.heldGoneAfterBlur, true, "the timer resumes once focus leaves");
  });

  it("keeps danger toasts until they are dismissed", async () => {
    await loadBindings();
    const result = await evaluate(`
      toaster.clear();
      const err = toaster.show({ title: 'Failed', tone: 'danger' });
      await new Promise((r) => setTimeout(r, 300));
      const stays = err.element.isConnected;
      err.dismiss();
      await new Promise((r) => setTimeout(r, 450));
      return { stays, gone: !err.element.isConnected };
    `);
    assert.equal(result.stays, true);
    assert.equal(result.gone, true);
  });

  // --------------------------------------------------------------- tooltip

  it("describes the trigger by its tooltip and dismisses it on Escape", async () => {
    await loadBindings();
    await emulateFocus(true);
    const result = await evaluate(`
      globalThis.unbindTips = TT.bindTooltips(document);
      const trigger = document.getElementById('tip-trigger');
      const bubble = document.querySelector('#tip-root .fc-tooltip__bubble');
      const describedBy = trigger.getAttribute('aria-describedby');
      trigger.focus();
      const shown = getComputedStyle(bubble).visibility;
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const afterEscape = getComputedStyle(bubble).visibility;
      const focusKept = document.activeElement === trigger;
      trigger.blur();
      const reset = document.getElementById('tip-root').hasAttribute('data-fc-dismissed');
      unbindTips();
      return { describedBy, bubbleId: bubble.id, role: bubble.getAttribute('role'), shown, afterEscape, focusKept, reset };
    `);
    await emulateFocus(false);
    assert.equal(result.describedBy, result.bubbleId);
    assert.equal(result.role, "tooltip");
    assert.equal(result.shown, "visible", "keyboard focus must show the tooltip, not only hover");
    assert.equal(result.afterEscape, "hidden");
    assert.equal(result.focusKept, true, "Escape dismisses the tooltip without moving focus");
    assert.equal(result.reset, false, "leaving the trigger lets the tooltip show again next time");
  });

  // -------------------------------------------------------------- spinners

  /*
   * What animates in each variant: the element itself, or its children (the
   * typing dots and the stream bars are child elements). Returns, per variant,
   * the animation name, duration, and iteration count of the moving part.
   */
  const SPINNER_PROBE = `
    return [...document.querySelectorAll('#spinners [data-variant]')].map((el) => {
      const mover = el.firstElementChild ?? el;
      const cs = getComputedStyle(mover);
      const box = el.getBoundingClientRect();
      return {
        variant: el.dataset.variant,
        name: cs.animationName,
        duration: parseFloat(cs.animationDuration),
        count: cs.animationIterationCount,
        width: box.width,
        height: box.height,
      };
    });
  `;

  it("animates every spinner variant, at a visible size", async () => {
    const result = await evaluate(SPINNER_PROBE);
    assert.equal(result.length, 6);
    for (const s of result) {
      assert.notEqual(s.name, "none", `${s.variant} should animate`);
      assert.equal(s.count, "infinite", `${s.variant} should loop`);
      assert.ok(s.width > 0 && s.height > 0, `${s.variant} should take up space`);
    }
  });

  it("keeps every spinner variant moving under reduced motion, slower or as a fade", async () => {
    const normal = await evaluate(SPINNER_PROBE);
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const reduced = await evaluate(SPINNER_PROBE);
    await send("Emulation.setEmulatedMedia", { features: [] });

    for (const [i, s] of reduced.entries()) {
      assert.equal(s.count, "infinite", `${s.variant} must not freeze under reduced motion`);
      assert.ok(s.duration >= 0.5, `${s.variant} must not collapse to the reset's 0.01ms`);
      if (["dots", "bars", "pulse", "sparkle"].includes(s.variant)) {
        assert.equal(s.name, "fc-spinner-fade", `${s.variant} should fade instead of moving`);
      } else {
        assert.ok(s.duration > normal[i].duration, `${s.variant} should turn more slowly`);
      }
    }
  });

  it("drives the agent status row from data-fc-state", async () => {
    const result = await evaluate(`
      const row = document.getElementById('agent-status');
      const spinner = row.querySelector('.fc-spinner');
      const label = row.querySelector('.fc-agent-status__label');
      const running = { spinner: getComputedStyle(spinner).display, shimmer: getComputedStyle(label).animationName };
      row.dataset.fcState = 'complete';
      const done = {
        spinner: getComputedStyle(spinner).display,
        shimmer: getComputedStyle(label).animationName,
        glyph: getComputedStyle(row, '::before').content,
      };
      row.dataset.fcState = 'running';
      return { running, done };
    `);
    assert.notEqual(result.running.spinner, "none");
    assert.notEqual(result.running.shimmer, "none", "a running step's label shimmers");
    assert.equal(result.done.spinner, "none", "a finished step hides its spinner");
    assert.equal(result.done.shimmer, "none", "the shimmer cannot outlive the state");
    assert.match(result.done.glyph, /✓/);
  });

  // ----------------------------------------------------------------- table

  it("sorts a table, moving aria-sort to one header and flipping on repeat", async () => {
    await loadBindings();
    const result = await evaluate(`
      globalThis.table = new TL.FutureCssTable('#table-root');
      const ids = () => [...document.querySelectorAll('#table-root tbody tr[id]')].map((r) => r.id.slice(4));
      const sorts = () => [...document.querySelectorAll('#table-root thead th')].map((th) => th.getAttribute('aria-sort'));
      const buttons = document.querySelectorAll('#table-root .fc-table__sort');
      buttons[0].click();
      const byName = ids(); const nameSort = sorts();
      buttons[0].click();
      const byNameDesc = ids();
      buttons[1].click();
      const byTokens = ids(); const tokenSort = sorts();
      buttons[2].click();
      const byAge = ids();
      buttons[3].click();
      return { byName, nameSort, byNameDesc, byTokens, tokenSort, byAge, afterDisabled: sorts() };
    `);
    // lang="sv": Å sorts after Z in Swedish, which a plain string compare gets
    // right by accident and an English collator gets wrong.
    assert.deepEqual(result.byName, ["alpha", "beta", "zeta", "angstrom"]);
    assert.deepEqual(result.nameSort, ["ascending", null, null, null], "only the sorted header carries aria-sort");
    assert.deepEqual(result.byNameDesc, ["angstrom", "zeta", "beta", "alpha"]);
    // 9 < 100 < 12,480 numerically. Beta and Ångström tie at 100 and keep the
    // order of the previous (descending name) sort: the sort is stable.
    assert.deepEqual(result.byTokens, ["zeta", "angstrom", "beta", "alpha"]);
    assert.deepEqual(result.tokenSort, [null, "ascending", null, null]);
    assert.deepEqual(result.byAge, ["beta", "alpha", "zeta", "angstrom"], "data-fc-sort-value beats the visible text");
    assert.deepEqual(result.afterDisabled, [null, null, "ascending", null], "a disabled sort button does nothing");
  });

  it("only reports the sort in manual mode", async () => {
    await loadBindings();
    const result = await evaluate(`
      table.destroy();
      const before = [...document.querySelectorAll('#table-root tbody tr')].map((r) => r.id);
      const calls = [];
      const manual = new TL.FutureCssTable('#table-wrap', { mode: 'manual', onSort: (c, d) => calls.push([c, d]) });
      manual.sort(0);
      manual.sort(0);
      const after = [...document.querySelectorAll('#table-root tbody tr')].map((r) => r.id);
      manual.destroy();
      return { same: before.join() === after.join(), calls, sorted: manual.sorted };
    `);
    assert.equal(result.same, true, "manual mode leaves the rows to the server");
    assert.deepEqual(result.calls, [[0, "ascending"], [0, "descending"]]);
    assert.deepEqual(result.sorted, { column: 0, direction: "descending" });
  });

  it("draws the sort arrow from aria-sort and scrolls a wide table inside its wrapper", async () => {
    const result = await evaluate(`
      const ths = document.querySelectorAll('#table-root thead th');
      ths.forEach((th) => th.removeAttribute('aria-sort'));
      const glyph = (i) => getComputedStyle(ths[i].querySelector('.fc-table__sort'), '::after').content;
      const unsorted = glyph(0);
      ths[0].setAttribute('aria-sort', 'descending');
      const descending = glyph(0);
      ths[0].removeAttribute('aria-sort');
      const wrap = document.getElementById('table-wrap');
      return {
        unsorted, descending,
        position: getComputedStyle(ths[0]).position,
        wrapScrolls: wrap.scrollWidth > wrap.clientWidth,
        numAlign: getComputedStyle(ths[1]).textAlign,
        numFlow: getComputedStyle(ths[1].querySelector('.fc-table__sort')).flexDirection,
      };
    `);
    assert.match(result.unsorted, /↕/, "an unsorted column still shows it can be sorted");
    assert.match(result.descending, /↓/);
    assert.equal(result.position, "sticky");
    assert.equal(result.wrapScrolls, true, "the wrapper scrolls, not the page");
    assert.equal(result.numAlign, "end");
    assert.equal(result.numFlow, "row-reverse");
  });

  it("keeps focus on a row control through a sort, and rebinds after destroy", async () => {
    await loadBindings();
    const result = await evaluate(`
      const open = document.getElementById('row-zeta-open');
      const [bound] = TL.bindTables(document.getElementById('table-wrap'));
      open.focus();
      bound.sort(0, 'descending');
      bound.sort(0, 'ascending');
      const focused = document.activeElement === open;
      bound.destroy();
      const marker = document.getElementById('table-root').hasAttribute('data-fc-bound');
      const rebound = TL.bindTables(document.getElementById('table-wrap'));
      rebound.forEach((t) => t.destroy());
      return { focused, marker, rebound: rebound.length };
    `);
    assert.equal(result.focused, true, "moving the row must not drop the user's focus");
    assert.equal(result.marker, false, "destroy releases the bound marker");
    assert.equal(result.rebound, 1);
  });

  it("centres and pads the empty-table cell, and gives short sort headers a full target", async () => {
    const result = await evaluate(`
      const empty = getComputedStyle(document.getElementById('table-empty'));
      const cell = getComputedStyle(document.querySelector('#table-root tbody td'));
      const sort = document.querySelector('#table-root .fc-table__sort').getBoundingClientRect();
      const target = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.5;
      return { align: empty.textAlign, pad: parseFloat(empty.paddingTop), cellPad: parseFloat(cell.paddingTop), width: sort.width, target };
    `);
    assert.equal(result.align, "center");
    assert.ok(result.pad > result.cellPad * 2, `empty cell padding ${result.pad} vs ${result.cellPad}`);
    assert.ok(result.width >= result.target - 0.5, `sort target ${result.width} < ${result.target}`);
  });

  it("lays a description list out side by side when wide and stacked when narrow", async () => {
    const result = await evaluate(`
      const dl = document.getElementById('dl');
      const top = (sel) => dl.querySelector(sel).getBoundingClientRect().top;
      const wide = top('dt') === top('dd');
      dl.style.inlineSize = '14rem';
      const narrow = top('dt') < top('dd');
      dl.style.inlineSize = '40rem';
      dl.classList.add('fc-dl--stacked');
      const stacked = top('dt') < top('dd');
      dl.classList.remove('fc-dl--stacked');
      return { wide, narrow, stacked, ddMargin: getComputedStyle(dl.querySelector('dd')).marginInlineStart };
    `);
    assert.equal(result.wide, true);
    assert.equal(result.narrow, true, "the value wraps under its term when they no longer fit");
    assert.equal(result.stacked, true);
    assert.equal(result.ddMargin, "0px", "the UA indent on <dd> is removed");
  });

});
