# Development plan

Phased roadmap with exit criteria. Each phase ends with a gate that can be checked, not a
judgment call.

**Current status: Phase 2 in progress.** Phases 0 and 1 are complete; Phase 2 has the
foundation built and the components remaining.

---

## Where we are

| Phase | Status | Delivered |
| --- | --- | --- |
| 0. Foundations | Complete | Repo, toolchain, decisions |
| 1. Token system | Complete | Palette, semantic layer, contrast contract, compiler |
| 2. Core CSS | In progress | Reset, base, layout, utilities, button, chat, tool-call |
| 3. Component set | Not started | Form controls, overlays, navigation |
| 4. Verification | Not started | Visual regression, browser matrix, docs site |
| 5. Platform expansion | Not started | Email build, print, native tokens |
| 6. Release | Not started | Publishing, versioning, governance |

### Working now

```
npm run build     119 tokens (44 theme-aware) + 8-file bundle, ~55 KB
npm run lint      14 rules, 0 violations
npm run test      58 tests passing
```

Verified: contrast contract enforced in both schemes, all ramps validated, linter verified
against both violations and legitimate patterns.

---

## Phase 0 -- Foundations (complete)

Repository structure, toolchain, and the architectural decisions that constrain
everything after.

- [x] Repository, MIT license, package manifest, TypeScript config
- [x] Zero-dependency toolchain: Node runs the TypeScript directly
- [x] Build, lint, and test scripts wired into `npm run check`
- [x] Cascade layer order declared and documented
- [x] Naming conventions decided (`--fc-`, `fc-` prefix)
- [x] Design principles written and agreed

**Exit criteria met.** `npm run check` runs clean from a fresh clone with no install step
beyond `npm install`.

---

## Phase 1 -- Token system (complete)

The palette and the pipeline that makes accessibility enforceable.

- [x] OKLCH ramps: neutral, accent, success, warning, danger, info
- [x] 14 steps per ramp, endpoints at pure white and pure black
- [x] Semantic layer with per-scheme values for every token
- [x] Contrast contract: 19 pairings, checked in both schemes at build time
- [x] Non-color scales: spacing, type, radius, border, motion, z-index, opacity
- [x] Token compiler emitting `tokens.css` and `tokens.json`
- [x] Contrast math verified against WCAG reference values
- [x] Ramp integrity tests: completeness, monotonic lightness, single hue, gamut

**Exit criteria met.** Changing any palette value and running the build either passes the
contrast contract or fails the build with a specific, actionable message.

Four defects were found and fixed by this contract during Phase 1, which is the clearest
evidence it earns its place:

1. Ramp step `0` was black while being used as the light-mode surface, making light mode
   render a black background.
2. `text-inverse` had no defined surface to be legible against, so its contrast pairing
   was meaningless (1:1).
3. `text-on-accent` was white in both schemes, which fails 4.5:1 in dark mode where the
   accent fill is light.
4. `text-muted` reused on an inverted surface collapsed to 1.8:1.

---

## Phase 2 -- Core CSS (in progress)

Everything a document needs before components exist. The reset, the semantic element
defaults, the layout primitives, the utilities, and the first component.

### Completed

- [x] Reset layer, all rules at zero specificity via `:where()`
- [x] Reduced-motion blanket rule shipped before any animation exists
- [x] Autofill styling for light and dark
- [x] Base layer: semantic element defaults for headings, prose, links, tables, forms,
  blockquotes, lists, selection
- [x] Focus ring with an offset ring for guaranteed visibility
- [x] Layout primitives: `fc-stack`, `fc-cluster`, `fc-sidebar`, `fc-grid`, `fc-container`
- [x] Direction-agnostic helpers: `fc-truncate`, `fc-clamp-*`, `fc-scroll-x`, `fc-center`
- [x] Utilities layer with the accessible-hiding pattern
- [x] Button component as the reference implementation
- [x] Chat surface (thread, message, lifecycle states, truncation)
- [x] Tool-call component (arguments, result, determinate and indeterminate progress)
- [x] Linter with 14 rules and a full test suite
- [x] Build orchestrator with per-layer outputs

### Remaining

- [ ] Text input, textarea, select
- [ ] Checkbox and radio
- [ ] Label and form field group
- [ ] Card / surface
- [ ] Badge and tag
- [ ] Alert / callout (the status family)
- [ ] Breadcrumb, and a minimal nav
- [ ] Fixture page rendering every component in every state, both directions, both schemes

### Defects found and fixed during Phase 2

Recorded because they are the best available evidence that the enforcement
mechanisms work:

1. **Indeterminate progress bar froze at 40% under reduced motion**, reading as
   "40% complete" -- a component stating something false. Now drawn full-width with a
   static striped fill, which conveys "working, extent unknown" without implying a
   percentage.
2. **The RTL progress sweep ran the wrong way.** `translateX` is a physical transform
   with no logical equivalent, so this is one of the genuinely direction-sensitive
   cases. Fixed with an explicit `:dir(rtl)` branch.
3. **Neither chat nor tool-call had a `forced-colors` block,** so several
   background-carried affordances would have collapsed into indistinguishable grey. Both
   now restate meaning with system colors.

Issues 2 and 3 prompted new lint rules (`reduced-motion`, `forced-colors`) so the gap
cannot recur silently.

**Exit criteria**

- Every component has all states in the [state matrix](COMPONENTS.md#the-state-matrix)
- `npm run check` passes clean
- Every component renders correctly in `dir="ltr"` and `dir="rtl"`
- Horizontal overflow assertion passes at 320px for every fixture
- No component uses a fixed height on text
- Review checklist in [ACCESSIBILITY.md](ACCESSIBILITY.md) passes per component

---

## Phase 3 -- Component set (not started)

The components needed for a real application, prioritized by frequency of use.

### Form controls

- [ ] Text input, textarea, select
- [ ] Checkbox, radio, switch
- [ ] Field group: label, hint, error, `aria-describedby` wiring
- [ ] Validation message component
- [ ] Form-level error summary with focus management

### Overlays

- [ ] Dialog, built on `<dialog>` for native focus containment and Escape
- [ ] Popover, built on the native popover API
- [ ] Tooltip, keyboard-reachable, never the sole source of information
- [ ] Toast, with correct live-region politeness (`polite` vs `assertive`)

### Navigation

- [ ] Tabs, full keyboard contract (arrows, Home, End)
- [ ] Menu / dropdown with focus management
- [ ] Pagination
- [ ] Sidebar

### Data display

- [ ] Table with sorting affordances
- [ ] Description list
- [ ] Empty state and error state patterns

**Exit criteria**

- Every interactive component has a documented keyboard contract and passes a
  keyboard-only walkthrough
- Automated axe-core pass added to CI with zero critical or serious findings
- Every overlay component documents its no-JS fallback
- Focus management documented for every overlay: what traps focus, what restores it

**Risk.** Overlays are where accessibility goes wrong most often. Budget extra time here
rather than treating dialogs as a quick win.

---

## Phase 4 -- Verification (not started)

Turning manual discipline into automation as the component count grows.

### Automated

- [ ] Playwright harness across Chromium, Firefox, WebKit
- [ ] Visual regression, both schemes, both directions
- [ ] axe-core in CI, zero critical/serious
- [ ] Horizontal overflow assertion at 320px and 400% zoom
- [ ] RTL layout diffing against LTR fixtures
- [ ] Reduced-motion and forced-colors test renders
- [ ] Bundle size budget with a failure threshold

### Documentation

- [ ] Fixture page as the living component gallery
- [ ] Token reference generated from the TypeScript source
- [ ] Per-component documentation with all six required sections
- [ ] Migration guide

### Manual, per release

- [ ] Screen reader: VoiceOver, NVDA, JAWS
- [ ] Keyboard-only pass
- [ ] RTL and long-string passes
- [ ] Real-translation review in Arabic, German, Finnish, Japanese

**Exit criteria**

- A regression in contrast, focus visibility, or direction handling fails CI rather than
  being found in review

---

## Phase 5 -- Platform expansion (not started)

- [ ] Print stylesheet
- [ ] Email build generated from the same tokens
- [ ] Native token packages (Swift, Kotlin) from `tokens.json`
- [ ] Figma variable export from `tokens.json`
- [ ] Vertical writing mode (`writing-mode`) support
- [ ] APCA contrast checking alongside WCAG 2.x
- [ ] Cognitive accessibility guidance

**Note on email.** It must be generated from the token source, never hand-maintained.
Hand-maintained email CSS drifts from the tokens within months, and a design system that
silently diverges between channels is worse than one that admits it does not support
email yet. Until this build exists, the system does not claim email support.

---

## Phase 6 -- Release (not started)

- [ ] Semantic versioning, with a documented deprecation policy
- [ ] Changesets for release notes
- [ ] CI publishing to npm
- [ ] CDN distribution
- [ ] Contribution guidelines and a review process
- [ ] Support policy: which versions get fixes, and for how long
- [ ] Migration tooling for breaking changes

**Versioning policy**

- **Major** -- removed or renamed tokens or classes; changed default values that alter
  rendering
- **Minor** -- new components, new tokens, new variants
- **Patch** -- bug fixes that preserve rendering

Token names are public API. Renaming one is a major change, because consumers depend on
them.

---

## Cross-cutting work

Not phase-specific; continuous.

### Documentation

Every document in `docs/` is a living artifact, updated in the same change as the code it
describes. Documentation that drifts is worse than none, because it is trusted.

### Testing philosophy

- Automated checks for anything expressible as a check
- Manual review for judgment: keyboard feel, focus order, reading clarity
- Never automate a judgment call and call it covered

### Performance budget

| Budget | Target |
| --- | --- |
| Full bundle, uncompressed | < 60 KB |
| Full bundle, minified | < 15 KB |
| Tokens + base only | < 10 KB minified |
| CSS applied to a typical page | < 30 KB |

Enforced in CI from Phase 4. Exceeding the budget requires a written justification.

### Open questions

1. **Vertical writing mode.** Japanese publishing needs it. Is it in scope, or documented
   as unsupported? Current answer: documented as unsupported, reconsidered in Phase 5.
2. **APCA.** Likely to replace WCAG 2.x contrast ratios. Adopt alongside WCAG rather than
   instead, until it stabilizes.
3. **Container queries for components.** Should components respond to their container
   rather than the viewport? Probably yes for cards and similar. Deferred until a real
   component needs it.
4. **Density modes.** Compact and comfortable spacing for data-heavy applications. Adds a
   token dimension; revisit after Phase 3.
5. **Motion tokens as a scale.** Motion is currently four durations. Real applications may
   need a richer scale for orchestrated sequences.
