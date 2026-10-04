# Architecture

How the system is put together, and why each structural decision was made.

---

## The shape of the system

```
TypeScript sources                 CSS output                 Consumer
--------------                     ----------                 --------
src/tokens/*.ts       ------>      dist/tokens.css    ------>  design tokens
  (typed, tested)     compiler     dist/tokens.json           native / Figma

src/css/*.css         ------>      dist/future-css.css ----->  everything
  (authored CSS)       bundler     dist/*.css (per layer)      layer-by-layer
```

Two pipelines, deliberately separate. Tokens are compiled from TypeScript because they
need types and tests. CSS is authored directly because CSS is what we are producing, and
routing it through a preprocessor would add a build dependency and an abstraction between
the author and the output for no benefit.

---

## Cascade layers

The layer order is the entire precedence strategy:

```css
@layer fc.reset, fc.tokens, fc.base, fc.layout, fc.components, fc.utilities, fc.overrides;
```

| Layer | Contains | Specificity | Purpose |
| --- | --- | --- | --- |
| `fc.reset` | Browser default corrections | 0 (all `:where()`) | Remove what browsers get wrong |
| `fc.tokens` | Custom property definitions | 0 | The variables everything reads |
| `fc.base` | Element defaults | 0 (all `:where()`) | Make semantic HTML look finished |
| `fc.layout` | Layout primitives | 1 class | Structure |
| `fc.components` | Components | 1 class | Appearance and behavior |
| `fc.utilities` | Escape hatches | 1 class | Last word for authors |
| `fc.overrides` | Consumer escape hatch | any | Reserved, empty by default |

**Why this order.**

- `reset` before everything, at zero specificity, so it can be aggressive without
  fighting anything.
- `tokens` early because custom properties are inherited and do not participate in
  specificity conflicts.
- `base` at zero specificity is the key move: element defaults can never outrank a class.
- `components` before `utilities` so a utility always wins on equal specificity. This is
  what makes an escape hatch reliable without `!important`.
- `overrides` reserved and empty. Consumers who need to win a fight have a sanctioned
  place to do it, instead of escalating specificity in their own stylesheet.

**Why zero specificity for reset and base.** `:where()` contributes nothing to
specificity. A reset rule can therefore use `!important`-free CSS and still lose to any
class, everywhere, forever. This is what makes the layers composable with third-party
CSS that has not heard of our layer order.

**Consuming layers separately.** Import `future-css/layers` first, then whichever pieces
you need. Without the layer declaration first, the pieces would land in anonymous layers
and the order would fall back to source order.

---

## Token pipeline

`src/build/compile-tokens.ts` reads the typed token definitions and emits CSS.

```
src/tokens/palette.ts            primitive ramps (OKLCH)
        |
src/tokens/semantic/color.ts  +-- semantic aliases {light, dark} per token
        |                       + the contrastPairs contract
        v
src/tokens/semantic/motion.ts     shadows, durations, z-index
src/tokens/index.ts               spacing, type, radius scales
        |
        v
[contrast check]  ---- fail ---->  non-zero exit, no output written
        |
        v
dist/tokens.css   dist/tokens.json
```

**Why the contrast check gates output.** The compiler refuses to write files if the
contract fails. Writing output anyway and logging a warning is the pattern that lets an
inaccessible palette reach production: someone sees the warning, ignores it, and the build
still goes green.

**Why OKLCH for authoring.** Perceptual lightness means "step 500" looks equally
mid-toned in every hue. In HSL, yellow at 50% lightness is far brighter than blue at 50%,
so ramps built in HSL have inconsistent steps and look wrong the moment you use them
together. OKLCH also gives hue stability: a single token's appearance does not shift when
its lightness changes.

Ramps are converted to sRGB hex at build time, with out-of-gamut values clamped, and the
conversion is verified against known WCAG reference values in tests.

**Why emit JSON as well.** Native platforms and design tools need the same numbers. A
generated JSON file makes token drift between platforms detectable by diffing it in CI,
instead of by noticing that the iOS color no longer matches the web one.

---

## Build outputs

| File | Purpose |
| --- | --- |
| `dist/future-css.css` | Everything, one file, correct layer order |
| `dist/layers.css` | Layer order declaration; import first |
| `dist/tokens.css` | Custom properties only |
| `dist/reset.css` | Reset only |
| `dist/base.css` | Element defaults only |
| `dist/layout.css` | Layout primitives only |
| `dist/components/*.css` | One file per component |
| `dist/utilities.css` | Utilities only |
| `dist/tokens.json` | Token values for native platforms and Figma |

**Why output is not minified.** A design system is infrastructure that other engineers
read, debug in devtools, and occasionally vendor into a codebase with a restrictive build
pipeline. Readable CSS is worth more here than the last few kilobytes; consumers minify at
their own boundary with whatever tooling they already use.

**Why per-layer files exist.** An application that has built its own components does not
need ours. Being able to import `layers + reset + base + tokens` and nothing else is the
difference between adopting the system and being forced to adopt all of it.

---

## Enforcement

Two gates, both required.

### The linter (`tools/lint-css.mjs`)

| Rule | Catches | Why it matters |
| --- | --- | --- |
| `logical-properties` | 30 physical longhands | The mechanical guarantee of RTL correctness |
| `logical-values` | `text-align: left/right` | Direction-agnostic alignment |
| `no-color-literals` | hex, rgb, hsl, oklch, oklab, lab, hwb, named | Theming and contrast checkability |
| `no-px` | any `px` value | Scales with the user's font size |
| `no-important` | `!important` outside exemptions | Preserves the layer strategy |
| `preserve-focus` | unscoped `outline: none` | Keyboard navigation |
| `no-transition-all` | `transition: all` | Jank from animating layout |
| `z-index-scale` | raw `z-index` | Closed, reviewable stacking scale |
| `no-id-selectors` | `#id` | Specificity and reuse |
| `no-over-qualified` | `.a.b` | Unnecessary specificity |
| `no-adjacent-sibling-chains` | `a + b + c` | Direction fragility |
| `no-absolute-font-size` | `font-size` in px/pt | User font-size preference |
| `reduced-motion` | `@keyframes` with no reduced-motion consideration | Motion may run when it must not |
| `forced-colors` | `@keyframes` with no forced-colors block | Component becomes an unreadable grey box |

The last two are file-scoped rather than line-scoped: they ask whether the file as a
whole addressed a concern, which is why they are easy to get wrong and have explicit
tests.

The linter is a line scanner with a comment state machine, deliberately dependency-free. It
is itself tested: `tests/lint.test.ts` asserts both that violations are caught *and* that
legitimate patterns are not flagged. A linter that cries wolf gets deleted, so the
allow-cases are as important as the reject-cases.

### The test suite (`tests/`)

- `contrast.test.ts` -- every contrast pair in both schemes; ramp completeness, monotonic
  lightness, single hue, gamut validity; WCAG reference-value sanity checks.
- `lint.test.ts` -- linter behavior, including inline-vs-multiline equivalence.

---

## Zero runtime dependencies

There are none, and that is a design constraint rather than an accident.

The system ships CSS. Anything a consumer loads in order to render a page is a liability:
it competes with their bundle budget, it may not arrive, and if it fails the page is
unstyled. Everything here works with JavaScript disabled, including dark mode (via
`color-scheme` and `light-dark()`) and the entire layout system.

Interactive behavior that genuinely requires script -- menus, dialogs, disclosure -- is a
documented progressive enhancement in `docs/COMPONENTS.md`, with the no-JS fallback
specified as part of the component contract.

---

## TypeScript role

TypeScript is used where it earns its place:

| Location | Why TypeScript |
| --- | --- |
| Token definitions | Typed names catch typos; contrast contracts are executable functions |
| Build scripts | Node runs `.ts` directly; no separate toolchain |
| Tests | Shared types between the palette, the contract, and the assertions |

It is deliberately *not* used for a component library, a CSS-in-JS runtime, or a
preprocessor. Those would each add a build dependency to a system whose main virtue is
that it needs none.
