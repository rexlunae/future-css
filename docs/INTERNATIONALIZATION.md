# Internationalization

A styling system for multi-language systems has to answer a question most design systems
avoid: what happens when the text is different from what you designed against?

This document covers writing direction, text expansion, vertical text, and the specific
failure modes that appear in production multilingual software.

---

## The core mechanism: logical properties

There is no `rtl.css` in this system and no `[dir="rtl"]` override block. Not because RTL
support was deprioritized, but because writing direction is handled at the property
level, once, everywhere:

```css
/* physical */
.card { margin-left: 2rem; border-left: 4px solid; }

/* logical */
.card { margin-inline-start: 2rem; border-inline-start: 4px solid; }
```

The logical version is correct in left-to-right and right-to-left languages, and correct
for bidirectional text within a paragraph. There is nothing to mirror later because there
is nothing physical to mirror.

**This is enforced by lint.** Thirty physical longhands are rejected, covering margins,
padding, borders, border radii, offsets, `float`, `clear`, `text-indent`, and
`text-align` values. A `margin-left` cannot be committed.

### The mapping

| Physical | Logical |
| --- | --- |
| `margin-left` / `margin-right` | `margin-inline-start` / `margin-inline-end` |
| `margin-top` / `margin-bottom` | `margin-block-start` / `margin-block-end` |
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end` |
| `padding-top` / `padding-bottom` | `padding-block-start` / `padding-block-end` |
| `border-left` / `border-right` | `border-inline-start` / `border-inline-end` |
| `border-top` / `border-bottom` | `border-block-start` / `border-block-end` |
| `border-top-left-radius` | `border-start-start-radius` |
| `border-top-right-radius` | `border-start-end-radius` |
| `border-bottom-left-radius` | `border-end-start-radius` |
| `border-bottom-right-radius` | `border-end-end-radius` |
| `left` / `right` | `inset-inline-start` / `inset-inline-end` |
| `top` / `bottom` | `inset-block-start` / `inset-block-end` |
| `width` / `height` | `inline-size` / `block-size` |
| `text-align: left` | `text-align: start` |
| `float: left` | `float: inline-start` |

### What is genuinely direction-sensitive

A small number of things are *content*, not layout, and must respond to direction:

- **Progress bars and meters.** Fill grows from the start edge. Use logical sizing and
  let direction handle it; do not animate `width` from the left.
- **Charts and graphs.** Axis order reverses. This is data visualization, not layout.
- **Sliders.** The track fills from the start; the thumb position is mirrored by the
  browser automatically when the input uses logical semantics.
- **Code and identifiers.** Keep `dir="ltr"` on code samples even inside RTL prose.
  Identifiers are not natural language and must not be reordered by the bidi algorithm.
- **Iconography.** Directional icons (arrows, chevrons, back/forward) must mirror.
  Non-directional icons (a clock, a gear) must not. This is decided per icon, documented
  on each.

Everything else is already handled.

---

## Text expansion

Translations are longer. The usual rule of thumb is 30-50% expansion from English into
French, German, and Spanish, and considerably more in Finnish or Swedish. Layouts that
survive English routinely break in these languages.

### What breaks, and the system's answer

| Failure | Answer in this system |
| --- | --- |
| Button label overflows | `white-space: nowrap` is not set; buttons use intrinsic sizing with `min-block-size`, so labels push the button wider |
| Sidebar clips text | `.fc-truncate` exists, but paired with `title` or a tooltip so the full value stays reachable |
| Fixed-width columns overflow | `.fc-grid` uses `minmax(min(16rem, 100%), 1fr)`, so tracks never force a container wider than itself |
| Flex child refuses to shrink | `min-inline-size: 0` on all flex children, which fixes the classic unbreakable-string overflow |
| Tabs overflow their row | `.fc-scroll-x` for tab lists and chip rows |
| Long words break layout | `overflow-wrap: break-word` on prose in the base layer |
| Fixed-height text areas clip | `textarea` has `min-block-size` in `lh` units and is never height-locked |

**Never set a fixed height on a text container.** Use `min-block-size`. Content that
cannot grow to fit is content that becomes unreachable.

### German, specifically

German compounds are the canonical i18n layout failure. `Lieferantendatenbankverbindung`
is a single word with no break opportunity, and it will overflow any container narrower
than itself.

```css
overflow-wrap: break-word;
hyphens: auto;   /* opt-in, per element */
```

`hyphens: auto` produces correct hyphenation but requires a `lang` attribute on the
element or an ancestor to know the language. This is a markup responsibility: **every
document and every translatable subtree needs a correct `lang`.**

---

## Bidirectional text

Mixed-direction content (an English product name inside an Arabic sentence) requires
explicit isolation. Without it, punctuation and numbers jump to the wrong side.

```html
<p>الاشتراك <bdi lang="en">Enterprise Plan</bdi> nessljezi</p>
```

`<bdi>` isolates content whose direction is unknown or different from the surrounding
text. The `lang` attribute tells assistive technology how to pronounce it, which matters
more than the visual result.

Use `<bdo>` only when you deliberately want to override direction; it is almost never the
right tool.

### Numeric data

Numbers, dates, times, and currency must be locale-formatted, and CSS can help in two
specific ways:

```css
/* Decimal alignment in tables, in any direction */
.fc-u-tabular,
[data-numeric] { font-variant-numeric: tabular-nums; }
```

Tabular figures are required for numeric columns and actively wrong for running prose,
where proportional digits read better. That is why both forms exist: the attribute for
semantic tables, the utility for ad-hoc application.

`text-align: end` on numeric columns aligns them to the reading edge in both directions,
which is what makes one table work in LTR and RTL without a separate stylesheet.

### Truncation and ellipsis

An ellipsis at the visual end of an RTL string must render on the left, and
`text-overflow: ellipsis` handles this automatically because it follows the inline
direction. The common mistake is manually prepending `"..."` in JavaScript, which breaks
in RTL. Let the browser truncate.

---

## Writing systems beyond Latin

### CJK

Chinese, Japanese, and Korean change several assumptions:

- **No word spaces.** `word-break: normal` will not break CJK text at arbitrary points;
  browsers apply their own line-breaking rules based on the script. Do not force
  `word-break: break-all` globally -- it is wrong for Korean.
- **Tall, dense line boxes.** CJK glyphs fill the em box vertically, so `line-height: 1.5`
  is readable where Latin usually wants 1.6-1.7.
- **Mixed Latin and CJK.** Latin runs inside CJK text need spacing adjustments; this is
  handled by the font's metrics, so avoid `letter-spacing` overrides.
- **Vertical writing.** `writing-mode: vertical-rl` is a real requirement for Japanese
  and Chinese publishing. The system does not yet ship a vertical-text mode. Until it
  does, vertical layouts need explicit work, and that gap is recorded in the plan.

### Thai and Lao

Complex script shaping with combining marks above and below. `line-height` needs to be
generous (1.8+) because marks extend beyond the nominal em box. Also note the
`word-break` interaction: `line-break: normal` is required, and `word-break: break-all`
produces incorrect results because it ignores the shaping rules.

### Indic scripts (Devanagari, Tamil, Bengali)

Conjuncts and reordered vowel signs mean glyph counts per character exceed what the
Latin alphabet implies. Devanagari in particular forms ligatures that stack vertically and
can collide with a tight line box. Generous line height is not optional here.

### Arabic

- **Letterforms change shape and join.** Never apply `text-transform: uppercase` to
  Arabic; it is a no-op in most engines and meaningless in the script.
- **Diacritics (harakat) carry meaning.** They must not be clipped. Generous line height
  and no fixed heights.
- **Numerals.** Arabic-script locales commonly use Eastern Arabic-Indic digits
  (`٠١٢٣`) while often displaying Latin digits for technical values. Do not force a
  numeral system in CSS; format the data, then let CSS align it.
- **Punctuation mirroring.** The browser handles it for `text-align: start` layouts.

### Case-transform dependence

`text-transform: uppercase` is silently wrong in Turkish (`i` uppercases to `I`, but
dotted `i` must become `i` with a dot), in German (a sharp `s` becomes `SS`), and in
Greek. This system does not use `text-transform` on any translatable string. Uppercase
eyebrow labels should be authored uppercase in the translation, not produced by CSS.

---

## Dates, numbers, and locale

CSS cannot localize these. `Intl.DateTimeFormat`, `Intl.NumberFormat`, and
`Intl.RelativeTimeFormat` do it correctly, and the styling system's job is to accept
their output without assumptions:

```css
/* Never assume a fixed date width */
.date-cell { white-space: nowrap; font-variant-numeric: tabular-nums; }

/* Accept both "3/10/2026" and "2026-10-03" */
.date-cell { min-inline-size: max-content; }
```

Pluralization is a runtime concern and belongs to the message layer, not the stylesheet.
A design system that tries to solve plurals in CSS has misunderstood where the problem is.

---

## Language and script metadata

```html
<html lang="ar" dir="rtl">
```

`lang` affects hyphenation, line breaking, font fallback, and screen-reader pronunciation.
`dir` sets the base direction.

**Both are mandatory.** A missing `lang` is among the most common serious accessibility
defects in multilingual applications: a screen reader may read a Chinese page with an
English voice, and hyphenation silently stops working.

For content in a different language than the page, set `lang` on the subtree:

```html
<p>Read the <span lang="fr">guide de l'utilisateur</span> for details.</p>
```

### Logical properties for the whole document

`dir` should be set on `<html>`, and CSS should never assume `ltr`. The system's own test
fixture renders every component under both `dir="ltr"` and `dir="rtl"`.

---

## Verification

Direction and locale correctness are hard to eyeball and easy to automate:

1. **Bidi test fixtures.** Every component has an RTL fixture and a text-expansion fixture.
2. **Automate the overflow check.** A headless-browser pass that loads each fixture at
   320px and asserts `document.documentElement.scrollWidth <= innerWidth`. This catches
   horizontal overflow from unbreakable strings, which is the most common i18n defect.
3. **Real translations in CI.** Test with actual translated strings, not English strings
   padded with `&nbsp;`. Real scripts exercise shaping and line-breaking rules that
   synthetic fixtures do not.
4. **Screenshot review** in Arabic, German, Finnish, and Japanese at both schemes.
