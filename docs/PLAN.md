# Development plan

Phased roadmap with exit criteria. Each phase ends with a gate that can be checked, not a
judgment call.

**Current status: Phase 2 complete, Phase 3 and Phase C mostly delivered, Phase A
(WASM size) in progress.** Phases 0 and 1 are complete. Form controls, overlays, navigation, and
the status family now exist as CSS, with bindings where the platform does not already
provide the behavior. The Rust/WASM
layer is specced in [WASM.md](WASM.md) and has a working, tested foundation.

---

## Where we are

| Phase | Status | Delivered |
| --- | --- | --- |
| 0. Foundations | Complete | Repo, toolchain, decisions |
| 1. Token system | Complete | Palette, semantic layer, contrast contract, compiler |
| 2. Core CSS | Complete | Reset, base, layout, utilities, every Phase 2 component, and the fixture page |
| 3. Component set | Mostly delivered | Forms, overlays, tabs, breadcrumb, pagination, loading, cards, table, description list, sidebar; axe-core pass remains |
| A. WASM size | In progress | Rust workspace, 8 crates, accelerator abstraction; every module but `fc-rich-text` within budget on the shipped basis |
| B. Complex components | In progress | editor, menu, grid, webview (CSS complete) |
| C. Token roles and themes | Mostly delivered | State tokens, override points, high-contrast and brand theme sets, type roles; reduced-transparency and reduced-data remain |
| D. Material 3 parity | Complete | Every M3 component Shipped or Divergent with its reason |
| 4. Verification | Started | Overflow assertions, size budgets, generated token reference; visual regression and browser matrix remain |
| 5. Platform expansion | Mostly delivered | Print foundation, email foundation, Swift and Kotlin tokens, Figma variables; vertical writing, APCA and cognitive guidance remain |
| 6. Release | Not started | Publishing, versioning, governance |
| F. Dioxus components | Designed | `fc-dioxus` design, API, accessibility tooling, and plan in [crates/fc-dioxus](../crates/fc-dioxus/docs/PLAN.md) |

### Working now

Measured on 2026-10-06 against `main` at `bd5ed5d` (after #24 and #25), with the WASM modules built and
headless Chrome present (without either, the WASM and browser suites skip):

```
npm run build        167 tokens (91 theme-aware) + 39-file bundle, 276.2 KB
                     8 Rust crates, 8 .wasm files in 7 modules (over budget — see Phase A)
npm run lint         15 rules, 0 violations across 39 files
npm test             416 tests passing (incl. WASM/JS parity, bundle integrity, Chrome)
cargo test           132 tests passing
```

The bundle figure is uncompressed and unminified, which is the shipped form: the CSS is
deliberately readable so engineers can debug it in devtools, and consumers minify at
their own boundary. The budget gates what one page pays rather than the full bundle; see
[Performance budget](#performance-budget).

**Eight crates, eight `.wasm` files, seven importable modules.** `fc-core` and
`fc-model` both emit into the `fc-model` module, so eight build entries produce seven
modules that JavaScript can import. On the shipped basis (post-bindgen, the bytes a
consumer downloads; see [WASM.md](WASM.md#what-actually-ships)) two modules are still
over budget. `fc-context-menu` was the largest by a wide margin until #25:

```
fc-context-menu    21.7 KB shipped   (raw  40.2 KB)   primitives only, was 81.3
fc-select          38.4 KB shipped   (raw  62.1 KB)   primitives only, was 50.0
fc-diff            33.7 KB shipped   (raw  54.4 KB)   primitives only
```

The raw basis made `js-sys` look like the whole story; the shipped basis shows that
bindgen strips most of it, and that two primitives-only modules are still over. Phase A
now targets where the shipped bytes are, not where the raw ones were. `fc-context-menu` and
`fc-select` both cut size by leaving case folding to JavaScript, which already ships the
Unicode tables; see [WASM.md](WASM.md#what-actually-ships).

Since 2026-10-08 `fc-diff` and `fc-select` build without std, which drops std's panic
formatting, and avoid the substring searcher whose panics linked the rest of it (measured
without wasm-opt, so ~10% above the figures above):

```
fc-diff            20.9 KB shipped   (raw  37.7 KB)   was 36.8 / 54.4, now within budget
fc-select          27.5 KB shipped   (raw  47.4 KB)   was 41.5 / 62.1, now within budget
```

See [WASM.md](WASM.md#no-std-for-primitives-only-crates).

Verified: contrast contract enforced in both schemes · all ramps validated · linter
verified against both violations and legitimate patterns · WASM modules instantiate and
**agree with the JS implementation on every offset pair**.

---

## Phase 0 -- Foundations (complete)

Repository structure, toolchain, and the architectural decisions that constrain
everything after.

- [x] Repository, MIT license, package manifest, TypeScript config
- [x] Zero-dependency toolchain: Node runs the TypeScript directly
- [x] Build, lint, and test scripts wired into `npm run check`
- [x] Cascade layer order declared and documented
- [x] Naming conventions decided (`--fc-`, `fc-` prefix)
- [x] Design principles written and agreed

**Exit criteria met.** `npm run check` runs clean from a fresh clone with no install step
beyond `npm install`.

---

## Phase 1 -- Token system (complete)

The palette and the pipeline that makes accessibility enforceable.

- [x] OKLCH ramps: neutral, accent, success, warning, danger, info
- [x] 14 steps per ramp, endpoints at pure white and pure black
- [x] Semantic layer with per-scheme values for every token
- [x] Contrast contract: 19 pairings, checked in both schemes at build time
- [x] Non-color scales: spacing, type, radius, border, motion, z-index, opacity
- [x] Token compiler emitting `tokens.css` and `tokens.json`
- [x] Contrast math verified against WCAG reference values
- [x] Ramp integrity tests: completeness, monotonic lightness, single hue, gamut

**Exit criteria met.** Changing any palette value and running the build either passes the
contrast contract or fails the build with a specific, actionable message.

Four defects were found and fixed by this contract during Phase 1, which is the clearest
evidence it earns its place:

1. Ramp step `0` was black while being used as the light-mode surface, making light mode
   render a black background.
2. `text-inverse` had no defined surface to be legible against, so its contrast pairing
   was meaningless (1:1).
3. `text-on-accent` was white in both schemes, which fails 4.5:1 in dark mode where the
   accent fill is light.
4. `text-muted` reused on an inverted surface collapsed to 1.8:1.

---

## Phase 2 -- Core CSS (in progress)

Everything a document needs before components exist. The reset, the semantic element
defaults, the layout primitives, the utilities, and the first component.

### Completed

- [x] Reset layer, all rules at zero specificity via `:where()`
- [x] Reduced-motion blanket rule shipped before any animation exists
- [x] Autofill styling for light and dark
- [x] Base layer: semantic element defaults for headings, prose, links, tables, forms,
  blockquotes, lists, selection
- [x] Focus ring with an offset ring for guaranteed visibility
- [x] Layout primitives: `fc-stack`, `fc-cluster`, `fc-sidebar`, `fc-grid-auto`, `fc-container`
- [x] Direction-agnostic helpers: `fc-truncate`, `fc-clamp-*`, `fc-scroll-x`, `fc-center`
- [x] Utilities layer with the accessible-hiding pattern
- [x] Button component as the reference implementation
- [x] Chat surface (thread, message, lifecycle states, truncation)
- [x] Tool-call component (arguments, result, determinate and indeterminate progress)
- [x] Linter with 15 rules and a full test suite
- [x] Build orchestrator with per-layer outputs

### Remaining

- [x] Text input, textarea, select (`fc-input`, native select with a themed chevron)
- [x] Checkbox and radio (native, `accent-color`), plus switch
- [x] Label and form field group (`fc-field`, `fc-input-group`, `fc-error-summary`)
- [x] Card / surface (`fc-card`, the first container-query component)
- [x] Badge and tag
- [x] Alert / callout (the status family)
- [x] Breadcrumb, and pagination
- [x] Fixture page rendering every component in every state, both directions, both schemes
  (`demo/fixtures.html`; `?dir=rtl` and `?theme=dark` switch before first paint)

### Defects found and fixed during Phase 2

Recorded because they are the best available evidence that the enforcement
mechanisms work:

1. **Indeterminate progress bar froze at 40% under reduced motion**, reading as
   "40% complete" -- a component stating something false. Now drawn full-width with a
   static striped fill, which conveys "working, extent unknown" without implying a
   percentage.
2. **The RTL progress sweep ran the wrong way.** `translateX` is a physical transform
   with no logical equivalent, so this is one of the genuinely direction-sensitive
   cases. Fixed with an explicit `:dir(rtl)` branch.
3. **Neither chat nor tool-call had a `forced-colors` block,** so several
   background-carried affordances would have collapsed into indistinguishable grey. Both
   now restate meaning with system colors.

4. **Every elevation token computed to no shadow.** Shadows were emitted as
   `light-dark(<shadow>, <shadow>)`, but `light-dark()` accepts colours only. The value
   was invalid at computed time -- not a parse error -- so menus and the select list
   rendered flat while every test passed. Fixed by wrapping each layer's colour instead;
   caught by a browser test that reads the computed `box-shadow`.
5. **Spinners froze under reduced motion,** despite a component rule slowing them down.
   The reset's reduced-motion block is `!important` in the earliest layer, and an
   important declaration in an earlier layer beats everything in later ones. Spinners
   are now excluded from that block by name.
6. **`npm run demo` did not start**: a merge left a syntax error in `demo/server.mjs`.
   The browser tests use their own server, so nothing ran the demo's.
7. **An errored or aborted chat message drew nothing unless it was the assistant's.**
   The state rule recoloured the inline-start border, and only assistant messages have
   one. Found by the fixture page; the state now draws its own border on every role.
8. **A composer attachment chip overflowed the page at 320px.** A long file name
   ellipsised inside the chip, but the chip itself had no maximum width. Found by the
   fixture page's 320px pass.

Issues 2 and 3 prompted new lint rules (`reduced-motion`, `forced-colors`) so the gap
cannot recur silently.

**Exit criteria**

- Every component has all states in the [state matrix](COMPONENTS.md#the-state-matrix)
- `npm run check` passes clean
- Every component renders correctly in `dir="ltr"` and `dir="rtl"`
- Horizontal overflow assertion passes at 320px for every fixture
- No component uses a fixed height on text
- Review checklist in [ACCESSIBILITY.md](ACCESSIBILITY.md) passes per component

---

## Phase 3 -- Component set (not started)

The components needed for a real application, prioritized by frequency of use.

### Form controls

- [x] Text input, textarea, select
- [x] Checkbox, radio, switch
- [x] Field group: label, hint, error, `aria-describedby` wiring
- [x] Validation message component (`fc-field__error`)
- [x] Form-level error summary with focus management (CSS; focus moved by the app)

### Overlays

- [x] Dialog, built on `<dialog>` for native focus containment and Escape (plus side sheet)
- [x] Popover, built on the native popover API, anchored where anchor positioning exists
- [x] Tooltip, keyboard-reachable, never the sole source of information (Escape via binding)
- [x] Toast, with correct live-region politeness (`polite` vs `assertive`)

### Navigation

- [x] Tabs, full keyboard contract (arrows, Home, End), RTL-aware arrows
- [x] Menu / dropdown with focus management (the context menu)
- [x] Pagination
- [x] Sidebar (`fc-nav`: links with `aria-current`, foldable groups, and an icon rail
  driven by the toggle's `aria-expanded`)

### Data display

- [x] Table with sorting affordances (`fc-table`, plus a `table` binding that sorts by
  `aria-sort`, numerically or by the table's `lang`, and stably)
- [x] Description list (`fc-dl`, intrinsic two-column layout that stacks when narrow)
- [x] Empty state and error state patterns
- [x] Avatar, disclosure / accordion, skeleton, progress
- [x] A spinner family (ring, arc, typing dots, pulse, stream bars, orbit, sparkle) and an
  agent status row driven by `data-fc-state`

**Exit criteria**

- Every interactive component has a documented keyboard contract and passes a
  keyboard-only walkthrough
- Automated axe-core pass added to CI with zero critical or serious findings
- Every overlay component documents its no-JS fallback
- Focus management documented for every overlay: what traps focus, what restores it

**Risk.** Overlays are where accessibility goes wrong most often. Budget extra time here
rather than treating dialogs as a quick win.

---

## Phase A -- WASM size reduction (in progress)

**Goal.** Get each WASM module from ~350-420 KB to its ~30-45 KB budget. Everything else
in the WASM plan depends on this, because a 400 KB download to open a context menu is not
a trade anyone accepts.

Delivered:

- Rust workspace with eight crates, each a `cdylib`. `fc-core` is emitted into the
  `fc-model` module directory rather than getting one of its own, so eight crates
  produce **eight** `.wasm` files across **seven** importable modules.
- 132 unit tests covering the algorithms.
- A JS accelerator abstraction with a pure-JS fallback, so the modules are optional.
- **`fc-context-menu` off `js-sys`**: 411.6 KB to 40.2 KB raw (79.8 to 21.7 KB
  shipped), under budget. It no longer depends on `fc-core` or serde, folds case
  in JS rather than linking Unicode tables, and is wired into the menu binding
  behind `useWasm` with a parity test (`tests/menu.test.ts`).
- **A measured size report in the build output**, because the dominant cost is invisible
  in source and only obvious in the numbers.
- **`fc-diff` and `fc-select` without std** (2026-10-08): 36.8 to 20.9 KB and 41.5 to
  27.5 KB shipped, both within budget on that basis. A `bare` crate feature drops std, so
  panics trap without linking std's message formatting, and both crates scan bytes where
  `str::replace` and `str::contains` brought the two-way searcher and its slicing panics.
  Native builds and `cargo test` are unchanged; see
  [WASM.md](WASM.md#no-std-for-primitives-only-crates).

The problem, measured rather than guessed:

| | Bytes |
| --- | ---: |
| Empty module | 27,707 |
| **+ one `js_sys::Array::new()`** | **329,588** |
| Actual `fc-context-menu` | 424,164 |

`js-sys` costs ~302 KB the moment it is linked, regardless of which API is called, and
LTO cannot remove it because wasm-bindgen's glue enumerates the WebIDL surface rather
than tree-shaking to the used subset.

Remaining:

- Re-derive the budgets on the **shipped** basis. The raw (pre-bindgen) basis now
  overstates the wire by 2–18x — see the table in docs/WASM.md — and three
  modules exceeded their budgets on shipped bytes (`fc-context-menu` 81.3 KB,
  `fc-select` 50.0, `fc-diff` 34.8). `fc-context-menu` is now at 21.7 and
  `fc-select` at 38.4, and since the `bare` builds `fc-select` and `fc-diff` are under
  too. On the shipped basis only `fc-rich-text` (45.9 KB with wasm-opt, 52.1 without,
  against 49) is still over. On the raw basis `fc-diff` and `fc-select` remain 3 and 12 KB
  over, most of it wasm-bindgen's own descriptor section, which never ships. Whether to
  move the budgets to the shipped basis is the maintainer's call, not a side effect of a
  size change.
- Apply the `bare` pattern to `fc-git` and `fc-context-menu`, which are already
  primitives-only, and to the js-sys crates once their boundaries are.
- Replace `js_sys::Array` / `Vec<JsValue>` returns with flat primitives: numbers, strings,
  and typed arrays. A range crosses as four numbers, not an object.
- Drop `serde-wasm-bindgen` in favour of hand-written `to_js` for the few shapes crossing
  the boundary. Serde's machinery is not free, and it is only paying for itself if the
  boundary grows.
- Re-measure, and turn the budgets into a build failure once they are met.

Exit criteria: **every module within budget**, and the parity tests still passing. The
parity suite is the safety net for this entire phase, because rewriting the boundary is
exactly where a silent behavior change would hide.

Risks:

- *Primitives-only is less ergonomic in Rust.* Mitigation: keep the ergonomic Rust API
  internally and do the conversion in one place per crate.
- *A hand-written marshalling layer is more code to get wrong.* Mitigation: the parity
  test compares every offset pair against the JS implementation, so a divergence is a test
  failure rather than a user's corrupted document.

---

## Phase B -- Complex components (in progress)

**Goal.** Working UI elements for complex surfaces. The priority is the *element* --
chrome, layout, states, accessibility -- not a feature-complete application.

Delivered (CSS complete, browser bindings not yet):

- [x] **Rich text editor** -- toolbar with roving tabindex, `aria-pressed` state,
  `.fc-prose` document styles usable standalone, all states, forced-colors block
- [x] **Context menu** -- items, groups, separators, checkbox items, submenu
  affordance, danger variant, forced-colors block
- [x] **Data grid** -- sticky row and column headers with a correct corner z-index,
  numeric alignment with tabular figures, selection vs. active cell, dirty and
  invalid states
- [x] **Embedded browser chrome** -- tab strip, address bar with secure indicator,
  navigation with the RTL back-arrow flip, overlay states
- [x] **Terminal** -- output grid, ANSI palette, cursor, input line, status bar. The
  only hue-named tokens in the system, with their own 19-pairing contrast contract.

Remaining, in priority order:

1. **JS bindings.** Editor, menu, grid, and webview bindings are written and covered by
   browser tests (`tests/browser/`). Terminal, chat, tool-call, code, and diff have CSS
   only -- their behavior is either trivial or delegated to the pure-JS modules beside
   them (`highlight`, `diff`, `markdown`).
2. ~~**Form field.**~~ Delivered (`fc-field`, `fc-input`, `fc-check`, `fc-switch`).
3. ~~**Dialog.**~~ Delivered on native `<dialog>`; no manual focus trap is shipped,
   because every supported browser has `showModal()`.

Exit criteria: every component has a JS-only path that is fully usable and accessible;
the WASM path is a performance option; and both are covered by the same behavior tests.

Risks:

- *`contenteditable` is a minefield.* Mitigation: prefer `beforeinput` over deprecated
  `execCommand`, and treat the browser's editing behavior as the baseline to conform to
  rather than fight.
- *Virtualized grids are hostile to assistive technology.* Mitigation: `aria-rowcount`
  and a focus model that keeps the active cell reachable, tested with a screen reader
  rather than assumed.

### A bug this phase found

The bundle never contained the token layer. `tokens.css` is generated rather than
authored in `src/css`, so it was not in `BUNDLE_ORDER`, and every
`var(--fc-color-*)` reference resolved to nothing. The stylesheet rendered completely
unstyled -- and nothing failed, because an unresolved custom property is valid CSS.

Every existing test passed: the linter reads sources, the token tests read `tokens.css`,
and the contrast contract validated values that were never in the bundle at all. Only
rendering the artifact in a browser found it. `tests/bundle.test.ts` now asserts the
token *definitions* are present, and `build.ts` throws if they are not.

The follow-on bug was in the fix: the banner-stripping regex matched `/*! ... */`
non-greedily, but the banner contains `src/tokens/**/*.ts`, whose `**/` closes the
pattern early. That left a literal `*.ts` in the bundle and broke parsing of the entire
token layer again -- so the stripper now scans for the terminator instead of trusting a
pattern to a file whose contents can contain anything.

---

## Phase C -- Token roles and themes (mostly delivered)

**Goal.** Close the gaps [Semantic coverage](SEMANTIC-COVERAGE.md) found against the ten
most widely-used token systems, without giving up what makes ours checkable. That
document's conclusion is that this is a *foundation library*: it ships scales and
meanings but not roles and brand slots, which makes it auditable and hard to adopt for a
team that already has a type ramp and a brand. This phase adds the extension points.

Each item below names the coverage entry it closes, so the two documents can be checked
against each other. The rule that holds throughout: **every new colour token is a
declared contrast pair**, and every new token value passes the same contract as the
existing ones. An extension point that cannot be verified is not one this system ships.

**Status, 2026-10-08.** Most of this phase landed in the maintainer's "Styling
improvements" commits (2c3c7e7, 9921f33) without this document being updated; the boxes
below are now checked against the code. Component slots and type roles are enforced by
`tests/roles.test.ts`, which closes every Absent and Partial row in the coverage
scorecard. What remains is the reduced-transparency and reduced-data item.

Ordered by what to do first, which is not quite the coverage document's order (that one
ranks by cost to a consumer). State tokens come first because every component added
without them encodes the workaround.

### 1. State tokens (closes entries 9 and 10)

- [x] `selected` background and foreground, replacing the surfaces the data grid, select,
  tabs and git surface currently borrow from outside the vocabulary
- [x] `disabled` background, foreground, and border colours, declared as contrast pairs.
  Opacity stays available for controls that must keep their identity (a disabled
  destructive button), but stops being the only mechanism, so the disabled state can be
  stated rather than only composited
- [x] Hover and active steps for each status family -- success, warning, danger, info --
  so the four families match accent's shape: `<family>-bg-hover` and
  `<family>-bg-active`, eight tokens derived from the existing ramps. The coverage
  document estimates sixteen, which would also give `-bg-subtle` its own hover and
  active steps; add those only if a component needs them
- [x] Re-try `warning-text` on `warning-bg` as a declared pair while the warning ramp is
  being touched. It failed in Phase 1, and components work around it; if it still cannot
  pass, record why in `color.ts`
- [x] Migrate components off the workarounds in the same change, not later

### 2. Component override points (closes entry 3)

Today a consumer who wants "the primary button is blue, not accent" must write CSS in
`fc.overrides`. Primer, Carbon, M3 and Spectrum all solve this with component tokens.

- [x] Decide the shape. The constraint is [ARCHITECTURE.md](ARCHITECTURE.md): per-layer
  distribution and a zero-specificity base must survive, so decisions must not move from
  the cascade into a token table wholesale. The candidate is a small set of
  `--fc-<component>-*` custom properties per component, each defaulting to a semantic
  token, read by the component and set by nothing in the library
- [x] Ship them for the components with brand weight first: button, chat surface,
  composer. The chat components are where Carbon's `$ai-*` / `$chat-*` families show the
  field going; we ship the components but no tokens for them
- [x] The linter and contrast contract cover the defaults; document that overriding one
  takes the pair outside the contract ([TOKENS.md](TOKENS.md))
- [x] A test that fails when a documented slot stops being read, or its fallback stops
  being a semantic token (`tests/roles.test.ts`)

### 3. A third value per token: high contrast and theme sets (closes entries 12 and 14)

One mechanism, two consumers. Every token has exactly two values today, and both
high-contrast schemes and alternative brands need more. Build the compiler abstraction
once rather than twice.

- [x] A theme-set abstraction in the token compiler: a named set of semantic values,
  verified by the same contrast contract, emitted under a selector
- [x] High-contrast light and dark sets, opt-in through `[data-fc-theme]` and applied
  automatically under `@media (prefers-contrast: more)`. `focus-ring` is already two
  tokens so an HC set can swap in a double-colour ring
- [x] A second brand set, generated from a different accent ramp, as the proof that a
  consumer can do the same. Tokens Studio's "theme set" is the reference
- [x] `forced-colors` handling stays as it is; it is the OS half of high contrast and is
  already complete and linted

### 4. Composite type styles (closes entry 15)

- [x] Named type roles (`body`, `body-small`, `title`, `heading-*`, `code`, `label`)
  that bundle size, weight, line height and tracking, exposed as tokens or classes and
  used by `base.css` instead of per-element composition
- [x] A `letterSpacing` token group, so the `-0.01em` literal in `base.css` becomes a
  token with its script-safety comment intact
- [x] A test that fails when a role or its class goes missing (`tests/roles.test.ts`)
- [x] Until this ships, `COMPONENTS.md` states the limitation, so a consumer does not
  discover it during design review

### 5. Smaller additions

Each is cheap and independent; none needs a new decision.

- [x] **Elevation.** Three shadows today (`raised`, `overlay`, `modal`); a menu over a
  modal over a toast needs more. Extend the scale rather than adding literals
- [x] **Surface depth.** Numbered aliases over the existing surface ladder, so a
  third-party component can ask for "one step above raised" (Carbon's `$layer-01..05`).
  The role names stay; depth is an alias, not a replacement
- [x] **Bidi isolation.** A `.fc-u-bidi` utility and `<bdi>` guidance in
  `COMPONENTS.md`, so the API matches what `INTERNATIONALIZATION.md` already describes
- [x] **Wide gamut.** Emit an `oklch()` value alongside each hex so P3 displays get the
  authored colour, while the contrast contract keeps verifying the hex that every browser
  can fall back to
- [x] **Per-token descriptions** in `tokens.json` (Polaris), generated from the comments
  already in the TypeScript source
- [ ] **`prefers-reduced-transparency` and `prefers-reduced-data`.** Partly done: the
  dialog backdrop honours the first. Honour the first
  wherever a component uses translucency; the second only once something ships that is
  worth not loading

Deliberately not adopted, with the reasons in the coverage document: seed-derived
dynamic colour (Material 3) cannot be contrast-checked at build time, and
scale-step-as-semantics (Radix) trades verifiability for brevity.

**Exit criteria**

- Every Absent and Partial row in the coverage scorecard is Shipped, or Divergent with
  its reason recorded in the same edit
- The gap-list items with no Absent or Partial row of their own are closed too: theme
  sets (gap 4, which sits under the Shipped entry 12), elevation depth (gap 6) and bidi
  isolation (gap 8)
- The contrast contract covers every new colour token in every theme set
- A consumer can switch brand and contrast level without writing CSS

---

## Phase D -- Material 3 component parity (complete)

**Goal.** An equivalent for every component in the Material 3 catalog
([m3.material.io/components](https://m3.material.io/components)), checked 2026-10-08.
"Equivalent" means the same job done for the same user, not the same look: M3's shapes,
tonal palettes and motion are its brand, and this system keeps its own. Where we
deliberately do something different, the row says Divergent and why, the same rule
[Semantic coverage](SEMANTIC-COVERAGE.md) uses for tokens.

That document compared *tokens* against ten systems, M3 among them, and its gaps are
Phase C. This one compares *components* against M3 alone, so the two do not overlap:
where an M3 component needs a token Phase C adds (the `selected` and `disabled` roles,
elevation steps), the component uses it rather than adding its own.

### The mapping

Status is **Shipped** (an existing component covers it), **Gap** (scheduled below), or
**Divergent** (deliberately different, reason given).

| M3 category | M3 component | Here | Status |
| --- | --- | --- | --- |
| Actions | Common buttons: filled, tonal, outlined, text | `fc-btn--primary`, `--subtle`, `--secondary`, `--ghost` | Shipped |
| | Elevated button | none | Divergent: a shadow on an in-flow control reads as a floating layer; elevation is reserved for surfaces that sit above others |
| | Icon button, toggle icon button | `fc-btn--icon`; `aria-pressed` styles the toggle | Shipped |
| | Button group (standard) | `fc-control-group` | Shipped |
| | Button group (connected) | `fc-button-group` | Shipped, D1 |
| | Segmented button | `fc-segmented` (`fc-tabs__list--segmented` remains for switching views) | Shipped, D1 |
| | Split button | `fc-split-btn` with `bindMenuButton` | Shipped, D1 |
| | FAB, extended FAB | `fc-fab`, `--extended` | Shipped, D1 |
| | FAB menu | `fc-fab-menu` | Shipped, D1 |
| Communication | Badges | `fc-badge`, `fc-badge--count` | Shipped |
| | Loading indicator | `fc-spinner` family | Shipped |
| | Progress, linear | `fc-progress` | Shipped |
| | Progress, circular determinate | `fc-progress-ring` | Shipped, D4 |
| | Snackbar | `fc-toast` with `__action`, toast binding | Shipped |
| | Tooltips, plain and rich | `fc-tooltip`; a rich tooltip is an `fc-popover` | Shipped |
| Containment | Cards: elevated, filled, outlined | `fc-card--elevated`, `--subtle`, default | Shipped |
| | Dialogs, basic and full-screen | `fc-dialog`, `--fullscreen` | Shipped |
| | Side sheets | `fc-dialog--sheet` | Shipped |
| | Bottom sheets | `fc-dialog--bottom`, modal or standard, with `__handle` | Shipped, D4 |
| | Carousel | `fc-carousel` (multi-browse, `--hero`, `--free`), `carousel` binding for the buttons | Shipped, D4 |
| | Dividers | `fc-divider`, `--inset`, `--middle`, `--vertical` | Shipped, D2 |
| | Lists | `fc-list`: static, linked, button and control rows, one to three lines | Shipped, D2 |
| Navigation | Top app bar | `fc-masthead` | Shipped |
| | Navigation drawer | `fc-nav` | Shipped |
| | Navigation rail | `fc-nav` rail (toggle's `aria-expanded`) | Shipped |
| | Navigation bar (bottom) | `fc-navbar` | Shipped, D3 |
| | Toolbars (docked and floating) | `fc-toolbar`, `--docked`, `--floating`, `toolbar` binding | Shipped, D3 |
| | Search: bar and view | `fc-search` | Shipped, D3 |
| | Tabs, primary and secondary | `fc-tabs`, tabs binding | Shipped |
| Selection | Checkbox, radio, switch | `fc-check`, `fc-switch` | Shipped |
| | Chips: assist, filter, input, suggestion | `button.fc-tag` (assist), `fc-tag[aria-pressed]` (filter), `fc-tag__remove` (input), `fc-suggestion--pill` (suggestion) | Shipped |
| | Menus | `fc-menu` and its binding (context and anchored) | Shipped |
| | Sliders | `fc-slider` on `<input type="range">`, `slider` binding for the fill | Shipped, D2 |
| | Date pickers | `fc-datepicker` and native `<input type="date">` | Shipped, D5; range selection deferred |
| | Time pickers | native `<input type="time">` and `fc-timepicker` input mode | Shipped, D5 |
| | Time picker clock dial | none | Divergent: a dial is a pointer gesture with no keyboard or screen-reader equivalent beyond the input mode it duplicates, and its hit targets shrink below the minimum on small screens |
| Text inputs | Text fields: outlined | `fc-input` in `fc-field` | Shipped |
| | Text fields: filled | `fc-input--filled` | Shipped, D4 |
| | Floating label | label above the input | Divergent: a label that moves into the field is unreadable while empty at small sizes and adds motion for no information; the persistent label is the accessible form |
| Colour | Dynamic colour from a seed | none | Divergent, see Phase C: cannot be contrast-checked at build time |

### The work, grouped as reviewable pull requests

Every new component follows [How to add things](../AGENTS.md#a-component): one file under
`fc.components`, every state, reduced-motion and forced-colors behaviour, a fixture
section, the 7 KB budget, and controls at the shared 40px height. Behaviour stays on the
platform wherever it exists (`<input type="range">`, `<input type="date">`, the popover
API, `<dialog>`, scroll snap); a binding ships only where the platform has no answer.

**D1. Actions**
- [x] Connected button group (`fc-button-group`): joined segments with round outer ends,
  the pressed segment rounding fully. Its own component rather than a control-group
  modifier, because the joined corners override each button's radius by position, which
  a modifier could only do by reaching into its items
- [x] Segmented button (`fc-segmented`): single or multiple choice, built on native radio
  and checkbox inputs so the value is a form value and the selection model is the browser's
- [x] Split button: a primary action plus a menu trigger, reusing `fc-menu` (new
  `bindMenuButton` in the menu binding)
- [x] FAB and extended FAB (`fc-fab`), including sizes and the lowered surface variant
- [x] FAB menu: the FAB as a popover invoker opening a column of actions

**D2. Lists and selection**
- [x] List (`fc-list`): one-, two- and three-line items with leading and trailing slots,
  static, linked and interactive (checkbox or switch in the trailing slot)
- [x] Divider (`fc-divider`): full, inset, and vertical, on `<hr>` or `role="separator"`
- [x] Chips: on inspection already covered. `fc-tag` as a button is an assist chip, with
  `aria-pressed` a filter chip, and with `__remove` an input chip; `fc-suggestion--pill`
  is the suggestion chip. No new component
- [x] Slider (`fc-slider`) on `<input type="range">`, with an `<output>` value and a
  visible scale; a small `slider` binding draws the fill, which Blink and WebKit have no
  pseudo-element for. RTL fill direction verified

**D3. Navigation**
- [x] Navigation bar (`fc-navbar`): three to five destinations at the block end, labels
  always visible, `aria-current="page"` as the selected state
- [x] Toolbar (`fc-toolbar`): docked and floating, with a binding for the APG roving
  tabindex contract, generalised from the editor's. The toolbar moved out of
  `editor.css` into `toolbar.css`, and the editor binding now uses the same roving
  contract its CSS comment always promised
- [x] Search (`fc-search`): a search bar with leading and trailing slots, and a search
  view that shows suggestions or results beneath it, on `role="search"`

**D4. Containment and feedback**
- [x] Bottom sheet (`fc-dialog--bottom`): modal and non-modal, with a drag handle
  that is decorative, never the only way to close
- [x] Carousel (`fc-carousel`): scroll-snap track, keyboard reachable, no autoplay
- [x] Circular determinate progress (`fc-progress-ring`), driven by a value the markup
  states, so it is never a spinner pretending to know
- [x] Filled text field variant (`fc-input--filled`), with its fill and underline
  declared as contrast pairs

**D5. Pickers**
- [x] Date picker (`fc-datepicker`): a calendar grid with the APG date-grid keyboard
  contract in a `datepicker` binding (arrows, Home/End, Page Up/Down, Shift+Page for
  years, RTL), month and weekday names from `Intl`, the locale's first day of the week,
  and min, max and per-day unavailability. The native `<input type="date">` is styled as
  the text-entry path and the no-JS fallback. Range selection is deferred until someone
  needs it; it changes the value from one date to two and the grid's selection model
- [x] Time picker: native `<input type="time">` styled, plus an input-mode layout
  (`fc-timepicker`: hours, minutes, an `fc-segmented` period) for locales that need the
  period stated. The clock dial is Divergent, see the table

**Exit criteria**

- Every Gap row above is Shipped, or Divergent with its reason recorded in the same edit
- Every new component has a fixture section and passes the 320px, RTL and dark-scheme
  browser pass
- No component exceeds the per-component budget
- Every new binding has browser tests for its full keyboard contract

---

## Phase E -- RustyClaw semantic coverage

Source audit against RustyClaw `481a428cb7a3b82d1a5e556ffef40e3dd9f52ce3` on 2026-10-09.
See [the complete screen/element mapping](RUSTYCLAW-COVERAGE.md) for desktop, TUI,
shared view models and website coverage. This phase adds web equivalents to future-css;
RustyClaw integration is separate work.

- [x] Map every desktop/TUI component family to existing controls or a semantic gap
- [x] Metric: labeled usage/latency/load summaries with exact values
- [x] Transfer: persistent downloads/model pulls, known and unknown totals and outcomes
- [x] Approval: operation, explicit scope, full arguments and decision actions
- [x] User prompt: inline question form composing native text, confirm, radio, checkbox and form controls
- [x] Device authorization: verification destination, code, expiry and status; reusable for pairing
- [x] Reuse existing components for management tables, settings, nested navigation,
  command search, plugin/swarm panels, credential entry, media and preview shells
- [x] Register new CSS, document contracts and add all lifecycle fixture states
- [x] File source-confirmed RustyClaw defects with reproduction instructions (#493–495)

Exit gate: `npm run check`, including real Chrome fixture overflow/focus in both
schemes and directions. Validation details are in [the audit](RUSTYCLAW-COVERAGE.md#verification).
Native assistive-technology review remains part of Phase 4.

---

## Phase 4 -- Verification (started)

Turning manual discipline into automation as the component count grows.

### Automated

- [ ] Playwright harness across Chromium, Firefox, WebKit
- [ ] Visual regression, both schemes, both directions
- [ ] axe-core in CI, zero critical/serious
- [x] Horizontal overflow assertion at 320px and 400% zoom (the fixture page in both
  directions and schemes, and the demo at 400%)
- [ ] RTL layout diffing against LTR fixtures
- [ ] Reduced-motion and forced-colors test renders
- [x] Bundle size budget with a failure threshold (per layer, per component and per
  page, in `tests/budget.test.ts`; adopted early, in Phase 2)

### Documentation

- [x] Fixture page as the living component gallery
- [x] Token reference generated from the TypeScript source (`docs/TOKEN-REFERENCE.md`)
- [ ] Per-component documentation with all six required sections
- [ ] Migration guide

### Manual, per release

- [ ] Screen reader: VoiceOver, NVDA, JAWS
- [ ] Keyboard-only pass
- [ ] RTL and long-string passes
- [ ] Real-translation review in Arabic, German, Finnish, Japanese

**Exit criteria**

- A regression in contrast, focus visibility, or direction handling fails CI rather than
  being found in review

---

## Phase 5 -- Platform expansion (mostly delivered)

- [x] Print stylesheet (`dist/print.css`, opt-in utilities)
- [x] Email build generated from the same tokens (`dist/email.css`, a light-only
  foundation; consumers still inline it)
- [x] Native token files (`FutureCssTokens.swift`, `FutureCssTokens.kt`), generated
  alongside `tokens.json`; packaging them is Phase 6
- [x] Figma variable export (`dist/figma-variables.json`)
- [ ] Vertical writing mode (`writing-mode`) support
- [ ] APCA contrast checking alongside WCAG 2.x
- [ ] Cognitive accessibility guidance

**Note on email.** It must be generated from the token source, never hand-maintained.
Hand-maintained email CSS drifts from the tokens within months, and a design system that
silently diverges between channels is worse than one that admits it does not support
email yet. The generated foundation covers canvas, surface, link and muted text only, so
the claim is that much email support and no more.

---

## Phase 6 -- Release (not started)

- [ ] Semantic versioning, with a documented deprecation policy
- [ ] Changesets for release notes
- [ ] CI publishing to npm
- [ ] CDN distribution
- [ ] Contribution guidelines and a review process
- [ ] Support policy: which versions get fixes, and for how long
- [ ] Migration tooling for breaking changes

**Versioning policy**

- **Major** -- removed or renamed tokens or classes; changed default values that alter
  rendering
- **Minor** -- new components, new tokens, new variants
- **Patch** -- bug fixes that preserve rendering

Token names are public API. Renaming one is a major change, because consumers depend on
them.

---

## Cross-cutting work

Not phase-specific; continuous.

### Documentation

Every document in `docs/` is a living artifact, updated in the same change as the code it
describes. Documentation that drifts is worse than none, because it is trusted.

### Testing philosophy

- Automated checks for anything expressible as a check
- Manual review for judgment: keyboard feel, focus order, reading clarity
- Never automate a judgment call and call it covered

### Performance budget

**Decided 2026-10-07 by the maintainer, for now: budget per page, enforced in
`npm run check` from today.** `tests/budget.test.ts` fails the check when a target is
missed.

| Budget (minified) | Target | Measured | Gate |
| --- | --- | --- | --- |
| Layers + reset + tokens + base | < 16 KB | 12.0 KB | fails the check |
| Any single component | < 7 KB | 6.0 KB largest (`nav`) | fails the check |
| Typical chat page | < 40 KB | 28.7 KB | fails the check |
| Full bundle, minified | — | 135.8 KB | reported only |
| Full bundle, minified + gzip | — | 19.7 KB | reported only |

Measured on 2026-10-07 with 37 components. "Typical chat page" is layers + reset +
tokens + base + layout + utilities plus button, chat and composer.

**Why per page.** Consumers load the per-layer files in `dist/` and only the components
they render, so what one page pays is the number that stays meaningful as the component
count grows. The old full-bundle targets (< 60 KB uncompressed, < 15 KB minified) were
written for a much smaller library and could not be met by trimming. Gating the full
bundle on gzip would let a page that renders one component pass while paying for all of
them; raising the uncompressed targets would penalise the explanatory comments
`AGENTS.md` asks for. The full bundle is still printed by the test so growth stays
visible, but it never fails.

**How it is measured.** Minified sizes come from `src/build/strip-css.ts`, an in-repo
comment-and-whitespace stripper, so the check adds no dependency. The shipped CSS stays
unminified; the stripper only measures. On this codebase it lands within 0.5% of esbuild
(135.8 KB against 135.3 KB for the full bundle).

That comparison excludes `/*!` comments, which the stripper drops and default minifiers
keep. Every source file opens with a `/*!` banner, and those banners are about 42 KB of
the full bundle when a consumer minifies with esbuild's defaults (177.2 KB against
135.3 KB). The 158.3 KB measured on 2026-10-06 used those defaults, so it included them. Whether the
banners should stay `/*!` is a separate decision; the budget measures the CSS without
them.

Exceeding a target requires a written justification here, not a raised number.

### Open questions

1. **Vertical writing mode.** Japanese publishing needs it. Is it in scope, or documented
   as unsupported? Current answer: documented as unsupported, reconsidered in Phase 5.
2. **APCA.** Likely to replace WCAG 2.x contrast ratios. Adopt alongside WCAG rather than
   instead, until it stabilizes.
3. **Container queries for components.** *Answered: yes, where the component's width is
   decided by its parent.* `fc-card` is the first: its media moves beside the content
   when the card, not the viewport, is wide enough.
4. **Density modes.** Compact and comfortable spacing for data-heavy applications. Adds a
   token dimension; revisit after Phase 3. Spectrum's medium/large scale axes are the
   candidate answer, and would ride on the theme-set mechanism in Phase C rather than
   needing their own.
5. **Motion tokens as a scale.** Motion is currently four durations. Real applications may
   need a richer scale for orchestrated sequences. If it grows, name durations by use
   (Open Props' `--duration-quick-1` for hover, `--duration-moderate-2` for a modal)
   rather than extending `fast`/`normal`/`slow`, and consider a `--motionOK` custom
   media query alongside the reset's reduced-motion block.
6. **A class-less mode.** `base.css` already renders legibly with zero classes. Pico goes
   further and styles buttons and form controls from bare elements. Worth offering as an
   opt-in entry point, if it can reuse component CSS rather than duplicating it.
