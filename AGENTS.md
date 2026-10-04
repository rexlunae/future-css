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
npm run build     # compile tokens, then bundle layers
npm run lint      # architecture linter
npm test          # contract tests
npm run check     # all three; this is the gate
```

The toolchain runs TypeScript directly via Node's type stripping. **Do not add a
transpiler, bundler, or framework dependency to make a change work.** The
zero-dependency property is a feature: the system must stay auditable and cheap
to vendor. If a change seems to need a dependency, that is a signal the change is
too large.

---

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
9. Run `npm run check`.

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
src/build/          Token compiler + bundle orchestrator
tools/lint-css.mjs  Architecture linter
tests/              Contract and linter tests
docs/               Design documents; PLAN.md is the roadmap
```

## Current state

Pre-alpha. Foundations are built and enforced. Three components are complete:
button, chat surface, and tool call / step trace. Form controls, overlays, and
navigation are planned but not yet written. See `docs/PLAN.md` for the current
phase and what is deliberately out of scope.

The docs in `docs/` were written alongside the code and reflect the same
architecture. If you change the system, change the docs in the same commit —
a design document that disagrees with its implementation is worse than none.