# Development plan

Phased roadmap with exit criteria. Each phase ends with a gate that can be checked, not a
judgment call.

**Current status: Phase 2 in progress, Phase A (WASM size) started.** Phases 0 and 1 are
complete; Phase 2 has the foundation built and the components remaining. The Rust/WASM
layer is specced in [WASM.md](WASM.md) and has a working, tested foundation.

---

## Where we are

| Phase | Status | Delivered |
| --- | --- | --- |
| 0. Foundations | Complete | Repo, toolchain, decisions |
| 1. Token system | Complete | Palette, semantic layer, contrast contract, compiler |
| 2. Core CSS | In progress | Reset, base, layout, utilities, button, chat, tool-call, editor, menu, grid, webview |
| 3. Component set | Not started | Form controls, overlays, navigation |
| A. WASM foundations | Started | Rust workspace, 6 crates, accelerator abstraction |
| B. Complex components | In progress | editor, menu, grid, webview (CSS complete) |
| 4. Verification | Not started | Visual regression, browser matrix, docs site |
| 5. Platform expansion | Not started | Email build, print, native tokens |
| 6. Release | Not started | Publishing, versioning, governance |

### Working now

```
npm run build        165 tokens (90 theme-aware) + 15-file bundle, 132 KB
                     6 Rust crates, 4 WASM modules (over budget — see Phase A)
npm run lint         15 rules, 0 violations across 15 files
npm test             245 tests passing (incl. WASM/JS parity + bundle integrity)
cargo test           75 tests passing
```

The bundle figure is uncompressed and unminified, which is the shipped form: the CSS is
deliberately readable so engineers can debug it in devtools, and consumers minify at
their own boundary. It exceeds the < 60 KB uncompressed budget in the performance
section below. That budget has never been enforced — it is scheduled for Phase 4 — so the
number above is stated as measured rather than as met. See
[Semantic coverage](SEMANTIC-COVERAGE.md) §"Docs that disagree with the code".

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

- [ ] Text input, textarea, select
- [ ] Checkbox and radio
- [ ] Label and form field group
- [ ] Card / surface
- [ ] Badge and tag
- [ ] Alert / callout (the status family)
- [ ] Breadcrumb, and a minimal nav
- [ ] Fixture page rendering every component in every state, both directions, both schemes

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

- [ ] Text input, textarea, select
- [ ] Checkbox, radio, switch
- [ ] Field group: label, hint, error, `aria-describedby` wiring
- [ ] Validation message component
- [ ] Form-level error summary with focus management

### Overlays

- [ ] Dialog, built on `<dialog>` for native focus containment and Escape
- [ ] Popover, built on the native popover API
- [ ] Tooltip, keyboard-reachable, never the sole source of information
- [ ] Toast, with correct live-region politeness (`polite` vs `assertive`)

### Navigation

- [ ] Tabs, full keyboard contract (arrows, Home, End)
- [ ] Menu / dropdown with focus management
- [ ] Pagination
- [ ] Sidebar

### Data display

- [ ] Table with sorting affordances
- [ ] Description list
- [ ] Empty state and error state patterns

**Exit criteria**

- Every interactive component has a documented keyboard contract and passes a
  keyboard-only walkthrough
- Automated axe-core pass added to CI with zero critical or serious findings
- Every overlay component documents its no-JS fallback
- Focus management documented for every overlay: what traps focus, what restores it

**Risk.** Overlays are where accessibility goes wrong most often. Budget extra time here
rather than treating dialogs as a quick win.

---

## Phase A -- WASM size reduction (started)

**Goal.** Get each WASM module from ~350-420 KB to its ~30-45 KB budget. Everything else
in the WASM plan depends on this, because a 400 KB download to open a context menu is not
a trade anyone accepts.

Delivered:

- Rust workspace with six crates, each a `cdylib`. `fc-core` links into the `fc-model`
  module rather than shipping on its own, which is why six crates produce four `.wasm`
  files. `fc-diff` is built as a Rust library only and has no WASM module yet.
- 75 unit tests covering the algorithms.
- A JS accelerator abstraction with a pure-JS fallback, so the modules are optional.
- **A measured size report in the build output**, because the dominant cost is invisible
  in source and only obvious in the numbers.

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

1. **JS bindings.** `contenteditable` wiring for the editor; menu positioning and focus
   management; grid keyboard navigation and virtualization. All CSS, no behavior yet.
2. **Form field.** Still the highest-value missing component, and the one with the most
   accessibility surface.
3. **Dialog.** Prefer native `<dialog>`; document the manual trap only where it is
   unavailable.

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

## Phase 4 -- Verification (not started)

Turning manual discipline into automation as the component count grows.

### Automated

- [ ] Playwright harness across Chromium, Firefox, WebKit
- [ ] Visual regression, both schemes, both directions
- [ ] axe-core in CI, zero critical/serious
- [ ] Horizontal overflow assertion at 320px and 400% zoom
- [ ] RTL layout diffing against LTR fixtures
- [ ] Reduced-motion and forced-colors test renders
- [ ] Bundle size budget with a failure threshold

### Documentation

- [ ] Fixture page as the living component gallery
- [ ] Token reference generated from the TypeScript source
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

## Phase 5 -- Platform expansion (not started)

- [ ] Print stylesheet
- [ ] Email build generated from the same tokens
- [ ] Native token packages (Swift, Kotlin) from `tokens.json`
- [ ] Figma variable export from `tokens.json`
- [ ] Vertical writing mode (`writing-mode`) support
- [ ] APCA contrast checking alongside WCAG 2.x
- [ ] Cognitive accessibility guidance

**Note on email.** It must be generated from the token source, never hand-maintained.
Hand-maintained email CSS drifts from the tokens within months, and a design system that
silently diverges between channels is worse than one that admits it does not support
email yet. Until this build exists, the system does not claim email support.

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

| Budget | Target | Measured |
| --- | --- | --- |
| Full bundle, uncompressed | < 60 KB | **132 KB — over by 2.2x** |
| Full bundle, minified | < 15 KB | not measured |
| Tokens + base only | < 10 KB minified | not measured |
| CSS applied to a typical page | < 30 KB | not measured |

Enforced in CI from Phase 4. Exceeding the budget requires a written justification.

**The uncompressed target is currently missed and always has been.** It was written
before the bundle had a terminal, a syntax palette, a diff family and seven more
components, and nothing has re-checked it since. Two honest options, and the choice
belongs to whoever picks this up:

1. **Restate the budget against the minified figure.** The shipped CSS is deliberately
   unminified — comments and readable structure are worth more to an engineer debugging
   in devtools than the last few kilobytes — so an uncompressed budget measures the wrong
   thing. That requires a minifier, which the zero-dependency constraint currently
   forbids. Phase 4 would have to add one, or measure with an external tool.
2. **Raise the uncompressed budget to what the system actually needs**, with the
   reasoning written down, and keep the minified number as the real target.

Leaving a target the build contradicts is the one option that is not available: it is
precisely the class of error this system is built to prevent everywhere else.

### Open questions

1. **Vertical writing mode.** Japanese publishing needs it. Is it in scope, or documented
   as unsupported? Current answer: documented as unsupported, reconsidered in Phase 5.
2. **APCA.** Likely to replace WCAG 2.x contrast ratios. Adopt alongside WCAG rather than
   instead, until it stabilizes.
3. **Container queries for components.** Should components respond to their container
   rather than the viewport? Probably yes for cards and similar. Deferred until a real
   component needs it.
4. **Density modes.** Compact and comfortable spacing for data-heavy applications. Adds a
   token dimension; revisit after Phase 3.
5. **Motion tokens as a scale.** Motion is currently four durations. Real applications may
   need a richer scale for orchestrated sequences.
