# Contributing

## Setup

```bash
npm install
npm run check      # build + lint + test
```

Node 22.6 or later runs TypeScript directly. `build:css` needs no Rust toolchain.
The full gate also requires Rust, the wasm32 target, wasm-bindgen CLI 0.2.118, and Chrome
for browser checks. CI requires Chrome rather than accepting a skipped suite.

| Command | Does |
| --- | --- |
| `npm run build` | Compile tokens and produce the bundles |
| `npm run build:tokens` | Compile tokens only |
| `npm run lint` | Architecture linter over `src/css` |
| `npm run test` | Contract and linter tests |
| `npm run check` | All of the above; the gate |

---

## Adding a color token

1. Decide the tier. A **primitive** is a raw ramp step. A **semantic** token is a role in
   the interface, and is the only tier components use.
2. Name it by role: `bg-muted`, never `gray-200`. A name describing what a token looks
   like cannot be re-themed.
3. Add the contrast pairings in `src/tokens/semantic/color.ts` with the minimum ratio for
   the WCAG criterion it serves.
4. If it varies by scheme, provide both `light` and `dark`. A one-sided theme token is
   almost always wrong: either it is theme-invariant (make it a literal) or it needs both.
5. Run `npm run check`. The build fails if any pairing falls short.
6. Document it in [TOKENS.md](TOKENS.md).

## Adding a non-color token

Add to the relevant scale in `src/tokens/index.ts` or
`src/tokens/semantic/motion.ts`. Use existing scale steps before introducing new ones; the
spacing scale exists so people do not invent `0.7rem`.

## Adding a component

The full process is in [COMPONENTS.md](COMPONENTS.md#adding-a-component). In short:

1. Identify the correct HTML element first. If none fits, stop and reconsider.
2. Write the accessibility contract: role, accessible name, keyboard interaction, state
   announcements.
3. Define the full state matrix before writing CSS.
4. Implement in `src/css/components/<name>.css`, inside `@layer fc.components`.
5. Add fixtures: every variant, every state, RTL, long text, empty, loading.
6. Register the file in `BUNDLE_ORDER` in `src/build/build.ts`.
7. Run `npm run check`.
8. Run the review checklist in [ACCESSIBILITY.md](ACCESSIBILITY.md).
9. Document anatomy, states, accessibility, internationalization, the no-JS fallback, and
   when not to use it.

## Adding a utility

Utilities are capped at roughly twenty classes, and adding one requires demonstrating
that no component covers the case. The bar is in
[CONVENTIONS.md](CONVENTIONS.md#when-a-utility-is-allowed).

## Adding a lint rule

Lint rules are the mechanism that keeps the system's promises true, so a new rule should
be added whenever a convention is being enforced by discipline rather than by tooling.

1. Add the check to `tools/lint-css.mjs`, with a message that says what to do instead.
   "Use a logical property" is actionable; "invalid" is not.
2. Add a case to `tests/lint.test.ts` asserting the violation is caught.
3. Add a case asserting a legitimate pattern is **not** flagged. This is the half that
   matters most: a rule with false positives gets deleted, and then the violation it was
   catching ships.
4. If the rule needs an exemption, add it to the explicit exemption list at the top of the
   linter with a comment explaining why the exemption is correct. Never disable a rule
   wholesale for a file or layer.

---

## Conventions

Full detail in [CONVENTIONS.md](CONVENTIONS.md). The short version:

- Logical properties only; physical longhands are lint errors
- Tokens for every color; literals are lint errors
- `rem` for everything; `px` is a lint error
- One selector per rule, two nesting levels maximum
- Comments explain *why*, not *what*
- One component per file
- `--fc-` for tokens, `fc-` for classes, `is-`/`has-` for state

---

## Review expectations

A change is ready for review when:

- `npm run check` passes
- Fixtures cover the new behavior, including RTL and expanded text
- Documentation is updated in the same change as the code it describes
- Accessibility and i18n implications are stated explicitly, even when the answer is
  "none"

A reviewer will ask about RTL and reduced motion first, because those are the two most
commonly missed and the two most expensive to retrofit.

---

## Design decision records

Architecture decisions belong in the pull request description, in the following form:

- **Context** -- what problem
- **Decision** -- what was chosen
- **Alternatives** -- what was rejected, and why
- **Consequences** -- what this makes easy and what it makes hard

Decisions that constrain future work -- layer order, token authoring language, the
`!important` policy -- are recorded in [PRINCIPLES.md](PRINCIPLES.md) or
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Definition of done

A component is done when:

- [ ] Uses the correct semantic HTML element
- [ ] Every state in the matrix is styled and documented
- [ ] Renders correctly in both directions, both schemes, at 320px and at 200% zoom
- [ ] Keyboard accessible with a visible focus indicator at every step
- [ ] Accessible name present and correct
- [ ] No fixed heights on text content
- [ ] `npm run check` passes
- [ ] Fixtures added
- [ ] All six documentation sections present
- [ ] Review checklist passed
