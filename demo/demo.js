/**
 * Demo wiring.
 *
 * Every component on the page is driven by its real binding, imported from
 * src/js/ -- the same modules the package exports and the same ones the browser
 * tests exercise. Nothing here re-implements behavior to make a demo look good,
 * and nothing simulates a callback the product does not actually fire.
 *
 * The only thing this file adds is presentation: theme and direction toggles, and
 * a status line so the callbacks are visible. Everything else is the library.
 */

import { FutureCssEditor } from "/src/js/editor.js";
import { FutureCssMenu } from "/src/js/menu.js";
import { FutureCssGrid } from "/src/js/grid.js";
import { FutureCssWebview } from "/src/js/webview.js";
import { highlight, renderHighlighted, languageNames } from "/src/js/highlight.js";
import { diffLines, diffStats } from "/src/js/diff.js";
import { FutureCssSelect } from "/src/js/select.js";
import { FutureCssComposer } from "/src/js/composer.js";
import { FutureCssContextStrip } from "/src/js/context-strip.js";
import { FutureCssGitSurface } from "/src/js/git.js";
import { bindNavs } from "/src/js/nav.js";
import { bindTables } from "/src/js/table.js";
import { bindTabs } from "/src/js/tabs.js";
import { FutureCssToaster } from "/src/js/toast.js";
import { bindTooltips } from "/src/js/tooltip.js";

const $ = (selector) => document.querySelector(selector);

/** Writes to a `role="status"` line, so the change is announced politely. */
function status(selector, message) {
  const el = $(selector);
  if (el) el.textContent = message;
}

// ---------------------------------------------------------------------------
// Theme and direction
//
// Both are plain `data-` attributes on <html>. The system reads `color-scheme`
// from the tokens layer and uses logical properties throughout, so flipping
// direction needs no component-level rule anywhere.
// ---------------------------------------------------------------------------

const root = document.documentElement;
const schemeButton = $("[data-demo-toggle='scheme']");
const directionButton = $("[data-demo-toggle='direction']");

// `data-fc-theme` is the system's own override hook. Setting it changes two
// `color-scheme` declarations, and because every themed token is a light-dark()
// pair, that single attribute re-themes all 65 of them. A theme switcher in any
// app built on this system needs no other CSS.
schemeButton?.addEventListener("click", () => {
  const dark = root.dataset.fcTheme !== "dark";
  root.dataset.fcTheme = dark ? "dark" : "light";
  schemeButton.setAttribute("aria-pressed", String(dark));
  schemeButton.querySelector("[data-demo-label]").textContent = dark ? "Dark" : "Light";
  // The token values changed, so any ratio computed from them is now stale.
  renderTokens();
});

directionButton?.addEventListener("click", () => {
  const rtl = root.dir !== "rtl";
  root.dir = rtl ? "rtl" : "ltr";
  directionButton.setAttribute("aria-pressed", String(rtl));
  directionButton.querySelector("[data-demo-label]").textContent = rtl ? "RTL" : "LTR";
});

// Start from the OS preference so the demo opens the way the user's system is
// already set. The attribute is left unset until they override it, which keeps
// the OS in charge for as long as possible.
const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
if (!systemPrefersDark) {
  root.dataset.fcTheme = "light";
  schemeButton?.setAttribute("aria-pressed", "false");
  schemeButton?.querySelector("[data-demo-label]").replaceChildren("Light");
} else {
  schemeButton?.querySelector("[data-demo-label]").replaceChildren("Dark");
}

// ---------------------------------------------------------------------------
// Busy button
//
// aria-busy rather than a class, so the state the demo shows and the state a
// screen reader announces are the same fact.
// ---------------------------------------------------------------------------

const busyButton = $("#btn-busy");
busyButton?.addEventListener("click", () => {
  const busy = busyButton.getAttribute("aria-busy") === "true";
  busyButton.setAttribute("aria-busy", String(!busy));
});

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const editor = new FutureCssEditor({
  root: "#editor-root",
  onChange: (html) => {
    status("#editor-status", `onChange fired \u2014 ${html.length} chars of HTML.`);
  },
  onSelectionChange: (active) => {
    // The real callback payload: which marks apply across the whole selection.
    const marks = Object.entries(active)
      .filter(([, on]) => on)
      .map(([name]) => name);
    status(
      "#editor-status",
      marks.length ? `Active marks: ${marks.join(", ")}` : "No marks active in the selection.",
    );
  },
});

$("#editor-link")?.addEventListener("click", () => {
  // Demonstrates the URL allowlist rather than asserting it in prose: the editor
  // refuses a javascript: link and says why instead of silently rewriting it.
  const applied = editor.applyMark("link", "https://example.com/docs");
  status(
    "#editor-status",
    applied
      ? "Link applied. A javascript: URL would be refused with a reason instead."
      : "Link refused: unsafe scheme.",
  );
});

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

const grid = new FutureCssGrid({
  root: "#grid-root",
  onActiveCellChange: (cell) => {
    // Row 0 of the grid model is the header row, so this reports the model's
    // index rather than pretending the header is not there.
    status("#grid-status", `Active cell: row ${cell.row}, column ${cell.col}.`);
  },
  onSelectionChange: ({ anchor, focus }) => {
    if (anchor.row === focus.row && anchor.col === focus.col) {
      status("#grid-status", `Single cell selected at row ${focus.row}, column ${focus.col}.`);
      return;
    }
    status(
      "#grid-status",
      `Range: rows ${Math.min(anchor.row, focus.row)}\u2013${Math.max(anchor.row, focus.row)}, ` +
        `columns ${Math.min(anchor.col, focus.col)}\u2013${Math.max(anchor.col, focus.col)}.`,
    );
  },
  onCellEdit: (cell, value) => {
    status("#grid-status", `Cell (${cell.row}, ${cell.col}) committed as "${value}".`);
  },
});

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

const trigger = $("#menu-trigger");
const menuEl = $("#demo-menu");

// The invoker is passed at construction, not at open time. By the time a menu
// opens, focus has usually already moved into it, so capturing it later would
// return focus to the menu itself -- the bug this parameter exists to prevent.
const menu = new FutureCssMenu({
  menu: menuEl,
  invoker: trigger,
  onOpen: () => trigger.setAttribute("aria-expanded", "true"),
  onClose: () => trigger.setAttribute("aria-expanded", "false"),
});

trigger?.addEventListener("click", () => menu.open(trigger));

// Same opt-in as the select below: traversal moves onto the Rust model when the
// module is served, and stays on the JS model, with identical behavior, when not.
menu.useWasm("/dist/wasm/fc-context-menu/web/fc_context_menu.js");

$("#menu-surface")?.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  // Opens at the pointer. Focus still returns to the invoker captured at
  // construction, which is the trigger -- correct, because that is where a
  // keyboard user's attention is.
  menu.open({ x: event.clientX, y: event.clientY });
});

menuEl?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-menu-action]");
  if (!item) return;

  if (item.getAttribute("aria-disabled") === "true") {
    status("#menu-status", `${item.textContent.trim()} is aria-disabled and cannot run.`);
    return;
  }

  if (item.getAttribute("role") === "menuitemcheckbox") {
    // Toggled here rather than in the binding: the binding owns navigation and
    // dismissal, and a checkbox item's checked state is the host's business.
    const next = item.getAttribute("aria-checked") !== "true";
    item.setAttribute("aria-checked", String(next));
    status("#menu-status", `${item.textContent.trim()} is now ${next ? "checked" : "unchecked"}.`);
    return;
  }

  status("#menu-status", `Action: ${item.dataset.menuAction}`);
});

// ---------------------------------------------------------------------------
// Webview
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Token swatches
// ---------------------------------------------------------------------------

/** Token pairings to display: a background and the foreground guaranteed on it. */
const SWATCHES = [
  ["--fc-color-bg-canvas", "--fc-color-text-default"],
  ["--fc-color-bg-surface", "--fc-color-text-muted"],
  ["--fc-color-bg-subtle", "--fc-color-text-default"],
  ["--fc-color-bg-muted", "--fc-color-text-default"],
  ["--fc-color-accent-bg", "--fc-color-text-on-accent"],
  ["--fc-color-accent-bg-subtle", "--fc-color-accent-text"],
  ["--fc-color-danger-bg", "--fc-color-danger-text"],
  ["--fc-color-warning-bg", "--fc-color-warning-text"],
  ["--fc-color-success-bg", "--fc-color-success-text"],
  ["--fc-color-border-default", "--fc-color-text-default"],
  ["--fc-color-focus-ring", "--fc-color-bg-canvas"],
  ["--fc-term-ansi-red", "--fc-term-bg"],
  ["--fc-term-ansi-green", "--fc-term-bg"],
  ["--fc-term-ansi-blue", "--fc-term-bg"],
];

/** Parses a computed colour into 0-255 channels, or null if it is not hex. */
function channels(value) {
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (match) return match.slice(1, 4).map(Number);
  const hex = value.trim().replace("#", "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  if (full.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * WCAG 2.x relative luminance.
 *
 * Reimplemented here rather than imported so the demo depends on nothing but the
 * bindings and the tokens -- which is the property being demonstrated.
 */
function luminance(rgb) {
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two computed colours, or null if either is unparseable. */
function contrast(a, b) {
  const la = luminance(channels(a));
  const lb = luminance(channels(b));
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Builds the swatch grid from live computed values.
 *
 * Read from the stylesheet rather than from the token source, so what the page
 * shows is what is actually rendering -- including a theme override, which is the
 * whole reason for computing it live.
 */
function renderTokens() {
  const host = $("#token-grid");
  if (!host) return;

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.append(probe);

  const frag = document.createDocumentFragment();

  for (const [bgToken, fgToken] of SWATCHES) {
    probe.style.backgroundColor = `var(${bgToken})`;
    probe.style.color = `var(${fgToken})`;
    const ratio = contrast(
      getComputedStyle(probe).backgroundColor,
      getComputedStyle(probe).color,
    );

    const card = document.createElement("div");
    card.className = "demo-swatch";

    const chip = document.createElement("div");
    chip.className = "demo-swatch__chip";
    chip.style.backgroundColor = `var(${bgToken})`;

    const name = document.createElement("span");
    name.className = "demo-swatch__name";
    name.textContent = bgToken;

    card.append(chip, name);

    if (ratio !== null) {
      const badge = document.createElement("span");
      badge.className = "demo-swatch__ratio";
      // The word, not just the number: 4.5 means nothing without knowing which
      // threshold it is being measured against.
      const verdict = ratio >= 4.5 ? "AA text" : ratio >= 3 ? "AA large / UI" : "below AA";
      badge.textContent = `${ratio.toFixed(2)}:1 \u00b7 ${verdict}`;
      card.append(badge);
    }

    frag.append(card);
  }

  probe.remove();
  host.replaceChildren(frag);
}

renderTokens();

// ---------------------------------------------------------------------------
// Nav current-section tracking
// ---------------------------------------------------------------------------

// IntersectionObserver rather than a scroll handler: it fires when a section
// crosses the observer's edge, not on every frame of a scroll.
const navLinks = new Map(
  [...document.querySelectorAll(".demo-nav__list a")].map((a) => [a.hash.slice(1), a]),
);

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of navLinks.values()) link.removeAttribute("aria-current");
      navLinks.get(entry.target.id)?.setAttribute("aria-current", "true");
    }
  },
  { rootMargin: "-30% 0px -60% 0px" },
);

for (const id of navLinks.keys()) {
  const section = document.getElementById(id);
  if (section) observer.observe(section);
}

$("#demo-meta")?.append(
  // Counted from the DOM rather than hard-coded: a stale count here is the kind
// of small lie that makes a demo stop matching the library it documents.
` ${SWATCHES.length} token pairings sampled live \u00b7 ${
  document.querySelectorAll("section.demo-section").length - 1
} components \u00b7 0 dependencies`,
);
const webviewEl = $("#webview-root");
const secureBadge = webviewEl?.querySelector(".fc-webview__secure");

const webview = new FutureCssWebview({
  root: webviewEl,
  onNavigate: (url) => status("#webview-status", `Navigating to ${url}`),
  onStateChange: (state) => {
    status("#webview-status", `Frame state: ${state}`);
    // Read back what the binding actually applied rather than restating it.
    if (secureBadge) {
      const src = document.querySelector("#webview-frame")?.src ?? "";
      secureBadge.dataset.fcState = src.startsWith("https:") ? "secure" : "insecure";
    }
  },
});

// Seed the history so Back has somewhere to go on the first click.
webview.navigate("/demo/page.html");

// ---------------------------------------------------------------------------
// Snippet copy buttons
//
// Delegated on the container, not per button, so a snippet added later needs no
// wiring. The clipboard call can reject (denied permission, insecure context),
// so the failure path reports rather than silently doing nothing.
// ---------------------------------------------------------------------------

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".demo-snippet__copy");
  if (!button) return;
  const snippet = button.closest(".demo-snippet");
  const code = snippet?.querySelector("code");
  if (!code) return;

  // textContent, not innerHTML: the snippet holds markup as *text*, and copying
  // the tags would paste visible angle brackets into the user's editor.
  const label = button.textContent;
  let message = "Copied";
  try {
    await navigator.clipboard.writeText(code.textContent);
  } catch {
    message = "Copy failed";
  }
  button.textContent = message;
  // Announced as well as shown: without the live region the confirmation is
  // visual only, and a screen reader user gets nothing at all.
  status("#demo-live", `${button.dataset.snippetLabel ?? "Snippet"} ${message.toLowerCase()}`);
  setTimeout(() => { button.textContent = label; }, 1600);
});

// ---------------------------------------------------------------------------
// Code block
//
// The highlighter runs on a real string and writes real elements, so what is on
// screen is exactly what the module produces -- there is no hand-written markup
// pretending to be highlighted output.
// ---------------------------------------------------------------------------

const SAMPLE = `interface DiffLine {
  kind: "equal" | "add" | "remove";
  oldLine: number | null;
  newLine: number | null;
}

/** Split text into lines, normalizing CRLF first. */
export function splitLines(text: string): string[] {
  return text.replace(/\\r\\n/g, "\\n").split("\\n");
}`;

const langSelect = $("#code-lang");

function paintCode() {
  const block = $("#code-root");
  if (!block) return;
  const lang = langSelect?.value ?? block.dataset.fcLang;

  // data-fc-lang is the single source of truth: the CSS, the gutter, and any
  // machine reading the DOM all read the same attribute the picker just wrote.
  block.dataset.fcLang = lang;

  const source = block.querySelector(".fc-code__source");
  const gutter = block.querySelector(".fc-code__gutter");
  const rendered = renderHighlighted(SAMPLE, lang);
  source?.replaceChildren(...rendered.childNodes);

  // The gutter is aria-hidden decoration, rebuilt here because a line count is
  // data rather than a style -- CSS cannot invent one.
  const count = SAMPLE.split("\n").length;
  if (gutter) {
    gutter.replaceChildren(
      ...Array.from({ length: count }, (_, i) => {
        const s = document.createElement("span");
        s.textContent = String(i + 1);
        return s;
      }),
    );
  }

  // Prove the round-trip in the UI itself: highlighting must never alter text.
  const preserved = highlight(SAMPLE, lang).map((s) => s.text).join("") === SAMPLE;
  const tokens = highlight(SAMPLE, lang).filter((s) => s.role !== "fg").length;
  status("#code-status", `${lang} \u00b7 ${tokens} tokens \u00b7 text preserved: ${preserved}`);
}

// Populated from the module's own list, so a language added to highlight.ts
// appears here without a second edit that could drift out of sync.
if (langSelect) {
  langSelect.replaceChildren(
    ...languageNames.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      return option;
    }),
  );
  langSelect.value = $("#code-root")?.dataset.fcLang ?? "typescript";
  langSelect.addEventListener("change", paintCode);
}

$("#code-copy")?.addEventListener("click", async () => {
  const source = $("#code-root .fc-code__source");
  try {
    await navigator.clipboard.writeText(source?.textContent ?? "");
    status("#code-status", "Copied the original source text.");
  } catch {
    status("#code-status", "Clipboard blocked by the browser.");
  }
});

paintCode();

// ---------------------------------------------------------------------------
// Diff viewer
//
// Built from diffLines() rather than hand-written rows, so the gutter numbers,
// the signs, and the stats all come from the same algorithm the package ships.
// ---------------------------------------------------------------------------

const BEFORE = `function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}`;

const AFTER = `function total(items: Item[]) {
  let sum = 0;
  for (const item of items) {
    if (item.discontinued) continue;
    sum += item.price * item.quantity;
  }
  return Math.round(sum * 100) / 100;
}`;

function paintDiff() {
  const root = $("#diff-root");
  if (!root) return;

  const lines = diffLines(BEFORE, AFTER);
  const stats = diffStats(lines);

  const bar = root.querySelector(".fc-diff__bar");
  if (bar) {
    bar.replaceChildren(
      ...[
        ["added", `+${stats.added}`],
        ["removed", `\u2212${stats.removed}`],
        ["", stats.identical ? "identical" : "changed"],
      ].map(([kind, text]) => {
        const s = document.createElement("span");
        s.className = kind ? `fc-diff__stat fc-diff__stat--${kind}` : "fc-diff__stat";
        s.textContent = text;
        return s;
      }),
    );
  }

  const body = root.querySelector(".fc-diff__body");
  if (body) {
    body.replaceChildren(
      ...lines.map((line) => {
        const row = document.createElement("div");
        row.className = "fc-diff__line";
        // data-fc-diff is the machine-readable half of the contract; the +/- text
        // is the human half. Both derive from `line`, so they cannot disagree.
        if (line.kind !== "equal") row.dataset.fcDiff = line.kind;

        const marker = document.createElement("span");
        marker.className = "fc-diff__marker";
        // The glyph is decorative -- the row's accessible name carries the state.
        // Without that name a screen reader announces "old line" and "new line"
        // identically, since the visible sign and the numbers are both hidden.
        marker.setAttribute("aria-hidden", "true");
        marker.textContent =
          line.kind === "add" ? "+" : line.kind === "remove" ? "\u2212" : " ";
        if (line.kind !== "equal") {
          row.setAttribute(
            "aria-label",
            `${line.kind === "add" ? "Added" : "Removed"}: ${line.text}`,
          );
        }

        // Positional metadata, hidden from assistive tech: announcing "line 3"
        // before every line makes the content far harder to follow. A line absent
        // on one side renders empty rather than 0, which would invent a line.
        const oldNum = document.createElement("span");
        oldNum.className = "fc-diff__num";
        oldNum.setAttribute("aria-hidden", "true");
        oldNum.textContent = line.oldLine ?? "";

        const newNum = oldNum.cloneNode();
        newNum.textContent = line.newLine ?? "";

        const content = document.createElement("span");
        content.className = "fc-diff__content";
        content.textContent = line.text;

        row.append(marker, oldNum, newNum, content);
        return row;
      }),
    );
  }

  status("#diff-status", `+${stats.added} \u2212${stats.removed} across ${lines.length} lines`);
}

paintDiff();

$("#diff-swap")?.addEventListener("click", () => {
  // The block *is* the .fc-diff element, so this must not be a descendant
  // selector -- `#diff-root .fc-diff` matches nothing and the toggle silently
  // does nothing, which is exactly what it did before this comment.
  const wrap = $("#diff-root");
  // Toggling the modifier rather than restyling proves the modifier API: wrapping
  // is the accessible default, scrolling is the opt-in.
  const scrolling = wrap.classList.toggle("fc-diff--scroll");
  $("#diff-swap").textContent = scrolling ? "Use wrapping" : "Use scrolling";
  paintDiff();
});
// ---------------------------------------------------------------------------
// Select / listbox
//
// Wired to the real binding, so this is the component rather than a lookalike.
// The model is JS by default; the wiring below opts into the Rust build of the
// same model, and the readout reports which one is actually running -- the
// point of showing it is that the two must be indistinguishable. The point of
// the section is the keyboard contract: try arrows, typeahead ("cl" for
// Claude), Escape (which restores), and Tab (which commits and leaves).
// ---------------------------------------------------------------------------

const modelSelect = new FutureCssSelect({
  invoker: "#model-select",
  list: "#model-list",
  onChange: (value, option) => {
    status("#model-select-status", `${option.label} (${value})`);
  },
});

const effortSelect = new FutureCssSelect({
  invoker: "#effort-select",
  list: "#effort-list",
  onChange: (value, option) => {
    status("#effort-select-status", `${option.label} — ${option.group ?? "no group"}`);
  },
});

$("#model-filter")?.addEventListener("input", (event) => {
  modelSelect.filter(event.target.value);
});

// Opt in to the Rust model. `useWasm` returns false -- and keeps the JS model --
// whenever the module is absent (dist not built) or fails to load, so this line
// is safe to leave in an app that has not shipped its WASM assets yet.
const WASM_SELECT_URL = "/dist/wasm/fc-select/web/fc_select.js";
const wasmTargets = [modelSelect, effortSelect];
let wasmLoaded = 0;
const backendNote = document.createElement("p");
backendNote.className = "demo-note";
backendNote.id = "select-backend";
backendNote.textContent = "Model backend: JS (fallback)";
document.querySelector("#model-select")?.closest(".demo-cluster")?.after(backendNote);
for (const target of wasmTargets) {
  target.useWasm(WASM_SELECT_URL).then((ok) => {
    if (ok) wasmLoaded += 1;
    backendNote.textContent =
      wasmLoaded === wasmTargets.length
        ? "Model backend: Rust (WASM) -- interactions are identical by test"
        : wasmLoaded
          ? `Model backend: Rust (WASM) ${wasmLoaded}/${wasmTargets.length}`
          : "Model backend: JS (fallback)";
  });
}


// ---------------------------------------------------------------------------
// Chat composer
//
// The send control flips to Stop while a run is in flight, which is the thing
// worth watching: the *same* element changes meaning rather than being replaced,
// so focus never moves mid-run. Attach a file to see the chips, and note that
// each remove button names its own file.
// ---------------------------------------------------------------------------

let composerRunning = false;
/** Handle for the simulated run, cleared before each new one. */
let runTimer;

const composer = new FutureCssComposer({
  root: "#composer-root",
  onSubmit: (text, attachments) => {
    const names = attachments.map((a) => a.name);
    status(
      "#composer-status",
      `Submitted ${text.length} chars${names.length ? ` with ${names.join(", ")}` : ""}`,
    );
    // The demo "runs" for a moment so the Stop state is reachable. A real app
    // calls setRunning() from its stream's lifecycle, not on a timer.
    //
    // The pending timer is cleared first: submitting again while a previous
    // run's timeout is still queued would let the *older* timer end the *newer*
    // run, flipping the control back to Send mid-response.
    clearTimeout(runTimer);
    composerRunning = true;
    composer.setRunning(true);
    runTimer = setTimeout(() => {
      composerRunning = false;
      composer.setRunning(false);
    }, 2500);
  },
  onStop: () => {
    status("#composer-status", "Stopped. Your draft was kept.");
    // Cancel the pending end-of-run, or it would fire after the stop and reset
    // state the user has already moved on from.
    clearTimeout(runTimer);
    composerRunning = false;
    composer.setRunning(false);
  },
  onAttachmentsChange: (files) => {
    status("#composer-attachments-status", `${files.length} attached`);
  },
});

$("#composer-attach")?.addEventListener("click", () => {
  composer.addAttachments([
    new File(["x".repeat(900)], "diff-viewer.ts", { type: "text/plain" }),
    new File(["y".repeat(1200)], "schema.sql", { type: "text/plain" }),
  ]);
});

// ---------------------------------------------------------------------------
// Context strip
//
// Provider, model, and effort wired as one piece of state. The thing worth
// watching: change provider and watch the model follow it, then change back and
// watch each provider restore the model it had. Also switch to GPT-5 (no
// reasoning) and the effort control dims and explains itself rather than
// silently ignoring the setting.
// ---------------------------------------------------------------------------

const contextStrip = new FutureCssContextStrip({
  root: "#strip-root",
  providers: [
    {
      id: "anthropic", name: "Anthropic",
      models: [
        { id: "opus-5", name: "Claude Opus 5", reasoning: true, parameters: { context: "200k", max_out: "64k" } },
        { id: "sonnet-5", name: "Claude Sonnet 5", reasoning: true, parameters: { context: "200k", max_out: "64k" } },
        { id: "haiku-5", name: "Claude Haiku 5", parameters: { context: "200k" } },
      ],
    },
    {
      id: "openai", name: "OpenAI",
      models: [
        { id: "gpt-5", name: "GPT-5", reasoning: true, parameters: { context: "400k" } },
        { id: "gpt-5-mini", name: "GPT-5 mini", parameters: { context: "400k" } },
      ],
    },
    {
      id: "local", name: "Local",
      models: [
        { id: "llama-4", name: "Llama 4", parameters: { context: "128k", quant: "Q4" } },
      ],
    },
  ],
  onChange: (state) => {
    status("#strip-status", `${state.provider} / ${state.model}${state.effort ? ` / effort ${state.effort}` : ""}`);
  },
});

// ---------------------------------------------------------------------------
// Git surface
//
// Fixture data, not a repository. Click Stage to see that staging a file does
// not also select it -- two different actions. The three buttons load trees that
// exercise the states that matter: a conflict, a clean tree, and an unborn branch.
// ---------------------------------------------------------------------------

const GIT_TREE = [
  { path: "src/js/git.ts", index: "modified", worktree: "modified",
    before: "a\nb\nc\n", after: "a\nc\nd\nd\n" },
  { path: "crates/fc-git/src/lib.rs", worktree: "untracked", after: "one\ntwo\n" },
  { path: "src/css/components/git.css", worktree: "modified",
    before: "x\ny\n", after: "x\ny\n" },
  { path: "src/js/merge.ts", index: "conflicted", worktree: "conflicted" },
  { path: "README.md", index: "added" },
  { path: "src/old-name.ts", index: "deleted" },
  { path: "src/js/no-contents.ts", worktree: "modified" },
];

const GIT_CONFLICTING = [
  { path: "src/js/git.ts", index: "conflicted", worktree: "conflicted" },
  { path: "crates/fc-git/src/lib.rs", index: "modified", worktree: "modified",
    before: "a\n", after: "b\nc\n" },
  { path: "README.md", worktree: "untracked" },
];

let gitSurface = null;

/** Rebuilds the surface over a different tree, keeping the listeners intact. */
function loadGit(branch, entries) {
  gitSurface = new FutureCssGitSurface({
    root: "#git-root",
    branch,
    entries,
    onSelect: (path) => status("#git-status", `selected ${path}`),
    onStage: (path) => status("#git-status", `staged ${path} — selection unchanged`),
  });
}

loadGit("feat/git-surface", GIT_TREE);
$("#git-another").addEventListener("click", () => loadGit("main", GIT_CONFLICTING));
$("#git-clean").addEventListener("click", () => loadGit("main", []));
$("#git-unborn").addEventListener("click", () => loadGit(null, GIT_TREE.slice(0, 2)));

// ---------------------------------------------------------------------------
// Forms
//
// Validation runs on submit. The error text goes into the error element that
// was in the DOM from the start (so aria-describedby already points at it), the
// control gets aria-invalid, and focus moves to the summary, which links to the
// field. Nothing is red before the user has tried to submit.
// ---------------------------------------------------------------------------

const form = $("#demo-form");
form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = $("#f-email");
  const error = $("#f-email-error");
  const summary = $("#form-summary");
  const valid = email.value.trim() !== "" && email.checkValidity();
  email.setAttribute("aria-invalid", String(!valid));
  error.textContent = valid ? "" : "Enter an email address, like ada@example.com";
  summary.hidden = valid;
  if (!valid) summary.focus();
  else toaster.show({ title: "Settings saved", tone: "success" });
});
form?.addEventListener("reset", () => {
  $("#f-email").removeAttribute("aria-invalid");
  $("#f-email-error").textContent = "";
  $("#form-summary").hidden = true;
});

// ---------------------------------------------------------------------------
// Toasts, tabs, tooltips, dialogs
// ---------------------------------------------------------------------------

const toaster = new FutureCssToaster();

const TOASTS = {
  success: { title: "Copied to clipboard", tone: "success" },
  action: {
    title: "Chat archived",
    body: "It will stay searchable.",
    action: { label: "Undo", onAction: () => toaster.show({ title: "Chat restored", tone: "info" }) },
  },
  danger: { title: "Upload failed", body: "report.pdf is larger than 30 MB.", tone: "danger" },
};

for (const button of document.querySelectorAll("[data-demo-toast]")) {
  button.addEventListener("click", () => toaster.show(TOASTS[button.dataset.demoToast]));
}

bindTabs(document);
bindNavs(document, {
  onToggle: (expanded) => status("#nav-status", expanded ? "Sidebar expanded." : "Sidebar collapsed to icons."),
});
bindTables(document, {
  onSort: (column, direction) => {
    const name = document.querySelectorAll("#demo-table thead th")[column]?.textContent.trim();
    status("#table-status", `Sorted by ${name}, ${direction}.`);
  },
});
bindTooltips(document);

// `commandfor`/`command` would open these with no script; the listeners below
// cover browsers that do not have invoker commands yet.
for (const opener of document.querySelectorAll("[data-demo-open]")) {
  opener.addEventListener("click", () => document.getElementById(opener.dataset.demoOpen)?.showModal());
}
for (const closer of document.querySelectorAll("[data-demo-close]")) {
  closer.addEventListener("click", () => closer.closest("dialog")?.close());
}

// The reasoning trace streams for a few seconds, then completes: the shimmer is
// driven by data-fc-state, so it stops the moment the state changes.
const reasoning = $("#demo-reasoning");
if (reasoning) {
  const started = Date.now();
  setTimeout(() => {
    reasoning.dataset.fcState = "complete";
    reasoning.querySelector(".fc-reasoning__label").textContent = "Thought";
    reasoning.querySelector("[data-demo-duration]").textContent =
      `for ${Math.round((Date.now() - started) / 1000)}s`;
  }, 4000);
}

for (const toggle of document.querySelectorAll(".fc-msg__action[aria-pressed]")) {
  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-pressed") !== "true";
    // Thumbs up and down are mutually exclusive.
    for (const other of toggle.parentElement.querySelectorAll("[aria-pressed]")) {
      other.setAttribute("aria-pressed", "false");
    }
    toggle.setAttribute("aria-pressed", String(next));
  });
}

for (const tag of document.querySelectorAll("button.fc-tag[aria-pressed]")) {
  tag.addEventListener("click", () => {
    tag.setAttribute("aria-pressed", String(tag.getAttribute("aria-pressed") !== "true"));
  });
}

// Agent steps: each click completes the live step and starts the next one. The
// row's look follows data-fc-state alone -- the script never touches a class.
const STEPS = ["Searching 12 sources", "Reading 4 pages", "Drafting the answer", "Checking citations"];
let step = 0;
let stepStarted = Date.now();
const live = $("#demo-agent-live");
const elapsed = live?.querySelector("[data-demo-elapsed]");
setInterval(() => {
  if (elapsed && live.dataset.fcState === "running") {
    elapsed.textContent = `${Math.round((Date.now() - stepStarted) / 1000)}s`;
  }
}, 1000);
$("#demo-agent-next")?.addEventListener("click", () => {
  if (!live) return;
  const done = live.cloneNode(true);
  done.removeAttribute("id");
  done.dataset.fcState = "complete";
  // Only the live step is a live region; finished ones are history.
  done.querySelector("[role='status']")?.removeAttribute("role");
  done.querySelector("[data-demo-elapsed]")?.removeAttribute("data-demo-elapsed");
  live.before(done);
  step = (step + 1) % STEPS.length;
  live.querySelector(".fc-agent-status__label").textContent = STEPS[step];
  stepStarted = Date.now();
  elapsed.textContent = "0s";
});
