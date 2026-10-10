# fc-dioxus development plan

Phases with exit gates. Like the root [PLAN.md](../../../docs/PLAN.md), each gate can be
checked, not judged. Every phase ends with `npm run check` green.

**Current status: design complete, Phase 0 not started.**

| Phase | Delivers | Gate |
| --- | --- | --- |
| 0. Foundations | Crate skeletons, lints, model crates feature-gated, asset sync | Workspace builds for native and wasm32; WASM size report unchanged |
| 1. Core | Shared types, macro, ids, controlled state, platform bridge, theme root, test harness | Core unit tests; the harness renders and compares one fixture |
| 2. Compliance engine | `fc-a11y` rules, HTML adapter, CLI `check`, `fc-tokens` | Audit of `demo/fixtures.html` runs in `npm run check` with zero errors |
| 3. Static components | Every component with no keyboard behaviour | Parity, a11y, and coverage green for each |
| 4. Interactive components | Shared behaviours and every bound component | Browser suite with keyboard scripts and axe-core |
| 5. Heavy components | Calendar, highlighting, terminal, data grid, webview, editor | Parity tests for each port; browser suite |
| 6. Compliance tooling | Debug checks, overlay, ledger, conformance report, SARIF | An example app audited end to end, report generated |
| 7. Release | Names, publishing, versioning | Published crates, docs.rs builds |

---

## Phase 0 -- Foundations

1. **Verify the toolchain before writing code.** Resolve Dioxus 0.7 against the workspace's
   pinned `wasm-bindgen = "=0.2.118"`. If Dioxus needs a newer `wasm-bindgen`, the choice is
   between moving the pin (and the CLI, and re-measuring every module's size) or putting the
   Dioxus crates in a nested workspace with their own lockfile. Record the outcome in
   DESIGN.md. Confirm the MSRV Dioxus needs against `rust-version = "1.82"`.
2. **Skeleton crates** `fc-dioxus`, `fc-a11y`, `fc-tokens` in the workspace with
   `#![forbid(unsafe_code)]`, `[lints] workspace = true`, and the workspace lint table from
   AGENTS.md.
3. **Gate the model crates' glue.** Add a default-on `bindgen` feature to `fc-core`,
   `fc-model`, `fc-rich-text`, `fc-select`, `fc-context-menu`, `fc-grid`, `fc-diff`, and
   `fc-git`, moving `#[wasm_bindgen]` items and `js-sys` behind it. `build:wasm` keeps it on.
4. **Asset sync.** `npm run build:dioxus-assets` copies `dist/` CSS into
   `crates/fc-dioxus/assets/`; a test fails when the copy is stale.
5. **Wire into the gate.** `npm run check` runs `cargo clippy` and the new crates' tests.
6. **Exclude the Dioxus crates from `build:wasm`.** They are applications' dependencies, not
   shipped modules, and must not appear in its size report.

**Gate:** `cargo build --workspace` for the host and `wasm32-unknown-unknown`; `npm run
build:wasm` prints the same sizes as before the change; `npm run check` green.

## Phase 1 -- Core

All of [DESIGN.md, The shared building blocks](DESIGN.md#the-shared-building-blocks):

- `Bem`, `ClassList`, `Modifier`, `fc_modifier!`
- `FcData`, `Lifecycle`, `MessageRole`, `Tone`, `Orientation`, `HeadingLevel`,
  `Availability` with `guard`
- `AccessibleName`, `Alt`, `Clipped`, `Id`, `use_id`
- `use_controllable`
- `DomBridge` with the `web-sys` and `eval` implementations
- `FutureCss`, `Theme`, `Brand`, `Direction`, `use_theme`, stylesheet assets
- `testing::render_to_html`, the markup-parity harness, and the coverage test, with every
  component on the pending list

**Gate:** unit tests for each piece (including `use_id` determinism across two SSR renders),
the parity harness passing for one trivial fixture (`divider`), and the coverage test
reporting the pending list.

## Phase 2 -- Compliance engine

Before any real component, so every component is audited from its first commit.

1. `fc-tokens`: generator from `dist/tokens.json`, checked-in output, drift test.
2. `fc-a11y` tree, the `html5ever` adapter (pending the decision below), and the rule
   catalogue in [ACCESSIBILITY.md](ACCESSIBILITY.md#rule-catalogue-initial), each rule with
   its catch and false-positive tests.
3. Reporters: human, JSON, SARIF. CLI `check` and `rules`.
4. Run it over `demo/fixtures.html`. Findings there are bugs in the CSS library's reference
   markup and are fixed in the fixtures, not suppressed in the rules.
5. `fc_dioxus::testing::assert_accessible`.

**Gate:** `fc-a11y check demo/fixtures.html` in `npm run check` with zero errors.

## Phase 3 -- Static components

Components whose behaviour is native or absent. Each lands with its examples, parity test,
a11y assertion, and coverage entry, in pull requests of about five components:

1. Layout, typography, utilities, divider, description list
2. Button, icon button, link button, badge, tag, kbd, avatar
3. Spinner, progress, progress ring, skeleton, alert, empty state
4. Card, list, breadcrumb, masthead, disclosure (native `<details>`)
5. Chat surface, agent status, reasoning, citations, suggestions
6. Tool call, the five lifecycle panels
7. Diff view (`fc-diff`), git surface (`fc-git`), code block without highlighting

**Gate:** the coverage pending list holds only Phase 4 and 5 components.

## Phase 4 -- Interactive components

1. `behavior::roving`, `dismiss`, `live`, `typeahead`, `sort`, `toast_queue`, and the
   pagination window, each unit-tested; parity tests for the TypeScript ports.
2. The Dioxus fixture app under `examples/fixtures`, with `?dir=rtl` and `?theme=dark`, and
   the browser suite pointed at it: overflow at 320 px, forced `:focus-visible`, axe-core.
3. Components, in pull requests grouped by shared behaviour:
   1. Field, input, textarea, input group, error summary, checkbox, radio, switch, slider
   2. Segmented, button group, control group, toolbar
   3. Tabs, nav, navbar, pagination, carousel
   4. Dialog, sheet, bottom sheet, popover, tooltip
   5. Menu, context menu, menu button, split button, FAB and FAB menu
   6. Select (`fc-select`), search
   7. Toast, table
   8. Context strip, composer
   9. Split pane and resize handle, once the CSS component lands (placeholder in COMPONENTS.md)

**Gate:** every Phase 4 component has keyboard scripts generated from its contract table, and
the browser suite passes in all four direction and scheme combinations.

## Phase 5 -- Heavy components

Each needs a model port or a renderer decision, so each is its own pull request:

1. `fc-calendar` (port of `datepicker.ts` logic, parity-tested), then `DatePicker` and
   `TimePicker`.
2. `fc-highlight` (port of `highlight.ts`, parity-tested), then highlighting in `CodeBlock`.
3. ANSI parsing and `Terminal`.
4. `DataGrid` over `fc-grid`, with virtualization from `Viewport`.
5. `Webview`, with the URL safety port.
6. `Editor` over `fc-rich-text`. Last, because `contenteditable` and a virtual DOM disagree
   about who owns the markup. A spike decides between DOM-patching through `DomBridge` on
   every renderer and a web-only editor; the result is recorded in DESIGN.md before the
   component is built.

**Gate:** the coverage pending list is empty.

## Phase 6 -- Compliance tooling

1. The remaining debug-build checks and `AuditMode`.
2. `AuditOverlay` (feature `dev-audit`), itself audited.
3. The review ledger: `fc-a11y checklist`, `review`, and `report`.
4. An example application (a chat client using the composer, context strip, chat surface,
   tool calls, and toasts) audited with every layer: types, debug checks, `fc-a11y check` on
   its SSR output, the browser suite, and a ledger with a manual pass, producing a
   conformance report.

**Gate:** the example's conformance report is generated in CI from real results, with every
criterion either backed by a check or marked as not yet reviewed.

## Phase 7 -- Release

Tied to the root plan's Phase 6, which has not started: package names, registry, and
versioning are decided there for the CSS and here for the crates, together.

- crates.io publishing for `fc-tokens`, `fc-a11y`, and `fc-dioxus` (names pending).
- docs.rs builds with every feature.
- A compatibility table between `fc-dioxus` versions, Dioxus versions, and CSS versions.

---

## Decisions needed

| Decision | Default this plan assumes | Alternative |
| --- | --- | --- |
| Where the library lives | In this repository, `crates/fc-dioxus` and siblings, sharing the workspace and model crates | A separate repository depending on published model crates; costs a publish cycle per model change |
| Crate names | `fc-dioxus`, `fc-a11y`, `fc-tokens` | `future-css-dioxus` etc. for crates.io discoverability; decide with root Phase 6 |
| HTML parser for `fc-a11y` | `html5ever`, behind a default feature | A hand-written parser for well-formed SSR output only, which cannot audit real pages |
| Dioxus version | 0.7, pinned to the minor | Track latest; costs a migration per minor |
| Renderers | Web, desktop, SSR and fullstack; Blitz best-effort | Web only, which halves the platform bridge |
| axe-core in the browser suite | Whatever the root plan's pending decision lands on | Rely on `fc-a11y` plus keyboard scripts only |
| Editor | Attempt every renderer, fall back to web-only | Web-only from the start |

## Risks

- **`wasm-bindgen` pin.** The workspace pins `=0.2.118` for the WASM modules. If Dioxus
  needs newer, Phase 0 step 1 decides between moving the pin and a nested workspace.
- **Hydration ids.** `use_id` relies on server and client rendering the same tree in the same
  order. Conditional rendering that differs between them (feature detection during render)
  breaks it; the debug-build duplicate-id and dangling-idref checks catch the symptom.
- **Top-layer behaviour on desktop.** `showModal` and popovers depend on the desktop
  webview's engine version. The browser suite covers Chrome; desktop is checked manually
  per release until there is a harness for it.
- **Scope.** Fifty-five CSS components with every option is a large surface. The coverage
  test is what keeps "every option" honest; the phase gates are what keep it finishable.
