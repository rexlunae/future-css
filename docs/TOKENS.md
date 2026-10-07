# Design tokens

Tokens are the vocabulary of the system. This document covers the naming model, the
primitive-to-semantic split, theming, and how to add tokens.

---

## The three-tier model

```
Primitive     --fc-color-accent-600        a raw ramp step
   |
   v
Semantic      --fc-color-accent-bg         a role in the interface
   |
   v
Component     (not yet a tier in this system) --fc-btn-padding-inline
```

**Primitive tokens** are raw values with no meaning beyond their number. `--fc-color-accent-600`
is a specific blue. It is never referenced by a component.

**Semantic tokens** describe a role. `--fc-color-accent-bg` means "the background of a
primary action". This is the tier components use, and the only tier that varies between
themes.

The indirection is the whole point. When dark mode needs a lighter blue, the primitive
stays at 600 and the *semantic* alias points somewhere else:

```ts
"accent-bg": { light: accent["600"], dark: accent["400"] }
```

A component written against `accent-bg` is correct in both schemes without knowing either
exists.

**Why components do not get their own token tier (yet).** A `--fc-btn-padding-inline`
token is only justified when at least two components need the same value *and* the value
needs to be themeable. Spacing is not themeable, so component-level spacing tokens tend to
become indirection for its own sake. If a scale of component-specific overrides becomes
necessary, the tier will be added deliberately rather than by accumulation.

---

## Naming grammar

```
--fc-<category>-<variant>-<state>
```

| Category | Purpose | Example |
| --- | --- | --- |
| `color` | Semantic color roles | `--fc-color-accent-bg` |
| `space` | Spacing scale | `--fc-space-4` |
| `font-size` | Type scale | `--fc-font-size-xl` |
| `font-family` | Font stacks | `--fc-font-family-sans` |
| `font-weight` | Weights | `--fc-font-weight-semibold` |
| `line-height` | Leading | `--fc-line-height-tight` |
| `radius` | Corner radii | `--fc-radius-md` |
| `border-width` | Stroke widths | `--fc-border-width-thin` |
| `shadow` | Elevation | `--fc-shadow-raised` |
| `duration` | Transition timing | `--fc-duration-fast` |
| `easing` | Curves | `--fc-easing-standard` |
| `z` | Stacking scale | `--fc-z-modal` |
| `opacity` | Alpha values | `--fc-opacity-disabled` |
| `size` | Fixed sizes | `--fc-size-target-min` |

Rules:

1. **Semantic names only.** `--fc-color-bg-canvas`, never `--fc-color-gray-25`. A name
   that describes *what it looks like* cannot be re-themed.
2. **No component names in the token vocabulary.** If a token exists only for one
   component, it belongs in that component's CSS as a local variable.
3. **Values are named, not numbered, when the number is meaningless.** `--fc-size-target-min`
   beats `--fc-size-24`.
4. **Prefix everything.** `--fc-` makes the namespace obvious and prevents collisions in
   a consuming application.

---

## Color

### Ramps

Six ramps, each with the same fourteen steps:

`0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000`

| Ramp | Hue | Role |
| --- | --- | --- |
| `neutral` | 265 | Surfaces, text, borders. Slightly cool, not pure grey |
| `accent` | 255 | Primary actions and links |
| `success` | 150 | Confirmation. Shifted toward teal so it is not a traffic-light green |
| `warning` | 80 | Caution. Chroma held low because yellow is the hardest hue to keep legible |
| `danger` | 27 | Destructive actions and errors |
| `info` | 225 | Advisory. Distinct from accent so it does not read as an action |

Step `0` is pure white and step `1000` is pure black. A ramp that runs out of steps at
the extremes produces dark-mode surfaces that are "almost but not quite" black and
light-mode surfaces that are visibly grey.

Neutral is deliberately a slightly cool grey rather than true grey. Pure greys read as
dead next to saturated accents and shift the perceived hue of adjacent colors depending on
the display's white point.

### Semantic color roles

```
Surfaces      bg-canvas  bg-surface  bg-raised  bg-overlay
              bg-sunken  bg-subtle   bg-muted   bg-inverse
              bg-thumb

Foreground    text-default  text-muted  text-subtle
              text-inverse  text-inverse-muted
              text-on-accent  text-on-danger

Borders       border-default  border-subtle  border-strong  border-interactive

Accent        accent-bg  accent-bg-hover  accent-bg-active
              accent-bg-subtle  accent-text  accent-border

Status        <status>-bg  <status>-text  <status>-bg-subtle  <status>-border
              for success, warning, danger, info; plus danger-bg-hover

Focus         focus-ring  focus-ring-offset
```

**`border-interactive` exists separately from `border-default`.** Decorative borders
(between table rows) need no contrast guarantee. Interactive control boundaries do: WCAG
1.4.11 requires 3:1 against the adjacent background so a user can see where the input
field begins. Using one token for both means one of the two requirements gets violated.

**`text-on-accent` inverts between schemes.** In light mode the accent fill is deep, so
the label is white. In dark mode the fill is light, so the label must be near-black.
Hard-coding white is one of the most common dark-mode accessibility failures.
`text-on-danger` does the same for the danger fill. The danger button used
`text-default` until it had one, which put near-black on deep red in light mode.

**`bg-inverse` and `text-inverse-muted` exist as a pair.** "Inverse text" needs a defined
surface to be legible against, and secondary text on that surface needs its own ramp: the
light-mode `text-muted` value collapses to roughly 1.8:1 on a dark background. Both were
added because the contrast contract demanded them.

### The contrast contract

Every pairing the interface relies on is declared with a minimum ratio and checked at
build time in both schemes:

```ts
{ usage: "Secondary text / helper copy", fg: "text-muted", bg: "bg-surface", min: 4.5 }
{ usage: "Focus ring against the canvas (WCAG 1.4.11)", fg: "focus-ring", bg: "bg-canvas", min: 3 }
```

When a pair fails, the build fails and prints the usage, the ratio, and the minimum:

```
Contrast contract violated:
  [light] Secondary text / helper copy: 4.41:1 (needs 4.5:1)
```

This is the mechanism that makes dark mode accessible rather than merely different. A
color that passed in light mode can fail in dark mode, and only computation catches it.

---

## Theming

### Default behavior

```css
:root { color-scheme: light dark; }
```

The browser follows the user's OS setting. No JavaScript, no storage, no flash of the
wrong theme.

### Explicit override

```html
<html data-fc-theme="light">
<html data-fc-theme="dark">
```

```css
[data-fc-theme="light"] { color-scheme: light; }
[data-fc-theme="dark"]  { color-scheme: dark; }
```

Because every themed token is a `light-dark()` pair, setting `color-scheme` re-resolves
all of them at once. **A theme switcher needs to change one attribute and nothing else.**

A switcher should persist the choice and treat "system" as a distinct third state that
removes the attribute, so that a user who never expressed a preference keeps following
their OS.

### Authoring a brand theme

Override semantic tokens. Do not touch components.

```css
@layer fc.tokens {
  :root {
    --fc-color-accent-bg: light-dark(#5b21b6, #a78bfa);
    --fc-color-accent-text: light-dark(#5b21b6, #c4b5fd);
  }
}
```

Then re-run the contrast check. A brand theme that fails contrast should not ship, and
the check is the same function the default theme passed.

### Forced colors

```css
@media (forced-colors: active) {
  :root {
    --fc-color-focus-ring: Highlight;
    --fc-color-focus-ring-offset: Canvas;
  }
}
```

In Windows High Contrast the OS overrides component colors. Focus indicators are remapped
to system colors because a ring drawn from a suppressed token would vanish entirely,
leaving keyboard users with no visible focus at all.

---

## Spacing

A 4px base unit, in `rem`:

```
0  px  0-5  1  1-5  2  3  4  5  6  8  10  12  16  20  24  32
```

`rem` rather than `px` so spacing scales with the user's font size preference. A user at
20px base size gets proportionally more breathing room, which is the correct behavior.

Fractional steps (`0-5`, `1-5`) exist because optical alignment frequently needs half
steps, and without them people invent arbitrary values.

---

## Typography

Type scale in `rem`, line heights unitless:

| Token | Size | Typical use |
| --- | --- | --- |
| `--fc-font-size-xs` | 0.875rem | Small labels, table headers |
| `--fc-font-size-sm` | 0.875rem | Buttons, secondary UI |
| `--fc-font-size-md` | 1rem | Body |
| `--fc-font-size-lg` | 1.125rem | Lead paragraphs |
| `--fc-font-size-xl` | 1.25rem | h4 |
| `--fc-font-size-2xl` | 1.5rem | h3 |
| `--fc-font-size-3xl` | 1.875rem | h2 |
| `--fc-font-size-4xl` | 2.25rem | h1 |

Line heights are unitless so they scale with the element's own font size: a heading and
body copy at the same scale keep the same ratio of leading to text.

**Font stacks are system stacks.** `system-ui` first, then platform fonts, then generic
families. This is not a placeholder decision:

- No webfont download, so no FOUT and no layout shift.
- The user's own language and script render with the font their OS was configured with.
- Native hinting and small forms are correct in CJK and Devanagari, which web fonts
  typically get wrong.
- Arabic, Thai, and Indic scripts need proper shaping and mark positioning. The system font
  has it; a mismatched webfont may not.

A brand typeface overrides three tokens (`sans`, and optionally `mono`) and nothing else.

---

## Elevation and motion

Shadows are theme-aware, because a shadow that reads as depth on white reads as a smudge
on near-black. There are three: `raised` (cards, segmented controls), `overlay` (menus,
popovers, the select list), and `modal` (dialogs, toasts).

Each shadow is a list of layers whose geometry is shared across schemes and whose colour
is not. The compiler wraps each layer's *colour* in `light-dark()`:

```css
--fc-shadow-raised: 0 1px 2px 0 light-dark(rgb(16 18 27 / 0.06), rgb(0 0 0 / 0.4)), …;
```

It once wrapped the whole shadow instead, as `light-dark(<shadow>, <shadow>)`. That is
invalid -- `light-dark()` accepts colours only -- and an invalid custom property is not a
parse error, so every `box-shadow` reading the token silently computed to `none`. Menus,
the select list, and `.fc-u-shadow-raised` were all flat. `tests/bundle.test.ts` rejects
the wrapped form, and the browser suite asserts each token computes to a real shadow in
both schemes.

Durations are deliberately short -- 120ms to 300ms. Interface motion exists to explain a
state change, not to entertain; above roughly 300ms it reads as latency.

Easing is split by intent: `decelerate` for entering (motion settles into place),
`accelerate` for exiting (motion gets out of the way). `spring` overshoots by a few
percent, for a part that is thrown rather than revealed -- the switch thumb. More
overshoot than that reads as bounce and draws the eye on every toggle.

All durations collapse under `prefers-reduced-motion`, handled once in the reset layer.
Spinners are the one exception, excluded from that block by name: the block is
`!important` in the earliest layer, which no later layer can loosen, and a frozen spinner
reads as a hung page. Each spinner slows itself instead: rotating ones to a third of
their speed, bouncing and pulsing ones to an opacity-only fade.

Stacking is a closed scale: `base, raised, sticky, dropdown, overlay, modal, popover,
toast`. A new layer gets a named step and a review, not `z-index: 9999`.

---

## Adding a token

1. **Determine the tier.** Raw value (primitive), or a role in the interface (semantic)?
   If neither, it does not need to be a token.
2. **Name it by role.** `bg-muted`, not `gray-200`.
3. **If it is color, add its contrast pairs** to `contrastPairs` with the minimum ratio
   for the WCAG success criterion it serves.
4. **If it varies by theme**, give it both a light and a dark value. A one-sided theme
   token is almost always a mistake; either it is theme-invariant (use a literal) or it
   needs both values.
5. **Run `npm run check`.** The build fails if the contract is violated.
6. **Document it** in the table in the relevant section above.
