# AGENTS.md

Operating instructions for autonomous and semi-autonomous contributors to this
repository. Read this before changing anything. It encodes the invariants that
are expensive to break and cheap to maintain.

This file is authoritative for agents. Where it conflicts with a habit picked up
from another codebase, this file wins.

---

## What this project is

A general-purpose CSS design system, authored in TypeScript, that ships as plain
CSS. Two audiences consume the output:

- **Humans** using browsers, screen readers, and assistive technology.
- **Machines** — automation, instrumentation, and agent runtimes that read the
  DOM as a data interface.

Both are first-class. A change is not finished when it looks right; it is finished
when it is also correct for a consumer reading the DOM.

---

## Non-negotiable invariants

These are enforced by `npm run check`. If a change requires breaking one, stop and
raise it rather than working around the check.

1. **No raw color literals in CSS.** Use a semantic token. A literal cannot be
   themed and cannot be contrast-checked.
2. **No physical direction properties.** `margin-inline-start`, never
   `margin-left`. This is what makes RTL support structural instead of a parallel
   stylesheet that nobody maintains.
3. **No `!important`,** with three documented exemptions (display:none for
   hiding, and the reduced-motion reset block).
4. **Every color pairing has a declared contrast minimum,** verified in both color
   schemes by `tests/contrast.test.ts`.
5. **Reset and base layers contribute zero specificity,** via `:where()`. A
   component class must always be able to win.
6. **No `outline: none`** unless scoped to `:not(:focus-visible)`.
7. **New components ship with all states styled,** not just the rest state.

---

## Dual-audience DOM contract

Any component that renders dynamic or partially-known data must expose its state
in the DOM as data attributes, not only as visible text:

| Attribute | Meaning |
| --- | --- |
| `data-fc-kind` | What the node is (`chat`, `message`, `tool-call`, …) |
| `data-fc-id` | Stable unique id mirroring the runtime id |
| `data-fc-seq` | Monotonic ordering integer |
| `data-fc-role` | Message author (`user`, `assistant`, `system`, `tool`) |
| `data-fc-state` | Lifecycle state (see below) |
| `data-fc-ts` | ISO-8601 or epoch-ms timestamp |
| `data-fc-truncated` | `"true"` when displayed text has been elided |

Rules:

- **State attributes are the single source of truth** for both styling and
  meaning. Never derive appearance from a class that can fall out of sync.
- **Truncation is always declared.** If text is clipped, set
  `data-fc-truncated="true"` and keep the full value reachable.
- **These attributes are additive.** Styling must never *depend* on them, so the
  component degrades correctly with no consumer attached.
- **Never put secrets or sensitive values in an attribute.** Attributes are
  serialized into markup, logs, and caches.

Valid `data-fc-state` values: `pending`, `queued`, `streaming`, `running`,
`complete`, `aborted`, `denied`, `error`.

---

## Commands

```bash
npm run build       # CSS bundle + WASM modules
npm run build:css   # CSS only; no Rust toolchain needed
npm run build:wasm  # Rust crates -> one .wasm per module, plus a size report
npm run lint        # architecture linter
npm test            # JS tests, including WASM/JS parity
npm run test:rust   # Rust unit tests, with and without the bindgen feature
npm run test:browser # bindings in headless Chrome (skipped if none found)
npm run demo       # serve the component demo at http://127.0.0.1:5178
npm run check       # all of the above; this is the gate
```

The toolchain runs TypeScript directly via Node's type stripping. **Do not add a
transpiler, bundler, or framework dependency to make a change work.** The
zero-dependency property is a feature: the system must stay auditable and cheap
to vendor. If a change seems to need a dependency, that is a signal the change is
too large.

---

## The Rust/WASM layer

Some components ship an optional Rust model compiled to WASM. **WASM is never
required.** Every component works with the layer absent, and the CSS build needs
no Rust toolchain at all.

### The rule that governs everything

**A WASM module is a pure computation library. It never touches the DOM.** Work
that requires asking the browser something — layout, focus, scroll, rendering,
ARIA — stays in JavaScript. WASM answers questions about *data*.

### Module size is a design constraint

An empty wasm-bindgen module is ~28 KB. Linking `js-sys` adds **~302 KB** the
moment it is used, regardless of which API is called, and LTO cannot remove it.
So:

- **Never return `Vec<JsValue>` or `js_sys::Array` from a crate.** Return
  primitives: numbers, strings, and flat typed arrays. A range crosses as four
  numbers.
- **Never add `js-sys` to a crate** without measuring the result first.
- `npm run build:wasm` prints a size report and the budgets in
  `src/build/build-wasm.ts`. All nine binaries fit the unchanged budgets on the
  **shipped** basis (post-bindgen and optional post-opt, see docs/WASM.md), which
  is enforced by the build. Raw descriptor-bearing sizes remain diagnostic.
- **A primitives-only crate can drop std.** `fc-diff`, `fc-select`, `fc-git`, `fc-context-menu` and `fc-highlight` build
  `no_std` through a `bare` feature, which build:wasm enables in its own cargo
  invocation; std's panic formatting was most of their bytes. Never enable
  `bare` in a build that includes a std crate: the two panic handlers collide.
  `build:wasm` keeps those Cargo invocations separate. Do not raise a budget to make the report green.
- **Every crate's JavaScript boundary sits behind a default-on `bindgen`
  feature.** Pure Rust consumers (the Dioxus library) turn defaults off and must
  get no wasm-bindgen at all: its exact `=0.2.118` pin would otherwise hold back
  their own. Write exports as `#[cfg_attr(feature = "bindgen", wasm_bindgen(...))]`,
  gate anything that names `JsValue` with `#[cfg(feature = "bindgen")]`, and pull
  sibling crates with `default-features = false`, forwarding `<sibling>/bindgen`.
  `tests/pure-rust.test.ts` and `npm run test:rust` fail when this leaks.
- **Never run `git push -u origin HEAD:<branch>` while checked out on `main`.**
  The `-u` rewrites main's upstream to the feature branch, and when that branch
  is later deleted every pull fails with "no such ref was fetched". Push feature
  branches without `-u` when HEAD may be main. Fix when hit:
  `git branch --set-upstream-to=origin/main main`.

### Cross-boundary rules

- **Offsets are UTF-16 code units, everywhere.** They match JavaScript.
- **Both implementations clamp to character boundaries** rather than splitting a
  surrogate pair. This diverges from `String.prototype.slice` deliberately: a
  lone surrogate renders as a replacement glyph and corrupts stored text.
- `tests/wasm.test.ts` compares every offset pair between the WASM and JS
  implementations. **A divergence there is the worst bug this system can have**,
  because users get correct results on one path and wrong results on the other
  with no way to tell. Run it after any boundary change.

### Toolchain gotchas

- The `wasm-bindgen` CLI version must match the crate exactly (`=0.2.118` is
  pinned). A mismatch fails with a "schema version" error that reads like
  corruption.
- Constructors need `#[wasm_bindgen(constructor)]`; a by-value factory in a
  `#[wasm_bindgen] impl` block does not compile.
- The `nodejs` bindgen target emits broken CommonJS in 0.2.118. Use the `web`
  build in tests.

---

## The demo

`npm run demo` serves `demo/` on port 5178. It is a working page, not a gallery of
screenshots: every component is wired to the same binding module the package
exports, loaded straight from `src/js/`.

**No build step, deliberately.** `demo/server.mjs` serves the TypeScript sources
with Node's `stripTypeScriptTypes` and rewrites sibling specifiers to `.js`. That
is what makes the claim checkable rather than aspirational — if the bindings ever
needed a bundler, this server would break.

The demo's own chrome (`demo/demo.css`) lives outside `src/css` on purpose, so
`npm run lint` does not walk it. The linter's contract is about the shipped
library. The demo still follows the same rules.

`demo/fixtures.html` is the other half: every component in every state the markup
can express, with no interaction needed to reach one. `?dir=rtl` and
`?theme=dark` switch direction and scheme before first paint. The browser suite
loads it at 320px in all four combinations and fails on page overflow or a blank
state, forces `:focus-visible` on every control and fails on one with no ring,
and `tests/bundle.test.ts` fails when a component file has no `data-fixture`
section. A new component is not done until it has one.

**A demo is a test.** Three of the bugs fixed in this area were invisible to unit
tests and obvious the moment real components rendered in a real browser:

- `.fc-grid` was an auto-fit layout primitive *and* the data grid. Layers resolve
  that silently, so the grid inherited `grid-template-columns` and rendered four
  columns of data as two. Both rules were individually correct.
- `grid-auto-columns` sizes implicit tracks, and nothing created them, so every
  cell stacked in one column. Roles, tabindex and ARIA were all correct.
- `color-scheme` was declared in `fc.base` as well as `fc.tokens`. Base is
  ordered later, so the theme switcher computed to `light dark` and changed
  nothing — while still responding to clicks.

Each is now covered by a test that fails when the bug is reintroduced.

## How to add things

### A design token

1. Add the primitive in `src/tokens/palette.ts` or the relevant scale.
2. Add the semantic alias in `src/tokens/semantic/`.
3. **If it is a color, add a contrast pair to `contrastPairs`** with its WCAG
   minimum. The build fails if the palette violates it. This is not optional —
   an unpaired color is an unchecked color.
4. Run `npm run check`. Inspect `dist/tokens.css` to confirm the output.

Never reference a primitive directly from a component. Semantics are the contract;
primitives are an implementation detail that themes may remap.

### A component

1. One file in `src/css/components/`, wrapped in `@layer fc.components`.
2. BEM with the `fc-` prefix: `.fc-name`, `.fc-name__element`, `.fc-name--modifier`.
3. Single class selectors. The linter rejects over-qualified selectors because
   they raise specificity for no benefit.
4. Logical properties only. No physical directions, no `left`/`right`.
5. Style **every** state: rest, hover, active, focus-visible, disabled,
   `aria-disabled`, plus any loading or error state the component can enter.
6. Include reduced-motion and forced-colors behavior, or explicitly note why it
   does not apply.
7. Register the file in `BUNDLE_ORDER` in `src/build/build.ts`.
8. Add a usage example to `docs/COMPONENTS.md`.
9. Run `npm run check`. It fails a component over 7 KB minified; see the performance
   budget in `docs/PLAN.md`. Split the component or justify the exception there.

### A lint rule

Rules live in `tools/lint-css.mjs`. **Every rule needs a test** in
`tests/lint.test.ts`, covering both a violation that must be caught and a
legitimate pattern that must not be. A rule without a false-positive test will
eventually be deleted by a frustrated contributor.

---

## Verification expectations

- Never report a task as complete with a failing `npm run check`.
- Do not disable or weaken a lint rule or a test to make a change pass. Fix the
  code.
- Do not relax a contrast minimum to make a palette build. Change the color.
- If you genuinely believe a rule is wrong, say so and explain the tradeoff
  rather than silently working around it.

## Writing style for code comments

Comments explain **why**, never what. The code already says what.

```css
/* Bad: sets the color to the token */
color: var(--fc-color-text-default);

/* Good: the offset colour creates a gap so the ring stays visible even when
   the component colour is close to the focus colour. */
box-shadow: 0 0 0 var(--fc-space-0-5) var(--fc-color-focus-ring-offset);
```

When a workaround looks odd, it almost always has a non-obvious reason worth
recording — especially around browser quirks, forced-colors mode, or RTL. If you
cannot explain why a line exists, delete it.

## Accessibility is not a follow-up

When adding any component, verify:

- Keyboard: reachable, operable, and visibly focused.
- Contrast: every text/background pairing declared and passing.
- Target size: at least `var(--fc-size-target-min)`.
- Screen reader: correct role and name; state changes announced without flooding
  a live region.
- Zoom: usable at 400% without horizontal scrolling.
- Forced colors: not a blank rectangle.

## Repository map

```
src/tokens/         Tokens in TypeScript (source of truth)
src/css/            Layered CSS. index.css declares layer order
src/js/             Component bindings (editor, menu, grid, webview) plus the
                    WASM accelerator. WASM is optional; JS always works.
src/build/          Token compiler, CSS bundler, WASM orchestrator
crates/            Rust crates; nine produce nine .wasm files in eight modules
tools/lint-css.mjs  Architecture linter
tests/              Contract, linter, accelerator, and WASM/JS parity tests
tests/browser/      Binding tests in headless Chrome. Skipped if no browser.
demo/               Live component demo. Serves the built CSS plus the real
                    TypeScript bindings, types stripped at serve time.
docs/               Design documents; PLAN.md is the roadmap, WASM.md the WASM spec
```

## Current state

Pre-alpha. Foundations are built and enforced. Fifty-five CSS components are
complete. The general set: button, connected button group, segmented button, split button, floating action
button and FAB menu, control group, masthead, list, divider, slider, toolbar, navigation bar, search, carousel, date and time pickers, form field and input group, checkbox / radio /
switch, card, badge and tag, alert, dialog, side sheet and bottom sheet, popover and tooltip, toast,
tabs, breadcrumb, pagination, spinners (ring, arc, typing dots, pulse, stream bars, orbit, sparkle), skeleton, progress, avatar, empty state,
disclosure, navigation sidebar, data table with sorting, description list, and splitter (split panes and resizable edges). The AI-chat set: chat surface (with message actions), agent status row, reasoning trace,
citations and sources, suggested prompts, tool call / step trace, rich text editor,
context menu, data grid, embedded browser chrome, terminal, code block, diff viewer,
select/listbox, chat composer, context strip, git surface, and theme picker. Twenty ship browser
bindings -- editor, menu, grid, webview, select, composer, context strip, git surface,
tabs, toast, tooltip, table, nav, slider, toolbar, carousel, date picker, splitter, theme picker, and multiselect -- exercised by tests in a real headless Chrome. Overlays lean
on the platform (`<dialog>`, the popover API, `<details>`, `@starting-style`) and need
no script. Syntax highlighting, Markdown, and line diffing ship as JS modules
(`highlight`, `diff`, `markdown`); the diff and the highlighter have Rust crates
(`fc-diff`, `fc-highlight`), Markdown does not yet.

When a modifier must restyle a component's parts, it sets custom properties the parts
read (see `.fc-tabs__list--segmented`, `.fc-empty--error`) or keys off a real state
attribute (`aria-orientation`, `aria-selected`). The linter rejects descendant
class-on-class selectors; wrapping one in `[class]` or similar to slip past it is a
workaround, not a fix.

The browser suite looks for Chrome in the usual install paths; set `CHROME_PATH` when
it lives elsewhere (a Playwright cache, a CI image). A suite that reports "no Chrome
found" has skipped 100+ tests, so check for that line before calling a run green.

The context strip is the clearest example of why a group of controls can be a
component. Each control is an `fc-select`, but provider filters model and effort
is not universally available, and neither relationship can live in a select --
two selects that each owned their own state would disagree, showing a model from
one provider selected under another. That is a request nobody can fulfil.

The fixture-driven git surface
(branch, status counts, file list, per-file line stats) is complete and reuses
`fc-diff`. The Rust/WASM layer has nine crates with 142 passing tests and a
working JS-only fallback. All nine binaries meet their unchanged shipped budgets;
raw sizes remain diagnostic. Core ABI 2 uses flat typed arrays and JSON strings
rather than JavaScript object serialization; see docs/MIGRATION.md. The select and context menu bindings
opt into their Rust models with `useWasm`, and both fold case in JavaScript so the
modules link no Unicode tables. The rich text and grid models exist in Rust but
are not wired; `fc-model`, `fc-diff`, `fc-select`, `fc-context-menu`, `fc-git` and
`fc-highlight` have JS parity tests. `fc-highlight` has no regex engine, so its parity
test also runs generated input through both tokenizers.

See `docs/PLAN.md` for the current phase and what is deliberately out of
scope.

The docs in `docs/` were written alongside the code and reflect the same
architecture. If you change the system, change the docs in the same commit —
a design document that disagrees with its implementation is worse than none.