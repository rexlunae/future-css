# AGENTS.md (fc-dioxus)

Operating instructions for contributors to the Dioxus component library and its
accessibility tooling: `crates/fc-dioxus`, `crates/fc-a11y`, and `crates/fc-tokens`.

**Read the root [AGENTS.md](../../AGENTS.md) first.** Everything there still applies. This
file adds the rules for the Rust component layer. Where the two overlap, the root file
wins on anything about CSS, tokens, and the DOM contract, and this file wins on Rust.

---

## What this is

A typed Dioxus API over future-css, in the spirit of `dioxus-bulma`: each CSS component is
a Rust component, each modifier an enum variant, and each binding behaviour Rust event
handling over the pure model crates the WASM layer already uses. The design is in
[docs/DESIGN.md](docs/DESIGN.md), the per-component API in
[docs/COMPONENTS.md](docs/COMPONENTS.md), the accessibility enforcement and compliance tools
in [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md), and the order of work in
[docs/PLAN.md](docs/PLAN.md).

The CSS is the source of truth. This layer emits the markup the CSS expects and nothing
else.

---

## Non-negotiable invariants

Each is enforced by a test, a lint, or the compiler. If a change needs to break one, stop
and raise it.

1. **No `unsafe`.** `#![forbid(unsafe_code)]` at the top of every crate, and
   `unsafe_code = "forbid"` in the workspace lints. `forbid` cannot be overridden by an inner
   `allow`, which is the point. This includes FFI casts: use checked `dyn_into`, never
   `unchecked_into` or `transmute`.
2. **No panics on consumer input.** No `unwrap`, `expect`, `panic!`, `unreachable!`, or
   slice indexing in library code; clippy's `unwrap_used`, `expect_used`, `panic`, and
   `indexing_slicing` are `deny` outside tests. Bad input renders the documented empty or
   error state and reports in debug builds.
3. **Never emit a class the CSS does not define.** The coverage test parses the CSS and
   fails on an unknown `fc-` class as well as on a missing one.
4. **Never author CSS here.** No stylesheet, `style` rule, or colour is written in Rust or
   in this crate. The one exception is the generated copy of the CSS library's own build
   output in `assets/` (rule 5), which the crate must carry to publish and which is never
   edited. The only inline styles allowed are the custom properties the CSS reads from
   markup (`--fc-slider-pct`, `--fc-progress-value`, `--fc-split-size`), set through a
   typed helper.
5. **`crates/fc-dioxus/assets/` is generated.** Never edit it by hand; run
   `npm run build:dioxus-assets`. A test fails when it differs from a fresh CSS build.
6. **One declaration per modifier.** Every modifier enum goes through `fc_modifier!`.
   Every `data-fc-*` attribute goes through `FcData` or a typed component-specific helper.
   No component spells an `fc-` class or a `data-fc-` name in a string literal outside its
   `Bem` constant.
7. **Logic lives in the model crates, not in components.** Selection, typeahead,
   filtering, ranges, diffs, git status, and text offsets come from `fc-select`,
   `fc-context-menu`, `fc-grid`, `fc-diff`, `fc-git`, `fc-model`, and `fc-rich-text`. A
   component that reimplements one of them is a review failure.
8. **A Rust port of TypeScript logic ships with a parity test** against the TypeScript, in
   the style of `tests/wasm.test.ts`. Two implementations without one will drift, and the
   root file calls a divergence between paths the worst bug this system can have.
9. **Accessibility requirements are types where they can be.** A control whose name cannot
   come from visible children takes a required `AccessibleName`. Images take `Alt`, which
   has no default. A new component that makes an inaccessible use compile is not done. See
   [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md#layer-1-types).
10. **Every component example passes `fc-a11y` at AA with zero errors**, and its markup
    matches its `data-fixture` section in `demo/fixtures.html` structurally.
11. **Never enable the `bare` feature** of a model crate. It is for `build:wasm` alone; the
    two panic handlers collide in any build that includes std.
12. **Never put a secret, token, or free-form user value in an attribute.** `FcData` has no
    free-form field for this reason. Do not add one.

---

## Rust conventions

- **Edition and MSRV** follow the workspace `Cargo.toml`. Dioxus is pinned to one minor
  version; upgrading it is its own pull request.
- **Workspace lints** (added in Phase 0, inherited with `[lints] workspace = true`):

  ```toml
  [workspace.lints.rust]
  unsafe_code = "forbid"
  missing_docs = "deny"
  unreachable_pub = "warn"

  [workspace.lints.clippy]
  pedantic = { level = "warn", priority = -1 }
  unwrap_used = "deny"
  expect_used = "deny"
  panic = "deny"
  indexing_slicing = "deny"
  todo = "deny"
  dbg_macro = "deny"
  ```

  The existing model crates adopt these as they are touched; they are not rewritten for
  lints alone.
- **Public types derive what they can**: `Debug`, `Clone`, `PartialEq`, and `Eq`, `Hash`,
  `Copy`, `Default` where they make sense. Enums that mirror a CSS vocabulary are
  `#[non_exhaustive]` so the CSS library can add a variant without a breaking release.
- **Newtypes over strings** for anything with rules: `AccessibleName`, `Id`, `Percent`,
  `Timestamp`, `Date`. Validation happens once, in the constructor.
- **Errors** are enums implementing `std::error::Error`. No `Box<dyn Error>` in public APIs,
  no `anyhow` in library crates.
- **Dependencies** are a cost. A new one is justified in the pull request description by
  what it replaces and what it adds to compile time and binary size. Dioxus, `dioxus-ssr`
  (dev), `web-sys` (feature `web`), and the workspace's own crates are the expected set.
  `fc-a11y` and `fc-tokens` depend on no part of Dioxus.
- **Comments explain why**, as the root file requires. Every public item has a doc comment;
  doc examples compile (`cargo test --doc`).

## Dioxus conventions and gotchas

- **Props are `Clone + PartialEq`**, as memoization requires. Pass large data as
  `ReadSignal<T>` or `Rc<T>`, never a `Vec` that is cloned and compared on every render.
- **Hooks run unconditionally and in order.** No hook inside an `if`, a loop, or an early
  return. `use_id` in particular must be called the same number of times on server and
  client, or hydration ids disagree.
- **Never touch the DOM during render.** Focus, scroll, `showModal`, and popovers happen in
  event handlers or `onmounted`, through `MountedData` or `DomBridge`.
- **`document::eval` never interpolates data into script text.** Send data through the
  eval channel. Script built with `format!` is an injection waiting for a component that
  passes user text.
- **Spread consumer attributes first**, so the component's own `role` and `aria-*` win. A
  consumer adds attributes; it does not silently remove the component's semantics.
- **Events carry domain values** (`EventHandler<String>` for a select), not raw DOM events,
  except on thin native wrappers like `Button`.
- **No component reads `window`, `document`, or `web_sys` directly.** Everything platform
  specific goes through `core::platform`, so desktop and SSR keep working.

---

## Commands

These are added in Phase 0 of [docs/PLAN.md](docs/PLAN.md); until then the crates do not
exist.

```bash
cargo test -p fc-dioxus -p fc-a11y -p fc-tokens   # unit, parity, coverage, a11y
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p fc-a11y -- check demo/fixtures.html   # audit the CSS library's fixtures
npm run build:dioxus-assets                         # sync dist/ CSS into the crate
dx serve --example fixtures                         # the Dioxus fixture app
npm run check                                       # the gate; runs all of the above
```

`npm run check` stays the single gate. Never report a task complete with it failing, and
never weaken a test, rule, or lint to make it pass.

Cloud sessions need the root environment setup (the `wasm32-unknown-unknown` target,
`wasm-bindgen-cli` 0.2.118, and Chromium symlinked for the browser suite) plus the
`dioxus-cli` matching the pinned Dioxus version for `dx`.

---

## How to add things

### A component

1. Read the CSS file, its `data-fixture` section, and its section in the root
   `docs/COMPONENTS.md`. The Rust API covers every class, modifier, element, and state
   attribute there.
2. Write or update its entry in [docs/COMPONENTS.md](docs/COMPONENTS.md) first. The API is
   reviewed as a document before it is code.
3. One module in `src/components/`, named after the CSS file. Declare its `Bem` constant
   and its modifier enums with `fc_modifier!`.
4. Build from the shared pieces: `Availability`, `FcData`, `use_id`, `use_controllable`,
   `Clipped`, `behavior::*`. If a piece is missing, add it to `core` or `behavior` for
   everyone rather than inline for one component.
5. Render the native element the fixture uses, the stylesheet asset, and every state the CSS
   styles.
6. Add an example per fixture state under `examples/fixtures/`, the markup parity test, and
   the a11y assertion. Remove the component from the coverage test's pending list.
7. Add keyboard scripts to the browser suite for anything interactive.
8. `npm run check`.

### An accessibility rule

Rules live in `crates/fc-a11y/src/rules/`. Every rule:

- cites the WCAG success criteria it checks, or none if it is a project rule;
- picks its severity honestly: `Error` only for a definite failure;
- has a test with a violation it must catch **and** a legitimate pattern it must not flag;
- has a `help` text that says how to fix it, naming the `fc-dioxus` component that does it
  correctly where there is one.

A rule without a false-positive test will be switched off by the first team it annoys.

### A Rust port of TypeScript logic

Put it in the model crate where it belongs, or a new pure crate following the Phase A
pattern (primitives at the boundary, a `bindgen` feature, a size budget), and add the
parity test before wiring it into a component.

---

## Review checklist

- [ ] No `unsafe`, no panicking calls, clippy clean.
- [ ] Every class and state the CSS defines for this component is reachable from props.
- [ ] No class, colour, or style the CSS does not define.
- [ ] Required names are required in the type, not documented as required.
- [ ] Markup parity, a11y, and coverage tests pass; keyboard scripts exist for interactive
      components.
- [ ] Logic comes from a model crate or a shared `behavior` module.
- [ ] Docs in `docs/COMPONENTS.md` match the code in the same commit.

## Current state

Design only. The documents in `docs/` describe the target; no crate in this directory
compiles yet. Phase 0 of [docs/PLAN.md](docs/PLAN.md) is next.
