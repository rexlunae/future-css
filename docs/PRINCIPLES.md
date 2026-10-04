# Design principles

These are the decisions that shape everything else. When a rule and a principle
conflict, the principle wins and the rule is a bug. Each principle states the decision,
the reasoning, and -- critically -- **how it is enforced**, because a principle nobody
checks is a slogan.

---

## 1. Semantic HTML carries meaning; CSS carries appearance

**The decision.** Style the element whose semantics match the role. `<button>` for an
action, `<a href>` for navigation, `<label>` for a form control, `<dialog>` for a modal,
`<table>` for tabular data. Add a class; do not substitute the element.

**Why.** A `<button>` arrives with the entire interaction model already correct: it is
focusable, activates on both Space and Enter, participates in form submission, exposes
the `disabled` state, is announced as "button" by screen readers, and sits in the
platform's expected tab order. Every one of those behaviors is free and correct.

The `<div role="button" tabindex="0">` version of the same thing is not a shortcut, it
is a regression that must be manually repaired. It needs `tabindex`, `role`, keyboard
handlers for two keys, and `aria-disabled` logic, and it will still be missing Enter-key
activation, form participation, forced-colors rendering, and correct touch behavior on
mobile. This is the single most common source of accessibility defects in production
codebases, and it is entirely avoidable.

**Enforced.** Lint rules reject `role` attributes that duplicate an element's native
semantics. Each component's documentation specifies the required element, and the anatomy
examples are HTML that uses it.

**Consequence.** The base layer styles elements directly, not just classes. A document
with no classes at all is legible and usable. Classes enhance; they do not rescue.

---

## 2. Accessibility is a build failure, not a review comment

**The decision.** Every accessibility commitment is expressed as an executable check that
fails the build.

**Why.** Review comments are advisory, and advisory accessibility work does not get
done, because nothing breaks when it is ignored. The gap between "we care about
accessibility" and "we ship an inaccessible button" is almost entirely a matter of
whether skipping the check has a consequence.

Contrast is the clearest case. A designer picks `#767676` on `#ffffff` for secondary text.
It looks fine. It is 4.54:1, passing. Change the background to `#f9fafb` in dark mode and
it becomes 4.41:1, and now body text fails WCAG AA. Nobody would ever notice by eye. Here
it is a named entry in a contract with a computed ratio, checked on every build:

```ts
{ usage: "Secondary text / helper copy", fg: "text-muted", bg: "bg-surface", min: 4.5 }
```

**Enforced.**

| Commitment | Mechanism | On failure |
| --- | --- | --- |
| Text contrast >= 4.5:1 | `contrastPairs` evaluated at build | Build fails with the ratio and pair |
| Body text contrast >= 7:1 | Same contract, higher minimum | Build fails |
| Non-text contrast >= 3:1 | Contract entries for borders and focus | Build fails |
| Keyboard focus always visible | Lint: `outline: none` outside `:not(:focus-visible)` | Lint fails |
| Target size >= 24x24 | Component contract + review checklist | Review gate |
| Reduced motion honored | Reset layer blanket rule | Deviation fails review |
| Ramp integrity | Monotonic lightness, single hue, gamut checks | Test fails |
| Direction-neutral properties | Lint: physical longhands | Lint fails |

**Consequence.** The linter and the test suite are part of the definition of the system,
not optional tooling around it. `npm run check` is the gate.

---

## 3. Logical properties everywhere

**The decision.** Every directional property is written logically:
`margin-inline-start`, `padding-block`, `inset-inline-end`, `border-start-start-radius`,
`text-align: start`. Physical longhands (`margin-left`, `left`, `float`) are lint errors.

**Why.** This is the highest-leverage decision in the system for a multi-language
product, and the tradeoff is worth stating plainly: writing `padding-inline-start`
instead of `padding-left` is mildly more typing, and it buys correctness in every
right-to-left language with no separate stylesheet, no mirroring step, and no chance of a
missed override.

The failure mode it prevents is mundane and extremely common. An LTR-first codebase
develops a `padding-left: 2rem` on a callout. Arabic ships. The callout is now indented
on the wrong side, so the gap sits against the text instead of the border, visually
detaching the border from the content it marks. It is a one-line fix that is routinely
missed, because there is no test for it and nothing looks *broken*, just slightly wrong.

The lint rule makes this structural: a physical property cannot be committed.

**Enforced.** The `logical-properties` lint rule covers 30 longhands. The
`logical-values` rule rejects `text-align: left` and `text-align: right`.

**Consequence.** There is no `rtl.css` and no `[dir="rtl"]` override block. Direction
matters only where content is genuinely direction-sensitive, such as a progress bar or a
chart.

---

## 4. Tokens are the only source of color

**The decision.** Components reference semantic tokens. Never a hex literal, never a
primitive ramp step. A raw color value in CSS is a lint error.

**Why.** A literal `#3b82f6` in a component is a promise the design system cannot keep.
It cannot be re-themed for a dark scheme, it cannot be contrast-checked against anything,
and it cannot be swapped for a brand palette. Every one of those is a find-and-replace
across an entire codebase.

The primitive-to-semantic indirection is what makes this work. A component says
`background-color: var(--fc-color-accent-bg)`. That token resolves differently in light
and dark, so the component is correct in both schemes without knowing either exists. And
because the mapping lives in one place, re-branding the product means editing one file.

**Enforced.** The `no-color-literals` lint rule matches hex, `rgb()`, `hsl()`, `oklch()`,
`oklab()`, `lab()`, `hwb()`, and the named CSS colors.

**Consequence.** Theming is a token problem, never a component problem.

---

## 5. Follow the user's environment

**The decision.** The operating system and browser settings are the default answer, not
a fallback. Dark mode follows `prefers-color-scheme`. Motion follows
`prefers-reduced-motion`. Colors follow `forced-colors`. Form controls and scrollbars
follow `color-scheme`.

**Why.** A preference the user has already set in their OS is a preference they have
already communicated. Respecting it requires no configuration and no storage; ignoring it
requires the user to configure the app again. The cost of the default is zero bytes.

`color-scheme` deserves particular credit. It is one declaration that makes the browser
render native form controls, scrollbars, and the default canvas in the correct scheme. It
fixes the wrong-white-input-on-dark-background problem that no amount of CSS in the
application layer can reliably solve, because the problem lives in the browser's default
rendering rather than in the document.

**Enforced.** The reset layer ships the reduced-motion rule unconditionally, so the media
query exists in the bundle before any animated component does. Focus indicators are
remapped under `forced-colors` to the `Highlight` system color.

**Consequence.** The default user experience is the accessible one. An explicit opt-in
is needed to do worse.

---

## 6. Layers over specificity

**The decision.** The cascade is ordered by `@layer`. Precedence is a property of layer
order, not of selector cleverness.

**Why.** The traditional approach is to win specificity contests: `!important`, then
`#id`, then nested selectors. It works until two teams need the same thing, and then the
stylesheet becomes a fossil record of every disagreement that ever happened, none of
which is removable.

Layer order inverts this. The order is declared once, up front, and every rule in the
system gets its place in that order regardless of what selector it uses:

```
reset -> tokens -> base -> layout -> components -> utilities -> overrides
```

Two properties make this powerful. First, `reset` and `base` are wrapped in `:where()`,
giving them **zero specificity**, so a single class in a later layer always wins with no
escalation. Second, `utilities` sits last, so an author can always override a component
with one class, which is what makes a system debuggable under production pressure.

**Enforced.** The build fails if any stylesheet is missing its `@layer` block. The
`no-important` lint rule permits only documented exemptions.

**Consequence.** Adding a component never requires increasing specificity anywhere else.

---

## 7. Tokens are authored in TypeScript

**The decision.** Token definitions live in `.ts` files and compile to CSS custom
properties. They are not hand-written in CSS.

**Why.** CSS custom properties have no type system. A typo produces a `var()` that
resolves to nothing, and the failure surfaces as an invisible or unstyled element far
from the cause. There is no build-time signal at all.

In TypeScript the token definition is data with a schema. The compiler can verify that
every ramp has the same steps, that no two tokens collide, that every contrast pair
references a token that exists, and that a contrast ratio actually meets its minimum. The
last of these is the important one: **the accessibility requirement becomes an ordinary
function that CI runs.** The same definitions also emit JSON for native platforms and for
Figma, so token drift between platforms is detectable by diffing a file.

**Enforced.** The build throws on duplicate token names. The build exits non-zero on any
contrast violation. Tests assert ramp integrity.

**Consequence.** Changing the palette is a typed, tested operation.

---

## 8. Progressive enhancement, not progressive ambition

**The decision.** Where a platform feature is missing, degrade to something that still
works and is still accessible. Never degrade to something broken.

**Why.** The interesting cases are all places where degrading is a design decision
rather than a technical one:

- `text-wrap: pretty` unsupported -> text wraps normally. Fine.
- `line-clamp` unsupported -> text shows in full. This is *correct*: content stays
  reachable instead of disappearing behind an ellipsis the user cannot expand.
- `light-dark()` unsupported -> a `@supports` fallback resolves each token against
  `prefers-color-scheme`.
- `min()` inside `minmax()` unsupported -> fall back to a simpler grid.

In each case the fallback preserves the *content*. A design system that hides text when a
feature is missing has introduced an accessibility bug to solve a layout one.

**Consequence.** Browser support is a matrix with a documented degradation story per
feature, not a binary gate.

---

## 9. Restraint is a feature

**The decision.** A small, deliberate API that people memorize beats a large one they
have to look up.

**Why.** Every utility and every variant is permanent surface area. Utilities in
particular have a way of becoming a second styling language with no governance, which
defeats the point of having a system at all. The utility layer here is capped at roughly
twenty classes, each earning its place by solving a problem no component can.

The same logic applies to layout primitives: `.fc-stack`, `.fc-cluster`, `.fc-sidebar`,
`.fc-grid`, `.fc-container`. Five primitives cover the overwhelming majority of real
layouts, and each is direction-agnostic by construction.

**Enforced.** A utility is added only via the process in
[CONVENTIONS.md](CONVENTIONS.md), which requires demonstrating that no component covers
the case.

**Consequence.** The system stays learnable, and `grep` finds things.

---

## 10. Two audiences, one DOM

**The decision.** The same markup serves humans and machines. Humans read rendered text
and the accessibility tree; automation and agent runtimes read the DOM as a data
interface. Components that render dynamic data expose that data as attributes:

```
data-fc-kind   data-fc-id   data-fc-seq   data-fc-role
data-fc-state  data-fc-ts   data-fc-truncated
```

**Why.** A system that only serves human eyes has to be reverse-engineered by anything
that needs to understand it -- scraped, screen-scraped, or reconstructed from rendered
text. That reconstruction is lossy exactly where it matters most: a spinner and a hang
look identical, a truncated message and a complete one look identical, a `denied` tool
call and a failed one look identical.

**Why the attributes are additive.** Styling must never *depend* on them. A component
with no machine consumer attached has to render identically for a human, and the
attributes are instrumentation on top of a presentation that stands on its own. This is
what keeps the framework general-purpose rather than specialized for one runtime.

**Three rules keep the attributes trustworthy.**

1. **State attributes are the single source of truth.** Styling reads
   `data-fc-state`, so appearance and meaning cannot diverge. A component styled from
   an `.is-success` class invites a state where the class and the content disagree --
   which is precisely the bug this principle exists to prevent.
2. **Truncation is always declared.** Clipped text sets `data-fc-truncated="true"` and
   keeps the full value reachable. Silent truncation is how a consumer ends up
   confidently reporting a partial result.
3. **Never put secrets in an attribute.** Attributes are serialized into markup, logs,
   caches, and analytics pipelines.

**Where this is tested.** The chat surface and the tool call component, where content
arrives partially by design. Both use `data-fc-state` to drive every state treatment,
and the tool call component documents each state in
[COMPONENTS.md](COMPONENTS.md#the-state-machine).

**Enforced.** Required by [AGENTS.md](../AGENTS.md) for any component rendering
dynamic data; documented per component in COMPONENTS.md.

---

## The test for a new feature

Before adding anything, it should pass all four:

1. **Does it work in Arabic, in German, and at 200% zoom?** If not, it is not done.
2. **Does it work without JavaScript?** If it fundamentally cannot, that is a deliberate,
   documented exception, not a default.
3. **Is the accessibility enforceable?** If the requirement cannot be expressed as a
   check, it belongs explicitly in the review checklist instead.
4. **Does it remove something the user had to know?** If it adds a concept without
   removing one, it probably does not belong.
