# Accessibility

The target is **WCAG 2.2 Level AA**. This document states what is committed, how each
commitment is enforced, and where the honest gaps are.

The governing idea is in principle 2: an accessibility commitment that is not checked
does not get done. Every item below is either an automated check or an explicitly
acknowledged manual gate.

---

## What is enforced automatically

### Contrast ratios

All 19 declared pairings are evaluated in both color schemes at build time.

| Requirement | WCAG | Minimum |
| --- | --- | --- |
| Body text | 1.4.3 (AA) | 4.5:1 |
| Large text (18.66px+, or 14px bold) | 1.4.3 (AA) | 3:1 |
| Body text, enhanced target | 1.4.6 (AAA) | 7:1 |
| UI component boundaries, focus rings | 1.4.11 (AA) | 3:1 |
| Graphics and charts | 1.4.11 (AA) | 3:1 |

Body text is held to 7:1 where practical, above the AA requirement. Once a threshold is
met it tends to get used, so meeting AAA for primary text is cheap insurance.

Failures print the usage, the computed ratio, and the minimum:

```
Contrast contract violated:
  [light] Secondary text / helper copy: 4.41:1 (needs 4.5:1)
```

### Focus visibility

The lint rule `preserve-focus` rejects `outline: none` anywhere except a selector
explicitly scoped to `:not(:focus-visible)`. The distinction matters: removing the ring
for pointer interaction is correct, removing it unconditionally means keyboard users
cannot see where they are.

The system draws focus with `outline` plus a `box-shadow` in the offset color. The offset
creates a gap between the component edge and the ring, so the ring stays visible even when
the component's own border color is close to the focus color. This is the difference
between a ring that technically exists and one that is actually perceivable.

Under `forced-colors`, focus tokens are remapped to the system `Highlight` color, since
the OS suppresses the authored values.

### Physical properties

The `logical-properties` and `logical-values` lint rules. This is an accessibility
requirement as much as an internationalization one: a layout that breaks under RTL is
broken for RTL users, and RTL users include people with dyslexia and ADHD for whom reading
direction consistency materially affects comprehension.

### Reduced motion

The reset layer ships a blanket rule before any component exists:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Components that need to deviate must justify it. The button spinner does: it slows to a
crawl rather than freezing, because a spinner is the only loading affordance and freezing
it removes information rather than motion. That is the standard for an exemption -- the
animation must not be the only means of conveying state.

### Color literals and `px`

Neither is directly an accessibility rule, but both are load-bearing for accessibility:

- A literal color cannot be contrast-checked, so it silently becomes uncheckable text.
- A `px` value ignores the user's font-size preference. WCAG 1.4.4 requires text to be
  resizable to 200% without loss of content; absolute pixel sizing throughout a layout
  makes that impossible to guarantee.

---

## What is a review gate

Some requirements cannot be automated without a browser and a human. These are in the
component review checklist, and a component is not done until they pass.

### Per component

- [ ] Keyboard reachable, with a logical tab order matching visual order
- [ ] Activatable by keyboard: Enter and Space for buttons, arrows for composites
- [ ] Focus visible on every focusable element
- [ ] Focus not trapped except inside modal surfaces, where it is contained deliberately
- [ ] Target size at least 24x24 CSS pixels (WCAG 2.2, 2.5.8), 44x44 recommended
- [ ] Accessible name present, from visible text where possible
- [ ] Role correct, and not duplicating a native element's semantics
- [ ] State changes announced (`aria-expanded`, `aria-selected`, `aria-live` as appropriate)
- [ ] Color is never the only means of conveying information
- [ ] Text remains readable at 200% zoom and at 320px width
- [ ] Works with the layer structure if JavaScript fails

### Per release

- [ ] Screen reader pass: VoiceOver (Safari), NVDA (Firefox), JAWS (Chrome)
- [ ] Keyboard-only pass, no mouse
- [ ] `prefers-reduced-motion` pass
- [ ] `forced-colors` pass on Windows
- [ ] 200% and 400% zoom pass (WCAG 1.4.10, reflow)
- [ ] RTL and LTR rendering pass
- [ ] Automated scan with axe-core or equivalent, zero critical/serious

---

## Component-level commitments

### Buttons

- Real `<button>` elements, never `div` with a role.
- `min-block-size` of 1.5rem (24px), comfortably above the 2.5.8 minimum.
- Disabled uses `:disabled` for true removal from interaction and `aria-disabled` when the
  control must stay focusable so the user can discover *why* it is unavailable.
- Loading state sets `aria-busy` and **keeps the label in the DOM**, so the accessible name
  does not change and the control is never left unlabelled. Replacing a label with a
  spinner is a routine and avoidable regression.
- `focus-visible` ring from the base layer, no override.

### Form fields

```html
<label for="email">Email</label>
<input id="email" type="email" autocomplete="email"
       aria-describedby="email-hint" required>
<p id="email-hint">We use this for billing only.</p>
```

- Every control has a `<label>`. Placeholder text is not a label: it disappears on input
  and is frequently too low-contrast to read.
- `autocomplete` is set on every field where the value is known. This is what makes
  autofill work, and autofill is an accessibility feature for anyone with motor or memory
  impairments.
- Error state uses `:user-invalid`, not `:invalid`, so the field is not flagged before the
  user has typed anything.
- Errors are text, associated with `aria-describedby`, and marked `aria-invalid`. Color
  alone fails WCAG 1.4.1.
- Required fields use the `required` attribute, not a visual asterisk alone.
- Error summaries at the top of a form take focus on submission.

### Color is never the only signal

Every status in the system is triple-encoded: color, text, and shape or position.
A validation error is a red border *and* an icon *and* a message. A destructive action is
styled `danger` *and* labeled "Delete" *and* confirmed.

This also covers chart and data visualization, where a series must be distinguishable by
more than hue -- use marker shape, line style, or direct labeling.

---

## Known gaps

Stated plainly, because a gap that is written down can be scheduled and one that is not
will be discovered by a user.

| Gap | Impact | Plan |
| --- | --- | --- |
| No automated axe-core pass in CI | Regressions caught late | Phase 3, once components exist to test |
| No automated reflow check at 320px | Horizontal overflow can regress | Phase 2, with the i18n fixtures |
| No screen-reader testing in CI | Depends on manual review | Not automatable; keep as a release gate |
| No APCA contrast check | WCAG 2.x ratios only | Phase 4; APCA is the likely successor standard |
| Reduced-motion blanket rule is blunt | Disables non-essential motion too | Deliberate; per-component refinement comes with components |
| No cognitive accessibility guidance | Beyond the WCAG scope covered here | Phase 4 |

---

## Keyboard interaction reference

| Pattern | Keys |
| --- | --- |
| Button | Space, Enter |
| Link | Enter |
| Checkbox / radio | Space |
| Select (native) | Arrows, type-ahead |
| Menu / tabs | Arrows, Home, End, Escape |
| Dialog | Escape to close, Tab contained |
| Disclosure | Enter or Space to toggle |

Browsers implement the first four natively when the correct element is used, which is the
practical argument for principle 1: choosing `<button>` over `<div>` gets Space/Enter
handling for free, and hand-rolled versions routinely get it wrong.
