# Components

This document defines the component model, the state matrix every component must
implement, and the process for adding one.

Currently implemented: **button**, **chat**, and **tool-call**. The rest are planned; see
[PLAN.md](PLAN.md). The button is the reference implementation and the template every
other component follows.

Chat and tool-call share one additional convention, the **dual-audience DOM contract**,
because content that streams, runs, and truncates must be machine-readable as well as
visible. It is described in [AGENTS.md](../AGENTS.md) and referenced below.

---

## The component contract

Every component in this system implements the same contract. A component that cannot meet
it is a sign the abstraction is wrong, not that the exception is warranted.

### 1. Real elements

A component names the HTML element it requires and styles that. `<button>`, not
`<div role="button">`. The element's native behavior is part of the component.

### 2. Full state coverage

Every interactive component implements all of these. A component that styles only its rest
state is unfinished.

| State | Mechanism |
| --- | --- |
| Rest | Base styles |
| Hover | `:hover`, only for pointer devices |
| Active / pressed | `:active` |
| Focus | `:focus-visible`, inherited from the base layer |
| Disabled | `:disabled` (removed from interaction) |
| Unavailable but perceivable | `aria-disabled="true"` (stays focusable) |
| Loading | `aria-busy="true"` |
| Invalid | `:user-invalid`, never `:invalid` |
| Selected | `aria-selected` / `aria-pressed` / `aria-current` |

### 3. Both directions, both schemes

Rendered under `dir="ltr"` and `dir="rtl"`, in light and dark, with expanded text, at
200% zoom. No component ships with only one direction verified.

### 4. No fixed heights on text

`min-block-size` only. Content is never clipped.

### 5. Accessibility review gate

The per-component checklist in [ACCESSIBILITY.md](ACCESSIBILITY.md) passes before the
component is marked done.

---

## Anatomy and modifiers

Components follow a modified BEM, detailed in [CONVENTIONS.md](CONVENTIONS.md):

```html
<button class="fc-btn fc-btn--primary fc-btn--sm">
  <span class="fc-btn__spinner" aria-hidden="true"></span>
  <span class="fc-btn__label">Save</span>
</button>
```

- **Block** -- `fc-btn`. The component.
- **Element** -- `fc-btn__label`, `fc-btn__spinner`. Internal parts, not composable by
  consumers.
- **Modifier** -- `fc-btn--primary`, `fc-btn--sm`. Public variants and sizes, freely
  combinable: `.fc-btn--danger.fc-btn--sm` is valid.
- **State** -- `.is-open`, `.is-loading`. Applied by JavaScript for components that need
  it, following the Vue/Ember `is-` convention.

Variants and sizes are separate classes precisely so they compose. A single
`.fc-btn--primary-large` modifier would need one class per combination, and 6 variants
times 3 sizes is 18 classes instead of 9.

---

## The state matrix

Use this when implementing any component. It is the definition of "done".

| | Default | Hover | Active | Focus | Disabled |
| --- | --- | --- | --- | --- | --- |
| **primary** | accent fill | accent-bg-hover | accent-bg-active | ring | muted |
| **secondary** | transparent + border | bg-muted | bg-subtle | ring | muted |
| **ghost** | transparent | bg-muted | bg-subtle | ring | muted |
| **subtle** | bg-subtle | bg-muted | bg-muted | ring | muted |
| **danger** | danger-bg | danger-border | danger-border | ring | muted |

All variants share the same disabled treatment. A destructive button that still looks
destructive when disabled invites the user to keep trying.

---

## Button (implemented)

The reference component. Every other component should be built by following it.

### Markup

```html
<!-- Primary action -->
<button class="fc-btn fc-btn--primary">Save changes</button>

<!-- Secondary action -->
<button class="fc-btn fc-btn--secondary fc-btn--sm">Cancel</button>

<!-- Destructive, with confirmation -->
<button class="fc-btn fc-btn--danger">Delete account</button>

<!-- Disabled -->
<button class="fc-btn fc-btn--primary" disabled>Save changes</button>

<!-- Unavailable but perceivable; stays focusable so the reason is discoverable -->
<button class="fc-btn fc-btn--primary" aria-disabled="true"
        aria-describedby="why-disabled">Save changes</button>
<span id="why-disabled">Connect a payment method to save.</span>

<!-- Loading: the label stays, so the accessible name never disappears -->
<button class="fc-btn fc-btn--primary" aria-busy="true">
  <span class="fc-btn__spinner" aria-hidden="true"></span>
  <span class="fc-btn__label">Saving</span>
</button>

<!-- Icon-only: needs an accessible name -->
<button class="fc-btn fc-btn--primary fc-btn--icon" aria-label="Close">
  <svg aria-hidden="true" ...></svg>
</button>
```

### Sizing

| Class | Min block size | Font size |
| --- | --- | --- |
| `.fc-btn--sm` | 2rem | xs |
| default | 1.5rem (24px, WCAG minimum) | sm |
| `.fc-btn--lg` | 2.5rem (40px) | md |

### The `:disabled` vs `aria-disabled` decision

- `:disabled` -- the control cannot be used. Removed from tab order. Use when the action
  is meaningless in this state entirely.
- `aria-disabled="true"` -- the control cannot be used *right now*. **Stays focusable** so
  a keyboard or screen-reader user can reach it and discover why. Use this by default; it
  is strictly more informative.

`aria-disabled` alone does not prevent activation, so the component also sets
`pointer-events: none`. That is sufficient here because a native `<button>` is activated
by click or keyboard, and both are suppressed. For a control that can also be activated by
script, the script must check the attribute.

---

## Chat surface (implemented)

A general-purpose component for turn-based, conversational interfaces. It is not an
agent-specific toolkit: the same structure serves a human support desk, a guided
wizard, and an agent transcript. What makes it distinctive is that its content arrives
*partially* -- which is where the dual-audience contract is under real pressure.

The thread is a real list, so it is navigable. `role="log"` plus `aria-live="polite"`
makes new messages announced without requiring focus to move.

```html
<ul class="fc-chat" role="log" aria-live="polite" aria-label="Conversation">
  <!-- A user turn: aligned to the inline end edge, in both directions -->
  <li class="fc-msg"
      data-fc-kind="message" data-fc-id="m-01" data-fc-seq="1"
      data-fc-role="user" data-fc-state="complete"
      data-fc-ts="2026-03-10T14:22:01Z">
    <div class="fc-msg__meta">
      <span class="fc-msg__author">You</span>
      <time class="fc-msg__time" datetime="2026-03-10T14:22:01Z">14:22</time>
    </div>
    <div class="fc-msg__body">Why did the deploy fail?</div>
  </li>

  <!-- Still streaming: caret shown, space already reserved -->
  <li class="fc-msg"
      data-fc-kind="message" data-fc-id="m-02" data-fc-seq="2"
      data-fc-role="assistant" data-fc-state="streaming"
      data-fc-ts="2026-03-10T14:22:03Z">
    <div class="fc-msg__meta">
      <span class="fc-msg__author">Assistant</span>
      <time class="fc-msg__time" datetime="2026-03-10T14:22:03Z">14:22</time>
    </div>
    <!-- pre-wrap keeps generated text unreflowed; overflow-wrap: anywhere still
         lets an unbroken token break rather than overflow -->
    <div class="fc-msg__body">The health check timed out during the migration</div>
  </li>

  <!-- Truncated: the clamp is visual, the attribute is the truth -->
  <li class="fc-msg" data-fc-role="assistant" data-fc-state="complete"
      data-fc-truncated="true">
    <div class="fc-msg__body">…7,400 further characters available…</div>
  </li>
</ul>
```

### Message states

| `data-fc-state` | Appearance | Meaning |
| --- | --- | --- |
| `pending` | Pulsing skeleton | Queued; no content yet. Space reserved to prevent layout shift. |
| `streaming` | Blinking caret | Tokens still arriving. |
| `complete` | Static | Finished. |
| `error` | Danger border | Failed; any error text is rendered by the caller. |
| `aborted` | Warning border | Cancelled partway, by the user or by policy. |

### Accessibility notes

- **`aria-live` on the thread, not on the streaming message.** A live region
  containing rapidly-updating text is the classic screen-reader failure: every token
  gets announced. The thread announces *messages*; the streaming state is conveyed
  visually and in markup rather than by flooding the buffer.
- **The caret is decorative.** It sits in a `::after` pseudo-element, so it is never
  read out as text.
- **`role="log"` rather than `role="region"`**, because it conveys that content is
  being added, which is the semantic assistive technology needs here.
- **System and tool messages are visible but recessive.** A user debugging what the
  system did must be able to read them; they are styled down, not removed.

---

## Tool call / step trace (implemented)

Renders a recorded or in-progress operation: an API request, a database query, a file
operation, a build step. Agent runtimes are one consumer; so is any application that
needs to show the user what a system is doing on their behalf.

This is the most information-dense component in the system, and the clearest test of
the dual-audience contract: every field is individually addressable, and appearance is
driven by the same attribute that carries the meaning.

```html
<div class="fc-tool"
     data-fc-kind="tool-call" data-fc-id="call-7" data-fc-seq="4"
     data-fc-state="complete" data-fc-ts="2026-03-10T14:22:09Z"
     data-fc-duration-ms="1240">

  <div class="fc-tool__header">
    <span class="fc-tool__name">search_documentation</span>
    <!-- The state is in text as well as colour, so it survives greyscale,
         forced-colors, and any future monochrome rendering -->
    <span class="fc-tool__state">
      <span aria-hidden="true">✓</span> Complete
    </span>
    <span class="fc-tool__duration">1.24s</span>
  </div>

  <span class="fc-tool__label" id="call-7-args">Arguments</span>
  <pre class="fc-tool__payload" aria-labelledby="call-7-args">{ "query": "deploy failure" }</pre>
</div>

<!-- Running: indeterminate sweep, mirrored in RTL -->
<div class="fc-tool" data-fc-state="running">
  <div class="fc-tool__progress">
    <div class="fc-tool__progress-bar" style="--fc-tool-progress: 42%"></div>
  </div>
</div>

<!-- Denied is distinct from error: a refused permission is an expected outcome,
     not a failure, and must not read as one -->
<div class="fc-tool" data-fc-state="denied">
  <p class="fc-tool__error">Permission denied: write outside the workspace</p>
</div>
```

### The state machine

| `data-fc-state` | Accent | Meaning |
| --- | --- | --- |
| `running` | accent | In progress. Indeterminate, or determinate via `--fc-tool-progress`. |
| `complete` | success | Finished successfully. |
| `error` | danger | Failed. Render the message in `.fc-tool__error`. |
| `denied` | warning | Refused by policy. Expected, not a failure. |
| `aborted` | neutral strong | Cancelled partway. |

`denied` and `aborted` are separate states on purpose. "Policy stopped this" and "I
stopped this" call for different responses, and collapsing them into one grey state
loses information a reader may need.

### Truncation and payload handling

Large arguments and results are clipped, and the clip is declared:

```html
<div class="fc-tool" data-fc-truncated="true">
  <pre class="fc-tool__payload" data-fc-truncated="true">…</pre>
</div>
```

The clipped region fades at the edge so a cut-off line reads as "continues below", and
the full value must remain reachable in the DOM or behind a disclosure. **Silent
truncation is how a consumer ends up confidently reporting a partial result.**

### Reduced motion

The indeterminate sweep is removed rather than slowed: large repeated motion is
precisely what vestibular conditions make unpleasant. The track stays visible, so the
component still communicates "working, extent unknown" through a static affordance. A
determinate bar is kept, being a short non-looping movement tied to real progress.

### RTL

The sweep direction is mirrored with `:dir(rtl)`. This is one of the few places in the
system needing an explicit direction branch, because `translateX` is a *physical*
transform with no logical equivalent. See
[INTERNATIONALIZATION.md](INTERNATIONALIZATION.md).

---

## Component bindings

Every component ships with JavaScript behavior. The CSS is complete without it —
an un-enhanced component is styled and usable but inert — so bindings are an
enhancement, never a requirement.

```
import { FutureCssEditor } from 'future-css/editor';
import { FutureCssMenu }  from 'future-css/menu';
import { FutureCssGrid }  from 'future-css/grid';
import { FutureCssWebview' } from 'future-css/webview';
```

**No Rust, no WASM, no build step.** The bindings are TypeScript run directly by
the toolchain. The Rust layer owns the document *model*; the bindings own the DOM,
because everything here needs to ask the browser something WASM cannot observe:
where the selection is, what the browser considers a word, what the IME is
composing.

### Editor

```js
const editor = new FutureCssEditor({
  root: '#editor',
  onChange: (html) => save(html),
  onSelectionChange: (active) => console.log(active.bold),
});
```

Notable decisions:

- **The toolbar reports the mark across the *whole* selection.** A selection that is
  partly bold reads as "not bold", because a toolbar that lies about a partial
  selection is worse than one that does not.
- **Un-marking preserves the text.** `unwrap` moves children out before discarding
  the wrapper. An editor that deletes content when a user clicks "remove bold"
  loses their work.
- **The input is a real textbox**, so caret, selection, clipboard and IME work
  natively.
- **Link URLs are validated against a scheme allowlist**, and an unsafe scheme is
  refused with a reason rather than silently rewritten. `javascript:` in an
  editor-authored link is stored XSS.

### Menu

Popover-based, with an attribute fallback. Focus restoration is the part that
matters: the invoker is captured at construction and restored on close, *always*,
including on Escape. A menu that does not restore focus strands keyboard users at
the top of the document.

`Tab` is deliberately not trapped — a menu is a single stop, and trapping it is the
most common way menus become keyboard traps.

### Grid

Roving tabindex: **one** tab stop, arrows to move. A grid where every cell is a tab
stop needs 9 presses of Tab to leave a 3×3, and is unusable at 10,000 cells.

Selection follows spreadsheet convention: arrows collapse, Shift+Arrow extends,
Ctrl+Space selects the row. `data-fc-rowcount` / `aria-rowcount` are written when
the real size exceeds the rendered rows, so a virtualized grid can announce
1,000,000 rows rather than 50.

### Webview

Chrome only. It does not intercept navigation or mediate requests — a webview that
pretended to be a browser without being one would create a security boundary that
does not exist.

`load` means navigation *completed*, not that it succeeded: a 404 and a good page
both fire it, so the error state is deliberately not derived from it.

### Testing

Bindings are tested in real headless Chrome (`npm run test:browser`), because the
bugs that matter are DOM bugs — caret placement, selection geometry, focus
restoration — and none are observable from a DOM-less test. The harness serves the
actual TypeScript sources with types stripped, which is what proves there is no
build step. It skips cleanly when no browser is present.

---

## Terminal (implemented)

A terminal emulator surface: output grid, input line, and status bar.

**Scope: the presentation layer.** Escape-sequence parsing, PTY management, and
scrollback belong to a terminal engine. This owns what is visible — grid geometry,
the ANSI palette, cursor states, and the accessibility contract.

### The ANSI palette

This is the **only** place in the system where tokens are named by hue rather than
by purpose, and the reason is structural: `\e[31m` means red, and a build log's
red error means nothing rendered blue. A purpose-based name cannot express "the
color at SGR 1", because the whole point is that it stays red whatever the theme is.

A terminal also has **its own background, dark in both color schemes**. An
application that follows the OS into a light theme must not produce a light
terminal — every terminal theme ever written keeps it dark.

Both properties are enforced by `src/tokens/semantic/terminal.ts`: 19 contrast
pairings, checked at build time in both schemes.

### Markup

```html
<div class="fc-terminal" data-fc-state="connected">
  <!-- A log, not a live region with assertive updates: a fast-running command
       would make a screen reader unusable. -->
  <div class="fc-terminal__output" role="log" aria-live="polite" aria-label="Terminal output">
    <span class="fc-terminal__line"><span class="fc-term-ansi-green fc-terminal__bold">$</span> npm run build</span>
    <span class="fc-terminal__line"><span class="fc-term-ansi-cyan">warn</span> deprecated</span>
    <span class="fc-terminal__line fc-term-ansi-red">error command not found</span>
    <span class="fc-terminal__line fc-terminal__dim">⠋ Building…</span>
  </div>

  <div class="fc-terminal__input-row">
    <span class="fc-terminal__prompt" aria-hidden="true">user@host:~/proj$</span>
    <!-- A real input: caret, selection, clipboard and IME all work natively. -->
    <input class="fc-terminal__input" type="text" aria-label="Terminal input">
  </div>

  <div class="fc-terminal__status">
    <span>utf-8</span><span>main</span>
    <!-- "exit 127" carries the state as text, so it survives greyscale -->
    <span class="fc-terminal__status-end fc-terminal__exit" data-fc-state="error">exit 127</span>
  </div>
</div>
```

### Accessibility notes

- **`role="log"`, not `aria-live="assertive"`.** A fast command would otherwise
  make a screen reader unusable.
- **The input is a real `<input>`.** Faking it with a `contenteditable` div breaks
  IME composition for every CJK user.
- **Exit status is labeled, not just colored.** A red `127` is a color-only signal.
- **Programming ligatures are disabled.** `!=` rendered as one glyph breaks column
  counting.

### A bug this component found

`white-space: pre` on the *output container* looks correct and is not: every
newline and indent in the markup between line elements renders as a blank output
line. A 10-line document occupied 598px instead of 180px and scrolled for no
reason. `pre` belongs on the line, where whitespace is meaningful, and nowhere else.

---

## Planned components

Ordered by dependency and by how often they appear. Full specifications are written as
each component is built.

| Component | Element | Notes |
| --- | --- | --- |
| Link | `<a href>` | Underline always; focus from base layer |
| Form field | `<input>` + `<label>` | Label, hint, error, `aria-describedby` wiring |
| Checkbox / radio | native | Do not rebuild; style the native control |
| Select | `<select>` | Styling native selects is limited; document the ceiling |
| Dialog | `<dialog>` | Native focus containment and Escape handling |
| Disclosure | `<details>` | Progressive enhancement target |
| Card | `<article>` / `<section>` | Surface, border, radius, shadow |
| Tabs | ARIA tabs pattern | Full keyboard contract required |
| Menu | `<nav>` + buttons | Focus management, Escape, arrow keys |
| Toast | `<output>` + `role="status"` | Live region politeness matters |
| Tooltip | `role="tooltip"` | Not for essential content; not hover-only |

### Two components that are not components

**Native select.** Styling a `<select>` is limited by the platform, particularly on macOS
and iOS. Rather than build a custom listbox that reimplements the accessibility tree, this
system styles the native control as far as it can go and documents the ceiling. A custom
select is a major accessibility commitment, not a component.

**Tooltips.** A tooltip must not contain the only instance of information, must be
reachable by keyboard, and must not appear on hover only. For anything essential, use
visible content or `aria-describedby` on a persistent element.

---

## Adding a component

1. **Identify the correct HTML element.** If none fits, stop and reconsider.
2. **Write the accessibility contract first.** What is the role, the accessible name, the
   keyboard interaction, the state announcements?
3. **Define the state matrix.** Every state in the table above.
4. **Implement the CSS** in `src/css/components/<name>.css`, inside `@layer fc.components`.
5. **Add fixtures** -- default, every variant, every state, RTL, long text, empty, loading.
6. **Add to `BUNDLE_ORDER`** in `src/build/build.ts`.
7. **Run `npm run check`.** Lint and tests must pass.
8. **Run the review checklist.** Accessibility and i18n gates.
9. **Document** anatomy, states, and the no-JS fallback.

A component is not done at step 7. Steps 8 and 9 are the definition of done.
