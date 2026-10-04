# Conventions

Naming and structural conventions. These exist so that a developer who knows the
convention can guess the name of something they have never seen.

---

## Class naming

A modified BEM with a namespace.

```
fc-<block>[__<element>][--<modifier>]
fc-u-<property>-<value>     (utilities)
```

| Part | Meaning | Public? |
| --- | --- | --- |
| `fc-<block>` | The component | Yes |
| `fc-<block>__<element>` | An internal part | No -- not a stability guarantee |
| `fc-<block>--<modifier>` | A variant or size | Yes |
| `fc-u-<utility>` | An escape hatch | Yes |
| `is-<state>` / `has-<state>` | Dynamic state | Yes |

Examples:

```
fc-btn                    the button component
fc-btn--primary           variant
fc-btn--sm                size
fc-btn__label             internal part
fc-u-visually-hidden      utility
is-open                   open state
has-error                 error present
```

### Why elements are not public

`fc-btn__label` is an implementation detail. A consumer may use it today; if a future
version restructures the component, it can change without a breaking release. Public API
is the block and its modifiers, nothing below.

This is not documented in a footnote -- it is the reason the `__` element convention
exists separately from the `--` modifier convention.

### Why `is-` for state

`.is-open` reads as state rather than as a variant, and the distinction matters: variants
are chosen by the author and stay for the component's life; states are applied and removed
by JavaScript in response to what the user is doing.

`.is-loading` and `.fc-btn--loading` are not interchangeable. The first is transient; the
second is a permanent design variant.

### Why variants and sizes are separate

```html
<button class="fc-btn fc-btn--danger fc-btn--sm">Delete</button>
```

If size were part of the variant (`fc-btn--danger-sm`), six variants times three sizes
would need eighteen classes. Separate axes mean nine, and every combination is valid.

---

## Prohibited patterns

Each of these is a lint error or a documented no.

| Pattern | Why |
| --- | --- |
| `!important` | Defeats the layer strategy. Exemptions are enumerated in the linter |
| `#id` selectors | Specificity, unreusable |
| `.a.b` | Raises specificity for no benefit |
| Physical properties | Break under RTL. 30 longhands rejected |
| `text-align: left` | Does not follow writing direction |
| Raw hex / `rgb()` / named colors | Cannot be themed or contrast-checked |
| `px` units | Ignores the user's font-size preference |
| `outline: none` | Hides keyboard focus, unless scoped to `:not(:focus-visible)` |
| `transition: all` | Animates layout properties, causes jank |
| Raw `z-index` | Escapes the closed stacking scale |
| `role` duplicating native semantics | The element already has the role, plus behavior |
| Adjacent sibling chains (`a + b + c`) | Direction-fragile; use flexbox/grid `gap` |
| Deep nesting | Nesting beyond two levels should be a layout primitive |
| Long inline style blocks | If it needs a comment, it needs a class |

---

## CSS authoring rules

### One selector per rule

```css
/* good */
.fc-btn--primary { }
.fc-btn--primary:hover { }

/* bad -- two rules, one selector */
.fc-btn--primary, .fc-btn--danger { }
```

Multiple selectors are allowed when they share *all* declarations, but the convention is
one rule per selector, because a shared rule later needs to diverge and then requires
knowing which selector it came from.

### Nesting depth

At most two levels. Beyond that, extract a component or a layout primitive. Deep nesting
is what turns a stylesheet into something nobody can safely edit.

### Declaration order

Within a rule, order declarations from layout to paint, and group related properties:

```css
.fc-btn {
  /* display & box */
  display: inline-flex;
  min-block-size: var(--fc-size-target-min);

  /* spacing */
  padding-block: var(--fc-space-2);
  padding-inline: var(--fc-space-4);

  /* typography */
  font-size: var(--fc-font-size-sm);

  /* color & border */
  background-color: var(--fc-color-accent-bg);

  /* motion */
  transition: background-color var(--fc-duration-fast);
}
```

Consistent ordering makes two rules diffable and makes a missing declaration obvious.

### Comments explain *why*

```css
/* bad */
/* sets the padding */

/* good */
/*
 * Logical property so the callout's padding moves to the correct side in RTL.
 * Using margin-left here detaches the border from the content in Arabic.
 */
padding-inline-start: var(--fc-space-4);
```

The code says what the value is. The comment should say what would break, and why this
choice was made.

### One declaration per line

Except for `transition`, which lists multiple properties, and shorthand groups that are
genuinely a single unit. Vertical diffs depend on it.

---

## The utilities policy

Utilities are capped. The current layer has roughly twenty classes, and that number is a
budget rather than an accident.

### When a utility is allowed

All four must hold:

1. No component can express it.
2. It solves a genuinely one-off problem.
3. Its name is predictable from the convention.
4. It cannot be expressed as a token or a layout primitive.

### Current utilities

| Utility | Why it exists |
| --- | --- |
| `fc-u-visually-hidden` | Accessible hiding; used by every component |
| `fc-u-truncate` / `fc-clamp-*` | Content-dependent, no component fits |
| `fc-u-p-*`, `fc-u-m*` | One-off spacing adjustments |
| `fc-u-text-*` | Ad-hoc color and alignment |
| `fc-u-bg-*` | Surface overrides in a specific region |
| `fc-u-tabular` | Numeric data alignment |
| `fc-u-full-bleed` | Escapes a container's padding |
| `fc-u-hidden` | `display: none`, one of two permitted `!important` uses |
| `fc-u-scroll-smooth` | Opt-in smooth scrolling, safe under reduced motion |

### Why the cap matters

Utilities become a second styling language without governance. Once `.fc-u-mt-4` exists,
someone writes `.fc-u-mt-6`, then `.fc-u-mt-7`, then inline styles. The system has been
replaced by ad-hoc CSS wearing its prefix.

---

## Markup conventions

### Language attributes are mandatory

```html
<html lang="ar" dir="rtl">
```

Every document needs both. A missing `lang` breaks hyphenation, line breaking, and screen
reader pronunciation. For content in another language, set `lang` on the subtree.

### Direction on code and identifiers

```html
<code dir="ltr">const x = 1;</code>
```

Identifiers are not natural language and must not be reordered by the bidi algorithm.

### No placeholder-as-label

```html
<!-- wrong: disappears on input, often too low-contrast -->
<input placeholder="Email address">

<!-- right -->
<label for="email">Email address</label>
<input id="email" type="email" autocomplete="email">
```

### Icon-only controls need a name

```html
<button class="fc-btn fc-btn--icon" aria-label="Close">
  <svg aria-hidden="true" ...></svg>
</button>
```

### Decorative images

```html
<img src="chart.png" alt="">                      <!-- decorative -->
<img src="chart.png" alt="Sales rose 40% in Q3">  <!-- informative -->
```

`alt=""` is correct for decoration and is not an omission. An empty `alt` is a decision.

---

## File organization

```
src/css/components/<block>.css     one file per component block
```

- One component block per file. A "form" file containing field, select, checkbox, and radio
  makes `git diff` useless and invites accidental coupling.
- The file is named after the block, not the component page.
- Shared internal patterns go in the layout layer as primitives, not in a `_shared.css`.

---

## Documentation conventions

Every component documents:

1. **Anatomy** -- the required HTML, with a complete example.
2. **States** -- filled from the state matrix.
3. **Accessibility** -- role, name, keyboard interaction, announcements.
4. **Internationalization** -- direction behavior, expansion behavior, fixed-width risks.
5. **No-JS fallback** -- what happens when JavaScript does not run.
6. **When not to use it** -- the most useful section, and the most often omitted.
