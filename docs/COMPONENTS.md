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

### Pure modules

These are functions over strings, with no DOM involvement at all. They are
importable on their own, independently of any component.

| Module | Exports | Contract |
| --- | --- | --- |
| `future-css/highlight` | `highlight`, `resolveLanguage`, `languages` | Contiguous, non-overlapping spans that reconstruct the source exactly. Unknown language falls back to plain text. |
| `future-css/diff` | `diffLines`, `diffStats`, `splitLines` | Myers with backtracking. Dropping added lines reproduces the original; dropping removed lines reproduces the revision. |
| `future-css/markdown` | `parseMarkdown`, `serializeMarkdown`, `parseInline`, `serializeInline`, `escapeMarkdown`, `parseLinkTarget` | Parse/serialize for a documented, round-trippable subset. |

**One exception, deliberately.** `highlight` also exports `renderHighlighted`,
which *does* build DOM nodes — it is the convenience wrapper that turns spans into
`<span class="fc-code__tok">` elements for the code component. Everything else in
the table is DOM-free and usable in a worker, a build script, or a test. Import
`highlight` rather than `renderHighlighted` when you are not building a page.

Two properties are asserted directly rather than described, because both have
failed in ways a smoke test missed: highlighting never alters the source text,
and a diff reconstructs both inputs. The Markdown subset has **one** documented
lossy case — `parseInline` records that a range is a link but not its
destination, so use `parseLinkTarget` when a target must be preserved.

### Rust

`diffLines` already has a Rust implementation, `fc-diff`, which is the same
algorithm with the same reconstruction guarantee and the same test cases. It is
**not yet wired to the JS side**: `src/js/diff.ts` remains the only path a
consumer gets today, and the crate is built as part of `npm run build:wasm`.

It is deliberately free of `js-sys`. Every other crate in the workspace links it,
and that single dependency is what inflates each module to roughly ten times its
budget, which is the problem Phase A in `PLAN.md` exists to fix. `fc-diff` is the
pattern that fix needs: primitives across the boundary, never `Vec<JsValue>`.

The remaining candidates are `highlight`'s tokenizer and the listbox typeahead
that a select component will need; neither has a Rust path yet. Whenever one is
added it ships **alongside** the JS implementation with a parity test, never
instead of it.

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

### Grid

`FutureCssGrid` now derives the column template from the widest row and writes
`grid-template-columns` on the root. This is required, not a nicety: the CSS sets
`grid-auto-columns`, which sizes *implicit* tracks, and without an explicit
template nothing creates them — so every cell stacked in a single column while
roles, focus and ARIA all reported correctly. The count comes from the widest row
rather than `data-fc-colcount`, because the header row is one cell wider than the
data rows (corner + headers) and `data-fc-colcount` is the *declared* size a
virtualized grid advertises, which is a different question.

### Theming

```js
document.documentElement.dataset.fcTheme = 'dark';  // or 'light'
```

`color-scheme` is declared **only** in the tokens layer. It also used to appear in
`fc.base`, and since base is ordered after tokens with equal specificity, that
declaration silently beat `[data-fc-theme]` and the theme switcher did nothing —
while still responding to clicks, which is what made it hard to spot. Remove it
from any other layer and the switcher dies quietly.

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

## Code block (implemented)

A reading surface for source code: optional gutter, token colours, and a wrapping
policy. Highlighting itself is a JS concern (`future-css/highlight`); this owns the
surface.

```html
<div class="fc-code fc-code--numbered" data-fc-lang="typescript">
  <!-- Line numbers are decoration: aria-hidden, because announcing "line 47"
       before each of 47 lines makes the content unusable. -->
  <div class="fc-code__gutter" aria-hidden="true">…</div>
  <code class="fc-code__source"></code>
</div>
```

`data-fc-lang` is the single source of truth for the language. A JS-side default
would silently highlight Python as JavaScript whenever the attribute was
misspelled.

### Modifiers

| Modifier | Effect |
| --- | --- |
| `--numbered` | Adds the gutter column |
| `--scroll` | `white-space: pre` plus a horizontal scroller, for column-aligned reading |

### Wrapping, and why line numbers can drift

Wrapping is the **default**, because WCAG 1.4.10 requires content to work at 400%
zoom without two-dimensional scrolling, and `pre` with `overflow-x` fails that for
any line wider than the viewport.

The cost is that a wrapped numbered block can misalign: one logical line may
occupy several visual rows while the gutter allocates exactly one number per
logical line. This is not fixable in CSS — the gutter cannot know how many rows a
line took. `--scroll` makes numbering exact by disabling wrapping. The tradeoff is
documented rather than hidden.

### Accessibility

The `<code>` element's `textContent` is byte-identical to the source, because every
token span sits inside it. A copy button and a screen reader both get the original
text, and highlighting can be disabled with CSS alone.

---

## Diff viewer (implemented)

Renders the output of `diffLines()` as a reviewable sequence of lines: summary bar,
per-line markers, old/new gutters, and optional hunk gaps.

```html
<div class="fc-diff">
  <div class="fc-diff__bar"><!-- +3 −1 --></div>
  <div class="fc-diff__line" data-fc-diff="add" aria-label="Added: const a = 1;">
    <span class="fc-diff__marker" aria-hidden="true">+</span>
    <span class="fc-diff__num" aria-hidden="true"></span>
    <span class="fc-diff__num" aria-hidden="true">12</span>
    <span class="fc-diff__content">const a = 1;</span>
  </div>
</div>
```

### Colour is never the only cue

Added and removed lines differ in **four** independent ways: background,
foreground hue, a `+`/`−` glyph, and `data-fc-diff`. Drop any one — a colour-blind
reader, a printer, forced-colors mode, a monochrome terminal — and the distinction
survives. That redundancy is the whole design; `background: green` would not be a
diff viewer.

`data-fc-diff` is the machine-readable half, so an automated reader selects rows
with a selector rather than by reading colours. It is **additive**: styling never
depends on a consumer reading it.

### Line numbers

`aria-hidden`, and **blank rather than 0** on the side a line does not exist. A
line present only in the revision has no number in the original, and showing 0
would invent a line that was never there.

### The accessible name requirement

Because the marker glyph *and* both numbers are hidden, a changed row needs an
`aria-label` carrying its state. Without one, a removed line and an added line with
the same text are announced identically — `data-fc-diff` is not announced. The
generator in `demo/demo.js` sets it; any consumer must do the same.

---

## Chat composer (implemented)

The input surface beneath a chat thread: text entry, attachments, and a send/stop
control.

```html
<div class="fc-composer" data-fc-state="idle">
  <label class="fc-u-visually-hidden" for="composer-input">Message</label>
  <textarea class="fc-composer__input" id="composer-input" rows="2"></textarea>
  <ul class="fc-composer__attachments"></ul>
  <button class="fc-btn fc-btn--primary fc-composer__send" data-fc-state="idle">Send</button>
  <p class="fc-composer__status" role="status"></p>
</div>
```

### Why a `<textarea>` and not contenteditable

The editor component uses `contenteditable`, so this looks inconsistent. It is
not. An **IME-composed character inserted into a contenteditable region fails
silently**, and composing input is routine in CJK and other composing scripts. A
textarea also gives Enter-to-send, Shift+Enter, and native undo without
re-implementing any of it. `terminal.css` documents the same failure for the same
reason.

### Enter must not send during IME composition

```js
const composing = event.isComposing || event.keyCode === 229;
if (event.key !== "Enter" || composing) return;
```

Sending mid-composition commits a half-composed character and closes the candidate
window. This is the most common bug in any composer and it only reproduces with an
IME, so it is tested with both signals.

### One send control, two meanings

`data-fc-state` on the root flips the control between Send and Stop. The button
element is **never replaced** — replacing it moves focus, and a control that
appears mid-run is the one a keyboard user is not looking at. While running the
input is `readOnly`, not `disabled`: a disabled field leaves the tab order, so
tabbing past would not reveal that there is anything there.

### Stopping is not sending

Abort keeps the draft. The user cancelled a run, not composed a message, and
clearing the text would discard work they may want to resend. The same reasoning
means the draft clears only *after* `onSubmit` returns — if a consumer's handler
throws, the text is still there.

### Attachments

Each chip's remove button is labelled `Remove <filename>`. Four buttons all reading
"Remove" tell a screen-reader user nothing about which attachment is going away. An
attachment that could not be read is shown with its reason rather than silently
dropped, since dropping it would leave the user sending a request that is missing
what they added.

---

## Select / listbox (implemented)

A value-selecting combobox with grouped options, substring filtering, and typeahead.

```html
<button type="button" class="fc-select" data-fc-value="opus-5">
  <span class="fc-select__value">Claude Opus 5</span>
  <span class="fc-select__chevron" aria-hidden="true">&#9662;</span>
</button>
<div class="fc-select__list" role="listbox" aria-label="Model">
  <div class="fc-select__group-label" role="presentation">Anthropic</div>
  <div class="fc-select__option" role="option" data-fc-value="opus-5">...</div>
  <div class="fc-select__option" role="option" aria-disabled="true">...</div>
</div>
```

### Keyboard contract

| Key | Behaviour |
| --- | --- |
| `Enter` / `Space` | Open, or commit the highlighted option |
| `ArrowUp` / `ArrowDown` | Move, **wrapping**, stepping over unavailable options |
| `Home` / `End` | First / last **selectable** option |
| typeahead | **Prefix** match, 600 ms window |
| `Escape` | Close and **restore** the committed value |
| `Tab` | Commit and leave — never trapped |

### Three things that are easy to get wrong

**Focus stays on the invoker.** The highlight is conveyed with
`aria-activedescendant`; DOM focus never enters the list. This is the single most
common way a custom listbox breaks, and it is why this cannot reuse the menu's
roving-`tabindex` approach.

**Escape restores, Enter commits.** A menu fires an action, so closing it has no
state to restore. A select *holds a value*, so dismissing must put back what was
in effect. Escape also deliberately does not fire `onChange`.

**Unavailable options are stepped over and never selected.** Typeahead that lands
on a disabled option is a dead end the user cannot escape by typing.

**Filtering constrains navigation, not just rendering.** If the filter lives only in
the view, arrows walk hidden options and `Enter` commits one the user cannot see.
The model holds the filtered set, so the list and the keyboard always agree.

**Focus is restored on keyboard closes only.** `Escape`, `Enter`, and `Tab` bring
focus back to the invoker. An *outside pointer* close does not — the user clicked
somewhere else, and yanking focus back would lose that click's target.

### `data-fc-value`

The selected value lives on the invoker as a data attribute, per the DOM contract.
A machine reads the selection without parsing the visible label, so the label stays
free to change — a model renamed upstream does not silently change what a consumer
reads.

### Why not a native `<select>`

This position was reversed from an earlier revision of this document. A model
listbox needs grouping and substring filtering, which `<select>` does not express;
fighting the platform to get partway there is worse than owning it. The cost is
real and worth stating: a custom listbox reimplements part of the accessibility
tree, and this is the most accessibility-sensitive component in the system.

### WASM

`fc-select` implements the navigation *model* — which option is active, how
typeahead accumulates, which options survive a filter — behind a primitives-only
boundary (flat `Int32Array`s, no `js-sys`), landing at 69.5 KB against 414.2 KB
for `fc-context-menu`.

**The binding does not yet call it.** `FutureCssSelect` uses the JS model; the WASM
module is exercised only by `tests/wasm.test.ts`, which proves the two agree but
proves nothing about the binding using the fast path. The current WASM entry points
are also stateless — `selectMove` and `selectTypeahead` rebuild the model from the
committed value on each call — so consecutive arrows would not accumulate even if
it were wired. Both are prerequisites for the switch, not cosmetic changes to it.

WASM is never required: the component is complete and correct on the JS path.

---

## Planned components

Ordered by dependency and by how often they appear. Full specifications are written as
each component is built.

| Component | Element | Notes |
| --- | --- | --- |
| Link | `<a href>` | Underline always; focus from base layer |
| Form field | `<input>` + `<label>` | Label, hint, error, `aria-describedby` wiring |
| Checkbox / radio | native | Do not rebuild; style the native control |
| Select / listbox | `<button role="combobox">` + `role="listbox"` | Custom listbox; full APG keyboard contract. First consumer is the composer |
| Dialog | `<dialog>` | Native focus containment and Escape handling |
| Disclosure | `<details>` | Progressive enhancement target |
| Card | `<article>` / `<section>` | Surface, border, radius, shadow |
| Tabs | ARIA tabs pattern | Full keyboard contract required |
| Menu | `<nav>` + buttons | Focus management, Escape, arrow keys |
| Toast | `<output>` + `role="status"` | Live region politeness matters |
| Tooltip | `role="tooltip"` | Not for essential content; not hover-only |

### One component that is not a component

**Tooltips.** A tooltip must not contain the only instance of information, must be
reachable by keyboard, and must not appear on hover only. For anything essential, use
visible content or `aria-describedby` on a persistent element.

**A bespoke listbox.** *This position has changed.* An earlier revision of this
document said a custom select is "not a component" and that the native control
should be styled to its ceiling instead. That was the right call for a general
design system and the wrong one here.

The composer needs option sets the platform cannot express: models grouped by
provider and filtered as you type, an effort control whose options change meaning
by model, and hundreds of entries with typeahead. A native `<select>` has no
grouping worth the name and no filtering, and styling it further is fighting the
platform rather than using it.

So a general `fc-select` listbox is now planned, and it is scoped as a **component**
rather than a composer detail, because anything with a keyboard contract this large
is worth having once and testing properly. The cost is real and worth stating:
a custom listbox reimplements part of the accessibility tree, and it will be the
most accessibility-sensitive component in the system. It ships only with the full
APG keyboard contract, `aria-activedescendant`, and browser tests for every key.

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
