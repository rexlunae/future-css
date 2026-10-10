# fc-dioxus design

A Dioxus component library over future-css, in the spirit of `dioxus-bulma`: every
CSS component becomes a typed Rust component, every modifier becomes an enum variant or
a field, and every behaviour the TypeScript bindings provide is reimplemented as Rust
event handling over the same pure models the WASM layer already uses.

This document is the architecture. [COMPONENTS.md](COMPONENTS.md) is the per-component
API, [ACCESSIBILITY.md](ACCESSIBILITY.md) is the enforcement and compliance tooling, and
[PLAN.md](PLAN.md) is the order the work happens in.

---

## Goals

1. **Full coverage.** Every component file in `src/css/components/`, every layout
   primitive, type role, and utility in `src/css/` has a Rust API, and every modifier,
   element, and state attribute in those files is reachable from it. Coverage is
   checked by a test, not by reading this document (see [Coverage is a test](#coverage-is-a-test)).
2. **The CSS stays the source of truth.** The Rust layer emits the markup the CSS
   expects. It never restyles, never adds a class the CSS does not define, and never
   ships its own stylesheet.
3. **Accessible by construction.** An inaccessible use is a compile error where the
   type system can express it, a debug-build report where it cannot, and an audit
   failure in CI either way. See [ACCESSIBILITY.md](ACCESSIBILITY.md).
4. **DRY.** A modifier, a state value, a keyboard contract, or a piece of selection
   logic exists once. Components compose shared pieces; they do not each carry a copy.
5. **Idiomatic, safe Rust.** `#![forbid(unsafe_code)]` in every crate. No panics on
   consumer input. Public types implement the standard traits they can. Clippy clean
   at `pedantic`.

## Non-goals

- **Not a port of the TypeScript bindings.** The bindings mutate DOM they did not
  render. In Dioxus the virtual DOM owns the markup, so a second controller would
  fight it. Behaviour is reimplemented as Dioxus state and handlers, sharing the
  *logic* (the Rust models), not the DOM code.
- **Not a new visual language.** No component here has an appearance the CSS library
  does not already have. A visual gap is fixed in the CSS library first.
- **Not a Dioxus-native (Blitz) first library.** Web, desktop (webview), and SSR or
  fullstack are the supported renderers. Blitz is best-effort until it supports the
  top layer, popovers, and `<dialog>`.

---

## Crates

Three new crates join the workspace. Dependencies point downward only, as the root
`Cargo.toml` already requires.

```
fc-tokens      generated from dist/tokens.json; token names, values, contrast pairs
    ^
fc-a11y        rule engine and CLI; knows HTML and WCAG, not Dioxus
    ^
fc-dioxus      the components; depends on fc-tokens, the model crates, and
               (dev only) fc-a11y for its tests

fc-select  fc-context-menu  fc-grid  fc-diff  fc-git  fc-model  fc-rich-text
    ^ used as plain Rust libraries, with their wasm-bindgen glue feature-gated off
```

| Crate | Purpose | Depends on Dioxus |
| --- | --- | --- |
| `fc-tokens` | Typed token names (`Token::ColorTextDefault`), the `var()` string for each, light, dark, and high-contrast values, and the contrast pairs. Generated, checked in, drift-tested. | No |
| `fc-a11y` | Accessibility rule engine over an HTML tree, WCAG mapping, reporters (human, JSON, SARIF), the `fc-a11y` CLI, and the manual review ledger. | No |
| `fc-dioxus` | Components, hooks, behaviours, and the debug-build audit hooks. | Yes |

`fc-a11y` deliberately does not depend on Dioxus. A compliance checker that only
works on one framework's output is a framework feature, not a compliance tool; this
one audits any HTML, including the existing `demo/fixtures.html`, and so also checks
the CSS library's own reference markup.

### Reusing the model crates natively

`fc-select`, `fc-context-menu`, `fc-grid`, `fc-diff`, `fc-git`, `fc-model`, and
`fc-rich-text` already hold the pure logic behind the WASM modules: typeahead,
filtering, roving movement, range selection, diffing, status ordering, and UTF-16
text ranges. `fc-dioxus` uses them directly as Rust dependencies. That is the largest
single DRY win available: the same code answers the same question on every path, and
the existing WASM/JS parity tests already pin its behaviour.

One change in those crates makes this work. Their `#[wasm_bindgen]` glue moves behind
a default-on `bindgen` feature, and `fc-dioxus` depends on them with
`default-features = false`. Without the gate, a Dioxus web build would link every
exported JS shim into the application's binary, and a native build would carry
`js-sys` for nothing. `npm run build:wasm` keeps building with the feature on, so the
shipped modules and their size report are unchanged. `fc-core`'s panic hook and
`js-sys` use go behind the same feature.

The `bare` (`no_std`) feature is never enabled by `fc-dioxus`. The two-panic-handler
collision described in the root AGENTS.md applies to any build that mixes it with std.

### Where pure logic lives when no crate has it yet

Some binding behaviour exists only in TypeScript today: calendar math
(`datepicker.ts`), sort comparison (`table.ts`), toast queueing (`toast.ts`), Markdown
(`markdown.ts`), and syntax highlighting (`highlight.ts`). The rule:

- **Small and Dioxus-shaped** (toast queue, sort comparator, roving focus): a pure
  module in `fc-dioxus::behavior`, unit-tested in Rust.
- **Substantial and useful to both sides** (calendar, Markdown, highlighting): a new
  pure crate in the workspace, following the Phase A pattern (primitives at the
  boundary, size budget, `bindgen` feature), with a parity test against the
  TypeScript implementation in the style of `tests/wasm.test.ts`. A Rust port with no
  parity test is two implementations that will drift, which the root AGENTS.md calls
  the worst bug this system can have.

---

## Module layout of `fc-dioxus`

```
src/
  lib.rs              #![forbid(unsafe_code)], re-exports, prelude
  prelude.rs          components, enums, hooks; what `use fc_dioxus::prelude::*` brings
  core/
    class.rs          Bem, ClassList, the Modifier trait, fc_modifier! macro
    attrs.rs          FcData (the dual-audience contract) and its attribute rendering
    id.rs             Id newtype and use_id(), deterministic across SSR and hydration
    state.rs          Lifecycle, MessageRole, Availability, Orientation, Tone, HeadingLevel
    text.rs           AccessibleName, Alt, Clipped<T> (truncation that is always declared)
    controlled.rs     use_controllable(): one controlled/uncontrolled pattern for all
    platform.rs       DomBridge: showModal, popovers, focus, scroll; web-sys and eval impls
    assets.rs         stylesheet assets, one per CSS file
  behavior/
    roving.rs         roving tabindex and arrow keys, RTL-aware, shared by 12 components
    typeahead.rs      thin adapter over fc-select / fc-context-menu typeahead
    dismiss.rs        Escape, light dismiss, focus return
    live.rs           polite and assertive announcers with rate limiting
    batch.rs          frame-throttled view over a growing Vec or String signal (Terminal, StreamingText)
    sort.rs           table sort comparator (port of table.ts, parity-tested)
    toast_queue.rs    max, timeout, and pause-on-hover policy (port of toast.ts)
  a11y/
    debug.rs          debug-build checks and the report sink (see ACCESSIBILITY.md)
    overlay.rs        AuditOverlay component, feature `dev-audit`
  layout/             Stack, Cluster, Center, Container, Sidebar, GridAuto, ScrollX ...
  typography/         Text, Heading, Kbd, Bdi
  components/         one module per CSS component file, named after it
  theme.rs            FutureCss root, ThemeProvider, use_theme()
  testing.rs          feature `testing`: render_to_html(), assert_accessible()
```

One module per CSS file, named after it (`components/button.rs` for `button.css`), so
the coverage test can map files to modules mechanically and a reviewer can always find
the Rust for a stylesheet.

---

## The shared building blocks

These are the pieces every component is built from. A component that reimplements one
of them is a review failure.

### Classes: `Bem`, `ClassList`, and `fc_modifier!`

```rust
/// A BEM block. `const` so every component declares its block once, at compile time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Bem(&'static str);

impl Bem {
    pub const fn new(block: &'static str) -> Self { Self(block) }
    pub const fn block(self) -> &'static str { self.0 }
    /// `fc-card__header`
    pub fn element(self, element: &str) -> String { /* ... */ }
    /// `fc-card--elevated`, or nothing for a modifier that renders the bare block.
    pub fn modifier<M: Modifier>(self, m: M) -> Option<String> { /* ... */ }
}

/// Implemented by every modifier enum. `None` means "the bare block".
pub trait Modifier: Copy + Eq + Default + core::fmt::Debug {
    fn suffix(self) -> Option<&'static str>;
}

/// Builds a class attribute without allocating per token.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ClassList(String);

impl ClassList {
    pub fn new(base: &str) -> Self;
    pub fn with(self, class: impl AsRef<str>) -> Self;
    pub fn with_if(self, cond: bool, class: impl AsRef<str>) -> Self;
    pub fn with_modifier<M: Modifier>(self, bem: Bem, m: M) -> Self;
    /// Consumer classes go last, so they read as additions in devtools.
    pub fn extend(self, extra: Option<&str>) -> Self;
}
```

Every modifier enum is declared through one declarative macro, so the enum, its
`Default`, its `Modifier` impl, `Display`, `FromStr`, and the list of every variant
the coverage test reads all come from a single declaration:

```rust
fc_modifier! {
    /// Emphasis of a button. `Neutral` renders the bare `.fc-btn`.
    pub enum ButtonVariant for "fc-btn" {
        #[default] Neutral => None,
        Primary   => "primary",
        Secondary => "secondary",
        Ghost     => "ghost",
        Subtle    => "subtle",
        Danger    => "danger",
    }
}
```

It is `macro_rules!`, not a procedural macro: a proc-macro crate is a build dependency
with its own compile cost, and nothing here needs one.

**Why per-component enums rather than one shared `Size`.** Sizes differ by component:
buttons have `sm` and `lg`, avatars and spinners `xs` through `xl`, progress only `sm`.
A shared `Size` would let `Button { size: Size::Xl }` compile and silently render the
default. The type should only offer what the CSS defines, so each component declares its
own enum through the macro, and the macro makes that a one-line cost rather than a
duplicated impl.

### The dual-audience contract: `FcData`

The root AGENTS.md defines the `data-fc-*` attributes. One struct renders them, so no
component spells an attribute name by hand:

```rust
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FcData {
    pub kind: Option<&'static str>,   // set by the component, never by the consumer
    pub id: Option<String>,           // mirrors the runtime id
    pub seq: Option<u64>,             // monotonic ordering
    pub role: Option<MessageRole>,
    pub state: Option<Lifecycle>,
    pub ts: Option<Timestamp>,        // epoch ms or validated ISO-8601
    pub truncated: bool,              // set by Clipped<T>, never by hand
}

impl FcData {
    pub fn attributes(&self) -> Vec<Attribute>;
}
```

Components with dynamic data take `id`, `seq`, and `ts` props and fill `kind`, `role`,
`state`, and `truncated` themselves. Styling never reads them (the contract says it must
not), so a component renders correctly with all of them absent.

**Secrets.** `FcData` has no free-form field. The values are an id, an integer, two
enums, a timestamp, and a boolean, so there is nowhere to put a token. Component-specific
attributes (`data-fc-provider`, `data-fc-model`) are typed the same way.

### Shared enums

| Type | Variants | Rendered as |
| --- | --- | --- |
| `Lifecycle` | `Pending`, `Queued`, `Streaming`, `Running`, `Complete`, `Aborted`, `Denied`, `Error` | `data-fc-state` |
| `MessageRole` | `User`, `Assistant`, `System`, `Tool` | `data-fc-role` |
| `Tone` | `Info`, `Success`, `Warning`, `Danger` | `--info` etc. on alert, toast |
| `Orientation` | `Horizontal`, `Vertical` | `aria-orientation` |
| `HeadingLevel` | `H1` to `H6` | the heading element for a component's title |
| `Availability` | `Enabled`, `Disabled`, `Unavailable { reason: Id }` | see below |

Component-specific state sets stay component-specific: git status (`added`, `modified`,
`deleted`, `renamed`, `untracked`, `conflicted`), terminal (`complete`, `disconnected`,
`error`), editor (`saving`, `error`), webview security. Folding them into `Lifecycle`
would let a git row claim it is `streaming`.

**`Availability` encodes the button doc's disabled decision.** The CSS documents two
kinds of unavailable: `disabled` removes the control; `aria-disabled="true"` keeps it
focusable so the reason is discoverable, and is the recommended default. The enum makes
the second kind carry its reason:

```rust
pub enum Availability {
    #[default] Enabled,
    /// Meaningless in this state. Removed from the tab order.
    Disabled,
    /// Unavailable right now. Stays focusable; `reason` is the id of visible text
    /// explaining why, rendered as `aria-describedby`.
    Unavailable { reason: Id },
}
```

`aria-disabled` alone does not stop activation, so every component that accepts
`Availability` also drops its own event handlers while `Unavailable`. That check lives in
one helper, `Availability::guard(handler)`, so no component forgets it.

### Accessible names: `AccessibleName`, `Alt`, `Label`

```rust
/// A non-empty, trimmed name, so a control can never be given the name "".
pub struct AccessibleName(Cow<'static, str>);
/// Runtime text (translations, user data): fails on an empty or whitespace string.
impl TryFrom<String> for AccessibleName { /* ... */ }
/// Literals, so `label: "Close"` works in `rsx!` through `#[props(into)]`. An empty
/// literal is a debug assertion and an `fc-a11y` error rather than a type error,
/// because `From` cannot fail; runtime text has no such path.
impl From<&'static str> for AccessibleName { /* ... */ }

/// Image alternatives. There is no default: the author must choose.
pub enum Alt {
    Text(AccessibleName),
    /// Purely decorative: renders alt="" (images) or aria-hidden="true" (icons).
    Decorative,
}
```

Components whose name cannot come from visible children take a required
`label: AccessibleName` prop. Icon-only buttons are a separate component (`IconButton`)
with a required label rather than a `Button` with an optional `aria_label`, because a
required prop is a compile error when missing and an optional one is a bug report.

### Truncation: `Clipped<T>`

```rust
/// Text that may be shown shortened. Holding the full value is not optional.
pub struct Clipped { full: String, shown: ClipMode }
pub enum ClipMode { Full, Lines(u8), Chars(usize) }
```

A component that shortens text takes `Clipped`, which sets `data-fc-truncated="true"`
whenever the shown text differs from the full text and keeps the full value reachable
(expandable body, or `title` plus an accessible description). No component accepts a
pre-shortened `String` where truncation is possible.

### Controlled and uncontrolled state: `use_controllable`

Every stateful component (open, selected, value, expanded, active cell) supports both
modes with one hook rather than a hand-written pair of code paths each:

```rust
pub fn use_controllable<T: Clone + PartialEq + 'static>(
    value: Option<ReadSignal<T>>,     // controlled when Some
    default: impl FnOnce() -> T,      // initial value when uncontrolled
    on_change: Option<EventHandler<T>>,
) -> Controllable<T>;

impl<T> Controllable<T> {
    pub fn get(&self) -> T;
    /// Requests a change. Uncontrolled: stores and notifies. Controlled: only notifies;
    /// the owner decides.
    pub fn set(&self, next: T);
}
```

Naming is uniform across the library: `value` / `default_value` / `onchange` for values,
`open` / `default_open` / `onopenchange` for disclosure-like state.

### Ids: `use_id`

ARIA relationships (`aria-labelledby`, `aria-describedby`, `aria-controls`,
`aria-activedescendant`) need ids that are unique and that match between server render
and hydration. `use_id()` takes the next value from a counter held in the `FutureCss`
root context, so the same tree yields the same ids on both sides. A consumer-supplied
`id` always wins. Duplicate ids are a debug-build report and an `fc-a11y` error.

### Compound components and context

Components with parts follow the `dioxus-bulma` compound pattern (`Card { CardHeader {}
CardBody {} }`), with convenience props for the common case (`Card { title: "..." }`).
Where parts must coordinate (tabs and their panels, a listbox and its options, a menu and
its items), the parent provides a typed context and the parts read it. Coordination never
goes through the DOM.

### Platform bridge: `DomBridge`

A few behaviours need the browser rather than the virtual DOM: `showModal()` and
`close()` on `<dialog>`, `showPopover()` and `hidePopover()`, focusing a specific node,
and `scrollIntoView`. They go through one trait with two implementations:

```rust
pub trait DomBridge {
    fn show_modal(&self, id: &Id) -> Result<(), DomError>;
    fn close_dialog(&self, id: &Id) -> Result<(), DomError>;
    fn toggle_popover(&self, id: &Id, open: bool) -> Result<(), DomError>;
    fn focus(&self, id: &Id) -> Result<(), DomError>;
    fn scroll_into_view(&self, id: &Id, block: ScrollBlock) -> Result<(), DomError>;
}
```

- **`web` feature:** `web-sys`, via `MountedData::as_web_event()` and checked
  `dyn_into` casts. No `unsafe`, no `unchecked_into`.
- **Everything else (desktop, liveview):** `document::eval` with a fixed script and the
  id passed as data, never interpolated into the script text.

Focus that Dioxus can do itself (`MountedData::set_focus`) uses Dioxus, not the bridge.
Overlays render the platform elements first (`<dialog>`, `popover`, `<details>`), so with
no script at all, as under SSR before hydration, they still work the way the CSS library's
no-JS fallback documents.

### Styles: one stylesheet per component

```rust
// core/assets.rs, generated by the sync script
pub const BUTTON_CSS: Asset = asset!("/assets/components/button.css");
```

Each component renders `document::Stylesheet { href: BUTTON_CSS }` once (Dioxus
deduplicates by href), and the `FutureCss` root loads the layer order, tokens, reset,
base, layout, type, and utilities. A page therefore downloads only the components it
renders, which is the per-page budget `tests/budget.test.ts` already enforces for the CSS
library. Manganis drops assets that no compiled code references, so unused components cost
nothing.

The CSS files are copied from `dist/` into `crates/fc-dioxus/assets/` by
`npm run build:dioxus-assets`, committed (a published crate must contain its assets), and
a test fails when the committed copy differs from a fresh `npm run build:css`. The copy is
never hand-edited.

Consumers who already load `future-css.css` themselves set `FutureCss { stylesheets:
Stylesheets::External }` and the components emit no stylesheet links.

### Theme

```rust
#[component]
pub fn FutureCss(
    #[props(default)] theme: Theme,           // System, Light, Dark, HighContrastLight, HighContrastDark
    #[props(default)] brand: Option<Brand>,   // data-fc-brand, e.g. Brand::Forest
    #[props(default)] direction: Option<Direction>, // Ltr, Rtl, or inherit
    #[props(default)] stylesheets: Stylesheets,
    children: Element,
) -> Element;

pub fn use_theme() -> ThemeHandle; // read and switch at runtime
```

`Theme` renders `data-fc-theme` on the root wrapper and never on `<html>` by default,
so two themed regions can coexist. `Theme::System` renders no attribute and lets
`prefers-color-scheme` decide.

---

## Component API conventions

Every component follows these, so the API is guessable from one example.

1. **`#[component]` functions with a `Props` struct**, documented with `///` on every
   field, because rustdoc is the reference and `#![deny(missing_docs)]` enforces it.
2. **Attribute spreading.** Every component takes
   `#[props(extends = GlobalAttributes)] attributes: Vec<Attribute>` (plus the element's
   own attributes where it is a single native element, such as `extends = button`), so a
   consumer can add `id`, `aria-*`, `data-*`, or a class without a new prop. Spread
   attributes are applied before the component's own ARIA, so a consumer cannot
   accidentally clear `role` or `aria-expanded`; consumer `class` is appended, never
   replaces.
3. **Native element first.** A component renders the element the CSS fixture uses:
   `<button>`, `<dialog>`, `<details>`, `<input type=range>`, `<table>`. A `div` with a
   role is used only where the CSS library itself does (the select listbox, the grid).
4. **Events are `EventHandler<T>` with domain types**, not raw DOM events, where the
   component has a domain value: `onchange: EventHandler<String>` on a select,
   `onsort: EventHandler<(usize, SortDirection)>` on a table. Raw events are passed
   through only where the component is a thin native element (`Button::onclick`).
5. **No panics.** Out-of-range input (a selected index past the end, an empty option list,
   an invalid date) renders the documented empty or error state and emits a debug-build
   report.
6. **`Clone + PartialEq` props**, as Dioxus memoization requires. Large data (grid cells,
   diff text, terminal lines) is passed as `ReadSignal<T>` or `Rc<T>` so comparison is
   cheap.
7. **Every state the CSS styles is reachable from a prop**, including loading, error,
   `aria-invalid`, and `aria-busy`. A state only reachable by spreading raw attributes is a
   coverage gap.

## Behaviour: shared keyboard contracts

The TypeScript bindings each implement their keyboard handling. In Rust it is shared:

| Behaviour | Module | Used by |
| --- | --- | --- |
| Roving tabindex, arrows, Home/End, wrap, RTL swap | `behavior::roving` | tabs, toolbar, segmented, button group, list, menu, nav, navbar, datepicker grid, carousel, select list, grid |
| Typeahead | `behavior::typeahead` over `fc-select` / `fc-context-menu` | select, menu, list |
| Escape, light dismiss, focus return | `behavior::dismiss` | dialog, popover, menu, select, split button, FAB menu, search view |
| Polite and assertive announcements, rate limited | `behavior::live` | toast, composer status, agent status, tool call, table sort, grid edit |

`roving` reads `Direction` from context: in RTL, ArrowLeft moves to the *next* item,
because "next" is the reading direction. That rule exists once, so no component can get
it backwards.

## Testing strategy

| Layer | What it proves | Tool |
| --- | --- | --- |
| Unit | class building, enum rendering, behaviour state machines | `cargo test` |
| Markup parity | each component renders the structure its `data-fixture` section uses | `cargo test`, `dioxus-ssr`, structural comparison |
| Accessibility | every rendered fixture passes `fc-a11y` at AA with zero errors | `cargo test` via `fc_dioxus::testing::assert_accessible` |
| Coverage | every class, modifier, and state attribute in the CSS is emitted by some component | `cargo test` (below) |
| Model parity | Rust ports of TypeScript logic agree on every case | `npm test`, as `tests/wasm.test.ts` does |
| Browser | keyboard contracts, focus, top-layer behaviour, axe-core | headless Chrome against the Dioxus fixture app |

**Markup parity.** For each `data-fixture` section in `demo/fixtures.html` there is a Rust
example rendering the same states. The test renders it with `dioxus-ssr` and compares a
structural signature (element names, `fc-` classes, `role`, `aria-*`, `data-fc-*`) with the
fixture's, ignoring text and ids. If the CSS library changes a component's markup, the
Rust test fails, which is the point: the two cannot drift silently.

### Coverage is a test

`tests/coverage.rs` parses every `.fc-*` class and every `[data-fc-*=…]` and
`[aria-*=…]` selector from the CSS sources (the same extraction the root linter uses),
renders every component example, and fails listing any class or state value no example
emits, and any `fc-` class an example emits that the CSS does not define. An intentional exclusion (a class used only internally by the CSS, such as
`.fc-term-ansi-*` being produced by the terminal's ANSI parser rather than a prop) is
listed in `coverage-exclusions.toml` with its reason. This is how "full coverage of the
widgets, with all their options" stays true after the CSS library grows.

## Versioning and compatibility

- `fc-dioxus` versions independently of the CSS package but pins the CSS it was tested
  against: the vendored assets carry the CSS package version, and `FutureCss` renders it
  as `data-fc-version` for diagnosis.
- Dioxus is pinned to one minor version (0.7 at the time of writing). A Dioxus upgrade is
  its own pull request.
- MSRV follows the workspace (`rust-version = "1.82"`) unless the pinned Dioxus requires
  newer; the plan's Phase 0 verifies this before any component is written.
