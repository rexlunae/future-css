# Semantic coverage

Where `future-css` stands against the ten most widely-used semantic CSS and design-token
libraries, feature by feature.

This document exists because "we have design tokens" is not a checkable claim. It is a
category of claim. The useful question is which *specific meanings* the system can
express, and which it cannot. So each library below is decomposed into the meanings it
encodes, meanings that turn out to be the same thing under different names are merged
into one entry, and that entry is marked with our actual status.

## How to read a status

| Status | Meaning |
| --- | --- |
| **Shipped** | Implemented, and something enforces it (linter rule, build-time check, or test) |
| **Partial** | Implemented, but thinner than the field norm or missing subfeatures named here |
| **Absent** | Not implemented. No ambiguity |
| **Divergent** | Deliberately different, with a recorded reason |

**Divergent** is not a consolation prize. Several entries are places where this system
made a defensible choice that most of the field has not, and saying so is more useful
than pretending parity. Where a divergence costs something real, that is stated in the
same row rather than buried.

## Method, and its limits

Every library below was read from its own published documentation or its shipped CSS,
not from memory. Where a library's documentation and its shipped artifact disagree, the
artifact was treated as authoritative -- for Primer that meant reading the compiled
functional theme rather than the prose, which is how the `ansi-*`, `prettylights-*` and
`diffBlob-*` token families below were discovered. Those three families are the reason
this document exists: they are token groups we implement, that Primer also implements,
and that four of the other nine libraries do not expose at all.

Two limits are worth stating plainly.

**Version drift.** Each library is recorded as of the read date, at the version its
docs reported. Tailwind's page was v4.3, Radix Colors v3.0.0, Material Web in
maintenance mode. Several of these projects ship faster than this document is revised.

**Rank.** "Top ten" is ordered by influence on the design-token conversation, not by
npm downloads. That ordering is a judgement and a different one is defensible. The
selection is argued in [The set](#the-set) so the judgement can be disagreed with
explicitly rather than in the abstract.

## The set

| # | Library | Why it is here |
| --- | --- | --- |
| 1 | **Radix Colors** | The purest statement of "scale step means use". No token below the primitive layer at all |
| 2 | **Primer Primitives** (GitHub) | The most complete real-world token taxonomy in production, including three that nothing else ships |
| 3 | **Material Design 3** (via Material Web) | The only system doing seed-derived dynamic colour |
| 4 | **Tailwind CSS v4** | Theme variables are the most widely-consumed token contract on the web, even though the framework is not semantic-CSS |
| 5 | **IBM Carbon** | The broadest component-token implementation, and the only one shipping explicit AI and chat token groups |
| 6 | **Microsoft Fluent 2** | The sharpest two-tier primitive/alias split, with high-contrast as a first-class scheme |
| 7 | **Adobe Spectrum CSS** | Medium/large scale axes and a strict global/component token split |
| 8 | **Shopify Polaris** | The clearest small-system token set, useful as a floor rather than a ceiling |
| 9 | **Pico CSS** | The strongest pure "semantic HTML is enough" position, and a class-less mode we have no equivalent of |
| 10 | **Bulma** | The original Sass-variable-to-CSS-variable semantic framework; the reference point for the pre-token era |

Read alongside these, not scored: **Open Props** (the largest pure CSS-variable

## The canonical vocabulary

This is the part that does the work. Nine of the ten libraries encode the same
underlying meanings under different names, and several encode *two* things under one
name. The table collapses them. **The canonical name is ours**, chosen to be the most
plainly descriptive name in the group; every alias is a real name from a real library
above.

| # | Canonical name | Also called |
| --- | --- | --- |
| 1 | **Primitive ramp** | Base scale, global token, ref token, raw value, `base/color/scale/*`, `$gray-10`, `--gray-1..12`, Radix scale step |
| 2 | **Semantic alias** | Functional token, alias token, sys token, derived variable, `$background`, `--fgColor-default`, `--blue-11`, `govuk-functional-colour("brand")` |
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
| 20 | **Syntax role** | `prettylights.syntax.*`, token type, highlight role |
| 21 | **ANSI role** | `ansi-*`, terminal colour, 16-colour palette |
| 22 | **Diff role** | `diffBlob-*`, addition/deletion line, change background |
| 23 | **Machine-readable state** | `data-*` state, state attribute, DOM contract |


## Scorecard

Counts by canonical name. "Shipped" counts only what is enforced, not merely present.

| Canonical name | Status | Enforced by |
| --- | --- | --- |
| 1. Primitive ramp | Shipped | Ramp integrity tests: 14 steps, monotonic lightness, single hue, gamut |
| 2. Semantic alias | Shipped | `no-color-literals` lint rule; components cannot reach a primitive |
| 3. Component token | **Absent** | Nothing to enforce yet |
| 4. Surface ladder | Shipped | 7 surfaces, each a declared contrast pair |
| 5. Foreground ladder | Shipped | 21 contrast pairs, both schemes, build fails on violation |
| 6. Boundary ladder | Shipped | `border-default/subtle/strong` |
| 7. Non-text boundary | Shipped | `border-interactive`, declared at 3:1 |
| 8. Focus indicator | Shipped | Ring + offset; `preserve-focus` lint rule |
| 9. Status family | **Partial** | 4 families x 4 roles; **no hover/active per family** |
| 10. Interactive state ramp | **Partial** | Accent only. No selected, no disabled tokens |
| 11. Inverse surface | Shipped | `bg-inverse`, with its own foreground ramp |
| 12. Brand accent | Shipped | 6 tokens: bg, bg-hover, bg-active, bg-subtle, text, border |
| 13. Scheme | Shipped | `light-dark()` + `color-scheme`, no JS |
| 14. High-contrast scheme | **Partial** | `forced-colors` blocks in all 10 components; **no HC token scheme** |
| 15. Composite type style | **Absent** | Scales exist, no composed role tokens |
| 16. Measurement | Shipped | `size-content-max` 75ch, `size-measure` 65ch |
| 17. Target size | Shipped | `size-target-min` 1.5rem = WCAG 2.2 |
| 18. Layer order | Shipped | 9 steps; `z-index-scale` lint rule rejects raw values |
| 19. Reduced motion | Shipped | Global reset block; `reduced-motion` lint rule |

## Feature detail

Each canonical name, its subfeatures, and who ships it. "Us" refers to this repository;
the evidence column names the file or test, so any row can be checked rather than
trusted.

### 1. Primitive ramp -- Shipped

A raw, meaning-free scale that components must never reference directly.

| Subfeature | Us | Radix | Primer | M3 | Tailwind | Carbon | Fluent 2 | Spectrum | Polaris | Pico | Bulma |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Numeric steps | 14 | 12 | `base/scale/*` | `ref/*` | oklch ramps | `$gray-10..100` | `ColorPalette*` | palette steps | ramp | 1-3 tones | derived |
| Gamut | sRGB hex out of oklch source | P3 + sRGB | sRGB | P3 | oklch | sRGB | sRGB | sRGB | sRGB | sRGB | sRGB |
| Ramp integrity tests | yes | docs only | no | no | no | no | no | no | no | no | no |

The last row is the real difference. Six ramps (neutral, accent, success, warning,
danger, info) x 14 steps, and a test that fails the build if a ramp is incomplete,
non-monotonic in lightness, multi-hue, or out of gamut. Every library here *has* ramps;
almost none *check* them.

**Divergence:** we author in OKLCH but emit hex. That loses wide-gamut fidelity on
displays that support it. Radix and M3 ship P3. This is a deliberate trade for
`contrastRatio` being computable from the shipped value -- the contract verifies what
ships, not what was authored -- and it is the right trade for a system whose central
claim is verifiability. It is still a real capability gap, and it is cheap to close by
emitting `oklch()` alongside the hex pair.

### 2. Semantic alias -- Shipped

The meaning layer. Components read these and never a primitive.

- **Us:** 42 semantic colour tokens, `<role>-<variant>[-<state>]`, per-scheme values.
- **Enforced** by `no-color-literals` (30 colour functions) plus the documented rule
  that a component referencing a primitive is a bug.
- **Radix** has no semantic layer at all. Its position is that a scale *step* is the
  semantic unit: `--blue-4` for a component background, `--blue-11` for its text. Fewer
  indirections, and the burden moves to whoever picks the step.
- **Carbon, Primer, Fluent 2, M3** all separate primitive from alias explicitly.
  Fluent's is the cleanest statement: "Global tokens are context-agnostic and store raw
  values. Alias tokens add semantic meaning."
- **GOV.UK** enforces the boundary in a way nothing else does -- `govuk-functional-colour()`
  is a function, and the docs say "do not copy the specific hex values."

### 3. Component token -- Absent

### 4. Surface ladder -- Shipped

Backgrounds, from page canvas to inverted overlay.

| Subfeature | Us | Carbon | Primer | M3 | Radix | Spectrum |
| --- | --- | --- | --- | --- | --- | --- |
| Canvas / page | `bg-canvas` | `$background` | `canvas.default` | `surface` | step 1-2 | `$spectrum-gray-50` |
| Content surface | `bg-surface` | `$layer-01` | `bgColor.default` | `surface-container-low` | step 3 | gray-100 |
| Raised | `bg-raised` | `$layer-02` | `bgColor.emphasis` | `surface-container-high` | step 9 | gray-200 |
| Overlay | `bg-overlay` | `$overlay` | `bgColor.overlay` | `surface-container-highest` | step 9 | gray-100 |
| Sunken / inset | `bg-sunken` | `$layer-accent-01` inverse | -- | `surface-container-lowest` | -- | gray-100 |
| Subtle | `bg-subtle` | `$layer` | `bgColor.muted` | `surface-container-low` | step 2 | gray-50 |
| Muted (hover) | `bg-muted` | `$layer-02` | `bgColor.muted` | -- | step 3 | -- |
| Inverse | `bg-inverse` | `$background-inverse` | `bgColor.inverse` | `inverseSurface` | -- | `$spectrum-gray-900` |

Seven surfaces, each a declared contrast pair in both schemes. The distinction between
`bg-raised` and `bg-overlay` is real and not redundant: raised is a card that sits above
the canvas, overlay is a popover that must separate from *both* canvas and the raised
surface beneath it.

**Where we are thinner:** no **layer-01..05 numbered ladder**. Carbon's numbered tiers
and M3's `surface-container-*` depths let a consumer place a surface at "depth 3"
without knowing which step that is. Our names describe role rather than depth, which
reads better in a component but does not compose. A third-party component built against
this system cannot ask for "one step above raised".

### 5. Foreground ladder -- Shipped

| Subfeature | Us | Carbon | Primer | M3 |
| --- | --- | --- | --- | --- |
| Primary | `text-default` | `$text-01` | `fgColor.default` | `on-surface` |
| Secondary | `text-muted` | `$text-02` | `fgColor.muted` | `on-surface-variant` |
| Tertiary | `text-subtle` | `$text-03` | `fgColor.subtle` | -- |
| On solid fill | `text-on-accent` | `$text-04` | `fgColor-onEmphasis` | `on-primary` |
| On inverse | `text-inverse` | `$text-inverse` | `fgColor-onInverse` | `inverse-on-surface` |
| Inverse secondary | `text-inverse-muted` | -- | -- | -- |
| Link | `accent-text` | `$link` | `fgColor-link` | `primary` |

21 declared contrast pairs, verified in both schemes at build time; the compiler
refuses to emit `tokens.css` if any pair fails its minimum.

`text-on-accent` is the token that catches the most common dark-mode failure, and its
comment in `src/tokens/semantic/color.ts` says why: the light-mode accent fill is a
deep blue needing white text, the dark-mode fill is a light blue needing near-black.
Hard-coding white is the standard bug.

`text-inverse-muted` is a token no other library in the set appears to ship, and it
exists because of a measured failure: `text-muted` on a dark surface collapses to about
1.8:1. An inverted surface needs its own foreground ramp, not a reuse.

### 6-7. Boundary ladder and non-text boundary -- Shipped

These are two contracts in one place because keeping them apart is the point.

| Subfeature | Us | Carbon | Primer | M3 |
| --- | --- | --- | --- | --- |
| Decorative subtle | `border-subtle` | `$border-subtle-01` | `borderColor.muted` | `outline-variant` |
| Decorative default | `border-default` | `$border-subtle-01` | `borderColor.default` | `outline` |
| Decorative strong | `border-strong` | `$border-strong-01` | -- | -- |
| **Non-text (3:1)** | **`border-interactive`** | `$focus`, `$border-interactive` | `borderColor.default` on controls | `outline` |

`border-interactive` is declared in `contrastPairs` at `min: 3` against `bg-canvas` and
is not used for decoration. Four of the ten libraries separate this; six do not, and
inherit WCAG 1.4.11 failures on control boundaries.

### 8. Focus indicator -- Shipped

Two tokens, deliberately: `focus-ring` and `focus-ring-offset`. The offset creates a gap
so the ring stays visible when the component colour is close to the focus colour -- a
single-token system has to pick one and accept the failure in half the cases.

`preserve-focus` is a lint rule: unscoped `outline: none` is rejected, and the only legal
form is scoped to `:not(:focus-visible)`. The base layer applies
`focus-visible` styling to `a, button, input, select, textarea, summary, [tabindex]`
and neutralises it on `focus:not(:focus-visible)`.

Fluent ships `focusStroke` and `focusStrokeOuter` -- the same two-token split, arrived at
independently. That is a good sign for the pattern.

### 9. Status family -- Partial

| Subfeature | accent | success | warning | danger | info |
| --- | --- | --- | --- | --- | --- |
| Solid background | yes | yes | yes | yes | yes |
| Subtle background | yes | yes | yes | yes | yes |
| Text | yes | yes | yes | yes | yes |
| Border | yes | yes | yes | yes | yes |
| **Hover / active** | **yes** | **no** | **no** | **no** | **no** |

Four families x four roles, consistent in shape, and then inconsistent in one place:
only accent has state variants. Every library in the set that ships status colour gives
each family a hover and active step -- Carbon's `$support-success-02`/`-03`, Primer's
`bgColor-success-emphasis` against `-muted`, Fluent's
`StatusForegroundSuccess` family. A danger button with a status background currently
cannot express hover without dropping to a token outside its own family.

This is the cheapest Partial in the document to close: four tokens per family, sixteen
in total, all already derivable from the existing ramps, all checkable by the existing
contract. It should not be left as a known inconsistency.


A token scoped to one component, overriding the semantic layer for that component only.

- **Us:** none. No `--fc-button-*`, no per-component colour token exists.
- **Primer:** the largest implementation in production. The compiled functional theme
  contains `--button-primary-bgColor-active`, `--button-primary-bgColor-hover`,
  `--button-primary-bgColor-disabled`, `--control-checked-bgColor-*`,
  `--controlKnob-bgColor-*`, `--counter-bgColor-*`, `--avatarStack-fade-bgColor-*`.
- **Carbon** ships a documented component-token table per component.
- **M3** has `md.comp.*`; **Spectrum** separates global and component tokens by
  directory.

**This is a deliberate omission, and it is the most debatable choice in the system.**
`docs/ARCHITECTURE.md` gives the reason: per-layer distribution, so "an application that
has built its own components does not need ours", plus zero-specificity reset and base
layers so a component class always wins. A component token layer would undercut both --
it moves decisions from the cascade into the token table.

The cost is real and should be recorded rather than argued away. A consumer who wants
"the primary button is blue, not accent" currently cannot express it in tokens; they
must author CSS in `fc.overrides`. For a system whose stated audience includes
multi-brand product teams, that is a genuine limitation, and Primer's Button token set
is the concrete example of what is being traded away. It belongs on the roadmap as an
explicit decision to revisit, not as a permanent principle.

| 20. Syntax role | Shipped | 25 tokens, 17 roles; 6 declared contrast pairs |
| 21. ANSI role | Shipped | 21 tokens; 3 declared contrast pairs |
| 22. Diff role | Shipped | Added/removed as surface *and* foreground, not surface alone |
| 23. Machine-readable state | Shipped | 8 `data-fc-*` attributes, AGENTS.md contract |

**Shipped: 17. Partial: 4. Absent: 2.**

The two Absent rows are the substantive findings, and both are discussed in
[Gaps](#gaps-that-are-actually-gaps).

Four collisions in that table are worth naming explicitly, because getting them wrong is
how a design system rots:

- **Surface (4) and layer order (18) are unrelated** despite sharing the word "layer".
  One is a background ramp, the other is a stacking scale. Carbon uses `$layer-01` for
  the first and `$zIndex` for the second; conflating them is common and wrong.
- **Boundary ladder (6) and non-text boundary (7) are different contracts.** The first
  is decorative separation. The second carries WCAG 1.4.11 at 3:1 against its
  adjacent background. Merging them means either decorative borders that fail a
  contrast requirement, or focusable controls whose outlines are decoration.
- **Focus indicator (8) is two tokens, not one.** Ring colour and ring offset are
  separate because a single-colour ring disappears on a same-coloured component.
- **Status family (9) and brand accent (12) are not the same axis.** Accent is one
  family with a full state ramp; status has four families. Primer's
  `bgColor-accent-muted` and `bgColor-success-muted` are different tokens for the same
  reason.

library, 500+ props, and the only one with a `--motionOK` custom-media convention),
**GOV.UK Design System** (functional colour via a Sass *function*, which forbids
hand-copying hex, and the only serious tints-and-shades alternative to a numeric ramp),
and **Tokens Studio** (the de facto token pipeline, and the reason multi-theme token
*sets* are a category at all).

Semantic UI was considered and excluded. It is the only library here whose name matches
the request, and it is unmaintained, jQuery-coupled, and ships no token layer. Including
it would have meant scoring a project on intent rather than implementation.

# Semantic coverage

What the rest of the design-system world means by "semantic", mapped onto what this
system means by it, feature by feature and subfeature by subfeature.

This document exists because "semantic CSS" is not one idea. Ten widely-used systems
use the word for at least four different things, and most of them use it for a fifth
thing that is not a CSS feature at all. Comparing them line by line produces noise.
Comparing them through a shared vocabulary produces the gap list at the bottom of this
file, which is the only part anyone actually acts on.

**Nothing here is aspirational.** Every status is checked against the working tree.
Where a claim in another `docs/` file disagrees with the code, this document says so
and names the file.

---

## 1. Method

- Ten libraries surveyed. Each one's token taxonomy was read from its own
  documentation rather than from memory; the source URL is in the table.
- Features that mean the same thing under different names were collapsed into
  **one canonical name** (§3) before any status was assigned. Assigning a status
  per library and then trying to merge produces a comparison nobody can read.
- Status was assigned against `src/tokens/`, `src/css/`, `dist/tokens.css`, and the
  test suite. Not against documentation. Where the two disagree, the disagreement
  is itself the finding (§9).
- Subfeatures are listed separately from main features because most gaps in this
  ecosystem are subfeature gaps. A system with a spacing scale and no tracking scale
  does not have "typography"; it has most of typography.

### Status legend

| | Meaning |
| --- | --- |
| **Done** | Implemented, covered by a test or a lint rule, and documented. |
| **Partial** | Works for the common case; the ceiling is documented rather than hidden. |
| **Absent** | Not implemented. Not a claim about priority. |
| **Declined** | Decided against on purpose, with a reason. Not a gap. |

---

## 2. The ten libraries

| # | Library | Model | Tier vocabulary | Source |
| --- | --- | --- | --- | --- |
| 1 | **Primer Primitives** (GitHub) | Semantic-first, accessibility-literal | `base` → `functional` → `component` | [primer.style](https://primer.style/primitives) |
| 2 | **Material Design 3** (Material Web) | Token-first, scheme-driven | `ref.*` → `sys.*` → `comp.*` | [github.com/material-components/material-web](https://github.com/material-components/material-web) |
| 3 | **Radix Colors** | Scale-first | 12 unnamed-by-role steps | [radix-ui.com/colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) |
| 4 | **IBM Carbon** | Semantic-first, AI-augmented | `core` → `component` → `ai` | [carbondesignsystem.com/elements/color/tokens](https://carbondesignsystem.com/elements/color/tokens/) |
| 5 | **Microsoft Fluent 2** | Two-layer | `global` → `alias` | [fluent2.microsoft.design/design-tokens](https://fluent2.microsoft.design/design-tokens) |
| 6 | **Adobe Spectrum CSS** | Component-first | `global` → `component` | [github.com/adobe/spectrum-css](https://github.com/adobe/spectrum-css) |
| 7 | **Shopify Polaris** | Flat groups | group → component, `--p-` prefix | [github.com/Shopify/polaris](https://github.com/Shopify/polaris) |
| 8 | **Tailwind CSS v4** | Utility-API-first | one `theme` namespace, no tiers | [tailwindcss.com/docs/theme](https://tailwindcss.com/docs/theme) |
| 9 | **Chakra UI v3** | Condition-first | `semantic` tokens + named `conditions` | [chakra-ui.com](https://chakra-ui.com/docs/theming/customization/conditions) |
| 10 | **Pico CSS** | Element-first, classless | one flat `--pico-*` namespace | [picocss.com/docs](https://picocss.com/docs) |

Three more were read while mapping and are cited where they are the clearest
example of a single subfeature, because they are unusually explicit about it:

- **GOV.UK Design System** — the strictest functional-colour vocabulary of any
  mature system, and the only one that forbids consumers from touching hex values
  outright. [design-system.service.gov.uk/styles/colour](https://design-system.service.gov.uk/styles/colour/)
- **Open Props** — a CSS-variable library with no component layer at all, useful as
  the lower bound of what "semantic" costs and delivers. [open-props.style](https://open-props.style/)
- **Bulma** — Sass-first, the last major framework where semantic classes are the
  primary API surface rather than an escape hatch. [bulma.io](https://bulma.io/)

### The four meanings of "semantic" in these ten

Before the vocabulary table, it is worth being precise about the disagreement,
because it is the reason a naive feature comparison fails.

1. **Semantic tokens** — Primer, Material, Carbon, Fluent, Spectrum, Polaris,
   Chakra. Tokens named by *role* (`bg-surface`, `$background`, `surface-container`)
   rather than by value (`gray-100`, `Neutral3`).
2. **Semantic classes** — Pico, Bulma, and historically Semantic UI. Class names
   named by *meaning* (`<nav>`, `.button`) rather than by appearance
   (`.btn-gray`, `.mt-4`). Primer's product layer and ours sit here too, but treat
   it as one technique among several rather than the thesis.
3. **Semantic HTML** — Pico's classless mode, Primer's accessibility posture,
   ours. Styling `<button>` is "semantic" in that the markup carries meaning CSS
   can respond to without inventing classes.
4. **Machine-readable semantics** — Radix `data-state`, Chakra conditions,
   Reakit, and ours. The DOM exposes state as attributes so that styling and
   automation read the same source.

The first three are styling concerns. The fourth is an interface contract, and it
is the one where this system is furthest ahead of every library surveyed.

---

## 3. Canonical vocabulary

One name per concept. The right-hand column lists what the other nine call the same
thing, so a search of any of their documentation lands here.

These are role-equivalences, not literal value equivalences. Where a library's
choice is genuinely *different* rather than differently-named, the coverage table
in §4 says so instead of quietly scoring it as a match.

### 3.1 Token architecture

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Primitive** | base, global, ref, raw, palette | `src/tokens/palette.ts` — 6 OKLCH ramps × 14 steps |
| **Semantic** | functional, alias, sys, role | `src/tokens/semantic/` — 42 color tokens + domain palettes |
| **Component** | comp, component token, override | *no such tier* — see §7.1 |

### 3.2 Surface roles

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Canvas** | app background, `$background`, `surface`, page | `bg-canvas` |
| **Surface** | layer, container, card, `$layer-01` | `bg-surface` |
| **Raised** | raised, elevated, `$layer-02` | `bg-raised` |
| **Overlay** | popover, modal, dialog, flyout | `bg-overlay` |
| **Sunken** | inset, well, gutter, trough | `bg-sunken` |
| **Subtle** | quiet, secondary fill, `$layer-01` | `bg-subtle` |
| **Muted** | hover fill, state fill, `$background-hover` | `bg-muted` |
| **Inverse** | inverted, `$background-inverse`, high-contrast fill | `bg-inverse` |

`Subtle` and `Muted` are the pair most systems blur together. They are listed
separately here because they answer different questions: `Subtle` is a resting
appearance, `Muted` is what an interaction leaves behind. Carbon keeps both
(`$layer-01` vs `$background-hover`) and so do we.

### 3.3 Foreground roles

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Foreground primary** | `$text-01`, `fg-default`, `text`, on-surface | `text-default` |
| **Foreground secondary** | `$text-02`, `fg-muted`, `text-secondary` | `text-muted` |
| **Foreground tertiary** | `$text-03`, placeholder, `text-tertiary`, `fg-subtle` | `text-subtle` |
| **Foreground inverse** | `$text-inverse`, on-inverse | `text-inverse` |
| **Foreground inverse secondary** | `$text-inverse-secondary`, `text-inverse-muted` | `text-inverse-muted` |
| **Foreground on-solid** | `on-primary`, `$text-on-color`, step 9/10 foreground | `text-on-accent` |

The first three are near-universally numbered (`-01`/`-02`/`-03` in Primer and
Carbon, `primary`/`secondary`/`tertiary` in Fluent and Pico, `text`/`subtle`/`muted`
in Polaris). We use `default`/`muted`/`subtle`, which is the one naming in the set
that is shared by nobody else. See §9.1.

**Foreground on-solid** deserves its own entry. It is the single most common
dark-mode accessibility failure in this ecosystem: a solid accent fill whose
foreground is hardcoded to white. Radix solves it by publishing, per scale, which
of step 9 or step 10 is designed for a dark foreground. Material solves it with
`on-primary`. We solve it with a per-scheme token, which is the same idea under a
name that says what it is for.

### 3.4 Stroke and focus roles

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Stroke default** | `$border-subtle-01`, `border-default`, divider | `border-default` |
| **Stroke subtle** | `$border-subtle-01`, hairline, separator | `border-subtle` |
| **Stroke strong** | `$border-strong-01`, `stroke-strong` | `border-strong` |
| **Control boundary** | `$focus` (Carbon), `border-control`, `outline` | `border-interactive` |
| **Focus ring** | `outline-focus`, `$focus-outline`, focus ring | `focus-ring` |
| **Focus offset** | `$focus-inset`, ring offset, halo | `focus-ring-offset` |

The last three are kept apart on purpose. Several systems collapse "the boundary
that satisfies WCAG 1.4.11" and "the indicator shown on keyboard focus" into one
token. Primer separates `border.default` from `outline.focus`; Fluent separates
`StrokeControl` from `StrokeFocus`. They are different requirements with different
consequences, and merging them makes one of the two impossible to express.

### 3.5 Accent and status roles

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Accent fill** | `$background-brand`, brand-bg, primary | `accent-bg` |
| **Accent fill hover** | `$background-brand-hover` | `accent-bg-hover` |
| **Accent fill active** | `$background-brand-active` | `accent-bg-active` |
| **Accent subtle fill** | `$background-brand-hover`, subtle | `accent-bg-subtle` |
| **Accent text** | `$link`, link-fg, brand text | `accent-text` |
| **Accent stroke** | `$focus`, brand border | `accent-border` |
| **Success / Warning / Danger / Info** | positive, caution, error/critical, informative | same names — universal |

The status vocabulary is the one place the ecosystem is already unanimous, and the
only naming we inherited without having to choose.

### 3.6 Scale vocabulary

Every canonical name from §3, with status. This is the table to argue with.

### 4.1 Token architecture and colour

| Feature | Subfeature | Status | Where |
| --- | --- | --- | --- |
| **Primitive** | OKLCH ramps | **Done** | `palette.ts`, 6 ramps × 14 steps |
| | Completeness, monotonic lightness, hue, gamut | **Done** | `tests/contrast.test.ts` |
| **Semantic** | Surface roles (8) | **Done** | 8 `bg-*` tokens |
| | Foreground roles (6) | **Done** | 6 `text-*` tokens |
| | Stroke roles (4) | **Done** | `border-subtle/default/strong/interactive` |
| | Accent roles (6) | **Done** | `accent-*` incl. hover + active |
| | Status families ×4 | **Done** | `success-`, `warning-`, `danger-`, `info-` |
| | Per-scheme value on every token | **Done** | 91 of 165 tokens are `light-dark()` |
| | Contrast contract enforced at build | **Done** | 21 pairs × 2 schemes, `checkContrast` |
| | Hex lockdown (GOV.UK-style) | **Done** | `no-color-literals` lint rule |
| **Component tier** | per-component overrides | **Absent** | deliberate — §7.1 |
| | Theme-set / multi-brand mechanism | **Partial** | remap `--fc-color-*` by hand |
| | Seed-based / dynamic colour | **Absent** | Material You equivalent; unplanned |
| **Domain palettes** | Syntax highlighting (25 tokens) | **Done** | `semantic/syntax.ts`, 6 pairs |
| | Terminal ANSI (21 tokens) | **Done** | `semantic/terminal.ts`, 3 pairs |
| | Diff add / remove | **Done** | `syntax.ts` bg + fg |
| | Data-viz categorical ramp | **Absent** | none of the ten ship one either |
| **Scheme** | Light / dark | **Done** | `light-dark()`, `color-scheme` |
| | Explicit override attribute | **Done** | `[data-fc-theme]` |
| | High-contrast token tier | **Absent** | §7.6 |
| | `prefers-contrast` | **Absent** | §8.7 |

### 4.2 Non-colour scales

| Feature | Subfeature | Status | Where |
| --- | --- | --- | --- |
| **Spacing** | rem-based scale | **Done** | 17 steps, 4px base |
| **Type** | size scale | **Done** | 12 steps |
| | composite type styles | **Absent** | §8.2 |
| | tracking scale | **Absent** | §8.2 |
| | family roles | **Partial** | 2 (sans, mono); Material has 6 |
| | `text-wrap: balance` on headings | **Done** | `base.css` |
| | line height, weight | **Done** | 5 + 4 steps |
| | measure / content max | **Done** | `75ch`, `65ch` |
| | locale-sensitive type rules | **Done** | `INTERNATIONALIZATION.md` |
| **Shape** | radius scale | **Done** | 6 steps |
| | stroke scale | **Done** | 4 steps |
| **Elevation** | shadow scale | **Partial** | 2 steps; others ship 6+ — §9.3 |
| | z-index scale | **Done** | 9 named steps, linted closed |
| | opacity scale | **Done** | 4 steps incl. scrim |
| **Sizing** | target size | **Done** | `min`, `comfortable` |
| | control size scale | **Absent** | §8.3 |
| | density modes | **Absent** | open question 4, `PLAN.md` |
| **Breakpoints** | breakpoint scale | **Absent** | §8.4 — deliberate |
| | container queries | **Absent** | open question 3, `PLAN.md` |
| **Motion** | duration scale | **Done** | 4 steps |
| | easing set | **Done** | 4 curves, enter/exit paired |
| | transition recipe token | **Absent** | §8.5 |
| | spring / expressive motion | **Absent** | Material Expressive equivalent |
| | reduced motion | **Done** | reset block + 6 components |

### 4.3 Structure, semantics, accessibility

| Feature | Subfeature | Status | Where |
| --- | --- | --- | --- |
| **Layers** | declared order, 7 layers | **Done** | `index.css` |
| | zero-specificity reset + base | **Done** | `:where()` throughout, linted |
| | consumer override layer | **Done** | `fc.overrides`, empty by default |
| | per-layer distribution | **Done** | 12 published files |
| **Reset** | margins, `box-sizing`, media defaults | **Done** | `reset.css` |
| | `[hidden]`, `[role=list]`, `autofill` | **Done** | `reset.css` |
| | tabular figures via `[data-numeric]` | **Done** | `reset.css` |
| **Base** | headings, body, lists, tables, forms | **Done** | `base.css`, ~30 rules |
| | links, focus-visible, `::selection` | **Done** | `base.css` |
| | usable classless baseline | **Done** | zero classes renders legibly |
| **Layout** | stack, cluster, sidebar | **Done** | `layout.css` |
| | intrinsic grid, container, center | **Done** | `grid-auto`, `container`, `center` |
| | truncate, line-clamp | **Done** | `truncate`, `clamp-2/3` |
| | scroll region | **Done** | `scroll-x` |
| | RTL by construction | **Done** | logical properties only |
| | `min-inline-size: 0` overflow fix | **Done** | applied to all 3 primitives |
| **Components** | 10 shipped | **Done** | button, chat, tool-call, editor, menu, grid, webview, terminal, code, diff |
| | form controls | **Absent** | Phase 3; select is next |
| | overlays | **Absent** | Phase 3 |
| | navigation | **Absent** | Phase 3 |
| **Accessibility** | keyboard, focus-visible, skip link | **Done** | base + `.fc-u-visually-hidden` |
| | forced-colors per component | **Done** | 14 blocks across 10 files |
| | target size | **Done** | token + button/grid |
| | contrast verified in both schemes | **Done** | 30 pairs total |
| | `prefers-reduced-motion` | **Done** | reset + 6 components |
| | live-region politeness | **Absent** | needs a toast component |
| | APCA alongside WCAG | **Absent** | open question 2, `PLAN.md` |
| **DOM contract** | `data-fc-state` machine-readable | **Done** | 61 uses, 8 valid values |
| | `kind/id/seq/role/ts/truncated` | **Done** | all six declared, all used |
| | additive, never styling-dependent | **Done** | documented in `AGENTS.md` |
| **Behaviour** | JS bindings | **Done** | `src/js/`, 8 modules |
| | optional WASM accelerator | **Done** | 5 crates, parity tested |
| | highlight / diff / markdown | **Done** | 6 languages, Myers, round-trip |

---

| --- | --- | --- |
| **Stroke default** | `$border-subtle-01`, `border-default`, divider | `border-default` |
| **Stroke subtle** | `$border-subtle-01`, hairline, separator | `border-subtle` |
| **Stroke strong** | `$border-strong-01`, `stroke-strong` | `border-strong` |
| **Control boundary** | `$focus` (Carbon), `border-control`, `outline` | `border-interactive` |
| **Focus ring** | `outline-focus`, `$focus-outline`, focus ring | `focus-ring` |
| **Focus offset** | `$focus-inset`, ring offset, halo | `focus-ring-offset` |

The last three are kept apart on purpose. Several systems collapse "the boundary
that satisfies WCAG 1.4.11" and "the indicator shown on keyboard focus" into one
token. Primer separates `border.default` from `outline.focus`; Fluent separates
`StrokeControl` from `StrokeFocus`. They are different requirements with different
consequences, and merging them makes one of the two impossible to express.

### 3.5 Accent and status roles

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Accent fill** | `$background-brand`, brand-bg, primary | `accent-bg` |
| **Accent fill hover** | `$background-brand-hover` | `accent-bg-hover` |
| **Accent fill active** | `$background-brand-active` | `accent-bg-active` |
| **Accent subtle fill** | `$background-brand-hover`, subtle | `accent-bg-subtle` |
| **Accent text** | `$link`, link-fg, brand text | `accent-text` |
| **Accent stroke** | `$focus`, brand border | `accent-border` |
| **Success / Warning / Danger / Info** | positive, caution, error/critical, informative | same names — universal |

The status vocabulary is the one place the ecosystem is already unanimous, and the
only naming we inherited without having to choose.

---
### 3.6 Scale vocabulary

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Spacing scale** | spacing, inset, size, gap | `space` — 17 steps |
| **Type scale** | font-size, text scale, t-shirt sizes | `fontSize` — 12 steps |
| **Type style** | typescale, composite type, `functional/typography` | *absent* — see §8.2 |
| **Line height** | leading | `lineHeight` — 5 steps |
| **Weight scale** | font-weight, weight | `fontWeight` — 4 steps |
| **Family scale** | typeface, font roles (Material has 6) | `fontFamily` — 2 steps |
| **Tracking scale** | letter-spacing, tracking | *absent* — see §8.2 |
| **Radius scale** | corner, border-radius | `borderRadius` — 6 steps |
| **Stroke scale** | stroke-width, border-width | `borderWidth` — 4 steps |
| **Elevation scale** | shadow, elevation, `box-shadow` | `shadow` — **2 steps**, see §9.3 |
| **Stacking scale** | z-index, layer, order | `zIndex` — 9 steps |
| **Opacity scale** | alpha, overlay | `opacity` — 4 steps |
| **Control size scale** | size, control height, density | *absent* — see §8.3 |
| **Target size** | hit area, minimum touch | `size-target-min` |
| **Measure** | content-max, line length | `size-content-max`, `size-measure` |
| **Breakpoint scale** | breakpoints, screens, min-width | *absent* — see §8.4 |
| **Duration scale** | duration, transition time | `duration` — 4 steps |
| **Easing set** | easing, curve, timing | `easing` — 4 curves |
| **Transition recipe** | transition shorthand, motion scheme | *absent* — see §8.5 |
| **Gradient scale** | gradient, mesh | *absent* |

### 3.7 Environment adaptation

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Scheme switching** | dark mode, theme, appearance, color scheme | `light-dark()` + `color-scheme` + `[data-fc-theme]` |
| **High-contrast scheme** | HC, forced theme, contrast theme | *absent* as a token tier |
| **Forced-colors adaptation** | forced colors, HCM, Windows high contrast | `@media (forced-colors: active)`, all 10 components |
| **Reduced motion** | motion preference | global reset block + 6 component blocks |
| **Contrast preference** | `prefers-contrast`, increased contrast | *absent* |
| **Reduced data** | `prefers-reduced-data` | *absent* |
| **Reduced transparency** | `prefers-reduced-transparency` | *absent* |
| **Direction-agnostic layout** | RTL support, logical properties | 30 physical longhands banned by the linter |
| **Bidi isolation** | `unicode-bidi`, `<bdi>`, mixed-direction runs | *absent* as a utility — see §8.6 |
| **Vertical writing** | `writing-mode`, tategaki | declined, documented |

### 3.8 Structural and semantic layers

| Canonical | Also called | Ours |
| --- | --- | --- |
| **Reset** | normalize, sanitize | `fc.reset`, zero-specificity via `:where()` |
| **Base** | element defaults, base styles, classless | `fc.base`, zero-specificity via `:where()` |
| **Layout primitive** | stack, cluster, grid, layout primitive | `fc.layout` — 8 primitives |
| **Component** | module, pattern, block | `fc.components` — 10 components |
| **Utility** | helper, escape hatch | `fc.utilities` — 27 classes |
| **Override** | overrides, patch layer | `fc.overrides` — declared, empty |
| **Cascade layer order** | layers, at-rules | 7 layers, documented precedence |
| **Machine-readable state** | `data-state`, conditions, `data-*` contract | `data-fc-*` — 19 attributes |
| **Live-region politeness** | `aria-live`, toast politeness | *absent* — no toast component |

---


