# future-css

**A styling system for multi-language, multi-platform systems.**

A CSS design system built on three commitments: semantic HTML first, accessibility
that is enforced rather than aspirational, and correct behavior in every language and
writing direction by default rather than by add-on.

```css
@import "future-css";
```

That single import gives you the tokens, the element defaults, the layout primitives,
the components, and the utilities. Dark mode follows the operating system with no
JavaScript. Right-to-left languages work without a second stylesheet. Nothing ships as
an opaque blob — it is readable CSS you can debug in devtools.

---

## Status

**Pre-alpha.** Foundations are built and enforced: the token pipeline, the cascade
architecture, the reset and base layers, the layout primitives, the linter, the
accessibility contract, and an optional Rust/WASM layer.

Seven components are complete: button, chat surface, tool call / step trace, rich text
editor, context menu, data grid, and embedded browser chrome. Form controls, dialogs, and
navigation are planned but not yet written, and the complex components are CSS only so
far -- their browser bindings come next. See [the development plan](docs/PLAN.md) for
what is done, what is next, and what is deliberately out of scope.

---

## Two audiences

This is a general-purpose framework, and its output is consumed by two kinds of reader:
people, and machines.

- **Humans** get semantic HTML, visible focus, verified contrast, and correct behavior
  under every OS accessibility setting.
- **Machines** — automation, instrumentation, and agent runtimes — get the same DOM as
  a data interface. Components that render dynamic data expose it as attributes
  (`data-fc-state`, `data-fc-role`, `data-fc-seq`, `data-fc-truncated`, …) so state is
  never something a consumer has to infer from pixels.

Those attributes are additive: styling never depends on them, so a component with no
machine consumer attached renders identically for a person. The contract is documented
in [PRINCIPLES.md §10](docs/PRINCIPLES.md#10-two-audiences-one-dom) and in
[AGENTS.md](AGENTS.md).

---

## Design principles

The full rationale is in [docs/PRINCIPLES.md](docs/PRINCIPLES.md). In short:

1. **Semantic HTML carries meaning; CSS carries appearance.** Style the real element.
   A `<button>` is already focusable, keyboard-activatable, and correctly announced.
   Reaching for a `<div role="button">` throws all of that away.
2. **Accessibility is a build failure, not a review comment.** Contrast ratios, ramp
   integrity, and focus behavior are declared as contracts and checked in CI.
3. **Logical properties everywhere.** `margin-inline-start`, not `margin-left`. This
   makes RTL support a property of the architecture rather than a maintenance burden.
4. **Tokens are the only source of color.** A raw hex value is a lint error, because
   it cannot be themed and cannot be contrast-checked.
5. **Follow the user's environment.** `prefers-color-scheme`, `prefers-reduced-motion`,
   `forced-colors`, and `color-scheme` are the defaults, not enhancements.
6. **Layers over specificity.** The cascade is managed by `@layer` order, so there are
   no specificity wars to win and no `!important` to deploy.
7. **Tokens are authored in TypeScript,** which makes contrast and naming rules
   executable rather than aspirational.

---

## Contributing

If you are an autonomous or semi-autonomous contributor, read
**[AGENTS.md](AGENTS.md)** first. It states the invariants that are enforced by
`npm run check`, the DOM contract for dynamic components, and the rules for adding
tokens, components, and lint rules.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [AGENTS.md](AGENTS.md) | **Working here?** Invariants, DOM contract, contribution rules |
| [PLAN.md](docs/PLAN.md) | **Start here.** Roadmap, phased milestones, exit criteria |
| [SEMANTIC-COVERAGE.md](docs/SEMANTIC-COVERAGE.md) | What ten reference libraries mean by "semantic", and what we ship against it |
| [PRINCIPLES.md](docs/PRINCIPLES.md) | The design principles and the reasoning behind them |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Cascade layers, the token pipeline, the build |
| [TOKENS.md](docs/TOKENS.md) | Token naming, the primitive→semantic model, theming |
| [COMPONENTS.md](docs/COMPONENTS.md) | Component anatomy, state matrix, contribution guide |
| [WASM.md](docs/WASM.md) | The Rust/WASM layer, module sizing, and the JS-only path |
| [ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | WCAG 2.2 AA commitments and how each is enforced |
| [INTERNATIONALIZATION.md](docs/INTERNATIONALIZATION.md) | Writing direction, text expansion, CJK, RTL playbook |
| [PLATFORMS.md](docs/PLATFORMS.md) | Browsers, embedded webviews, email, and print |
| [CONVENTIONS.md](docs/CONVENTIONS.md) | Class naming, BEM structure, utilities policy |
| [CONTRIBUTING.md](docs/CONTRIBUTING.md) | How to add a component, a token, or a lint rule |

---

## Quick start

```bash
npm install
npm run build     # generate tokens.css and the bundles
npm run check     # build + lint + test
```

Requires Node 22.6+ (the toolchain runs TypeScript directly, with no build step of its
own). There are currently **zero runtime dependencies**.

---

## Usage

### Theming

Dark mode follows the browser by default. To let a user override it, set one attribute:

```html
<html data-fc-theme="dark">   <!-- or "light" -->
```

Because every color token is a `light-dark()` pair, that single attribute re-themes the
entire system. No JavaScript is required for the default behavior; a theme switcher only
needs to persist the choice and set the attribute.

### Components

```html
<button class="fc-btn fc-btn--primary">Save changes</button>
<button class="fc-btn fc-btn--secondary fc-btn--sm">Cancel</button>
<button class="fc-btn fc-btn--danger" disabled>Delete</button>
```

### Layout

```html
<div class="fc-stack fc-stack--4">
  <h2>Billing</h2>
  <div class="fc-cluster fc-cluster--between">
    <span class="fc-truncate">Subscription</span>
    <span class="fc-u-tabular">$24.00</span>
  </div>
</div>
```

### A dynamic, stateful interface

Components that render partially-known data drive their appearance from
`data-fc-state`, so the visual treatment and the machine-readable meaning can
never disagree:

```html
<div class="fc-tool" data-fc-state="running" data-fc-name="search">
  <div class="fc-tool__header">
    <span class="fc-tool__name">search_documentation</span>
    <span class="fc-tool__state">Running</span>
  </div>
  <div class="fc-tool__progress">
    <div class="fc-tool__progress-bar" style="--fc-tool-progress: 42%"></div>
  </div>
</div>
```

The same markup renders correctly with no machine consumer attached — the
attributes are additive, never a requirement.

---

## Repository layout

```
src/
  tokens/          Design tokens authored in TypeScript
    palette.ts       Primitive color ramps (OKLCH)
    semantic/        Semantic aliases: the themable layer
    color-utils.ts   Contrast math and color conversion
  css/             Layered stylesheets (the authored CSS)
    index.css        Layer order declaration
    reset.css        Zero-specificity reset
    base.css         Semantic element defaults
    layout.css       Direction-agnostic layout primitives
    components/
      button.css      Reference component
      chat.css        Conversational surface with lifecycle states
      tool-call.css   Operation trace with a five-state machine
    utilities.css    The escape hatch
  build/           Token compiler and bundle orchestrator
tools/
  lint-css.mjs     Architecture linter (enforces the rules above)
tests/             Contract tests for tokens and linter behavior
docs/              Design documents; PLAN.md is the roadmap
AGENTS.md          Operating instructions for autonomous contributors
```

## License

MIT
