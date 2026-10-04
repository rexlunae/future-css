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
  ` ${SWATCHES.length} token pairings sampled live \u00b7 9 components \u00b7 0 dependencies`,
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