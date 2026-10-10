# Accessibility enforcement and compliance tooling

The target is the CSS library's: **WCAG 2.2 Level AA** (see the root
[docs/ACCESSIBILITY.md](../../../docs/ACCESSIBILITY.md)). This document says how the
Dioxus layer *enforces* it, and what tools it ships so applications built on it can
*check* it.

The governing idea is the root one: a commitment that is not checked does not get done.
The Dioxus layer adds a second idea: **the cheapest check is the one that runs at compile
time**, so every requirement is pushed as far left as it will go.

```
 compile time        debug build            test / CI               browser            release
 ------------        -----------            ---------               -------            -------
 types make the      components report      fc-a11y audits          axe-core and       manual review
 wrong use           what types cannot      rendered HTML; fails    keyboard scripts   ledger feeds a
 unrepresentable     express                the build on errors     on real layout     conformance report
```

Each layer catches what the one before cannot. None replaces the manual pass, which is
why the ledger exists.

---

## Layer 1: types

These requirements are compile errors. A component that could express them in its types
and does not is a review failure.

| Requirement | WCAG | Mechanism |
| --- | --- | --- |
| Icon-only controls have a name | 4.1.2 | `IconButton`, `Fab` (icon-only), `TagRemove`, dialog close: required `label: AccessibleName` |
| A name is never empty | 4.1.2 | `AccessibleName::try_from(String)` rejects empty or whitespace runtime text; an empty literal is a debug assertion and an `fc-a11y` error |
| Images choose an alternative | 1.1.1 | `Alt` has no default: `Alt::Text(..)` or `Alt::Decorative` |
| Form controls have a label | 1.3.1, 3.3.2 | `Field`, `Check`, `Switch`, `Slider`, `Select`, `Search` require `label` (it may be visually hidden, never absent) |
| Groups have a name | 1.3.1 | `CheckGroup` requires `legend`; `ControlGroup`, `Toolbar`, `Tabs`, `Nav`, `Masthead` nav require `label` |
| Dialogs have a title | 4.1.2 | `Dialog` requires `title`, rendered as the `aria-labelledby` target |
| Citations name their source | 2.4.4 | `Cite` requires `source: AccessibleName`; a bare index is not a name |
| Unavailable controls explain why | 3.3.2 (good practice) | `Availability::Unavailable { reason: Id }` cannot be constructed without the reason |
| Truncation is declared | project contract | `Clipped` sets `data-fc-truncated` and keeps the full value; no component takes pre-cut text |
| State values are valid | 4.1.2 | `Lifecycle`, `MessageRole`, `aria-sort`, `aria-current` values are enums, not strings |
| Headings keep the outline | 1.3.1 | titles take `HeadingLevel`, so a card in an `h2` section can render `h3` |
| No secrets in attributes | project contract | `FcData` has no free-form fields |
| No raw colours | 1.4.3, 1.4.11 | no component takes a colour; theming goes through `fc-tokens` and the CSS custom properties |

## Layer 2: debug-build checks

Some requirements depend on values or on the whole tree, not one component's props. In
debug builds (`cfg(debug_assertions)`) components check them and report through
`a11y::debug`. In release builds the checks compile to nothing.

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub rule: RuleId,          // the same ids fc-a11y uses, so reports line up
    pub component: &'static str,
    pub message: String,
    pub wcag: &'static [SuccessCriterion],
}
```

Checks in this layer:

- An `Id` used for `aria-labelledby` or `aria-describedby` that no rendered element has.
- The same `Id` rendered twice.
- A live region announcing more than once per `live::MIN_INTERVAL` (default 1 s). The
  CSS library's contracts say announcements happen at phase boundaries, never per token;
  streaming components route through `behavior::live`, which coalesces, and the check
  catches anything that bypasses it.
- A heading level more than one deeper than the nearest enclosing heading the library
  rendered.
- A selected or active index that is out of range, or points at a disabled item.
- `Tabs` with no selected tab, `Select` with a value matching no option, `Pagination`
  with a current page outside its range.
- A `Table` with more than one sorted column.

Where a report goes is configurable on the `FutureCss` root:

```rust
pub enum AuditMode {
    /// Default in debug builds: `tracing::warn!` with rule, component, and fix.
    Log,
    /// Collect into context for `AuditOverlay` (feature `dev-audit`).
    Overlay,
    /// Panic on the first violation. For tests only.
    Strict,
    Off,
}
```

`AuditOverlay` (feature `dev-audit`) is an in-page panel listing current violations with
the offending element outlined. It renders inside a `<dialog>` so it is itself keyboard
operable, and it audits itself in the library's own tests.

## Layer 3: `fc-a11y`, the rule engine

A standalone crate that audits HTML. It knows nothing about Dioxus, so it audits the
output of any framework, the CSS library's own `demo/fixtures.html`, and server-rendered
pages.

### Shape

```rust
pub struct Document { /* parsed tree, ids indexed */ }

pub struct Audit {
    level: Conformance,            // A, AA (default), AAA
    rules: RuleSet,                // all, or a filtered set
    scope: Scope,                  // Page (expects <html lang>, landmarks) or Fragment
}

impl Audit {
    pub fn run(&self, doc: &Document) -> Report;
}

pub struct Finding {
    pub rule: RuleId,
    pub severity: Severity,        // Error, Warning, Notice
    pub wcag: &'static [SuccessCriterion],
    pub path: NodePath,            // css-like path to the node
    pub snippet: String,           // the opening tag, attributes with values elided past 80 chars
    pub message: String,
    pub help: &'static str,        // how to fix, linking the component doc
}

pub trait Rule: Send + Sync {
    fn id(&self) -> RuleId;
    fn criteria(&self) -> &'static [SuccessCriterion];
    fn check(&self, doc: &Document, out: &mut Vec<Finding>);
}
```

Rules are plain structs implementing `Rule`, registered in one list. Each rule has a test
with a violation it must catch and a legitimate pattern it must not flag, the same
discipline the root AGENTS.md requires of lint rules and for the same reason.

**Severity is a promise.** `Error` is reserved for a definite failure of the cited
criterion. A rule that cannot be sure (a name that exists but may not be meaningful)
reports `Warning`. A best practice with no WCAG criterion reports `Notice`. CI fails on
errors by default; a tool that cries wolf gets disabled.

### Rule catalogue (initial)

| Rule | Checks | WCAG | Severity |
| --- | --- | --- | --- |
| `name-required` | Interactive elements and widget roles have a computed accessible name (text, `aria-label`, `aria-labelledby`, `label[for]`, `alt`). `title` alone is a warning. | 4.1.2 | Error |
| `control-label` | Inputs, selects, textareas, and `role=combobox/slider/switch` have a label; placeholder-only is a failure. | 1.3.1, 3.3.2 | Error |
| `img-alt` | `<img>` has `alt`; `<svg>` is `aria-hidden` or has `role=img` and a name. | 1.1.1 | Error |
| `idref` | `aria-labelledby`, `-describedby`, `-controls`, `-activedescendant`, `-owns`, `label[for]` resolve. | 1.3.1, 4.1.2 | Error |
| `duplicate-id` | Ids referenced by ARIA are unique. | 4.1.2 | Error |
| `aria-valid` | ARIA attributes exist, values are in range, and are allowed on the role. | 4.1.2 | Error |
| `aria-children` | Required owned elements: `listbox > option`, `tablist > tab`, `menu > menuitem*`, `grid > row > gridcell`, `radiogroup > radio`. | 1.3.1 | Error |
| `hidden-focusable` | No focusable element inside `aria-hidden="true"` or `inert`. | 4.1.2 | Error |
| `tabindex-positive` | No `tabindex` greater than 0. | 2.4.3 | Error |
| `dialog-name` | `<dialog>` and `role=dialog/alertdialog` are named. | 4.1.2 | Error |
| `table-headers` | Data tables have `th` headers; one `aria-sort` column at most; a sortable header is a button. | 1.3.1 | Error |
| `heading-order` | No skipped levels. | 1.3.1 | Warning |
| `landmark-names` | Repeated landmarks (two `nav`s) have distinct names. | 1.3.1, 2.4.1 | Error |
| `page-lang` | Page scope: `<html lang>` is present and valid BCP 47. | 3.1.1 | Error |
| `live-region-nesting` | No live region inside another; `aria-live` regions are not also `aria-hidden`. | 4.1.3 | Error |
| `link-purpose` | Links have discernible text; bare "click here" or a lone index is a warning. | 2.4.4 | Warning |
| `color-alone` | `fc-` status components carry visible status text alongside their tone. | 1.4.1 | Error |
| `inline-color` | No colour literal in a `style` attribute: it bypasses the token contrast contract. | 1.4.3, 1.4.11 | Error |
| `fc-state` | `data-fc-state`, `-role`, `-truncated` hold values the contract allows. | project | Error |
| `fc-secrets` | `data-*` values do not look like credentials (high-entropy strings, known key prefixes, JWT shape). | project | Error |
| `aria-disabled-reason` | `aria-disabled="true"` controls have `aria-describedby`. | 3.3.2 | Notice |
| `target-size-static` | Icon-only `fc-btn` uses `fc-btn--icon`, which guarantees the square minimum. Real sizes are measured in layer 4. | 2.5.8 | Warning |

Rules that need layout (contrast on real backgrounds, target size, reflow at 320 px, focus
visibility, focus order) are not attempted statically. Pretending to answer them from
markup would produce findings nobody could trust; layer 4 measures them.

Contrast is not re-checked here at all for token pairs: the token build already refuses to
emit a palette that fails a declared pair, and `fc-tokens` exposes those pairs so reports
can cite them.

### HTML parsing

The engine's rules run over its own small tree type, so they have no parser dependency.
Building that tree from arbitrary HTML needs a spec-compliant parser; the recommendation is
`html5ever` behind an on-by-default `html` feature. Hand-writing an HTML parser for a
compliance tool would be the wrong economy: real pages are not well-formed, and a checker
that parses them differently from browsers audits a document nobody sees. This is a new
dependency and is listed as an open decision in [PLAN.md](PLAN.md#decisions-needed).

### The CLI

```
fc-a11y check <FILE|DIR|->...  [--level a|aa|aaa] [--scope page|fragment]
                               [--format human|json|sarif] [--rules <ids>]
                               [--fail-on error|warning|notice]
fc-a11y rules                  list rules with their criteria and examples
fc-a11y checklist <component>  print the manual review gate for a component
fc-a11y review <ledger.toml>   validate the manual review ledger, list what is stale
fc-a11y report <ledger.toml> --audit <results.json>
                               write a conformance report (Markdown and HTML)
```

- **`check`** exits non-zero when findings at or above `--fail-on` exist. `sarif` output
  makes findings appear inline on pull requests in any SARIF-aware code host.
- **`checklist`** prints the per-component review gate from the root accessibility
  document, specialised to the component (the select prints its full keyboard contract,
  the toast its live-region rule), so a reviewer has the exact list in front of them.

### The manual review ledger

Automated checks cover roughly a third of WCAG. The rest is the manual gate in the root
accessibility document: screen-reader passes, keyboard-only use, 400 % zoom, forced colours,
RTL. Today that gate is a checklist that leaves no record. The ledger makes it a record:

```toml
# a11y-review.toml, committed with the application
[[review]]
component = "select"
version = "0.3.0"              # fc-dioxus version reviewed
date = "2026-11-02"
reviewer = "erica"
checks.screen-reader = { result = "pass", at = ["voiceover-safari", "nvda-firefox"] }
checks.keyboard = { result = "pass" }
checks.zoom-400 = { result = "pass" }
checks.forced-colors = { result = "fail", note = "chevron disappears", issue = "#81" }
```

`fc-a11y review` reports components whose last review predates a change to them, and
checks with no result. `fc-a11y report` combines the ledger with an automated run into a
conformance report per WCAG success criterion (supports, partially supports, does not
support, not applicable), in the shape an Accessibility Conformance Report expects. It
reports what was checked and found; it never infers a pass for a criterion nobody
checked.

## Layer 4: browser

Run in headless Chrome against `examples/fixtures`, a Dioxus app rendering every
component example in every state, mirroring `demo/fixtures.html` and using the same
query parameters (`?dir=rtl`, `?theme=dark`). The harness is the root browser suite's.

- **axe-core**, zero critical or serious findings, in all four direction and scheme
  combinations. (axe-core as a dev dependency is already an open decision for the CSS
  library; the Dioxus suite uses whatever that decision lands on.)
- **Keyboard scripts** per component, generated from the same contract tables
  `behavior::roving` and `behavior::dismiss` implement, so the test and the
  implementation cannot describe different contracts.
- **Measured checks** the static layer leaves out: target size at least 24 by 24 CSS px,
  a visible focus ring on every focusable element (the root suite's forced
  `:focus-visible` check), no horizontal overflow at 320 px, and forced-colors rendering
  that is not blank.

## What applications get

Everything above that is not internal is public API, so an application built on
`fc-dioxus` inherits the tooling rather than only the components:

```rust
// in the application's own tests
use fc_dioxus::testing::{render_to_html, assert_accessible};

#[test]
fn settings_page_is_accessible() {
    let html = render_to_html(rsx! { SettingsPage {} });
    assert_accessible(&html); // fails with the findings, rule ids, and fixes
}
```

Plus `fc-a11y check` in CI over server-rendered pages, `AuditOverlay` during development,
and the ledger for releases.
