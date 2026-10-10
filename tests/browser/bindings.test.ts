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
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findChrome, startServer } from "./server.mjs";

const chromePath = await findChrome();
const axeSourcePath = process.env.FC_AXE_SOURCE;
const axeSource = axeSourcePath ? readFileSync(axeSourcePath, "utf8") : null;

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
    // A thrown error is reported beside the value, at the same depth. Checked
    // one level up, it was missed: the test saw `undefined` instead of the error.
    const thrown = res.result?.exceptionDetails ?? res.exceptionDetails;
    if (thrown) {
      const detail = thrown.exception?.description ?? thrown.text;
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
        import('/src/js/nav.js'),
        import('/src/js/slider.js'),
        import('/src/js/toolbar.js'),
        import('/src/js/carousel.js'),
        import('/src/js/datepicker.js'),
        import('/src/js/splitter.js'),
      ]).then(([e, m, g, w, h, d, s, c, k, it, tb, ts, tt, tl, nv, sl, tr, cr, dp, sp]) => {
        globalThis.E = e; globalThis.M = m; globalThis.G = g; globalThis.W = w;
        globalThis.H = h; globalThis.D = d; globalThis.S = s;
        globalThis.C = c; globalThis.K = k; globalThis.IT = it;
        globalThis.TB = tb; globalThis.TS = ts; globalThis.TT = tt; globalThis.TL = tl; globalThis.NV = nv; globalThis.SL = sl; globalThis.TR = tr; globalThis.CR = cr; globalThis.DP = dp; globalThis.SP = sp;
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
        typeof TL.FutureCssTable, typeof NV.FutureCssNav,
      ]`,
    );
    assert.deepEqual(names, [
      "function", "function", "function", "function", "function", "function",
      "function", "function", "function", "function",
      "function", "function", "function", "function", "function",
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

  it("keeps every child when a paragraph becomes a block", async () => {
    // Regression: `appendChild(...nodes)` takes one node, so all but the first child
    // of the paragraph were dropped when it was replaced.
    await loadBindings();
    const html = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = '<p>Some <strong>bold</strong> text</p>';
      const p = el.firstChild;
      const r = document.createRange(); r.setStart(p.firstChild, 1); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.toggleBlock('h2');
      return el.innerHTML;
    `);
    assert.equal(html, "<h2>Some <strong>bold</strong> text</h2>");
  });

  it("removes a mark when the selection lies wholly inside it", async () => {
    // Regression: the element walker never returns its root, so the <strong> that
    // contains the whole selection was not found and Bold could not be removed.
    await loadBindings();
    const html = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = 'a <strong>bold word</strong> b';
      const text = el.querySelector('strong').firstChild;
      const r = document.createRange(); r.setStart(text, 0); r.setEnd(text, 4);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.removeMark('bold');
      return el.innerHTML;
    `);
    assert.equal(html, "a bold word b");
  });

  it("reports a link active when the selection is linked", async () => {
    await loadBindings();
    const active = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = 'see <a href="https://example.com">the docs</a>';
      const text = el.querySelector('a').firstChild;
      const r = document.createRange(); r.setStart(text, 0); r.setEnd(text, 3);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return globalThis.ed.isMarkActive('link');
    `);
    assert.equal(active, true);
  });

  it("starts a mark at the caret, not at the end of the document", async () => {
    await loadBindings();
    const html = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = 'before after';
      const r = document.createRange(); r.setStart(el.firstChild, 7); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.applyMark('bold');
      return el.innerHTML;
    `);
    assert.equal(html, "before <strong></strong>after", "the empty mark goes where the caret was");
  });

  it("keeps the caret in place when a block change ends at a block boundary", async () => {
    await loadBindings();
    const offset = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = '<p>first</p><p>second</p>';
      const second = el.lastChild;
      // An element endpoint: after the second paragraph's only child.
      const r = document.createRange(); r.setStart(second, 1); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.toggleBlock('h2');
      const after = getSelection().getRangeAt(0);
      const measure = document.createRange(); measure.setStart(el, 0); measure.setEnd(after.endContainer, after.endOffset);
      return measure.toString().length;
    `);
    assert.equal(offset, "firstsecond".length, "the caret stays at the end of the changed block");
  });

  it("never formats another editor's selection", async () => {
    await loadBindings();
    const html = await evaluate(`
      globalThis.ed = new E.FutureCssEditor({ root: '#ed' });
      const el = document.querySelector('.fc-editor__content');
      el.innerHTML = 'mine';
      const other = document.createElement('div');
      other.contentEditable = 'true';
      other.innerHTML = 'theirs';
      document.body.append(other);
      const r = document.createRange(); r.setStart(other.firstChild, 0); r.setEnd(other.firstChild, 6);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      globalThis.ed.removeMark('bold');
      globalThis.ed.toggleBlock('h2');
      globalThis.ed.applyMark('italic');
      const result = el.innerHTML + '|' + other.innerHTML;
      other.remove();
      return result;
    `);
    assert.equal(html, "mine|theirs");
  });

  it("stops listening after destroy", async () => {
    await loadBindings();
    const changes = await evaluate(`
      let count = 0;
      const ed = new E.FutureCssEditor({ root: '#ed', onSelectionChange: () => { count++; } });
      const el = document.querySelector('.fc-editor__content');
      ed.destroy();
      el.dispatchEvent(new Event('input'));
      document.dispatchEvent(new Event('selectionchange'));
      document.querySelector('[data-fc-mark="bold"]').click();
      return count;
    `);
    assert.equal(changes, 0);
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

  it("wires a menu button: aria-expanded follows the menu, which opens beneath it", async () => {
    // The split button's toggle draws its open state from aria-expanded, so the
    // binding keeping it in step is what keeps the drawn and announced states
    // the same. A fresh menu, for the same reason as the arrow-navigation test.
    await loadBindings();
    const r = await evaluate(`
      // An earlier test leaves its menu open, and its document-level Escape
      // handler would move focus to its own trigger.
      globalThis.m?.close();
      const wrap = document.createElement('div');
      wrap.innerHTML = \`
        <button type="button" id="mb-trigger" class="fc-btn">More</button>
        <div class="fc-menu" id="mb-menu" popover="manual">
          <button type="button" class="fc-menu__item" role="menuitem">Send later</button>
          <button type="button" class="fc-menu__item" role="menuitem">Save draft</button>
        </div>\`;
      // Pinned to the top, so there is room below whatever the page above it
      // has grown to; the flip case is tested on its own below.
      wrap.style.cssText = 'position: fixed; inset-block-start: 8px; inset-inline-start: 24px;';
      document.body.appendChild(wrap);
      const trigger = wrap.querySelector('#mb-trigger');
      const menuEl = wrap.querySelector('#mb-menu');
      const m = M.bindMenuButton(trigger, '#mb-menu');
      const out = { initial: [trigger.getAttribute('aria-haspopup'), trigger.getAttribute('aria-expanded'), trigger.getAttribute('aria-controls')] };

      trigger.focus();
      trigger.click();
      const t = trigger.getBoundingClientRect(), mr = menuEl.getBoundingClientRect();
      out.opened = [m.isOpen, trigger.getAttribute('aria-expanded'), document.activeElement.textContent.trim()];
      out.below = mr.top >= t.bottom && Math.abs(mr.left - t.left) < 2;

      menuEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      out.escaped = [m.isOpen, trigger.getAttribute('aria-expanded'), document.activeElement.id];

      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      out.arrow = m.isOpen;

      // A pointer click on the trigger of an open menu closes it and leaves it closed.
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      trigger.click();
      out.toggledClosed = [m.isOpen, trigger.getAttribute('aria-expanded')];

      // Enter and Space click with no pointerdown first; that click closes too.
      trigger.click();
      trigger.focus();
      trigger.click();
      out.keyboardClosed = m.isOpen;

      // An aria-disabled trigger stays focusable but opens nothing.
      trigger.setAttribute('aria-disabled', 'true');
      trigger.click();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      out.disabledOpens = m.isOpen;
      trigger.removeAttribute('aria-disabled');

      // ArrowUp opens at the last item.
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      out.arrowUp = document.activeElement.textContent.trim();
      m.close();

      // At the bottom of the viewport the menu opens above the trigger, and at
      // the inline end it is pulled back inside the viewport.
      trigger.style.cssText = 'position: fixed; inset-block-end: 2px; inset-inline-end: 2px;';
      trigger.click();
      const t3 = trigger.getBoundingClientRect(), mr3 = menuEl.getBoundingClientRect();
      out.flipped = mr3.bottom <= t3.top && mr3.top >= 0;
      out.clamped = mr3.right <= document.documentElement.clientWidth && mr3.left >= 0;
      m.close();
      trigger.style.cssText = '';

      // A locally RTL trigger with an LTR menu outside its section still lines
      // the menu up with the trigger's right edge.
      const section = document.createElement('div');
      section.dir = 'rtl';
      section.style.cssText = 'inline-size: 300px;';
      wrap.prepend(section);
      section.appendChild(trigger);
      trigger.click();
      const t4 = trigger.getBoundingClientRect(), mr4 = menuEl.getBoundingClientRect();
      out.mixedAligned = Math.abs(mr4.right - t4.right) < 2;
      m.close();
      wrap.appendChild(trigger);
      section.remove();

      // RTL: the menu's inline-start edge is its right edge, so it lines up with
      // the trigger's right edge rather than its left.
      document.documentElement.dir = 'rtl';
      trigger.click();
      const t2 = trigger.getBoundingClientRect(), mr2 = menuEl.getBoundingClientRect();
      out.rtlAligned = Math.abs(mr2.right - t2.right) < 2;
      m.close();
      document.documentElement.dir = '';
      wrap.remove();
      return out;
    `);
    assert.deepEqual(r.initial, ["menu", "false", "mb-menu"]);
    assert.deepEqual(r.opened, [true, "true", "Send later"]);
    assert.equal(r.below, true, "the menu opens beneath the trigger, aligned to its start edge");
    assert.deepEqual(r.escaped, [false, "false", "mb-trigger"]);
    assert.equal(r.arrow, true, "ArrowDown on the trigger opens the menu");
    assert.deepEqual(r.toggledClosed, [false, "false"]);
    assert.equal(r.keyboardClosed, false, "a keyboard click on the trigger of an open menu closes it");
    assert.equal(r.disabledOpens, false, "an aria-disabled trigger does not open its menu");
    assert.equal(r.arrowUp, "Save draft", "ArrowUp opens the menu at its last item");
    assert.equal(r.flipped, true, "at the viewport bottom the menu opens above the trigger");
    assert.equal(r.clamped, true, "the menu stays inside the viewport sideways");
    assert.equal(r.mixedAligned, true, "an RTL trigger's LTR menu aligns to the trigger's right edge");
    assert.equal(r.rtlAligned, true, "in RTL the menu aligns to the trigger's right edge");
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

  it("uses the viewport for the demo and highlights every section's copyable examples", async () => {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${server.origin}/demo/index.html` });
    await new Promise((r) => setTimeout(r, 1200));
    const result = await evaluate(`
      const original = new DOMParser().parseFromString(await (await fetch('/demo/index.html')).text(), 'text/html');
      const snippets = [...document.querySelectorAll('[data-demo-snippet]')];
      const missing = [...document.querySelectorAll('.demo-section')]
        .filter((section) => !section.querySelector('[data-demo-snippet]')).map((section) => section.id);
      const changed = snippets.filter((snippet) => {
        const initial = original.querySelector('[data-demo-snippet="' + snippet.dataset.demoSnippet + '"] code');
        return snippet.querySelector('code').textContent !== initial.textContent;
      }).map((snippet) => snippet.dataset.demoSnippet);
      const unhighlighted = snippets.filter((snippet) => !snippet.matches('.fc-code') || !snippet.querySelector('.fc-code__tok'))
        .map((snippet) => snippet.dataset.demoSnippet);
      const block = document.querySelector('.demo-snippet');
      const source = getComputedStyle(block.querySelector('.fc-code__source'));
      return {
        missing, changed, unhighlighted,
        width: document.querySelector('main').getBoundingClientRect().width,
        overflow: getComputedStyle(block).overflowX,
        sourceRadius: source.borderStartStartRadius,
        sourceBackground: source.backgroundColor,
      };
    `);
    assert.deepEqual(result.missing, [], "every section has usage examples");
    assert.deepEqual(result.changed, [], "highlighting preserves the exact text copied");
    assert.deepEqual(result.unhighlighted, [], "examples use the real highlighted code component");
    assert.ok(result.width > 1300, "the workbench uses the available desktop width");
    assert.equal(result.overflow, "clip", "child surfaces follow the outer corners");
    assert.equal(result.sourceRadius, "0px", "block source does not inherit inline-code rounding");
    assert.equal(result.sourceBackground, "rgba(0, 0, 0, 0)");
    await send("Emulation.clearDeviceMetricsOverride");
  });

  it("nests the masthead and sidebar with a working collapse control", async () => {
    await send("Page.navigate", { url: `${server.origin}/demo/index.html` });
    await new Promise((r) => setTimeout(r, 1200));
    const result = await evaluate(`
      const nav = document.querySelector('#shell-nav');
      const toggle = nav.querySelector('.fc-nav__toggle');
      const expanded = nav.getBoundingClientRect().width;
      toggle.click();
      await new Promise((r) => setTimeout(r, 250));
      const collapsed = nav.getBoundingClientRect().width;
      const state = toggle.getAttribute('aria-expanded');
      const masthead = document.querySelector('#shell .fc-masthead');
      return { expanded, collapsed, state,
        current: masthead.querySelector('[aria-current="page"]').textContent,
        disabledHref: masthead.querySelector('[aria-disabled="true"]').getAttribute('href'),
        named: [...nav.querySelectorAll('.fc-nav__link')].every((link) => link.textContent.trim()),
      };
    `);
    assert.ok(result.collapsed < result.expanded, "the live sidebar collapses to a rail");
    assert.equal(result.state, "false");
    assert.equal(result.current, "Workspace");
    assert.equal(result.disabledHref, null);
    assert.equal(result.named, true, "collapsed destinations retain accessible names");
  });

  it("operates grouped composer controls without sending and keeps settings through Send/Stop", async () => {
    await send("Page.navigate", { url: `${server.origin}/demo/index.html` });
    await new Promise((r) => setTimeout(r, 1200));
    const result = await evaluate(`
      const root = document.querySelector('#composer-root');
      root.scrollIntoView({ block: 'center' });
      const input = root.querySelector('textarea');
      input.value = 'Review this design';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const search = document.querySelector('#composer-search');
      search.click();
      const invoker = document.querySelector('#composer-model');
      invoker.focus();
      const key = (value) => invoker.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
      key('Enter'); key('ArrowDown'); key('Enter');
      const beforeSend = { draft: input.value, state: root.dataset.fcState,
        model: invoker.dataset.fcValue, pressed: search.getAttribute('aria-pressed'),
        expanded: invoker.getAttribute('aria-expanded') };
      const send = document.querySelector('#composer-send');
      send.click();
      const running = input.readOnly && root.dataset.fcState === 'running';
      const submitted = document.querySelector('#composer-context-status').textContent;
      send.click();
      const bold = document.querySelector('[data-demo-format="bold"]');
      bold.click();
      return { beforeSend, running, submitted, sameSend: send === document.querySelector('#composer-send'),
        modelAfter: invoker.dataset.fcValue, searchAfter: search.getAttribute('aria-pressed'),
        bold: !!document.querySelector('#group-preview strong'), stopped: root.dataset.fcState };
    `);
    assert.equal(result.beforeSend.draft, 'Review this design');
    assert.equal(result.beforeSend.state, 'idle', 'model and tool controls do not submit the draft');
    assert.equal(result.beforeSend.model, 'fast');
    assert.equal(result.beforeSend.pressed, 'true');
    assert.equal(result.beforeSend.expanded, 'false');
    assert.equal(result.running, true);
    assert.match(result.submitted, /using fast; tools: Web search/);
    assert.equal(result.sameSend, true);
    assert.equal(result.modelAfter, 'fast');
    assert.equal(result.searchAfter, 'true');
    assert.equal(result.stopped, 'idle');
    assert.equal(result.bold, true, 'standalone grouped controls update the preview');
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

  it("navigates git rows and preserves native Stage keyboard activation", async () => {
    await loadBindings();
    await buildGit({}, "onStage: (path) => { globalThis.staged = path; }");
    const result = await evaluate(`
      const rows=[...document.querySelectorAll('#git-root .fc-git__row')];
      rows[0].focus();
      rows[0].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
      return [document.activeElement===rows.at(-1),rows.at(-1).getAttribute('aria-selected'),document.querySelector('#git-root .fc-git__files').getAttribute('role')];
    `);
    assert.deepEqual(result,[true,'true','grid']);
    await evaluate(`globalThis.staged=null;document.querySelector('#git-root .fc-git__stage-button').focus();`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.ok(await evaluate(`return globalThis.staged;`), 'Enter activates the nested native Stage button');
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

  it("applies optional brand and contrast themes and the browser contrast preference", async () => {
    const result = await evaluate(`
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/dist/themes.css';
      document.head.append(link); await new Promise((resolve,reject) => {link.onload=resolve;link.onerror=reject});
      const root = document.documentElement;
      const sample = document.createElement('button'); sample.className = 'fc-btn fc-btn--primary'; sample.textContent = 'Theme'; sample.style.transition = 'none'; document.body.append(sample);
      root.dataset.fcTheme = 'light';
      const initial = getComputedStyle(sample).backgroundColor;
      root.dataset.fcBrand = 'forest';
      const forest = getComputedStyle(sample).backgroundColor;
      root.dataset.fcTheme = 'high-contrast-light';
      const light = {fg:getComputedStyle(sample).color,bg:getComputedStyle(sample).backgroundColor};
      root.dataset.fcTheme = 'high-contrast-dark';
      const dark = {fg:getComputedStyle(sample).color,bg:getComputedStyle(sample).backgroundColor};
      root.dataset.fcTheme = 'light'; delete root.dataset.fcBrand;
      sample.remove(); link.remove();
      return {initial,forest,light,dark};
    `);
    assert.notEqual(result.initial, result.forest);
    assert.deepEqual(result.light, {fg:'rgb(255, 255, 255)',bg:'rgb(0, 0, 0)'});
    assert.deepEqual(result.dark, {fg:'rgb(0, 0, 0)',bg:'rgb(255, 255, 255)'});
    try {
      await send("Emulation.setEmulatedMedia", { features:[{name:'prefers-contrast',value:'more'}] });
      const high = await evaluate(`
        const link=document.createElement('link');link.rel='stylesheet';link.href='/dist/themes.css';document.head.append(link);
        await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject});
        const color=getComputedStyle(document.documentElement).getPropertyValue('--fc-color-text-default');
        link.remove(); return color;
      `);
      assert.match(high, /#000000/);
    } finally { await send("Emulation.setEmulatedMedia", {features:[]}); }
  });

  it("keeps RustyClaw decisions explicit and validates inline answers", async () => {
    await send("Page.navigate", { url: `${server.origin}/demo/rustyclaw.html` });
    await new Promise(r => setTimeout(r, 800));
    const result = await evaluate(`
      const approval = document.querySelector('.fc-approval');
      const prompt = document.querySelector('.fc-user-prompt');
      const input = prompt.querySelector('input');
      prompt.requestSubmit(prompt.querySelector('[type=submit]'));
      const invalidState = prompt.dataset.fcState;
      input.value = 'Example project';
      prompt.requestSubmit(prompt.querySelector('[type=submit]'));
      approval.requestSubmit(approval.querySelector('[value=deny]'));
      return {
        invalidState, promptState: prompt.dataset.fcState,
        approvalState: approval.dataset.fcState,
        label: input.labels[0].textContent,
        fullArguments: approval.querySelector('details code').textContent,
        resolvedDisabled: [...document.querySelectorAll('[data-rc-example] button')].every(b => b.disabled)
      };
    `);
    assert.equal(result.invalidState, 'pending');
    assert.equal(result.promptState, 'complete');
    assert.equal(result.approvalState, 'denied');
    assert.match(result.label, /Project name/);
    assert.match(result.fullArguments, /README.md/);
    assert.equal(result.resolvedDisabled, true);
    try {
      await send('Emulation.setDeviceMetricsOverride', {width:320,height:900,deviceScaleFactor:1,mobile:false});
      for (const dir of ['ltr', 'rtl']) {
        for (const theme of ['light', 'dark']) {
          const overflow = await evaluate(`
            document.documentElement.dir=${JSON.stringify(dir)};
            document.documentElement.dataset.fcTheme=${JSON.stringify(theme)};
            return document.documentElement.scrollWidth > innerWidth;
          `);
          assert.equal(overflow, false, `recipe overflow: ${dir}/${theme}`);
        }
      }
    } finally { await send('Emulation.clearDeviceMetricsOverride'); }
  });

  it("keeps long approval arguments inspectable at narrow widths in both directions", async () => {
    try {
      await send('Emulation.setDeviceMetricsOverride', {width:320,height:900,deviceScaleFactor:1,mobile:false});
      for (const page of ['/demo/rustyclaw.html', '/demo/fixtures.html']) {
        await send('Page.navigate', {url: `${server.origin}${page}`});
        await new Promise(r => setTimeout(r, 800));
        for (const dir of ['ltr', 'rtl']) {
          const result = await evaluate(`
            document.documentElement.dir=${JSON.stringify(dir)};
            const approval=document.querySelector('.fc-approval');
            const details=approval.querySelector('details'); details.open=true;
            const source=approval.querySelector('.fc-code__source');
            const text=JSON.stringify({path:'workspace/'+'directory-'.repeat(80)+'README.md'});
            source.querySelector('code').textContent=text;
            const range=document.createRange();range.selectNodeContents(source.querySelector('code'));
            const box=source.getBoundingClientRect();
            const rects=[...range.getClientRects()];
            return {text:source.textContent, expected:text, wraps:getComputedStyle(source).whiteSpace,
              contained:rects.every(r=>r.left>=box.left-1&&r.right<=box.right+1),
              overflow:document.documentElement.scrollWidth>innerWidth, offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(-10).map(e=>e.className)};
          `);
          assert.equal(result.text, result.expected);
          assert.equal(result.wraps, 'pre-wrap');
          assert.equal(result.contained, true, `${page}: ${dir} arguments clipped`);
          assert.equal(result.overflow, false, `${page}: ${dir} page overflow ${JSON.stringify(result.offenders)}`);
        }
      }
    } finally {await send('Emulation.clearDeviceMetricsOverride');}
  });

  it("renders all fixtures under reduced motion and forced colors", async () => {
    try {
      await send("Page.navigate", { url: `${server.origin}/demo/fixtures.html` });
      await new Promise(r => setTimeout(r, 1000));
      for (const feature of [{name:'prefers-reduced-motion',value:'reduce'}, {name:'forced-colors',value:'active'}]) {
        await send("Emulation.setEmulatedMedia", {features:[feature]});
        const blank = await evaluate(`return [...document.querySelectorAll('[data-fixture]')].filter(el=>el.getBoundingClientRect().height === 0).map(el=>el.dataset.fixture);`);
        assert.deepEqual(blank, [], feature.name);
        const capture = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:true});
        assert.ok(Buffer.from(capture.result?.data ?? capture.data, 'base64').length > 1000);
        if (feature.name === 'forced-colors') {
          const fg = await evaluate(`return getComputedStyle(document.querySelector('.fc-btn')).color;`);
          assert.notEqual(fg, 'rgba(0, 0, 0, 0)');
        }
      }
    } finally { await send("Emulation.setEmulatedMedia", {features:[]}); }
  });

  it("prints a light document and preserves explicit content while hiding marked chrome", async () => {
    try {
      await evaluate(`
        const link=document.createElement('link');link.id='print-test-style';link.rel='stylesheet';link.href='/dist/print.css';document.head.append(link);
        await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject});
        document.documentElement.dataset.fcTheme='dark';
        const chrome=document.createElement('button');chrome.id='print-test-chrome';chrome.className='fc-print-hide';chrome.textContent='Action';document.body.append(chrome);
        const content=document.createElement('a');content.id='print-test-content';content.className='fc-print-content fc-print-link';content.href='https://example.com/reference';content.textContent='Reference';document.body.append(content);
      `);
      await send('Emulation.setEmulatedMedia',{media:'print'});
      const result=await evaluate(`
        const content=document.getElementById('print-test-content');
        return {scheme:getComputedStyle(document.documentElement).colorScheme,select:document.querySelector("#model-select")?.outerHTML,fill:getComputedStyle(document.querySelector(".fc-btn")).webkitTextFillColor,labelstyle:document.querySelector("#model-select .fc-select__value")&&{display:getComputedStyle(document.querySelector("#model-select .fc-select__value")).display,visibility:getComputedStyle(document.querySelector("#model-select .fc-select__value")).visibility},rect:document.querySelector("#model-select .fc-select__value")?.getBoundingClientRect().toJSON(),hidden:getComputedStyle(document.getElementById('print-test-chrome')).display,display:getComputedStyle(content).display,url:getComputedStyle(content,'::after').content,shadow:getComputedStyle(content).boxShadow};
      `);
      assert.equal(result.scheme,'light'); assert.equal(result.hidden,'none');
      assert.notEqual(result.display,'none'); assert.match(result.url,/reference/); assert.equal(result.shadow,'none');
    } finally {
      await send('Emulation.setEmulatedMedia',{media:'',features:[]});
      await evaluate(`document.documentElement.dataset.fcTheme='light';for(const id of ['print-test-style','print-test-chrome','print-test-content'])document.getElementById(id)?.remove();`);
    }
  });

  it("replaces the translucent dialog backdrop when reduced transparency is requested", async () => {
    try {
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
      const result=await evaluate(`
        const dialog=document.createElement('dialog');dialog.className='fc-dialog';dialog.setAttribute('aria-label','Preference test');dialog.textContent='Dialog';document.body.append(dialog);dialog.showModal();
        const cs=getComputedStyle(dialog,'::backdrop');const result={color:cs.backgroundColor,filter:cs.backdropFilter};dialog.close();dialog.remove();return result;
      `);
      assert.equal(result.filter,'none'); assert.doesNotMatch(result.color,/rgba/);
    } finally {await send('Emulation.setEmulatedMedia',{features:[]});}
  });

  it("has no serious or critical axe findings in fixtures and the working demo", {skip: axeSource ? false : 'set FC_AXE_SOURCE to an isolated axe-core/axe.min.js'}, async () => {
    for (const page of ['/demo/fixtures.html','/demo/index.html','/demo/rustyclaw.html']) {
      for (const dir of ['ltr','rtl']) for (const theme of ['light','dark']) {
        await send('Page.navigate',{url:`${server.origin}${page}?dir=${dir}&theme=${theme}`});
        await new Promise(r=>setTimeout(r,1000));
        await evaluate(`document.documentElement.dir=${JSON.stringify(dir)};document.documentElement.dataset.fcTheme=${JSON.stringify(theme)};`);
        await new Promise(r=>setTimeout(r,300));
        await send('Runtime.evaluate',{expression:axeSource});
        const findings=await evaluate(`
          const result=await axe.run(document);
          return result.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
        `);
        assert.deepEqual(findings,[],`${page} ${dir} ${theme}: ${JSON.stringify(findings,null,2)}`);
      }
    }
  });

  it("keeps joined seams square across stock themes, states and directions", async () => {
    const results = await evaluate(`
      const link=document.createElement('link');link.rel='stylesheet';link.href='/dist/themes.css';document.head.append(link);await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});
      const {themePresets}=await import('/src/js/theme-picker.js');
      const region=document.createElement('section');region.style.inlineSize='320px';
      region.innerHTML='<div class="fc-split-btn"><button class="fc-btn fc-btn--primary fc-split-btn__action">Export</button><button class="fc-btn fc-btn--primary fc-split-btn__toggle" aria-label="Export options">+</button></div><div class="fc-button-group"><button class="fc-btn fc-btn--secondary fc-button-group__item">Start</button><button class="fc-btn fc-btn--secondary fc-button-group__item">Center</button><button class="fc-btn fc-btn--secondary fc-button-group__item">End</button></div><div class="fc-control-group fc-control-group--joined"><button class="fc-btn fc-btn--secondary fc-control-group__joined-item">Clear</button><input aria-label="Query" class="fc-input fc-control-group__joined-item fc-control-group__control"><button class="fc-btn fc-btn--primary fc-control-group__joined-item">Search</button></div>';
      document.body.append(region);const results=[];
      for(const theme of themePresets)for(const scheme of ['light','dark'])for(const dir of ['ltr','rtl']) {
        region.dataset.fcDesign=theme.id;region.dataset.fcPalette=theme.palette;region.dataset.fcTheme=scheme;region.dir=dir;
        for(const state of ['false','true']) {
          region.querySelector('.fc-split-btn__toggle').setAttribute('aria-expanded',state);
          for(const button of region.querySelectorAll('.fc-button-group__item'))button.setAttribute('aria-pressed',state);
          await new Promise(r=>setTimeout(r,180));
          for(const selector of ['.fc-split-btn','.fc-button-group','.fc-control-group']) {
            const group=region.querySelector(selector),parts=[...group.children];
            const corners=parts.flatMap((part,i)=>{const css=getComputedStyle(part);return [...(i>0?[css.borderStartStartRadius,css.borderEndStartRadius]:[]),...(i<parts.length-1?[css.borderStartEndRadius,css.borderEndEndRadius]:[])];});
            results.push({theme:theme.id,scheme,dir,state,selector,corners,gap:getComputedStyle(group).columnGap,overflow:group.scrollWidth>320});
          }
        }
      }
      region.style.setProperty('--fc-joined-inner-radius','4px');await new Promise(r=>setTimeout(r,180));
      const custom=getComputedStyle(region.querySelector('.fc-split-btn__action')).borderStartEndRadius;
      region.remove();return {results,custom};
    `);
    assert.equal(results.results.length,504);
    for(const row of results.results){assert.ok(row.corners.every(c=>c==='0px'),JSON.stringify(row));assert.equal(row.gap,'0px');assert.equal(row.overflow,false,JSON.stringify(row));}
    assert.equal(results.custom,'4px');
  });

  it("applies stock design geometry, palette and schemes through a scoped picker", async () => {
    await evaluate(`
      const link=document.createElement('link');link.rel='stylesheet';link.href='/dist/themes.css';document.head.append(link);await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});
      globalThis.Themes=await import('/src/js/theme-picker.js');
      const old=document.getElementById('theme-test');old?.remove();
      const region=document.createElement('section');region.id='theme-test';region.setAttribute('aria-label','Appearance preview');
      region.style.inlineSize='320px';region.innerHTML='<div id="test-picker" class="fc-theme-picker"></div><article class="fc-card fc-card--feature">Patterned feature text</article><header class="fc-masthead"><a class="fc-masthead__brand" href="#theme-test">Workspace</a><a class="fc-masthead__link" href="#theme-test" aria-current="page">Home</a></header><article class="fc-card"><div class="fc-card__body"><h2>Readable work</h2><p>A surface that follows your preferences.</p><label>Search<input class="fc-input"></label><button class="fc-btn fc-btn--primary" id="theme-test-button">Continue</button></div></article><div class="fc-composer"><label>Message<textarea class="fc-composer__input"></textarea></label></div>';
      document.body.append(region);globalThis.themeChanges=[];
      globalThis.tp=new Themes.FutureCssThemePicker({root:'#test-picker',target:region,onChange:s=>themeChanges.push(s)});
      return true;
    `);
    const results=await evaluate(`
      const region=document.getElementById('theme-test');const results=[];
      for(const design of Themes.themePresets)for(const scheme of ['light','dark'])for(const dir of ['ltr','rtl']){
        region.dir=dir;tp.setState({design:design.id,palette:design.palette,scheme});await new Promise(r=>setTimeout(r,300));
        const card=getComputedStyle(region.querySelector('.fc-card:not(.fc-card--feature)')),featureCard=getComputedStyle(region.querySelector('.fc-card--feature')),button=getComputedStyle(region.querySelector('.fc-btn'));
        results.push({id:design.id,scheme,dir,featureShadow:featureCard.textShadow,featureImage:featureCard.backgroundImage,radius:card.borderRadius,shadow:card.boxShadow,font:card.fontFamily,canvas:getComputedStyle(region).backgroundImage,feature:getComputedStyle(region).getPropertyValue('--fc-theme-feature-image'),overflow:region.scrollWidth>region.clientWidth+1,target:parseFloat(button.minHeight),selected:region.querySelector('input[value="'+design.id+'"]').checked});
      }
      return results;
    `);
    assert.equal(results.length,84);
    for(const result of results){assert.equal(result.overflow,false,JSON.stringify(result));assert.equal(result.selected,true);assert.ok(result.target>=24);}
    const square=results.find(r=>r.id==='blueprint');const round=results.find(r=>r.id==='ocean');assert.equal(square.radius,'0px');assert.notEqual(round.radius,square.radius);
    assert.equal(results.find(r=>r.id==='clarity').shadow,'none');assert.notEqual(round.shadow,'none');
    assert.match(results.find(r=>r.id==='editorial').font,/serif/);
    for(const id of ['candy','parchment','bubble'])for(const row of results.filter(r=>r.id===id))assert.notEqual(row.canvas,'none',JSON.stringify(row));
    assert.match(results.find(r=>r.id==='arcade').font,/monospace/);
    for(const row of results.filter(r=>['candy','arcade','pride'].includes(r.id))){assert.notEqual(row.featureShadow,'none',JSON.stringify(row));assert.notEqual(row.featureImage,'none',JSON.stringify(row));}
    assert.equal(results.find(r=>r.id==='future').featureShadow,'none');
    // Native radio ArrowRight changes the design, rather than a synthetic custom key handler.
    await evaluate(`document.getElementById('theme-test').dir='ltr';tp.setState({design:'future',palette:'default',scheme:'light'});document.querySelector('#test-picker input[value="future"]').focus();`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    assert.equal(await evaluate(`return tp.value.design;`),'clarity');
    await evaluate(`tp.destroy();document.getElementById('theme-test').remove();`);
  });

  it("renders theme options as independent windows and edits an exportable Custom design", async () => {
    const result=await evaluate(`
      const link=document.createElement('link');link.rel='stylesheet';link.href='/dist/themes.css';document.head.append(link);await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});
      const {FutureCssThemePicker}=await import('/src/js/theme-picker.js');
      const region=document.createElement('section'),root=document.createElement('div');root.className='fc-theme-picker';region.append(root);document.body.append(region);
      const contract=await fetch('/dist/theme-contract.json').then(r=>r.json());
      const picker=new FutureCssThemePicker({root,target:region,contract});
      const snapshot=()=>[...root.querySelectorAll('[data-fc-theme-option]')].map(option=>({id:option.dataset.fcThemeOption,design:option.dataset.fcDesign,palette:option.dataset.fcPalette,radius:getComputedStyle(option).borderRadius,border:getComputedStyle(option).borderTopWidth,shadow:getComputedStyle(option.querySelector('.fc-theme-picker__window-feature')).textShadow,image:getComputedStyle(option).backgroundImage,window:!!option.querySelector('.fc-theme-picker__window')}));
      const before=snapshot();picker.setState({design:'forest',palette:'forest',scheme:'dark'});const after=snapshot();
      picker.setState({design:'custom'});const shown=!root.querySelector('[data-fc-theme-editor]').hidden;
      for(const [key,value] of [['shape','square'],['depth','lifted'],['surface','tinted'],['palette','rose']]){const control=root.querySelector('[data-fc-theme-parameter="'+key+'"]');control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));}
      const role=root.querySelector('[data-fc-theme-color=role]');role.value='text-default';role.dispatchEvent(new Event('change',{bubbles:true}));
      const beforeColor=picker.exportCustomTheme();root.querySelector('[data-fc-theme-color=light]').value='#ffffff';root.querySelector('[data-fc-theme-color-apply]').click();const rejected=root.dataset.fcState==='error'&&picker.exportCustomTheme()===beforeColor;
      root.querySelector('[data-fc-theme-color=light]').value=contract.palettes.rose['text-default'].light;root.querySelector('[data-fc-theme-color=dark]').value=contract.palettes.rose['text-default'].dark;root.querySelector('[data-fc-theme-color-apply]').click();const accepted=root.dataset.fcState==='complete'&&picker.value.palette==='custom';
      const paletteSelect=root.querySelector('select[data-fc-theme-control=palette]');const paletteListed=paletteSelect.value==='custom';
      for(const value of ['forest','custom']){paletteSelect.value=value;paletteSelect.dispatchEvent(new Event('change',{bubbles:true}));}const paletteReturned=picker.value.palette==='custom';
      picker.setState({contrast:'high'});const highClearsCustomColors=!root.querySelector('[data-fc-theme-option=custom]').style.getPropertyValue('--fc-color-text-default');
      const draft=picker.exportCustomTheme(),state=picker.value,customRadius=getComputedStyle(root.querySelector('[data-fc-theme-option="custom"]')).borderRadius;
      picker.setState({design:'future'});const hidden=root.querySelector('[data-fc-theme-editor]').hidden;picker.destroy();region.remove();return {before,after,shown,draft,state,customRadius,hidden,rejected,accepted,highClearsCustomColors,paletteListed,paletteReturned};
    `);
    assert.equal(result.before.length,22);assert.ok(result.before.every(option=>option.window));
    for(const option of result.before.filter(o=>['candy','arcade','pride'].includes(o.id))){assert.notEqual(option.shadow,'none');assert.equal(option.image,'none');}
    for(const option of result.before)assert.equal(option.border,['clarity','graphite','blueprint','solar','arcade'].includes(option.id)?'2px':'1px',option.id);
    assert.equal(result.before.find(o=>o.id==='blueprint').radius,'0px');assert.notEqual(result.before.find(o=>o.id==='forest').radius,'0px');
    assert.deepEqual(result.before.map(o=>[o.id,o.design,o.palette,o.radius]),result.after.map(o=>[o.id,o.design,o.palette,o.radius]));
    assert.equal(result.shown,true);assert.equal(result.hidden,true);assert.equal(result.customRadius,'0px');assert.equal(result.state.design,'custom');assert.equal(result.state.palette,'custom');assert.equal(result.rejected,true);assert.equal(result.accepted,true);assert.equal(result.highClearsCustomColors,true);
    assert.equal(result.paletteListed,true,'the first custom color adds a selectable Custom palette');assert.equal(result.paletteReturned,true,'Custom palette is reachable again after choosing a stock palette');
    assert.match(result.draft,/shape = "square"/);assert.match(result.draft,/depth = "lifted"/);assert.match(result.draft,/palette = "rose"/);
  });

  it("starts from a scheme the page set before script loaded", async () => {
    const result=await evaluate(`
      const {FutureCssThemePicker}=await import('/src/js/theme-picker.js');
      const read=theme=>{const region=document.createElement('section');region.dataset.fcTheme=theme;const root=document.createElement('div');region.append(root);document.body.append(region);
        const picker=new FutureCssThemePicker({root,target:region});const value=picker.value,applied=region.dataset.fcTheme;picker.destroy();region.remove();return {scheme:value.scheme,contrast:value.contrast,applied};};
      return {dark:read('dark'),light:read('light'),high:read('high-contrast-dark'),unknown:read('sepia')};
    `);
    assert.deepEqual(result.dark,{scheme:'dark',contrast:'system',applied:'dark'});
    assert.deepEqual(result.light,{scheme:'light',contrast:'system',applied:'light'});
    assert.deepEqual(result.high,{scheme:'dark',contrast:'high',applied:'high-contrast-dark'});
    assert.equal(result.unknown.scheme,'system');
  });

  it("loads TOML, rejects inaccessible imports, and restores custom colors after contrast preferences", async () => {
    const result=await evaluate(`
      const {FutureCssThemePicker}=await import('/src/js/theme-picker.js');
      const contract=await fetch('/dist/theme-contract.json').then(r=>r.json());
      const region=document.createElement('section');region.id='theme-import-test';region.style.setProperty('--fc-radius-lg','3rem');document.body.append(region);
      const picker=document.createElement('div');picker.className='fc-theme-picker';region.append(picker);
      globalThis.importPicker=new FutureCssThemePicker({root:picker,target:region,contract});
      const id=await importPicker.loadTheme('/demo/themes/reading-room.toml');
      importPicker.setState({design:id,palette:'forest',scheme:'light'});
      const before=importPicker.value;let rejected=false;
      try{importPicker.registerTheme({schemaVersion:1,version:'1.0.0',id:'bad-colors',name:'Bad',description:'Unreadable',base:'future',colors:{'text-default':{light:'#ffffff',dark:'#000000'}}});}catch{rejected=true;}
      const unchanged=JSON.stringify(before)===JSON.stringify(importPicker.value);
      importPicker.registerTheme({schemaVersion:1,version:'1.0.0',id:'custom-palette',name:'Custom',description:'Verified palette',base:'future',colors:{'text-default':contract.colors['text-default']}});
      importPicker.setState({design:'custom-palette',palette:'custom-palette'});
      const inline=region.style.getPropertyValue('--fc-color-text-default');
      let foreign='';try{await importPicker.loadTheme('https://theme-host.invalid/evil.toml');}catch(error){foreign=error.message;}
      // Two overlapping imports: the slower, older file must not replace the newer choice.
      const toml=(id,delay)=>({size:200,text:()=>new Promise(r=>setTimeout(()=>r('schema-version = 1\\nversion = "1.0.0"\\nid = "'+id+'"\\nname = "'+id+'"\\ndescription = "Race"\\nbase = "future"\\n'),delay))});
      const older=importPicker.importFile(toml('older-file',120)),newer=importPicker.importFile(toml('newer-file',10));await Promise.all([older,newer]);
      const raced={design:importPicker.value.design,olderInstalled:!!picker.querySelector('[data-fc-theme-option="older-file"]')};
      importPicker.setState({design:'custom-palette',palette:'custom-palette'});
      return {id,rejected,unchanged,inline,foreign,raced};
    `);
    assert.equal(result.id,'reading-room');assert.ok(result.rejected&&result.unchanged);assert.match(result.inline,/light-dark/);
    assert.match(result.foreign,/not allowed/,'a theme URL on another origin needs an explicit themeOrigins entry');
    assert.deepEqual(result.raced,{design:'newer-file',olderInstalled:false});
    try{
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-contrast',value:'more'}]});
      await evaluate(`await new Promise(r=>setTimeout(r,60));`);
      assert.equal(await evaluate(`return document.getElementById('theme-import-test').style.getPropertyValue('--fc-color-text-default');`),'');
      await send('Emulation.setEmulatedMedia',{features:[]});
      await evaluate(`await new Promise(r=>setTimeout(r,60));`);
      assert.match(await evaluate(`return document.getElementById('theme-import-test').style.getPropertyValue('--fc-color-text-default');`),/light-dark/);
      const original=await evaluate(`importPicker.destroy();const region=document.getElementById('theme-import-test');const result=[region.dataset.fcDesign??null,region.style.getPropertyValue('--fc-radius-lg'),region.style.getPropertyValue('--fc-color-text-default')];region.remove();return result;`);
      assert.deepEqual(original,[null,'3rem','']);
    }finally{await send('Emulation.setEmulatedMedia',{features:[]});}
  });

  it("runs dialog confirmation, validation, cancellation and preferences with native focus restoration", async () => {
    await send('Page.navigate',{url:server.origin+'/demo/index.html#dialogs'});await new Promise(r=>setTimeout(r,1000));
    const result=await evaluate(`
      const open=id=>{const button=document.querySelector('[data-demo-open="'+id+'"]');button.focus();button.click();return document.getElementById(id);};
      const settle=()=>new Promise(r=>setTimeout(r,250));
      let dialog=open('recipe-confirm');const safe=document.activeElement.textContent;dialog.querySelector('[value="confirm"]').click();await settle();const confirmed=document.getElementById('dialog-recipe-status').textContent;
      dialog=open('recipe-confirm');const fresh=dialog.returnValue;dialog.dispatchEvent(new Event('cancel',{cancelable:true}));dialog.close();await settle();const dismissed=document.getElementById('dialog-recipe-status').textContent;const restored=document.activeElement.dataset.demoOpen;
      dialog=open('recipe-create');document.querySelector('[form="recipe-create-form"][value="create"]').click();const invalidStayed=dialog.open;
      const form=document.getElementById('recipe-create-form');form.elements.name.value='Example project';document.querySelector('[form="recipe-create-form"][value="create"]').click();await settle();const created=document.getElementById('dialog-recipe-status').textContent;
      dialog=open('recipe-create');form.elements.name.value='Retained draft';document.querySelector('[form="recipe-create-form"][value="cancel"]').click();await settle();const draft=form.elements.name.value;
      dialog=open('recipe-settings');const settings=document.getElementById('recipe-settings-form');settings.querySelector('[value="detailed"]').checked=true;settings.elements.sources.checked=false;document.querySelector('[form="recipe-settings-form"][value="cancel"]').click();await settle();const cancelled={style:settings.elements.style.value,sources:settings.elements.sources.checked};
      dialog=open('recipe-settings');settings.querySelector('[value="detailed"]').checked=true;document.querySelector('[form="recipe-settings-form"][value="save"]').click();await settle();
      dialog=open('recipe-settings');settings.querySelector('[value="concise"]').checked=true;dialog.close();await settle();const saved=settings.elements.style.value;
      return {safe,confirmed,fresh,dismissed,restored,invalidStayed,created,draft,cancelled,saved};
    `);
    assert.equal(result.safe,'Cancel');assert.match(result.confirmed,/archived/);assert.equal(result.fresh,'');assert.match(result.dismissed,/no action applied/);assert.equal(result.restored,'recipe-confirm');assert.equal(result.invalidStayed,true);assert.match(result.created,/Example project/);assert.equal(result.draft,'Retained draft');assert.deepEqual(result.cancelled,{style:'concise',sources:true});assert.equal(result.saved,'detailed');
    await evaluate(`const opener=document.querySelector('[data-demo-open="recipe-confirm"]');opener.focus();opener.click();`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await new Promise(r=>setTimeout(r,250));
    assert.deepEqual(await evaluate(`return {open:document.getElementById('recipe-confirm').open,focus:document.activeElement.dataset.demoOpen};`),{open:false,focus:'recipe-confirm'});
  });

  it("keeps every dialog recipe accessible and inside a narrow viewport in both schemes and directions", {skip:axeSource?false:'set FC_AXE_SOURCE'}, async () => {
    await send('Page.navigate',{url:server.origin+'/demo/index.html#dialogs'});await new Promise(r=>setTimeout(r,1000));
    await send('Emulation.setDeviceMetricsOverride',{width:320,height:720,deviceScaleFactor:1,mobile:false});
    await send('Runtime.evaluate',{expression:axeSource});
    for (const scheme of ['light','dark']) for (const dir of ['ltr','rtl']) for (const id of ['recipe-notice','recipe-confirm','recipe-create','recipe-settings']) {
      const result=await evaluate(`
        document.documentElement.dataset.fcTheme=${JSON.stringify(scheme)};document.documentElement.dir=${JSON.stringify(dir)};
        const opener=document.querySelector('[data-demo-open="'+${JSON.stringify(id)}+'"]');opener.focus();opener.click();const dialog=document.getElementById(${JSON.stringify(id)});await new Promise(r=>setTimeout(r,350));
        const rect=dialog.getBoundingClientRect();const focus=dialog.contains(document.activeElement);
        const scan=await axe.run(dialog);const issues=scan.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));
        dialog.close();await new Promise(r=>setTimeout(r,250));return {focus,issues,inside:rect.x>=0&&rect.right<=320&&rect.y>=0&&rect.bottom<=720};
      `);
      assert.equal(result.focus,true,id);assert.equal(result.inside,true,id+'/'+scheme+'/'+dir);assert.deepEqual(result.issues,[],id+'/'+scheme+'/'+dir);
    }
  });

  it("keeps multiselect native form values, filtering, disabled selections and reset in sync", async () => {
    const result = await evaluate(`
      const {FutureCssMultiselect}=await import('/src/js/multiselect.js');
      const form=document.createElement('form');form.id='multi-test';form.innerHTML='<details class="fc-multiselect" open id="multi-details"><summary class="fc-multiselect__summary">Members <span data-fc-selection-summary></span></summary><input type="search" data-fc-filter aria-label="Search members"><fieldset><legend>Members</legend><label class="fc-multiselect__option"><input type="checkbox" name="members" value="ada" checked>Ada Maintainer</label><label class="fc-multiselect__option"><input type="checkbox" name="members" value="grace">Grace Reviewer</label><label class="fc-multiselect__option"><input type="checkbox" name="members" value="alan" disabled checked>Alan Unavailable</label></fieldset><button type="button" data-fc-selection-action="all">All visible</button><button type="button" data-fc-selection-action="clear">Clear</button><p data-fc-empty hidden>No matches</p></details>';document.body.append(form);
      const changes=[];const picker=new FutureCssMultiselect({root:'#multi-details',formatSummary:n=>n+' chosen',onChange:v=>changes.push(v)});
      const initial=picker.values;picker.filter('Reviewer');form.querySelector('[data-fc-selection-action="all"]').click();const selected=picker.values;const posted=new FormData(form).getAll('members');
      picker.filter('unknown');const empty=!form.querySelector('[data-fc-empty]').hidden;
      let invalid=false;try{picker.setValues(['missing']);}catch{invalid=true;}const intact=picker.values;
      form.querySelector('[data-fc-selection-action="clear"]').click();const cleared=picker.values;
      let unavailable=false;try{picker.setValues([]);}catch{unavailable=true;}
      const query=form.querySelector('[data-fc-filter]');query.value='Ada';query.dispatchEvent(new Event('input',{bubbles:true}));
      form.reset();await new Promise(r=>queueMicrotask(r));const reset=picker.values;
      const resetFilter={query:query.value,hidden:[...form.querySelectorAll('.fc-multiselect__option')].filter(o=>o.hidden).length};
      const details=form.querySelector('details');details.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const escaped=!details.open&&document.activeElement===details.querySelector('summary');
      const attrs={kind:details.dataset.fcKind,values:JSON.parse(details.dataset.fcValues),count:details.dataset.fcCount,summary:details.querySelector('[data-fc-selection-summary]').textContent};
      picker.destroy();details.open=true;form.querySelector('input[value="grace"]').click();const native=picker.values;form.remove();return {initial,selected,posted,empty,invalid,intact,cleared,unavailable,reset,resetFilter,escaped,attrs,native,changes};
    `);
    assert.deepEqual(result.initial,['ada','alan']);assert.deepEqual(result.selected,['ada','grace','alan']);assert.deepEqual(result.posted,['ada','grace']);
    assert.equal(result.empty,true);assert.equal(result.invalid,true);assert.deepEqual(result.intact,result.selected);assert.deepEqual(result.cleared,['alan']);assert.equal(result.unavailable,true);
    assert.deepEqual(result.reset,['ada','alan']);assert.deepEqual(result.resetFilter,{query:'',hidden:0},'reset clears the typed query and shows every option');assert.equal(result.escaped,true);assert.deepEqual(result.attrs,{kind:'multiselect',values:['ada','alan'],count:'2',summary:'2 chosen'});assert.deepEqual(result.native,['ada','grace','alan']);assert.equal(result.changes.length,2);
  });

  it("preserves descriptive select options and wires default actions separately from menus", async () => {
    await send("Page.navigate",{url:server.origin+'/demo/index.html#advanced-controls'});await new Promise(r=>setTimeout(r,1000));
    const result=await evaluate(`
      document.getElementById('export-default').click();const direct=document.getElementById('advanced-status').textContent;
      document.getElementById('export-toggle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const opened=document.getElementById('export-toggle').getAttribute('aria-expanded');const first=document.activeElement.textContent;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const restored=document.activeElement.id;
      document.getElementById('rich-plan').click();const description=document.querySelector('#rich-plan-options .fc-select__option-description').textContent;const meta=document.querySelector('#rich-plan-options .fc-select__option-meta').textContent;
      document.getElementById('rich-plan').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));document.querySelector('[data-demo-confirm="cancel"]').click();const cancel=document.getElementById('advanced-status').textContent;return {direct,opened,first,restored,description,meta,cancel};
    `);
    assert.match(result.direct,/PDF/);assert.equal(result.opened,'true');assert.match(result.first,/PDF/);assert.equal(result.restored,'export-toggle');assert.equal(result.description,'One person, unlimited drafts');assert.equal(result.meta,'Free');assert.match(result.cancel,/cancelled/);
  });

  it("has accessible themed controls across all stock designs in both schemes and directions", {skip:axeSource?false:'set FC_AXE_SOURCE'}, async () => {
    await evaluate(`
      const link=document.createElement('link');link.rel='stylesheet';link.href='/dist/themes.css';document.head.append(link);await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});
      const Themes=await import('/src/js/theme-picker.js');globalThis.themeAuditPresets=Themes.themePresets;
      const region=document.createElement('section');region.id='theme-audit';region.setAttribute('aria-label','Theme sample');region.style.inlineSize='320px';
      region.innerHTML='<header class="fc-masthead"><a class="fc-masthead__brand" href="#theme-audit">Workspace</a><a class="fc-masthead__link" href="#theme-audit" aria-current="page">Home</a></header><article class="fc-card"><div class="fc-card__body"><h2>Readable work</h2><p>Every theme preserves readable surfaces.</p><label>Search<input class="fc-input"></label><button class="fc-btn fc-btn--primary">Continue</button><button class="fc-btn" disabled>Unavailable</button></div></article><div class="fc-composer"><label>Message<textarea class="fc-composer__input"></textarea></label></div><div class="fc-theme-picker" id="audit-picker"></div>';
      document.body.append(region);globalThis.auditPicker=new Themes.FutureCssThemePicker({root:'#audit-picker',target:region});
    `);
    await send('Runtime.evaluate',{expression:axeSource});
    try{
      for(const id of await evaluate(`return themeAuditPresets.map(p=>p.id);`))for(const scheme of ['light','dark'])for(const dir of ['ltr','rtl']){
        await evaluate(`const region=document.getElementById('theme-audit');region.dir=${JSON.stringify(dir)};const preset=themeAuditPresets.find(p=>p.id===${JSON.stringify(id)});auditPicker.setState({design:preset.id,palette:preset.palette,scheme:${JSON.stringify(scheme)}});await new Promise(r=>setTimeout(r,220));`);
        const violations=await evaluate(`const result=await axe.run(document.getElementById('theme-audit'));return result.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));`);
        assert.deepEqual(violations,[],`${id}/${scheme}/${dir}: ${JSON.stringify(violations)}`);
      }
    }finally{await evaluate(`auditPicker.destroy();document.getElementById('theme-audit').remove();`);}
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
      // A stale instance, destroyed again, must not release the new binding,
      // or the next bindTables would attach a second click handler.
      bound.destroy();
      new TL.FutureCssTable('#table-root').destroy();
      const kept = document.getElementById('table-root').getAttribute('data-fc-bound');
      const third = TL.bindTables(document.getElementById('table-wrap')).length;
      // A host that handed the element to another binding keeps that marker.
      const root = document.getElementById('table-root');
      root.setAttribute('data-fc-bound', 'other');
      rebound.forEach((t) => t.destroy());
      const foreign = root.getAttribute('data-fc-bound');
      root.removeAttribute('data-fc-bound');
      return { focused, marker, rebound: rebound.length, kept, third, foreign };
    `);
    assert.equal(result.focused, true, "moving the row must not drop the user's focus");
    assert.equal(result.marker, false, "destroy releases the bound marker");
    assert.equal(result.rebound, 1);
    assert.equal(result.kept, "table", "a stale or unbound instance leaves the live binding's marker");
    assert.equal(result.third, 0, "so the table is not bound twice");
    assert.equal(result.foreign, "other", "destroy never removes another binding's marker");
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

  // ------------------------------------------------------------------- nav

  // -------------------------------------------------------------- toolbar

  it("gives a toolbar one tab stop and moves through it with the arrows", async () => {
    // The roving tabindex contract: arrows wrap, Home/End jump, natively
    // disabled items are skipped, aria-disabled ones are not, RTL reverses
    // Left/Right, and a vertical toolbar uses Up/Down.
    await loadBindings();
    const r = await evaluate(`
      const bar = document.createElement('div');
      bar.className = 'fc-toolbar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Tools');
      bar.innerHTML = '<button type="button" class="fc-toolbar__item">A</button>'
        + '<button type="button" class="fc-toolbar__item" disabled>B</button>'
        + '<button type="button" class="fc-toolbar__item" aria-disabled="true">C</button>'
        + '<input class="fc-input" aria-label="Find">'
        + '<button type="button" class="fc-toolbar__item">D</button>';
      document.body.appendChild(bar);
      const unbind = TR.bindToolbar(bar);
      const name = () => document.activeElement.textContent || document.activeElement.getAttribute('aria-label');
      const stops = [...bar.querySelectorAll('button:not(:disabled), input')].filter((el) => el.tabIndex === 0).map((el) => el.textContent || 'input');
      const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      const seen = [];
      bar.querySelector('button').focus();
      key('ArrowRight'); seen.push(name());
      key('ArrowRight'); seen.push(name());
      // The text field keeps its arrows for its caret.
      key('ArrowRight'); seen.push(name());
      bar.querySelector('button:last-child').focus();
      key('ArrowRight'); seen.push(name());
      key('End'); seen.push(name());
      key('Home'); seen.push(name());
      const stopAfter = [...bar.querySelectorAll('button:not(:disabled)')].filter((el) => el.tabIndex === 0).map((el) => el.textContent);
      bar.dir = 'rtl';
      key('ArrowLeft'); const rtl = name();
      bar.dir = '';
      bar.setAttribute('aria-orientation', 'vertical');
      key('ArrowDown'); const vertical = name();
      // Disabling the item that holds the stop hands it to the first enabled
      // item, or Tab could never re-enter the toolbar.
      const holder = [...bar.querySelectorAll('button')].find((el) => el.tabIndex === 0);
      holder.blur();
      holder.disabled = true;
      await Promise.resolve();
      const reStop = [...bar.querySelectorAll('button:not(:disabled), input')].filter((el) => el.tabIndex === 0).map((el) => el.textContent || 'input');
      unbind();
      bar.remove();
      return { stops, seen, stopAfter, rtl, vertical, reStop };
    `);
    assert.deepEqual(r.stops, ["A"], "one tab stop");
    assert.deepEqual(r.seen, ["C", "Find", "Find", "A", "D", "A"]);
    assert.deepEqual(r.stopAfter, ["A"], "the tab stop follows focus");
    assert.equal(r.rtl, "C", "in RTL, Left moves forward");
    assert.equal(r.vertical, "Find", "a vertical toolbar moves with Down");
    assert.equal(r.reStop.length, 1, "disabling the stop's holder moves the stop, keeping exactly one");
  });

  // ------------------------------------------------------------- carousel

  it("shows carousel controls only when bound, and disables each at its end", async () => {
    // A previous button that looks pressable at the start of the track does
    // nothing when pressed; aria-disabled says so. In RTL the track scrolls
    // with negative scrollLeft, which the end detection must handle.
    await loadBindings();
    const r = await evaluate(`
      const make = (dir) => {
        const c = document.createElement('section');
        c.className = 'fc-carousel';
        c.dir = dir;
        c.style.inlineSize = '300px';
        c.innerHTML = '<div class="fc-carousel__controls" hidden>'
          + '<button class="fc-btn" type="button" data-fc-carousel="prev" aria-label="Previous">p</button>'
          + '<button class="fc-btn" type="button" data-fc-carousel="next" aria-label="Next">n</button></div>'
          + '<ul class="fc-carousel__track" tabindex="0" style="scroll-behavior: auto; scroll-snap-type: none">'
          + [1, 2, 3, 4, 5, 6].map((i) => '<li class="fc-carousel__item" style="flex-basis: 140px; block-size: 40px">' + i + '</li>').join('')
          + '</ul>';
        document.body.appendChild(c);
        return c;
      };
      const state = (c) => [c.querySelector('[data-fc-carousel="prev"]').getAttribute('aria-disabled'),
                            c.querySelector('[data-fc-carousel="next"]').getAttribute('aria-disabled')];
      const settle = () => new Promise((res) => setTimeout(res, 60));
      const out = {};
      for (const dir of ['ltr', 'rtl']) {
        const c = make(dir);
        const hiddenBefore = c.querySelector('.fc-carousel__controls').hidden;
        const unbind = CR.bindCarousel(c);
        const at = [hiddenBefore, c.querySelector('.fc-carousel__controls').hidden, ...state(c)];
        c.querySelector('[data-fc-carousel="next"]').click();
        await settle();
        const track = c.querySelector('.fc-carousel__track');
        const moved = Math.abs(track.scrollLeft) > 0;
        const mid = state(c);
        // Page to the end.
        for (let i = 0; i < 6; i++) { c.querySelector('[data-fc-carousel="next"]').click(); await settle(); }
        const end = state(c);
        unbind();
        c.remove();
        out[dir] = { at, moved, mid, end };
      }
      return out;
    `);
    for (const dir of ["ltr", "rtl"]) {
      assert.deepEqual(r[dir].at, [true, false, "true", "false"], `${dir}: controls revealed, prev disabled at the start`);
      assert.equal(r[dir].moved, true, `${dir}: next scrolls the track`);
      assert.deepEqual(r[dir].mid, ["false", "false"], `${dir}: both enabled mid-track`);
      assert.deepEqual(r[dir].end, ["false", "true"], `${dir}: next disabled at the end`);
    }
  });

  // ----------------------------------------------------------- datepicker

  it("renders a date picker month and walks it with the date grid keys", async () => {
    // One tab stop on the focused day; arrows by day and week, swapped in
    // RTL; Home/End to the week's ends; PageDown to the next month, clamped
    // to its length; selection on the gridcell; unavailable days reachable
    // but not selectable.
    await loadBindings();
    const r = await evaluate(`
      const root = document.createElement('div');
      root.className = 'fc-datepicker';
      document.body.appendChild(root);
      const changes = [];
      const p = DP.bindDatePicker(root, {
        today: '2026-01-15', value: '2026-01-31', locale: 'en-US', firstDayOfWeek: 0,
        max: '2026-03-10', isDisabled: (iso) => iso === '2026-02-02', onChange: (iso) => changes.push(iso),
      });
      const focused = () => document.activeElement.dataset.fcDate;
      const key = (k, extra = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
      const out = {
        title: root.querySelector('.fc-datepicker__title').textContent,
        heads: [...root.querySelectorAll('th')].map((th) => th.textContent + '/' + th.abbr).join(' '),
        stops: [...root.querySelectorAll('.fc-datepicker__day')].filter((b) => b.tabIndex === 0).map((b) => b.dataset.fcDate),
        today: root.querySelector('[aria-current="date"]').dataset.fcDate,
        selectedCell: root.querySelector('[aria-selected="true"] button').dataset.fcDate,
        value: root.dataset.fcValue,
      };
      p.focus();
      key('ArrowRight'); out.right = focused();
      out.titleAfter = root.querySelector('.fc-datepicker__title').textContent;
      key('ArrowRight'); key('Enter');
      document.activeElement.click(); out.disabledClick = [p.value, changes.length];
      key('ArrowUp'); out.up = focused();
      key('Home'); out.home = focused();
      key('End'); out.end = focused();
      p.value = '2026-01-31'; p.focus();
      key('PageDown'); out.pageDown = focused();
      key('PageDown', { shiftKey: true }); out.clampedToMax = focused();
      root.dir = 'rtl'; p.value = '2026-01-14'; p.focus();
      key('ArrowRight'); out.rtlRight = focused();
      root.dir = '';
      document.activeElement.click();
      out.selected = [p.value, changes.slice(-1)[0], root.querySelector('[aria-selected="true"] button').dataset.fcDate];
      // A value set from outside while a day has focus keeps the keyboard in
      // the grid, on the new day.
      p.focus();
      p.value = '2026-01-21';
      out.refocused = focused();
      // Years below 100 are taken literally, not as 19xx.
      p.value = '0099-12-31';
      out.earlyYear = [root.querySelector('[aria-selected="true"] button').dataset.fcDate, root.querySelector('.fc-datepicker__title').textContent];
      p.destroy();
      root.remove();
      return out;
    `);
    assert.equal(r.title, "January 2026");
    assert.equal(r.heads.split(" ")[0], "S/Sunday", "narrow name shown, full name as the header's abbr");
    assert.deepEqual(r.stops, ["2026-01-31"], "one tab stop, on the selected day");
    assert.equal(r.today, "2026-01-15");
    assert.equal(r.selectedCell, "2026-01-31");
    assert.equal(r.value, "2026-01-31", "the selection is mirrored for machine readers");
    assert.equal(r.right, "2026-02-01", "Right crosses into the next month");
    assert.equal(r.titleAfter, "February 2026");
    assert.deepEqual(r.disabledClick, ["2026-01-31", 0], "an unavailable day takes focus but not selection");
    assert.equal(r.up, "2026-01-26");
    assert.equal(r.home, "2026-01-25", "Home goes to the first day of the week (Sunday here)");
    assert.equal(r.end, "2026-01-31");
    assert.equal(r.pageDown, "2026-02-28", "PageDown keeps the day, clamped to the shorter month");
    assert.equal(r.clampedToMax, "2026-03-10", "Shift+PageDown clamps to max");
    assert.equal(r.rtlRight, "2026-01-13", "in RTL, Right goes back a day");
    assert.deepEqual(r.selected, ["2026-01-13", "2026-01-13", "2026-01-13"]);
    assert.equal(r.refocused, "2026-01-21", "setting the value keeps focus in the grid");
    assert.equal(r.earlyYear[0], "0099-12-31");
    assert.match(r.earlyYear[1], /December 99\b/, "year 99 is not shown as 1999");
  });

  // --------------------------------------------------------------- slider

  it("fills the slider track to the value and mirrors it in its output", async () => {
    // Blink has no pseudo-element for the filled part of a range track, so the
    // fill is the binding's job; a stale fill would show one value while the
    // input announces another.
    await loadBindings();
    const r = await evaluate(`
      const wrap = document.createElement('div');
      wrap.className = 'fc-slider';
      wrap.innerHTML = '<input class="fc-slider__input" type="range" id="sl-temp" min="0" max="2" step="0.1" value="0.5" aria-label="Temperature">'
        + '<output class="fc-slider__value" for="sl-temp">?</output>';
      document.body.appendChild(wrap);
      const input = wrap.querySelector('input');
      const output = wrap.querySelector('output');
      const unbind = SL.bindSliders(document);
      const initial = [input.style.getPropertyValue('--fc-slider-pct'), output.value];
      input.value = '1.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const moved = [input.style.getPropertyValue('--fc-slider-pct'), output.value];
      // Degenerate and out-of-range values clamp rather than drawing past the track.
      const flat = document.createElement('input');
      flat.type = 'range'; flat.min = '5'; flat.max = '5'; flat.value = '5';
      const extremes = [SL.sliderPercent(flat)];
      unbind();
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const afterUnbind = output.value;
      wrap.remove();
      return { initial, moved, extremes, afterUnbind };
    `);
    assert.deepEqual(r.initial, ["25%", "0.5"]);
    assert.deepEqual(r.moved, ["75%", "1.5"]);
    assert.deepEqual(r.extremes, ["0%"]);
    assert.equal(r.afterUnbind, "1.5", "the returned function removes the listener");
  });

  // ------------------------------------------------------------- splitter

  /** A 400px split, primary pane first unless `primaryLast`, in direction `dir`. */
  const SPLIT = (dir: string, primaryLast = false) => `
    const wrap = document.createElement('div');
    wrap.dir = '${dir}';
    wrap.style.inlineSize = '400px';
    const primary = '<div class="fc-split__pane fc-split__pane--primary" id="sp-a">A <button type="button">In A</button></div>';
    const other = '<div class="fc-split__pane">B</div>';
    const bar = '<div class="fc-splitter" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="sp-a"'
      + ' aria-label="A" aria-valuenow="30" aria-valuemin="10" aria-valuemax="80"></div>';
    wrap.innerHTML = '<div class="fc-split" style="block-size: 100px">' + (${primaryLast} ? other + bar + primary : primary + bar + other) + '</div>';
    document.body.appendChild(wrap);
    const split = wrap.firstElementChild;
    const bar_ = split.querySelector('.fc-splitter');
    const pane = split.querySelector('#sp-a');
    const events = [];
    split.addEventListener('fc-resize', (e) => events.push(e.detail));
    const unbind = SP.bindSplitters(document);
    const key = (k, extra = {}) => bar_.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
    const now = () => Number(bar_.getAttribute('aria-valuenow'));
    const width = () => Math.round(pane.getBoundingClientRect().width);
  `;

  it("sizes a split pane from aria-valuenow and moves it with the arrows, Home, End and Enter", async () => {
    // The window splitter contract: the value is the primary pane's size, the
    // arrows move the bar, Home/End go to the bounds, and Enter collapses and
    // restores. A collapsed pane must not keep its controls in the tab order.
    await loadBindings();
    const r = await evaluate(`
      ${SPLIT("ltr")}
      const out = { initial: [now(), pane.style.getPropertyValue('--fc-split-size'), width()], events: events.length };
      key('ArrowRight'); out.right = now();
      key('ArrowLeft'); key('ArrowLeft'); out.left = now();
      key('ArrowRight', { shiftKey: true }); out.shift = now();
      key('ArrowDown'); out.crossAxis = now();
      key('Home'); out.home = now();
      key('End'); out.end = [now(), width()];
      key('ArrowRight'); out.clamped = now();
      key('Home'); key('ArrowRight'); key('ArrowRight');
      key('Enter'); out.collapsed = [now(), pane.hidden];
      key('Enter'); out.restored = [now(), pane.hidden];
      out.lastEvent = events.at(-1);
      bar_.setAttribute('aria-disabled', 'true');
      key('ArrowRight'); out.disabled = now();
      unbind();
      bar_.removeAttribute('aria-disabled');
      key('ArrowRight'); out.afterUnbind = now();
      wrap.remove();
      return out;
    `);
    // 30% of 400px, less half the one-pixel bar the panes share.
    assert.deepEqual(r.initial, [30, "30%", 120]);
    assert.equal(r.events, 0, "binding is not a change and fires no event");
    assert.equal(r.right, 35);
    assert.equal(r.left, 25);
    assert.equal(r.shift, 75, "Shift moves ten steps");
    assert.equal(r.crossAxis, 75, "a vertical bar ignores Up and Down");
    assert.equal(r.home, 10);
    assert.deepEqual(r.end, [80, 320]);
    assert.equal(r.clamped, 80, "the value never passes aria-valuemax");
    assert.deepEqual(r.collapsed, [10, false], "collapses to the minimum, which still has a size");
    assert.deepEqual(r.restored, [20, false]);
    assert.deepEqual(r.lastEvent, { value: 20, unit: "%", final: true });
    assert.equal(r.disabled, 20, "aria-disabled holds the size");
    assert.equal(r.afterUnbind, 20, "the returned function removes the listeners");
  });

  it("mirrors the arrows in RTL and for a primary pane after the bar", async () => {
    // ArrowRight moves the bar right. In RTL that is toward the inline start,
    // and when the controlled pane is after the bar, moving right shrinks it.
    await loadBindings();
    const r = await evaluate(`
      const out = {};
      {
        ${SPLIT("rtl")}
        key('ArrowLeft'); out.rtlLeft = now();
        wrap.remove(); unbind();
      }
      {
        ${SPLIT("ltr", true)}
        key('ArrowRight'); out.lastRight = now();
        wrap.remove(); unbind();
      }
      return out;
    `);
    assert.equal(r.rtlLeft, 35, "in RTL, moving the bar left grows the inline-start pane");
    assert.equal(r.lastRight, 25, "moving the bar toward a trailing pane shrinks it");
  });

  it("drags a split with the pointer, and Escape puts it back", async () => {
    // Real input through CDP: pointer capture only works for a pointer the
    // browser knows is down, which a synthetic event is not.
    await loadBindings();
    const box = await evaluate(`
      ${SPLIT("ltr")}
      globalThis.spDone = () => { wrap.remove(); unbind(); };
      globalThis.spState = () => ({ now: now(), width: width(), active: document.activeElement === bar_, events: events.map((e) => e.final) });
      // Input lands at viewport coordinates, so the bar has to be in view.
      split.scrollIntoView({ block: 'center' });
      const r = bar_.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    `);
    const mouse = (type: string, x: number, buttons = 1) =>
      send("Input.dispatchMouseEvent", { type, x, y: box.y, button: "left", buttons, clickCount: 1 });
    await mouse("mousePressed", box.x);
    await mouse("mouseMoved", box.x + 40);
    await mouse("mouseMoved", box.x + 80);
    const mid = await evaluate(`return spState();`);
    await mouse("mouseReleased", box.x + 80, 0);
    const dropped = await evaluate(`return spState();`);
    await mouse("mousePressed", box.x + 80);
    await mouse("mouseMoved", box.x + 160);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await mouse("mouseReleased", box.x + 160, 0);
    const cancelled = await evaluate(`const s = spState(); spDone(); return s;`);
    // 80px of 400 is 20 percentage points.
    assert.equal(mid.now, 50);
    assert.equal(mid.width, 200);
    assert.equal(mid.active, true, "grabbing the bar focuses it, so the keys work next");
    assert.deepEqual(dropped.events.slice(-1), [true], "release settles with one final event");
    assert.equal(dropped.now, 50);
    assert.equal(cancelled.now, 50, "Escape restores the size the drag started from");
  });

  it("resizes an element from its edge in pixels, inline and block", async () => {
    await loadBindings();
    const r = await evaluate(`
      const host = document.createElement('div');
      host.style.inlineSize = '500px';
      host.innerHTML = '<aside class="fc-resizable" id="sp-panel" style="--fc-split-size: 200px">Panel'
        + '<div class="fc-splitter fc-splitter--edge" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="sp-panel" aria-label="Panel" aria-valuemin="100"></div></aside>'
        + '<div class="fc-resizable fc-resizable--block" id="sp-notes" style="--fc-split-size: 80px">Notes'
        + '<div class="fc-splitter fc-splitter--edge" role="separator" tabindex="0" aria-orientation="horizontal" aria-controls="sp-notes" aria-label="Notes" aria-valuemin="40" aria-valuemax="200" data-step="10"></div></div>';
      document.body.appendChild(host);
      const [inl, blk] = host.querySelectorAll('.fc-splitter');
      const panel = host.querySelector('#sp-panel');
      const notes = host.querySelector('#sp-notes');
      const unbind = SP.bindSplitters(document);
      const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const out = {
        measured: [inl.getAttribute('aria-valuenow'), inl.getAttribute('aria-valuemax')],
        edge: [Math.round(inl.getBoundingClientRect().right), Math.round(panel.getBoundingClientRect().right)],
      };
      key(inl, 'ArrowRight'); out.grown = [inl.getAttribute('aria-valuenow'), panel.getBoundingClientRect().width, panel.hidden];
      key(inl, 'End'); out.end = panel.getBoundingClientRect().width;
      key(blk, 'ArrowDown'); key(blk, 'ArrowRight');
      out.block = [blk.getAttribute('aria-valuenow'), notes.getBoundingClientRect().height];
      key(blk, 'Enter'); out.blockCollapsed = [notes.getBoundingClientRect().height, notes.hidden];
      unbind(); host.remove();
      return out;
    `);
    assert.deepEqual(r.measured, ["200", "500"], "no aria-valuenow: measured; no max: the container");
    assert.deepEqual(r.edge, [r.edge[1], r.edge[1]], "the handle sits on the element's inline-end edge");
    assert.deepEqual(r.grown, ["216", 216, false]);
    assert.equal(r.end, 500);
    assert.deepEqual(r.block, ["90", 90], "a horizontal bar answers Down, not Right");
    assert.deepEqual(r.blockCollapsed, [40, false], "an edge's own element is never hidden");
  });

  it("hides a split pane collapsed to zero, and shows it when reopened", async () => {
    await loadBindings();
    const r = await evaluate(`
      ${SPLIT("ltr")}
      bar_.setAttribute('aria-valuemin', '0');
      key('Home');
      const out = { closed: [width(), pane.hidden, getComputedStyle(pane).display] };
      key('ArrowRight');
      out.open = [now(), pane.hidden];
      unbind(); wrap.remove();
      return out;
    `);
    assert.deepEqual(r.closed, [0, true, "none"], "padding cannot keep a sliver of it drawn");
    assert.deepEqual(r.open, [5, false]);
  });

  it("syncs splitters added after binding, and follows a resized container's bound", async () => {
    // A splitter inserted later must not render at the CSS default while a
    // screen reader hears its aria-valuenow; and a bound measured from the
    // container must not freeze at the container's size on the day it bound.
    await loadBindings();
    const r = await evaluate(`
      const host = document.createElement('div');
      host.style.inlineSize = '400px';
      document.body.appendChild(host);
      const unbind = SP.bindSplitters(document);
      host.innerHTML = '<div class="fc-split" style="block-size: 60px"><div class="fc-split__pane fc-split__pane--primary" id="sp-late">A</div>'
        + '<div class="fc-splitter" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="sp-late" aria-label="A" aria-valuenow="30"></div>'
        + '<div class="fc-split__pane">B</div></div>'
        + '<aside class="fc-resizable" id="sp-wide" style="--fc-split-size: 300px">P'
        + '<div class="fc-splitter fc-splitter--edge" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="sp-wide" aria-label="P"></div></aside>';
      await new Promise((r) => setTimeout(r, 50));
      const late = host.querySelector('#sp-late');
      const edge = host.querySelector('.fc-splitter--edge');
      const events = [];
      edge.addEventListener('fc-resize', (e) => events.push(e.detail.value));
      const out = { late: [Math.round(late.getBoundingClientRect().width), host.querySelector('.fc-splitter').getAttribute('aria-valuemax')] };
      out.bound = edge.getAttribute('aria-valuemax');
      host.style.inlineSize = '200px';
      await new Promise((r) => setTimeout(r, 100));
      out.shrunk = [edge.getAttribute('aria-valuenow'), edge.getAttribute('aria-valuemax'), [...events]];
      host.style.inlineSize = '600px';
      await new Promise((r) => setTimeout(r, 100));
      edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      out.grown = [edge.getAttribute('aria-valuenow'), edge.getAttribute('aria-valuemax')];
      // Hiding the container is not a resize to zero: the panel keeps its size.
      edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
      edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      host.style.display = 'none';
      await new Promise((r) => setTimeout(r, 100));
      host.style.display = '';
      await new Promise((r) => setTimeout(r, 100));
      out.reshown = [edge.getAttribute('aria-valuenow'), Math.round(host.querySelector('#sp-wide').getBoundingClientRect().width)];
      unbind(); host.remove();
      return out;
    `);
    assert.deepEqual(r.late, [120, "100"]);
    assert.equal(r.bound, "400");
    assert.deepEqual(r.shrunk, ["200", "200", [200]], "a shrink clamps the value and announces it once");
    assert.deepEqual(r.grown, ["600", "600"], "End reaches the room the container now has");
    assert.deepEqual(r.reshown, ["16", 16], "hiding and showing the container keeps the size");
  });

  it("keeps a container resize during a drag non-final", async () => {
    // A listener persisting on `final` must not save a size the user is still moving.
    await loadBindings();
    const box = await evaluate(`
      const host = document.createElement('div');
      host.style.inlineSize = '400px';
      host.innerHTML = '<aside class="fc-resizable" id="sp-drag" style="--fc-split-size: 300px">P'
        + '<div class="fc-splitter fc-splitter--edge" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="sp-drag" aria-label="P"></div></aside>';
      document.body.appendChild(host);
      host.scrollIntoView({ block: 'center' });
      const edge = host.querySelector('.fc-splitter');
      const unbind = SP.bindSplitters(document);
      globalThis.spEvents = [];
      edge.addEventListener('fc-resize', (e) => spEvents.push(e.detail));
      globalThis.spHost = host;
      globalThis.spDone = () => { unbind(); host.remove(); };
      const r = edge.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    `);
    const mouse = (type: string, x: number, buttons = 1) =>
      send("Input.dispatchMouseEvent", { type, x, y: box.y, button: "left", buttons, clickCount: 1 });
    await mouse("mousePressed", box.x);
    await mouse("mouseMoved", box.x + 20);
    const during = await evaluate(`
      spHost.style.inlineSize = '200px';
      await new Promise((r) => setTimeout(r, 100));
      return spEvents.map((e) => [e.value, e.final]);
    `);
    await mouse("mouseReleased", box.x + 20, 0);
    const after = await evaluate(`const e = spEvents.at(-1); spDone(); return [e.value, e.final];`);
    assert.deepEqual(during.at(-1), [200, false], "the clamp mid-drag is not final");
    assert.ok(during.every(([, final]: [number, boolean]) => !final), "nothing settles before release");
    assert.deepEqual(after, [200, true]);
  });

  it("ends a drag in progress when unbound", async () => {
    await loadBindings();
    const box = await evaluate(`
      ${SPLIT("ltr")}
      split.scrollIntoView({ block: 'center' });
      globalThis.spUnbind = unbind;
      globalThis.spState = () => ({ now: now(), events: events.length, wrap });
      globalThis.spDone = () => wrap.remove();
      const r = bar_.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    `);
    const mouse = (type: string, x: number, buttons = 1) =>
      send("Input.dispatchMouseEvent", { type, x, y: box.y, button: "left", buttons, clickCount: 1 });
    await mouse("mousePressed", box.x);
    await mouse("mouseMoved", box.x + 40);
    const atUnbind = await evaluate(`spUnbind(); const s = spState(); return [s.now, s.events];`);
    await mouse("mouseMoved", box.x + 120);
    await mouse("mouseReleased", box.x + 120, 0);
    const after = await evaluate(`const s = spState(); spDone(); return [s.now, s.events];`);
    assert.equal(atUnbind[0], 40);
    assert.deepEqual(after, atUnbind, "no resize and no event once unbound");
  });

  it("collapses the sidebar to a rail from aria-expanded, keeping link names", async () => {
    await loadBindings();
    const result = await evaluate(`
      globalThis.nav = new NV.FutureCssNav('#nav');
      const root = document.getElementById('nav');
      const toggle = document.getElementById('nav-toggle');
      const label = root.querySelector('#nav-chats .fc-nav__label');
      const read = () => ({
        width: root.getBoundingClientRect().width,
        labelClip: getComputedStyle(label).clipPath,
        labelWidth: label.getBoundingClientRect().width,
        meta: getComputedStyle(root.querySelector('.fc-nav__meta')).display,
        nested: getComputedStyle(root.querySelector('.fc-nav__list--nested')).display,
        group: getComputedStyle(document.getElementById('nav-group')).display,
        turn: getComputedStyle(toggle, '::before').rotate,
        glyphBox: getComputedStyle(toggle, '::before').display,
      });
      const wired = { controls: toggle.getAttribute('aria-controls'), expanded: toggle.getAttribute('aria-expanded') };
      const open = read();
      document.getElementById('nav-nested').focus();
      toggle.click();
      // The width is transitioned; read it once the transition has finished.
      await Promise.all(root.getAnimations({ subtree: true }).map((a) => a.finished));
      const rail = read();
      const focusAfter = document.activeElement.id;
      const name = document.getElementById('nav-chats').textContent.trim();
      toggle.click();
      nav.destroy();
      // The first instance was constructed directly, so it never owned a marker.
      const [owned] = NV.bindNavs(document);
      owned.destroy();
      const navs = NV.bindNavs(document);
      const rebound = navs.filter((n) => n instanceof NV.FutureCssNav).length;
      owned.destroy();
      const marker = root.dataset.fcBound;
      // A host that handed the element to another binding keeps that marker.
      root.dataset.fcBound = 'other';
      navs.forEach((n) => n.destroy());
      const foreign = root.dataset.fcBound;
      delete root.dataset.fcBound;
      return { wired, open, rail, focusAfter, name, expanded: nav.expanded, rebound, marker, foreign };
    `);
    assert.deepEqual(result.wired, { controls: "nav", expanded: "true" });
    assert.ok(result.rail.width < result.open.width / 2, `rail ${result.rail.width} vs ${result.open.width}`);
    assert.equal(result.open.labelClip, "none");
    assert.match(result.rail.labelClip, /inset\(50%\)/, "labels are visually hidden, not removed");
    assert.ok(result.rail.labelWidth <= 1);
    assert.equal(result.rail.meta, "none");
    assert.equal(result.rail.nested, "none");
    assert.equal(result.rail.group, "none");
    assert.match(result.open.turn, /^(none|0deg)$/);
    // The glyph turns to point outward. An inline ::before reports the rotation
    // but does not draw it, which is how this once showed one arrow for both states.
    assert.equal(result.rail.turn, "180deg", "the toggle glyph turns when collapsed");
    assert.notEqual(result.rail.glyphBox, "inline", "rotate only applies to a transformable box");
    assert.equal(result.focusAfter, "nav-toggle", "focus leaves a link the rail hides");
    assert.match(result.name, /^Chats/, "the link keeps its name in the rail");
    assert.equal(result.expanded, true);
    assert.equal(result.rebound, 1, "destroy releases the bound marker");
    assert.equal(result.marker, "nav", "a stale instance destroyed again keeps the live binding's marker");
    assert.equal(result.foreign, "other", "destroy never removes another binding's marker");
  });

  it("marks the current page and its section, and mirrors the toggle in RTL", async () => {
    const result = await evaluate(`
      const cs = (id) => getComputedStyle(document.getElementById(id));
      const toggle = document.getElementById('nav-toggle');
      const ltr = getComputedStyle(toggle, '::before').content;
      document.getElementById('nav').setAttribute('dir', 'rtl');
      const rtl = getComputedStyle(toggle, '::before').content;
      const bar = cs('nav-chats').borderRightColor;
      document.getElementById('nav').removeAttribute('dir');
      return {
        current: cs('nav-chats').borderLeftColor,
        plain: cs('nav-nested').borderLeftColor,
        sectionWeight: cs('nav-projects').fontWeight,
        disabledCursor: cs('nav-off').cursor,
        ltr, rtl, bar,
      };
    `);
    assert.notEqual(result.current, "rgba(0, 0, 0, 0)", "the current page draws its bar");
    assert.equal(result.plain, "rgba(0, 0, 0, 0)");
    assert.equal(result.bar, result.current, "the bar moves to the right edge in RTL");
    assert.equal(result.sectionWeight, "500", "the section holding the current page is emphasised");
    assert.equal(result.disabledCursor, "not-allowed");
    assert.match(result.ltr, /«/);
    assert.match(result.rtl, /»/);
  });

  it("titles links only in the rail, ignores an aria-disabled toggle, and mirrors group chevrons", async () => {
    await loadBindings();
    const result = await evaluate(`
      const root = document.getElementById('nav');
      const toggle = document.getElementById('nav-toggle');
      const chats = document.getElementById('nav-chats');
      const projects = document.getElementById('nav-projects');
      projects.title = 'Authored title';
      const nav = new NV.FutureCssNav(root);
      const before = chats.hasAttribute('title');
      nav.setExpanded(false);
      const rail = { chats: chats.title, projects: projects.title };
      // While collapsed: the app titles a link, renames a label, and adds a link.
      const nested = document.getElementById('nav-nested');
      nested.title = '3 unread';
      chats.querySelector('.fc-nav__label').textContent = 'Threads';
      const added = document.createElement('li');
      added.innerHTML = '<a class="fc-nav__link" id="nav-added" href="#r"><span class="fc-nav__label">Reports</span></a>';
      root.querySelector('.fc-nav__list').append(added);
      const reach = (el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      reach(chats);
      reach(document.getElementById('nav-added'));
      const live = { chats: chats.title, added: document.getElementById('nav-added').title };
      nav.setExpanded(true);
      const after = { chats: chats.hasAttribute('title'), projects: projects.title, nested: nested.title };
      projects.removeAttribute('title');
      nested.removeAttribute('title');
      added.remove();
      chats.querySelector('.fc-nav__label').textContent = 'Chats';

      toggle.setAttribute('aria-disabled', 'true');
      toggle.click();
      const disabledStays = nav.expanded;
      toggle.removeAttribute('aria-disabled');
      nav.destroy();

      const group = document.getElementById('nav-group');
      const details = group.parentElement;
      // The chevron's turn is transitioned; finish it so the end state is read.
      const turn = () => {
        // Transitions only: finishing the page's infinite spinner animations throws.
        document.getAnimations().filter((a) => a instanceof CSSTransition).forEach((a) => a.finish());
        return getComputedStyle(group, '::after').rotate;
      };
      details.open = true;
      const ltrOpen = turn();
      root.setAttribute('dir', 'rtl');
      const rtlOpen = turn();
      details.open = false;
      const rtlClosed = turn();
      root.removeAttribute('dir');
      const ltrClosed = turn();
      details.open = true;
      return { before, rail, live, after, disabledStays, ltrOpen, rtlOpen, rtlClosed, ltrClosed };
    `);
    assert.equal(result.before, false, "an expanded sidebar adds no titles");
    assert.equal(result.rail.chats, "Chats", "the rail names each icon for mouse users");
    assert.equal(result.rail.projects, "Authored title", "an authored title is kept");
    assert.deepEqual(result.live, { chats: "Threads", added: "Reports" }, "titles follow the links as they change");
    assert.deepEqual(result.after, { chats: false, projects: "Authored title", nested: "3 unread" },
      "expanding removes only the binding's own titles");
    assert.equal(result.disabledStays, true, "an aria-disabled toggle does not collapse");
    assert.equal(result.ltrOpen, "45deg");
    assert.equal(result.rtlOpen, "-45deg", "open points down in RTL too");
    assert.equal(result.rtlClosed, "45deg");
    assert.equal(result.ltrClosed, "-45deg");
  });

  it("draws an error or aborted message on every role, not only the assistant", async () => {
    const result = await evaluate(`
      const chat = document.createElement('div');
      chat.className = 'fc-chat';
      document.body.append(chat);
      const out = {};
      for (const role of ['user', 'assistant', 'system', 'tool']) {
        for (const state of ['complete', 'error', 'aborted']) {
          const msg = document.createElement('article');
          msg.className = 'fc-msg';
          msg.dataset.fcRole = role;
          msg.dataset.fcState = state;
          msg.textContent = role + ' ' + state;
          chat.append(msg);
          const cs = getComputedStyle(msg);
          out[role + ':' + state] = { width: cs.borderLeftWidth, style: cs.borderLeftStyle, color: cs.borderLeftColor };
        }
      }
      chat.remove();
      return out;
    `);
    for (const role of ["user", "assistant", "system", "tool"]) {
      for (const state of ["error", "aborted"]) {
        const edge = result[`${role}:${state}`];
        assert.equal(edge.style, "solid", `${role} ${state} draws an edge`);
        assert.notEqual(edge.width, "0px", `${role} ${state} draws an edge`);
        assert.notEqual(edge.color, result[`${role}:complete`].color, `${role} ${state} is distinguishable from complete`);
      }
    }
    assert.notEqual(result["assistant:error"].color, result["assistant:aborted"].color, "error and aborted differ");
  });

  /*
   * The fixture page is every component in every state the markup can express.
   * Loading it at 320px in both directions and both schemes is the closest
   * thing this suite has to looking at all of it.
   */
  describe("fixture page", () => {
    async function openFixtures(query: string): Promise<void> {
      await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: `${server.origin}/demo/fixtures.html?${query}` });
      await new Promise((r) => setTimeout(r, 1000));
      const ready = await evaluate(`
        for (let i = 0; i < 50 && !document.documentElement.hasAttribute('data-fx-ready'); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        return document.documentElement.hasAttribute('data-fx-ready');
      `);
      assert.equal(ready, true, "fixtures.js finished rendering");
    }

    for (const dir of ["ltr", "rtl"]) {
      for (const theme of ["light", "dark"]) {
        it(`renders every fixture at 320px without page overflow (${dir}, ${theme})`, async () => {
          await openFixtures(`dir=${dir}&theme=${theme}`);
          const result = await evaluate(`
            const de = document.documentElement;
            const blank = [...document.querySelectorAll('.fx__state')]
              .filter((fig) => {
                const body = fig.querySelector('.fx__body');
                const r = body.getBoundingClientRect();
                return r.width < 1 || r.height < 1 || body.innerText.trim() === '' && !body.querySelector('svg, input, progress, meter, [class*="fc-spinner"], [class*="fc-skeleton"]');
              })
              .map((fig) => fig.closest('[data-fixture]').dataset.fixture + ': ' + fig.dataset.fxState);
            return {
              dir: de.dir || 'ltr',
              theme: de.dataset.fcTheme,
              scrollWidth: de.scrollWidth,
              clientWidth: de.clientWidth,
              fixtures: document.querySelectorAll('[data-fixture]').length,
              blank,
            };
          `);
          assert.equal(result.dir, dir);
          assert.equal(result.theme, theme);
          assert.ok(result.fixtures > 30, `only ${result.fixtures} fixtures`);
          assert.deepEqual(result.blank, [], "every state draws something");
          assert.ok(result.scrollWidth <= result.clientWidth, `page scrolls sideways: ${result.scrollWidth} > ${result.clientWidth}`);
        });
      }
    }

    it("draws a focus indicator on every focusable control", async () => {
      await openFixtures("dir=ltr&theme=light");
      await send("DOM.enable");
      await send("CSS.enable");
      const { root } = (await send("DOM.getDocument", { depth: 0 })).result;
      const selector = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1']), [contenteditable='true']";
      const { nodeIds } = (await send("DOM.querySelectorAll", { nodeId: root.nodeId, selector })).result;
      for (const nodeId of nodeIds) {
        await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["focus", "focus-visible"] });
      }
      const missing = await evaluate(`
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const ring = (el) => {
          const cs = getComputedStyle(el);
          const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
          return outline || cs.boxShadow !== 'none';
        };
        return [...document.querySelectorAll(${JSON.stringify(selector)})]
          .filter(visible)
          // A native control draws its ring on itself; a visually hidden input
          // (switch, checkbox) hands it to the sibling that is drawn instead.
          .filter((el) => !ring(el) && !(el.parentElement && ring(el.parentElement)))
          .map((el) => (el.closest('[data-fixture]')?.dataset.fixture ?? 'page') + ' ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
      `);
      await send("CSS.disable");
      await send("DOM.disable");
      assert.deepEqual([...new Set(missing)], [], "controls with no visible focus");
    });
  });

});
