# Semantic coverage

Where `future-css` stands against the ten most widely-used semantic CSS and design-token
libraries, feature by feature and subfeature by subfeature.

"We have design tokens" is not a checkable claim. It is a category of claim. The useful
question is which *specific meanings* the system can express, and which it cannot. So
each library below is decomposed into the meanings it encodes; meanings that turn out
to be the same thing under different names are merged into one entry, and that entry
is marked with our actual status.

Every status here was checked against the working tree, not against another document's
description of the working tree. Where a claim in `PLAN.md` or `COMPONENTS.md`
disagrees with the code, that is recorded rather than smoothed over.

---

## How to read a status

| Status | Meaning |
| --- | --- |
| **Shipped** | Implemented, and something enforces it — a lint rule, a build-time check, or a test |
| **Partial** | Implemented, but thinner than the field norm, or missing subfeatures named here |
| **Absent** | Not implemented. No ambiguity |
| **Divergent** | Deliberately different, with a recorded reason |

**Divergent** is not a consolation prize. Several entries are places where this system
made a defensible choice the field has not, and saying so is more useful than implying
parity. Where a divergence costs something real, that cost is stated in the same row
rather than buried.

---

## Method, and its limits

Each library was read from its own published documentation **or its own shipped source**,
not from memory. For Primer that meant reading the token JSON under
`primer/primitives/src/tokens/` rather than the prose, which is how `diffBlob` and
`highlight` were found.

Three limits are worth stating plainly.

**A correction worth recording.** An earlier draft of this document claimed Primer
ships `ansi-*`, `prettylights-*`, and `diffBlob-*` families, and used that as its
central argument. Checking the repository contradicts two thirds of it:

- `src/tokens/component/diffBlob.json5` — **confirmed**. A full diff family:
  `additionLine`, `additionWord`, `additionNum`, the `deletion*` mirrors, `empty*`,
  `expander`.
- `src/tokens/component/highlight.json5` — **confirmed**, but it holds a single
  background token, not a syntax palette.
- `ansi-*` and `prettylights-*` — **not found**. `src/tokens/` contains only `base/`,
  `component/`, `fallback/`, `functional/`. `prettylights` was a `primer/css` variable
  family and no longer appears in `src/support/`. The ANSI claim could not be
  substantiated at all.

So Primer ships **diff** and **highlight** domain tokens, not all three, and the
"nobody else ships these" argument was weaker than it looked. The conclusion in entry 20
survives, on narrower ground: no surveyed library ships a *checked* ANSI palette, and
Primer's diff family is thinner than ours because it has no contrast contract attached
to it. That now rests on a verified claim rather than an assumed one.

**Version drift.** Recorded as of the read date, at each project's default branch.
`@primer/primitives` 11.10.0; Radix Colors v3.0.0; Material Web in maintenance mode;
Open Props v1.7.23. These projects ship faster than this document is revised.

**Rank.** "Top ten" is ordered by influence on the design-token conversation, not by
npm downloads. That is a judgement and a different one is defensible. The selection is
argued in [The set](#the-set) so the judgement can be disagreed with explicitly.

---

## The set

| # | Library | Why it is here |
| --- | --- | --- |
| 1 | **Primer Primitives** (GitHub) | The most complete real-world token taxonomy in production, and the only one shipping diff and highlight token families |
| 2 | **Radix Colors** | The purest "scale step means use" position — no token layer below the primitive at all |
| 3 | **Material Design 3** (via Material Web) | The only system doing seed-derived dynamic colour |
| 4 | **IBM Carbon** | The broadest component-token implementation, and the only one shipping explicit AI and chat token groups |
| 5 | **Microsoft Fluent 2** | The sharpest two-tier primitive/alias split, with high-contrast as a first-class scheme |
| 6 | **Adobe Spectrum CSS** | Medium/large scale axes and a strict global/component token split |
| 7 | **Shopify Polaris** | The clearest small-system token set — a floor rather than a ceiling |
| 8 | **Pico CSS** | The strongest pure "semantic HTML is enough" position, and a classless mode we have no equivalent of |
| 9 | **Bulma** | The reference point for the pre-token era: Sass variables compiled to CSS custom properties, with `--bulma-scheme-*` as a derived semantic tier |
| 10 | **Open Props** | The largest pure CSS-variable library, and the only one with a `--motionOK` custom-media convention |

Read alongside these, not scored: **GOV.UK Design System** (functional colour via a
Sass *function*, which forbids hand-copying hex, and the only serious tints-and-shades
alternative to a numeric ramp) and **Tokens Studio** (the de facto token pipeline, and
the reason multi-theme token *sets* are a category at all).

Two exclusions are worth stating, because both were briefly in the set.

**Tailwind CSS was removed.** It is a utility-first framework, not a semantic CSS
suite. Its `@theme` directive is a real and widely-copied token contract, but it exists
to generate utility classes from those tokens rather than to expose them as the styling
API, so scoring it against "what semantic CSS means" would have compared a different kind
of thing. Open Props took the vacated slot: it is likewise a pure variable library, but
unlike Tailwind it publishes the variables *as* the interface, with no class layer
sitting on top.

**Semantic UI** is the only library whose name matches the request, and it is
unmaintained, jQuery-coupled, and ships no token layer. Including it would mean scoring
a project on intent rather than implementation.

---

## The canonical vocabulary

This is the part that does the work. Nine of the ten libraries encode the same
underlying meanings under different names, and several encode *two* things under one
name. The table collapses them. **The canonical name is ours**, chosen to be the most
plainly descriptive name in the group; every alias is a real name from a real library
above.

| # | Canonical name | Also called |
| --- | --- | --- |
| 1 | **Primitive ramp** | Base scale, global token, ref token, raw value, `base/color/scale/*`, `$gray-10`, `--gray-1..12`, Radix scale step |
| 2 | **Semantic alias** | Functional token, alias token, sys token, derived variable, `$background`, `--fgColor-default`, `--blue-11`, `surface-container-low` |
| 3 | **Component token** | `component/button/*`, `$button-*`, `md.comp.*`, component-scoped token |
| 4 | **Surface ladder** | Layer, elevation tier, `$layer-01..05`, `surface-container-*`, `bgColor.muted`, `bg-surface-*`, `color-bg` |
| 5 | **Foreground ladder** | Text ramp, on-surface, `$text-01..05`, `fgColor.default/muted/subtle`, `onSurfaceVariant` |
| 6 | **Boundary ladder** | Border, outline, `$border-subtle/strong`, `borderColor.*`, `outline-variant` |
| 7 | **Non-text boundary** | Interactive border, control stroke, WCAG 1.4.11 boundary |
| 8 | **Focus indicator** | `$focus`/`$focus-inset`, `focus-outline`, focus ring + offset, `focusStrokeOuter` |
| 9 | **Status family** | `$support-*`/`$status-*`, semantic colour, success/warning/danger/info, `fgColor-success/danger/attention` |
| 10 | **Interactive state ramp** | hover/active/selected/disabled, scale steps 3-4-5, `-hover`/`-active`/`-selected`, `$background-hover` |
| 11 | **Inverse surface** | `$background-inverse`, `bgColor.inverse`, `inverseSurface` |
| 12 | **Brand accent** | Primary, `$background-brand`, `$link`, `primary`, `Brand*`, `accent` |
| 13 | **Scheme** | Dark mode, theme, colour mode, `[data-color-mode]`, `.theme-dark`, `.dark`, `light-dark()` |
| 14 | **High-contrast scheme** | HC theme, forced colours, contrast level, `g100`, high-contrast scales |
| 15 | **Composite type style** | Type scale, `--text-*`, `md-typescale-*`, type ramp role |
| 16 | **Measurement** | Measure, content max, `max-inline-size`, `max-w-prose` |
| 17 | **Target size** | Hit area, `size-min`, 24x24 minimum |
| 18 | **Layer order** | z-index, `$zIndex`, `--zIndex-*`, elevation index, layer token |
| 19 | **Reduced motion** | `--motionOK`, motion preference, motion-shrink |
| 20 | **Syntax role** | `highlight.*`, token type, highlight role |
| 21 | **ANSI role** | `ansi-*`, terminal colour, 16-colour palette |
| 22 | **Diff role** | `diffBlob-*`, addition/deletion line, change background |
| 23 | **Machine-readable state** | `data-*` state, state attribute, DOM contract |

Four collisions in that table are worth naming explicitly, because getting them wrong is
how a design system rots:

- **Surface (4) and layer order (18) are unrelated** despite sharing the word "layer".
  One is a background ramp, the other a stacking scale. Carbon uses `$layer-01` for the
  first and `$zIndex` for the second; conflating them is common and wrong.
- **Boundary ladder (6) and non-text boundary (7) are different contracts.** The first
  is decorative separation. The second carries WCAG 1.4.11 at 3:1 against its adjacent
  background. Merging them means either decorative borders that fail a contrast
  requirement, or focusable controls whose outlines are decoration.
- **Focus indicator (8) is two tokens, not one.** Ring colour and ring offset are
  separate because a single-colour ring disappears on a same-coloured component.
- **Status family (9) and brand accent (12) are not the same axis.** Accent is one
  family with a full state ramp; status has four families. Primer's `bgColor-accent-muted`
  and `bgColor-success-muted` are different tokens for the same reason.

---

## Scorecard

Counts by canonical name. "Shipped" counts only what is enforced, not merely present.

| # | Canonical name | Status | Enforced by |
| --- | --- | --- | --- |
| 1 | Primitive ramp | **Shipped** | Ramp integrity tests: 14 steps, monotonic lightness, single hue, gamut |
| 2 | Semantic alias | **Shipped** | `no-color-literals` lint rule; components cannot reach a primitive |
| 3 | Component token | **Absent** | Nothing to enforce yet |
| 4 | Surface ladder | **Shipped** | 8 surfaces, each a declared contrast pair |
| 5 | Foreground ladder | **Shipped** | 21 contrast pairs, both schemes, build fails on violation |
| 6 | Boundary ladder | **Shipped** | `border-default/subtle/strong` |
| 7 | Non-text boundary | **Shipped** | `border-interactive`, declared at 3:1 |
| 8 | Focus indicator | **Shipped** | Ring + offset; `preserve-focus` lint rule |
| 9 | Status family | **Partial** | 4 families x 4 roles; **no hover/active per family** |
| 10 | Interactive state ramp | **Partial** | Accent only. No selected token, no disabled colour |
| 11 | Inverse surface | **Shipped** | `bg-inverse`, with its own foreground ramp |
| 12 | Brand accent | **Shipped** | 6 tokens: bg, bg-hover, bg-active, bg-subtle, text, border |
| 13 | Scheme | **Shipped** | `light-dark()` + `color-scheme`, no JS |
| 14 | High-contrast scheme | **Partial** | `forced-colors` blocks in all 10 components; **no HC token scheme** |
| 15 | Composite type style | **Absent** | Scales exist, no composed role tokens |
| 16 | Measurement | **Shipped** | `size-content-max` 75ch, `size-measure` 65ch |
| 17 | Target size | **Shipped** | `size-target-min` 1.5rem = WCAG 2.2 |
| 18 | Layer order | **Shipped** | 9 steps; `z-index-scale` lint rule rejects raw values |
| 19 | Reduced motion | **Shipped** | Global reset block; `reduced-motion` lint rule |
| 20 | Syntax role | **Shipped** | 25 tokens, 17 roles; 6 declared contrast pairs |
| 21 | ANSI role | **Shipped** | 21 tokens; 3 declared contrast pairs |
| 22 | Diff role | **Shipped** | Added/removed as surface *and* foreground, not surface alone |
| 23 | Machine-readable state | **Shipped** | 8 documented `data-fc-*` attributes, AGENTS.md contract |

**Shipped: 18. Partial: 3. Absent: 2.**

The two Absent rows are the substantive findings, and both are discussed in
[Gaps](#gaps-that-are-actually-gaps).

---

## Feature detail

Each canonical name, its subfeatures, and who ships it. "Us" refers to this repository;
the evidence column names the file or test, so any row can be checked rather than
trusted.

### 1. Primitive ramp — Shipped

A raw, meaning-free scale that components must never reference directly.

| Subfeature | Us | Radix | Primer | M3 | Carbon | Fluent 2 | Spectrum | Polaris | Pico | Bulma | Open Props |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Numeric steps | 14 | 12 | `base/scale/*` | `ref/*` | `$gray-10..100` | palette steps | palette steps | ramp | 1-3 tones | derived | 1-12 |
| Ramp count | 6 | ~30 | many | ~20 | 14 | 14 ramps | ~20 | several | 1 | 8 | ~30 hues |
| Gamut at output | sRGB hex from oklch source | P3 + sRGB | sRGB | P3 | sRGB | sRGB | sRGB | sRGB | sRGB | sRGB | sRGB + HSL |
| Ramp integrity tests | **yes** | docs only | no | no | no | no | no | no | no | no | no |

The last row is the real difference. Six ramps (neutral, accent, success, warning,
danger, info) x 14 steps, and a test that fails the build if a ramp is incomplete,
non-monotonic in lightness, multi-hue, or out of gamut. Every library here *has*
ramps; almost none *check* them.

**Divergent:** we author in OKLCH but emit hex. That loses wide-gamut fidelity on
displays that support it — Radix and M3 ship P3. This is a deliberate trade for
`contrastRatio` being computable from the shipped value, so the contract verifies what
ships rather than what was authored, and that is the right trade for a system whose
central claim is verifiability. It is still a real capability gap, and it is cheap to
close by emitting an `oklch()` fallback alongside the hex pair.

### 2. Semantic alias — Shipped

The meaning layer. Components read these and never a primitive.

- **Us:** 42 semantic colour tokens, `<role>-<variant>[-<state>]`, per-scheme values.
  Counting unique names, 90 of the 165 emitted tokens are `light-dark()` pairs.
- **Enforced** by `no-color-literals` plus the documented rule that a component
  referencing a primitive is a bug.
- **Radix** has no semantic layer at all. Its position is that a scale *step* is the
  semantic unit: `--blue-4` for a component background, `--blue-11` for its text. Fewer
  indirections, and the burden moves to whoever picks the step.
- **Carbon, Primer, Fluent 2, M3** all separate primitive from alias explicitly.
  Fluent's is the cleanest statement: "Global tokens are context-agnostic and store raw
  values. Alias tokens add semantic meaning."
- **Enforcement is the differentiator.** None of these libraries prevents a consumer from
  reaching past the alias layer; they document the boundary and trust review. Ours rejects
  it mechanically, because `no-color-literals` fails the build on any raw colour in a
  component regardless of which token the author meant to use.

### 3. Component token — Absent

A token scoped to one component, overriding the semantic layer for that component only.

- **Us:** none. No `--fc-button-*`, no per-component colour token exists.
- **Primer** is the largest implementation in production, with 33 component token
  files under `src/tokens/component/` including `button.json5`, `diffBlob.json5`,
  `focus.json5`, `highlight.json5`, `overlay.json5`.
- **Carbon** ships a documented component-token table per component, plus `$ai-*` and
  `$chat-*` families.
- **M3** has `md.comp.*`; **Spectrum** separates global and component tokens by
  directory.

**This is a deliberate omission, and the most debatable choice in the system.**
`docs/ARCHITECTURE.md` gives the reason: per-layer distribution, so "an application that
has built its own components does not need ours", plus zero-specificity reset and base
layers so a component class always wins. A component token layer would undercut both —
it moves decisions from the cascade into the token table.

The cost is real and should be recorded rather than argued away. A consumer who wants
"the primary button is blue, not accent" cannot express it in tokens today; they must
author CSS in `fc.overrides`. For a system whose stated audience includes multi-brand
product teams, that is a genuine limitation, and Primer's button token set is the
concrete example of what is being traded away. It belongs on the roadmap as an explicit
decision to revisit, not as a permanent principle.

### 4. Surface ladder — Shipped

Backgrounds, from page canvas to inverted overlay.

| Subfeature | Us | Carbon | Primer | M3 | Radix | Spectrum |
| --- | --- | --- | --- | --- | --- | --- |
| Canvas / page | `bg-canvas` | `$background` | `canvas.default` | `surface` | step 1-2 | gray-50 |
| Content surface | `bg-surface` | `$layer-01` | `bgColor.default` | `surface-container-low` | step 3 | gray-100 |
| Raised | `bg-raised` | `$layer-02` | `bgColor.emphasis` | `surface-container-high` | step 9 | gray-200 |
| Overlay | `bg-overlay` | `$overlay` | `bgColor.overlay` | `surface-container-highest` | step 9 | gray-100 |
| Sunken / inset | `bg-sunken` | inverse layer | — | `surface-container-lowest` | — | gray-100 |
| Subtle | `bg-subtle` | `$layer-01` | `bgColor.muted` | `surface-container-low` | step 2 | gray-50 |
| Muted (hover) | `bg-muted` | `$background-hover` | `bgColor.muted` | — | step 3 | — |
| Inverse | `bg-inverse` | `$background-inverse` | `bgColor.inverse` | `inverseSurface` | — | gray-900 |

Eight surfaces, each a declared contrast pair in both schemes. The distinction between
`bg-raised` and `bg-overlay` is real and not redundant: raised is a card that sits above
the canvas, overlay is a popover that must separate from *both* canvas and the raised
surface beneath it.

**Where we are thinner:** no numbered `layer-01..05` ladder. Carbon's numbered tiers
and M3's `surface-container-*` depths let a consumer place a surface at "depth 3"
without knowing which step that is. Our names describe role rather than depth, which
reads better inside a component but does not compose — a third-party component built
against this system cannot ask for "one step above raised."

### 5. Foreground ladder — Shipped

| Subfeature | Us | Carbon | Primer | M3 |
| --- | --- | --- | --- | --- |
| Primary | `text-default` | `$text-01` | `fgColor.default` | `on-surface` |
| Secondary | `text-muted` | `$text-02` | `fgColor.muted` | `on-surface-variant` |
| Tertiary | `text-subtle` | `$text-03` | `fgColor.subtle` | — |
| On solid fill | `text-on-accent` | `$text-04` | `fgColor-onEmphasis` | `on-primary` |
| On inverse | `text-inverse` | `$text-inverse` | `fgColor-onInverse` | `inverse-on-surface` |
| Inverse secondary | `text-inverse-muted` | — | — | — |
| Link | `accent-text` | `$link` | `fgColor-link` | `primary` |

**Foreground on-solid** deserves its own row. It is the single most common dark-mode
accessibility failure in this ecosystem: a solid accent fill whose foreground is
hardcoded to white. Radix solves it by publishing per scale which of step 9 or step 10
is designed for a dark foreground. Material solves it with `on-primary`. We solve it
with a per-scheme token, which is the same idea under a name that says what it is for.

`text-inverse-muted` exists because reuse measured 1.8:1. The foreground tuned for a
*light* background collapses on a dark one, so inverted surfaces need their own ramp.

**Divergent:** the names. Primer and Carbon number these (`$text-01..05`); Fluent and
Pico say primary/secondary/tertiary; Polaris says text/subtle/muted. Ours is
`default`/`muted`/`subtle`, which matches no one in particular. It is internally
consistent and legible, and switching would be a breaking change to public API, so this
is recorded as a note rather than a proposal.

### 6-7. Boundary ladder and non-text boundary — Shipped

Two different contracts that one word usually hides.

| Role | Us | Declared at | Primer | Carbon |
| --- | --- | --- | --- | --- |
| Decorative separation | `border-subtle` | not contrast-checked | `borderColor.muted` | `$border-subtle-01` |
| Default boundary | `border-default` | not contrast-checked | `borderColor.default` | `$border-strong-01` |
| Emphasis | `border-strong` | not contrast-checked | `borderColor.emphasis` | `$border-strong-01` |
| **Control boundary** | `border-interactive` | **3:1 (WCAG 1.4.11)** | `borderColor.default` on controls | `$focus` |

Only the last is a contrast requirement, and only the last is a declared pair. Keeping
them apart is the point: a decorative border that fails 3:1 is fine, and a focusable
control whose outline is decorative is not. Carbon collapses both into `$focus`, which
makes one of the two inexpressible.

### 8. Focus indicator — Shipped

Two tokens: `focus-ring` and `focus-ring-offset`. Both are contrast pairs against both
`bg-canvas` and `bg-surface` at 3:1. The offset exists because a single-colour ring
disappears against a component of the same colour, which is precisely what a primary
button is. The `preserve-focus` lint rule rejects unscoped `outline: none`, and
`base.css` scopes its reset to `:focus:not(:focus-visible)` so a mouse click does not
leave a ring but a keyboard focus always does.

Fluent ships `$focus-inset` as a variant rather than an offset; Primer separates
`outline.focus` from `borderColor.default`. Same three ideas, three arrangements.

### 9. Status family — Partial

| Subfeature | accent | success | warning | danger | info |
| --- | --- | --- | --- | --- | --- |
| Solid background | yes | yes | yes | yes | yes |
| Subtle background | yes | yes | yes | yes | yes |
| Text | yes | yes | yes | yes | yes |
| Border | yes | yes | yes | yes | yes |
| **Hover / active** | **yes** | **no** | **no** | **no** | **no** |

Four families x four roles, consistent in shape, then inconsistent in one place: only
accent has state variants. Every library in the set that ships status colour gives each
family a hover and active step — Carbon's `$support-success-02`/`-03`, Primer's
`bgColor-success-emphasis` against `-muted`, Fluent's `StatusForegroundSuccess` family.
A danger button with a status background currently cannot express hover without
dropping to a token outside its own family.

**This is the cheapest Partial in the document to close:** four tokens per family,
sixteen in total, all already derivable from the existing ramps, all checkable by the
existing contract. It should not be left as a known inconsistency.

Note also that only the accent family's text is contrast-checked against every status
surface. `warning-text` on `warning-bg` is *not* a declared pair, because warning's
filled background is mid-lightness and the pairing failed during Phase 1. The
components work around it by using `warning-bg-subtle` for surfaces and `warning-bg`
only for fills with no text. That ceiling is real and is recorded here rather than
hidden.

### 10. Interactive state ramp — Partial

The hover/active/selected/disabled family, treated separately from status because these
are *states of one surface* rather than parallel families.

| Subfeature | Us | Radix | Carbon | Primer | Bulma |
| --- | --- | --- | --- | --- | --- |
| Rest | via surface ladder | step 3 | `$background` | `-rest` | base colour |
| Hover | `accent-bg-hover`, `bg-muted` | step 4 | `$background-hover` | `-hover` | `is-hovered` |
| Active | `accent-bg-active`, `bg-subtle` | step 5 | `$background-active` | `-active` | `is-active` |
| **Selected** | **no token** | step 5 | `$background-selected` | `-selected` | `is-selected` |
| **Disabled** | **opacity only** | — | `$background-disabled` | `bgColor-disabled` | `--bulma-button-disabled-*` |

Bulma is the clearest counter-example to our disabled handling: it ships four
`--bulma-button-disabled-*` tokens rather than compositing a single opacity, so its
disabled state is inspectable as colour even though the documented value is still an
opacity.

Radix encodes the whole ramp as *scale steps 3, 4, 5*, which is the cleanest statement of
the idea in the set: hover is literally "one step further from the background."

Two real gaps. **Selected** has no token at all — the data grid styles selection and the
menu styles checkmarks, but both reach for a surface outside the vocabulary.
**Disabled** is expressed as `--fc-opacity-disabled: 0.55` composited over whatever it
sits on, which means a disabled element's contrast is not a declared pair and therefore
not checked. Primer's `fgColor-disabled` and `bgColor-disabled` exist precisely so the
disabled state is a colour, and therefore verifiable.

The opacity approach is defensible for a control that must still show its disabled
*identity* — a destructive button that stops looking destructive invites the user to keep
trying. It is not defensible as the *only* mechanism, because "0.55 of anything" is
below 3:1 against nothing in particular. A disabled control is exempt from WCAG contrast,
so this is a legality question rather than an accessibility one; but it does mean the
system cannot state what a disabled control looks like, only how transparent it is.

### 11. Inverse surface — Shipped

`bg-inverse` plus its own two-token foreground ramp. Carbon, Primer and M3 all ship the
surface; only GOV.UK treats the secondary-on-inverse case explicitly. Our
`text-inverse-muted` exists because reuse measured 1.8:1.

### 12. Brand accent — Shipped

Six tokens — the most completely specified single family in the system, and the one used
by the widest surface area (link, primary button, focus ring, active nav).

`accent-bg`, `accent-bg-hover`, `accent-bg-active`, `accent-bg-subtle`, `accent-text`,
`accent-border`. Accent is `accent[600]` in light and `accent[400]` in dark, with the
hover and active steps inverting direction in the dark scheme — hover goes *lighter*,
not darker — because a dark scheme's accents sit at the other end of the ramp.

**Multi-brand is not implemented.** Tokens Studio, Radix Themes, Fluent and Primer all
support a consumer swapping the brand ramp and getting a coherent system. Here a
consumer can remap the 42 semantic tokens by hand, but nothing generates a correct
alternative brand. Tokens Studio calls this a "theme set," and it is the single most
requested capability in the token-tooling world. We are close — the semantic layer is
already the correct seam — but the tooling to exploit it does not exist.

### 13. Scheme — Shipped

`light-dark()` for the values, `color-scheme` for the toggle, `[data-fc-theme]` for
consumer override. No JavaScript, no duplicated stylesheet, one declaration switches 90
tokens.

**This is better than most of the set.** Radix requires a `.dark` class on `<body>` or a
parent and ships separate `*-dark.css` files. Spectrum needs `.theme-dark`. Primer needs
`[data-color-mode]` plus `[data-light-theme]`. Carbon ships four separate theme tiers.
Bulma needs a `theme-dark` class or the `prefers-color-scheme` mixin.
`light-dark()` collapses all of that into the value itself, which is the correct level
for the concern.

The cost of `light-dark()` is that it needs `color-scheme` set correctly, and that
declaration must live in exactly one layer. `src/css/base.css` carries a long comment
recording the bug: `color-scheme` was declared in `fc.base` as well as `fc.tokens`, base
is ordered later at equal specificity, and the theme switcher silently did nothing —
while still responding to clicks. The rule now lives in the tokens layer alone.

### 14. High-contrast scheme — Partial

| Subfeature | Us | Radix | Carbon | Fluent 2 | M3 | Primer |
| --- | --- | --- | --- | --- | --- | --- |
| `forced-colors` handling | **all 10 components** | yes | yes | yes | yes | yes |
| HC token scheme | **no** | yes | `g100` | yes | contrast levels | yes |
| Opt-in HC toggle | no | yes | yes | yes | yes | yes |
| Colour-vision modes | no | no | no | no | no | yes |

Every one of our ten components has a `@media (forced-colors: active)` block, and the
`forced-colors` lint rule makes omitting one a build failure. That is the *forced* half
of high contrast — the OS overrides your palette — and we do it completely.

What we do not have is the *authored* half: a third set of token values that a consumer
opts into. Primer ships six (`light-high-contrast`, `dark-high-contrast`, plus
tritanopia and protanopia-deuteranopia variants — visible throughout `diffBlob.json5`),
Carbon ships `g100`, M3 ships contrast levels, Radix ships high-contrast scales. These
serve people whose contrast needs are not met by either of our two schemes.

`prefers-contrast: more` is also unhandled. It is a separate mechanism from `forced-colors`
and would need its own token tier. Note this is the same gap as the missing theme sets
in entry 12, seen from a different angle: both want a third value per token.

### 15. Composite type style — Absent

A named role that bundles size, weight, line height and tracking — `body-small`,
`title-medium`, `md-typescale-headline-small`.

- **Us:** scales only. `fontSize` (12 steps), `fontWeight` (4), `lineHeight` (5),
  `fontFamily` (2). `base.css` composes roles per element — `h1` through `h6`, `p`,
  `code` — but nothing is named or reusable outside that file.
- **M3** has `md.typescale.*` as first-class tokens. **Fluent** has
  `FontSize.*`/`FontWeight.*` groupings. **Primer** has `typography.*` under functional.
  **Polaris** has `text-*` composite tokens. All four treat the role as the unit.

**What it costs.** The system cannot express "this paragraph uses the *body-small*
role." An application with a defined type ramp — most product teams have one, and design
review enforces it — cannot adopt ours without re-deriving the mapping. Combined with the
missing component tokens (entry 3), this is the second place where the "everything is a
scale, nothing is a role" position makes the system easy to extend and hard to adopt.

Honest summary: the same principle that makes our tokens auditable makes them
insufficient for a product team with a type ramp and a brand system. That is a
legitimate trade for a foundation library, but `docs/COMPONENTS.md` should state it as a
limitation rather than leaving a consumer to discover it.

The related subfeature is a **tracking scale**. There is no `letterSpacing` token group at
all. `base.css` applies `letter-spacing: -0.01em` to `h5`/`h6` with a comment explaining
that letter-spacing alone misbehaves in scripts without word spacing — the right instinct,
expressed as a literal instead of as a token.

### 16-17. Measurement and target size — Shipped

`size-content-max: 75ch`, `size-measure: 65ch`, `size-target-min: 1.5rem`,
`size-target-comfortable: 2.5rem`. Applied in `base.css` to `body` (so it constrains
prose without constraining full-bleed layouts) and to interactive components.

GOV.UK and Pico both treat measure as a first-class concern with a named token; most
others do not. WCAG 2.2's 24x24 target minimum is matched exactly.

### 18. Layer order — Shipped

Nine steps: `0`, `base`, `raised`, `sticky`, `dropdown`, `overlay`, `modal`, `popover`,
`toast`. The `z-index-scale` lint rule rejects any raw `z-index` value, so `z-index: 9999`
cannot enter the codebase. Carbon, Primer and Fluent all ship equivalent closed scales.

Distinct from the surface ladder in entry 4, and deliberately so — see the collisions
list above.

### 19. Reduced motion — Shipped

A global `prefers-reduced-motion` block in the reset layer sets
`animation-duration`/`transition-duration` to `0.01ms` and `scroll-behavior` to `auto`,
plus the `reduced-motion` lint rule. The comment explains why the block exists even
before any animated component ships: so the media query is guaranteed present in the
bundle. Six components add their own handling.

Open Props ships `--motionOK` as a custom media query; everything else uses the standard
preference. No library in the set treats "reduced motion" as a *token*, which is the
right call — the correct behaviour is to collapse to zero rather than swap values.

### 20-22. Syntax, ANSI and diff roles — Shipped

**The token families most of the field omits.** Of the ten libraries, Primer ships diff
(`diffBlob`) and a minimal highlight token; Radix, Pico, Bulma and Open Props ship none,
and Open Props is notable there because with no component layer at all it had every
opportunity to. The rest carry syntax colours only inside their own editor components.

| Family | Our tokens | Contrast pairs | Isolated namespace | Primer equivalent |
| --- | --- | --- | --- | --- |
| Syntax (`--fc-code-*`) | 25 | 6 | yes | `highlight.*` (bg only) |
| ANSI (`--fc-term-*`) | 21 | 3 | yes | none found |
| Diff (within `fc-code-*`) | 4 | via syntax | yes | `diffBlob.*` |

Three design decisions here are worth recording, because each was forced by a measured
failure rather than chosen up front.

**Isolated namespaces.** The ANSI palette defines `bg`, `fg` and `bg-raised`; the app
palette defines the same three names with different meanings. A terminal background is
genuinely not the app canvas — a terminal emulates another program and must stay dark —
so they cannot share a name. Syntax colours carry *syntactic* meaning rather than brand
meaning and must not be remapped by a brand theme. The `fc-term-*` and `fc-code-*`
prefixes exist because of this, and `compile-tokens.ts` carries a comment recording that
the unique-name guard caught the collision rather than letting one silently overwrite
the other.

**A contrast contract per palette, not one contract.** `syntax.ts` and `terminal.ts` each
declare their own pairs against their own backgrounds and are verified by the same
`checkContrast` function, exported as a type precisely so the loop is not reimplemented
and cannot drift. A code surface is dense, small, and read for long stretches; a colour
that does not carry its meaning is a bug you cannot see.

**Solved, not chosen.** The syntax values were found by binary search — for each role's
hue and chroma, the lightness whose contrast against the code background is just above
4.5:1, then rounded away from the background so the shipped 2dp value cannot land under.
Hand-picking produced roles at 4.44:1, invisible failures that only the contract caught.

Two bugs the contract caught are recorded in `syntax.ts` and are the argument for having
one at all. The code block's boundary was pointed at the *inset* surface, so a white
block on a near-white page measured 1.04:1 — invisible, and caught only because it was a
declared pair. And the added and removed diff backgrounds were originally identical
values, so a changed row rendered exactly like an unchanged one in dark mode; both passed
contrast, because two identical backgrounds contrast identically. The contract verifies
legibility, not distinctness, so that gap had to be closed by hand and is now called out
in the source.

### 23. Machine-readable state — Shipped

The one category where this system is ahead of every library surveyed, and the only one
that is not a CSS feature at all.

- **8 documented attributes** in the `AGENTS.md` contract: `data-fc-kind`, `-id`, `-seq`,
  `-role`, `-state`, `-ts`, `-truncated`, plus `data-fc-theme` for the scheme override.
  22 distinct `data-fc-*` attributes appear in the codebase overall.
- **A closed state enum**: `pending`, `queued`, `streaming`, `running`, `complete`,
  `aborted`, `denied`, `error`. Not a free-form string.
- **61 uses of `data-fc-state`** across the chat, tool-call and grid components.
- **Additive**: styling never *depends* on these attributes, so the component degrades
  correctly with no consumer attached.
- **Truncation is always declared** — `data-fc-truncated="true"` with the full value
  kept reachable.

Radix exposes `data-state` and Chakra exposes named conditions, but both exist so the
library's own CSS can react. None documents state as a contract for *external*
automation. This system's stated audience includes machine consumers, and that claim is
only credible because the attributes are a published interface rather than an
implementation detail.

The rule that keeps it honest: **never derive appearance from a class that can fall out
of sync with the state attribute.** Six of the ten components style from
`data-fc-state`, and the `tool-call` component carries a comment recording that its state
glyph was chosen so the state survives greyscale, forced-colors mode, and any future
colour scheme — i.e. so state is never carried by colour alone.

---

## Structure and behaviour

Not part of the 23-name vocabulary, because none of the ten libraries treat these as
tokens — but they are the other half of "semantic" and belong in the same comparison.

| Area | Subfeature | Status | Where |
| --- | --- | --- | --- |
| **Cascade layers** | Declared order, 7 layers | Shipped | `index.css`, published as `layers.css` |
| | Zero-specificity reset + base | Shipped | `:where()` throughout, enforced by lint |
| | Consumer override layer | Shipped | `fc.overrides`, declared and empty |
| | Per-layer distribution | Shipped | 12 published files |
| **Reset** | Margins, `box-sizing`, media defaults | Shipped | `reset.css` |
| | `[hidden]`, `[role=list]`, `autofill` | Shipped | `reset.css` |
| | Tabular figures via `[data-numeric]` | Shipped | `reset.css` |
| **Base** | Headings, body, lists, tables, forms | Shipped | `base.css`, ~30 element rules |
| | Links, focus-visible, `::selection` | Shipped | `base.css` |
| | Usable classless baseline | Shipped | zero classes renders legibly |
| **Layout** | stack, cluster, sidebar | Shipped | `layout.css`, 10 primitives |
| | Intrinsic grid, container, center | Shipped | `grid-auto`, `container`, `center` |
| | Truncate, line-clamp | Shipped | `truncate`, `clamp-2/3` |
| | Scroll region | Shipped | `scroll-x` |
| | RTL by construction | Shipped | logical properties only |
| | `min-inline-size: 0` overflow fix | Shipped | applied to all 3 primitives |
| **Components** | 10 shipped | Shipped | button, chat, tool-call, editor, menu, grid, webview, terminal, code, diff |
| | Form controls | Absent | Phase 3; select is next |
| | Overlays (dialog, tooltip, toast) | Absent | Phase 3 |
| | Navigation (tabs, breadcrumb) | Absent | Phase 3 |
| **Accessibility** | Keyboard, focus-visible, skip link | Shipped | base + `.fc-u-visually-hidden` |
| | forced-colors per component | Shipped | 1 block per component, all 10 |
| | Contrast verified in both schemes | Shipped | 30 declared pairs total |
| | Target size | Shipped | token + button/grid |
| | `prefers-reduced-motion` | Shipped | reset + 6 components |
| | Live-region politeness | Absent | needs a toast component |
| | APCA alongside WCAG | Absent | open question 2, `PLAN.md` |
| **Behaviour** | JS bindings | Shipped | `src/js/`, 10 modules |
| | Optional WASM accelerator | Shipped | 6 crates, WASM/JS parity tested |
| | highlight / diff / markdown | Shipped | 6 languages, Myers, round-trip |

Three of these deserve a note because they are places the field is *behind*, and being
ahead of a gap is not the same as being ahead of a well-served area.

**Zero runtime dependencies.** No framework, no preprocessor, no transpiler; Node runs
the TypeScript directly. Only reachable because tokens are compiled from TypeScript
rather than Sass — a Sass pipeline would make the dependency-free property impossible
to keep.

**Enforced RTL.** 31 physical longhands are rejected by the `logical-properties` lint
rule, so there is no `[dir="rtl"]` block anywhere in the codebase. There is nothing to
override because nothing physical was written. Pico ships an RTL stylesheet, Primer ships
direction overrides, Bulma ships an RTL mixin. All three are maintaining a second
stylesheet for a problem this system does not have.

**Demonstrable, not aspirational.** `demo/` serves the real TypeScript sources with
Node's `stripTypeScriptTypes`, so "no build step" is checkable rather than claimed. The
same discipline produced three regression tests, because a demo is a test: the
`.fc-grid` name collision between the layout primitive and the data grid, the
`grid-auto-columns` implicit-track mistake, and the `color-scheme` layer-order bug were
each invisible to unit tests and obvious the moment real components rendered.

## Gaps that are actually gaps

Ordered by cost to a consumer adopting this system, not by effort.

**1. Component tokens (Absent, entry 3)** and **2. Composite type styles (Absent, entry
15)** follow from one position — everything is a scale, nothing is a role — and both are
what a product team with a type ramp and a brand system needs first. Together they are
the difference between a foundation library and an adoptable system. Both are defensible
omissions; both cost real adoptions.

**3. High-contrast token tier (Partial, entry 14).** One gap seen twice: every token has
exactly two values, and three use cases need a third. A consumer cannot turn on high
contrast and cannot honour `prefers-contrast: more`. `focus-ring` was built as two tokens
specifically so an HC mode could swap in a double-colour ring, so the structure is
already in place.

**4. No theme sets.** The same two-values problem from the brand side: a consumer cannot
generate a coherent alternative brand. The semantic layer is already the correct seam —
the work is a theme-set abstraction in the compiler, not a redesign.

**5. No `selected` or `disabled` colour tokens (Partial, entry 10), and no hover/active
per status family (Partial, entry 9).** Eighteen tokens. All derivable from the existing
ramps, all checkable by the existing contract. Close this before more components ship,
because every component added in the meantime encodes the workaround.

**6. Elevation is two steps.** Every other system ships six or more. Enough for a card
and a popover; not enough the first time a design wants a menu over a modal over a
toast. No new decisions required, only more of an existing one.

**7. `prefers-contrast`, `prefers-reduced-data`, `prefers-reduced-transparency`.** Three
media queries nothing references. The first matters most and belongs with item 3.

**8. Bidi isolation is documented but not shipped.** `docs/INTERNATIONALIZATION.md` covers
mixed-direction runs thoroughly and the layout layer supports them, but there is no
`.fc-u-bidi` class and no `<bdi>` guidance in `COMPONENTS.md`. The prose is ahead of the
API.

**9. Bundle size.** 132 KB uncompressed against a `< 60 KB` budget in `PLAN.md`. The
output is deliberately unminified and the docs say consumers minify at their own
boundary, so the honest fix is to measure the minified size and state it — or to raise
the budget with a justification. Not to leave a number the build contradicts.

### Docs that disagree with the code

Recorded rather than fixed silently, because `AGENTS.md` says documentation that drifts
is worse than none.

**All of these are now corrected in `PLAN.md` and `README.md`.** The table is kept as
the record of what was wrong, not as a live list of outstanding defects — a stale claim
in this file would be the same defect one layer down.

| Was claimed | Now states |
| --- | --- |
| "119 tokens (44 theme-aware)" | 165 tokens, 90 theme-aware |
| "~55 KB" bundle | 132 KB uncompressed, with the unenforced budget called out |
| "92 tests passing" | 245 tests passing |
| "68 tests" (Rust) | 75 tests passing |
| "5 WASM modules" | 6 crates → 5 `.wasm` files in 4 importable modules, with `fc-diff` named as unbound |
| "Seven components are complete" (README) | Ten, plus the three JS modules named |

### One gap the numbers do not show

`fc-diff` is a Rust crate with 7 passing tests and **no `wasm_bindgen` layer**. It is
absent from `CRATES` in `build-wasm.ts`, so it emits no `.wasm`. Crates, emitted
`.wasm` files, and importable modules are three different measurements: six crates
produce five `.wasm` files across four importable modules, and only four of the six
crates are reachable from JavaScript today.

## Per-library verdicts

One line each: what each library does that we do not, and whether we would take it.

In the order of the scored set in [§2](#the-set). The two unscored references are listed
separately underneath.

| Library | Its advantage over us | Would we adopt it? |
| --- | --- | --- |
| **Primer** | Component tokens; numeric surface depth; type composites | The diff/highlight families we already have; the rest is the gap list above |
| **Radix Colors** | P3 output; high-contrast scales; scale-step-as-semantics with zero indirection | HC scales: yes. Step-as-semantics: no — it trades verifiability for brevity |
| **Material 3** | Seed-derived dynamic colour; type composites; elevation as a numbered scale | Dynamic colour: no — it cannot be contrast-checked at build time, which is the point here |
| **IBM Carbon** | Component tokens; `$ai-*`/`$chat-*` families; explicit `$layer-01..05` depth | Layer depth and chat tokens: yes, both cheap. We ship chat *components* and no chat *tokens* |
| **Fluent 2** | Two-tier primitive/alias split stated most clearly; HC as a first-class theme | HC theme: yes. The naming discipline we already have |
| **Spectrum CSS** | Medium/large scale axes for density without new tokens | Density is open question 4; scale axes are the candidate answer |
| **Shopify Polaris** | Small comprehensible set with per-token `description` metadata | Per-token descriptions: cheap, worth having in `tokens.json` |
| **Pico CSS** | A real class-less switch; measure as a first-class concern | Class-less: worth an option. Measure: already shipped |
| **Bulma** | `--bulma-scheme-*` derived tier; explicit per-state tokens including `--bulma-button-disabled-*`; a full spacing/typography helper set | Disabled-as-tokens: yes, that is gap 5. The rest: we have the equivalent at a different altitude |
| **Open Props** | 500+ props, PropPack granularity, `--motionOK` custom media, UX-named durations | Granular import already exists per layer. `--motionOK`, and durations named by use (`--duration-quick-1` for hover, `--duration-moderate-2` for a modal), are a better vocabulary than `fast`/`normal`/`slow` and would close the transition-recipe item under gap 5 |

**Unscored, read while mapping:** Tokens Studio — the de facto token pipeline, and the
reason multi-theme token *sets* are a category at all.

## Maintaining this document

This file is only useful while it is true, and it decays the moment the code moves.

- **Every status cites a file or a test.** A row that cannot cite one is an assumption
  and should be marked as such rather than stated as fact.
- **Re-read the sources on any load-bearing claim.** The Primer correction is the worked
  example: the claim was central, it was wrong in two places, and only reading the
  shipped CSS caught it. The same is true of anything asserted about Radix, Carbon or
  Fluent — their token sets change faster than this file does.
- **Add to the vocabulary before adding to the comparison.** A subfeature that maps to no
  existing canonical name is either a gap in the vocabulary or a feature nobody else has.
  Both are worth recording explicitly rather than forced into a neighbouring row.
- **When a Partial becomes Shipped, say why in the same edit.** The reasoning is the
  expensive part to reconstruct, and it is what a reader six months from now needs.
- **Re-derive the tally rather than editing it.** The scorecard count is a claim about the
  system's shape; recompute it from the table when the table changes.

## What this document concludes

Eighteen of twenty-three canonical meanings are shipped and enforced. Three are partial
in ways that are cheap to close. Two are absent by decision, and both decisions are
defensible in isolation while jointly describing one consistent position: **this is a
foundation library, not a product design system.** It ships scales and meanings, not
roles and brand slots. That makes it auditable and cheap to vendor, and insufficient for
a team with a type ramp and a brand system until the extension points above exist.

Two capabilities are ahead of every library surveyed: the machine-readable DOM contract
(entry 23) and enforced contrast across three separate palettes rather than one (entries
20-22). The second caught a real bug that *passed* the contrast check — added and
removed diff rows were the same colour, so both validated identically while telling a
reader nothing. That single failure is the argument for the whole approach, and it is
why the contract verifies three palettes separately rather than trusting one.

If three things get done next: component override points, the high-contrast token tier,
and composite type styles — in that order. The first two unblock adoption; the third
unblocks design review.
