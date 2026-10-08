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

See [Component contracts](COMPONENT-CONTRACTS.md) for all six required documentation sections for every shipped component, including complete fixture markup and no-JS fallbacks.

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
| **secondary** | surface + border | 8% tint, stronger border | 12% tint | ring | muted |
| **ghost** | transparent | 8% tint | 12% tint | ring | muted |
| **subtle** | 8% tint | 12% tint | 18% tint | ring | muted |
| **danger** | danger-bg | danger-bg-hover | sinks | ring | muted |

A "tint" is `currentColor` mixed at the `opacity-hover-overlay` and
`opacity-pressed-overlay` tokens, so it stays visible on any surface in either scheme.
Every enabled variant also sinks to 97% scale while pressed, and hover colours apply only
under `(hover: hover)`, so a tapped button on a touch screen does not stay lit.

All variants share the same disabled treatment. A destructive button that still looks
destructive when disabled invites the user to keep trying.

Buttons and `.fc-input` share heights (2rem small, 2.5rem default, 3rem large), and
`.fc-select` matches the default. All three use the `radius-lg` corner, so controls placed
side by side line up.

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
| `.fc-btn--sm` | 2rem (32px) | xs |
| default | 2.5rem (40px) | sm |
| `.fc-btn--lg` | 3rem (48px) | md |

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

Arrows reach every `menuitem`, `menuitemcheckbox`, and `menuitemradio`, skipping
separators and `aria-disabled` items. Typeahead accumulates characters typed within
500 ms ("dep" reaches *Deploy* past *Delete*), repeats of one letter cycle, and
labels exclude `aria-hidden` content, so a check glyph or shortcut never blocks a
match. `await menu.useWasm(url)` moves this traversal onto the `fc-context-menu`
crate (21.7 KB shipped); it returns `false` and keeps the JS model on any failure.

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
<div class="fc-composer" id="composer" data-fc-state="idle">
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
what they added — `addFailedAttachment` is how that state is reached.

**The original `File` is retained.** An `Attachment` carries `file`, so
`onSubmit` receives something a consumer can actually upload, hash, or inline.
Reducing it to `{name, size, type}` looks like it works and silently delivers
nothing: the chip stays on screen until submit, so the loss has no visible moment.
The binding is a pass-through, not a gate — reading the bytes is the consumer's
business.

```ts
// `onSubmit` is a constructor option, not an instance method -- calling
// `composer.onSubmit(...)` registers nothing.
const composer = new FutureCssComposer({
  root: "#composer",
  onSubmit: (text, files) => {
    const form = new FormData();
    for (const a of files) if (a.file) form.append("files[]", a.file);
    form.append("text", text);
    fetch("/api/turns", { method: "POST", body: form });
  },
});
```

### Focus on removal

The markup above needs `id="composer"` to match the `root: "#composer"` in the
JavaScript example; copied apart, neither initialises.

Removing a chip destroys the button that had focus, which would strand focus on
`<body>`. Focus is restored **by file name**, not by index: if the removed chip was
focused, focus moves to its neighbour or back to the input; if a *different* chip
was focused, focus stays on that same file. Restoring by index would silently move
a keyboard user onto a different attachment, so their next press removes the wrong
one.

### Teardown

`destroy()` aborts every listener the binding registered. The drag handlers live on
`document`, which outlives the composer, so a view that mounts and unmounts a
composer repeatedly would otherwise keep every detached root reachable and keep
invoking its obsolete handlers on each drop. Call `destroy()` when the composer
leaves the DOM.

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
boundary (flat arrays and strings, no `js-sys`), shipping at 38.4 KB. Matching
keys cross pre-folded: the adapter lowercases labels, values and queries with
`toLowerCase()`, so the module links no Unicode case tables and there is one
definition of case-insensitive rather than two (see
[WASM.md](WASM.md#case-folding-belongs-to-javascript)); `fc-context-menu` does the
same. The module exports `selectAbi()`, and `useWasm` refuses any module whose
version differs from the adapter's, so a cached module from an older wire format
keeps the JS model rather than failing on the first keystroke.

**The binding opts into it** with `await select.useWasm(url)`. The boundary entry
points are stateless — they rebuild the model on each call — so the adapter
(`WasmSelectModel`) holds the view state and hands it back in on every call
(`adopt_state` in the crate). `selectMoveFrom` and `selectTypeaheadFrom` accept the
*visible* set, which is what makes filtered navigation expressible at the boundary
at all; before those existed, filtered moves were a parity blind spot, not a
covered equivalence.

`tests/wasm.test.ts` drives the JS twin and the shipped adapter over the same
operation list — including the filtered cases — and requires identical state after
every operation. What crosses: the open seed, the filter, the filtered move, and
the typeahead match. What stays in JS: state writes, the trivial first/last-visible
scans, the typeahead buffer and its case folding, and the 600ms window, which is a
clock rather than model logic.

WASM is never required: the component is complete and correct on the JS path, and
a `useWasm` that returns false keeps it that way.

---

## Form field (implemented)

`src/css/components/field.css`. A label, an optional hint, the real control, and an
error element that exists from the start and is filled on failure.

```html
<div class="fc-field">
  <label class="fc-field__label" for="email">Email</label>
  <p class="fc-field__hint" id="email-hint">Used for sign-in.</p>
  <input class="fc-input" id="email" type="email" required
         aria-describedby="email-hint email-error">
  <p class="fc-field__error" id="email-error"></p>
</div>
```

- `.fc-input` styles `<input>`, `<textarea>`, and a native `<select>` (chevron drawn
  with `currentColor`, so it follows the theme). Sizes `--sm`, `--lg`;
  `--autosize` grows a textarea with `field-sizing: content`, no script.
- Invalid is `aria-invalid="true"` (set by the application) or `:user-invalid`
  (native validation after interaction), never bare `:invalid`, which would mark a
  required field red before anyone typed.
- `.fc-input-group` holds a control with adornments (`__addon`, `__control`). The
  group draws the border; the inner control's focus ring is drawn inset, because the
  group clips its corners.
- `.fc-error-summary` goes above the form after a failed submit, with `tabindex="-1"`
  so focus can move to it, and links to each failing field.

## Checkbox, radio, and switch (implemented)

`check.css`. Checkboxes and radios are the native controls tinted with `accent-color`,
inside a `<label class="fc-check">` that is the whole hit target. The switch is
`<input type="checkbox" role="switch" class="fc-switch">`, drawn by hand because no
native switch exists, and still a real checkbox: it submits, resets, and toggles with
Space. The thumb travels by `translate`, which is physical, so it has an RTL branch.
`.fc-switch-row` lays out a settings row with the switch at the inline end.

## Card (implemented)

`card.css`. The first component that is a **size container**: its parts respond to the
card's own width, so one card works in a grid, a sidebar, and on a phone.
`.fc-card__layout` puts `__media` beside the content once the card is 34rem wide and
stacks it below that; tight cards (< 18rem) reduce their padding. Variants
`--elevated`, `--subtle`.

A whole-card link stretches the title link's `::after` over the card, so the hit area is
large while the accessible name is just the title. A card containing a radio or checkbox
reflects `:checked` and `:disabled` through `:has()`, so it works as a large option.

## Badge, tag, and kbd (implemented)

`badge.css`. `.fc-badge` is a static label with tones `--accent --success --warning
--danger --info`, plus `--solid`, `--outline`, `--square`, `--count` (tabular figures).
`.fc-tag` is interactive: a filter chip with `aria-pressed`, or a token with its own
`.fc-tag__remove` button named "Remove <label>". `.fc-kbd` renders a key.

## Alert (implemented)

`alert.css`. Tones `--info --success --warning --danger`, a `--banner` variant, and
optional `__icon`, `__title`, `__body`, `__actions`, `__dismiss`. The role is the
consumer's choice and deliberately not implied by the class: none for a callout present
at load, `status` for one inserted after an action, `alert` only for an interruption.

## Dialog and sheet (implemented)

`dialog.css`, on native `<dialog>` opened with `showModal()` (or `commandfor` /
`command="show-modal"` where invoker commands are supported). The platform supplies the
top layer, inert background, Escape, and focus in and back. `closedby="any"` adds light
dismiss.

- Parts: `__header`, `__title`, `__description`, `__close`, `__body` (the only part
  that scrolls), `__footer`.
- Sizes `--sm`, `--lg`, `--fullscreen`. `--sheet` docks to the inline-end edge and
  slides in from it; under 36rem a centred dialog becomes a bottom sheet.
- Enter and exit animate with `@starting-style` and discrete transitions of `display`
  and `overlay`. Without support it shows and hides instantly.
- `display: flex` is only set on `[open]`; setting it unconditionally would override
  the UA rule that hides closed dialogs.

## Popover and tooltip (implemented)

`popover.css`. `.fc-popover` styles a native `[popover]`, anchored to its invoker with
`position-area` and `position-try-fallbacks` where CSS anchor positioning exists, and
centred by the UA elsewhere.

`.fc-tooltip` wraps a trigger and a `role="tooltip"` bubble. It shows on hover (after a
short delay) and on keyboard focus (immediately), stays open while the pointer moves
onto it (WCAG 1.4.13 "hoverable"), and is hidden with `visibility` so
`aria-describedby` still reads it. The `tooltip` binding adds Escape dismissal without
moving focus and wires `aria-describedby` when the markup did not. A tooltip is never
the only place information lives.

## Toast (implemented)

`toast.css` plus the `toast` binding. `FutureCssToaster` creates a polite and an
assertive live region up front (a region created with its first message is announced
unreliably), renders each toast with text only, and routes `danger` to the assertive
region. Timers pause while the pointer is over the stack or focus is inside it;
`danger` toasts do not time out by default. Escape dismisses a focused toast and focus
returns to where the user came from.

```js
const toaster = new FutureCssToaster();
toaster.show({ title: "Chat archived", action: { label: "Undo", onAction: restore } });
```

## Tabs (implemented)

`tabs.css` plus the `tabs` binding (`FutureCssTabs`, `bindTabs`). APG tabs: one tab in
the tab order, arrows move, Home/End jump, `aria-disabled` tabs are skipped, and the
selected panel is the only one shown. **Arrow direction follows the writing direction**
(ArrowLeft is "next" in RTL) and **orientation** (`aria-orientation="vertical"` on the
list switches to Up/Down and lays the tabs out vertically). Activation is automatic by
default; `activation: "manual"` selects on Enter/Space.

`.fc-tabs__list--segmented` draws a segmented control. Variants reach the tabs through
custom properties (`--fc-tabs-tab-size`, `--fc-tabs-selected-bg`, …) rather than
descendant selectors.

## Breadcrumb and pagination (implemented)

`breadcrumb.css`: an ordered list whose separators are generated content with empty
alternative text, so they are not read. Long names truncate. The current page is
`aria-current="page"`.

`pagination.css`: links, not buttons, so every page has a URL. The disabled "Previous"
is an anchor with no `href` and `aria-disabled`. Arrows are generated and mirror in RTL.

## Navigation sidebar (implemented)

`nav.css` plus the `nav` binding (`FutureCssNav`, `bindNavs`). The app's primary
navigation: links in a column, optionally grouped, that can collapse to an icon rail.
`.fc-sidebar` is the two-column *layout* primitive; this is `.fc-nav`.

```html
<nav class="fc-nav" id="app-nav" aria-label="Main">
  <div class="fc-nav__header">
    <span class="fc-nav__title">Workspace</span>
    <button class="fc-nav__toggle" type="button" aria-label="Sidebar"
            aria-expanded="true" aria-controls="app-nav"></button>
  </div>
  <ul class="fc-nav__list">
    <li>
      <a class="fc-nav__link" href="/chats" aria-current="page">
        <svg class="fc-nav__icon" aria-hidden="true">…</svg>
        <span class="fc-nav__label">Chats</span>
        <span class="fc-nav__meta">3</span>
      </a>
    </li>
  </ul>
  <details class="fc-nav__group" open>
    <summary class="fc-nav__group-label">Projects</summary>
    <ul class="fc-nav__list">…</ul>
  </details>
  <div class="fc-nav__footer">…</div>
</nav>
```

- **Links, not a tree or a menu.** Tab walks them, they appear in a screen reader's
  link list, and every destination has a URL. `role="tree"` would demand arrow-key
  navigation nobody expects from a sidebar.
- **Current page:** `aria-current="page"`, drawn as a tinted row with an inline-start
  bar (a border, so forced colours keep it). The section holding the current page is
  `aria-current="true"` and is emphasised, so the path stays visible.
- **States:** hover, active, focus (base ring), and `aria-disabled="true"` on an
  anchor with no `href` for a destination that exists but cannot be opened.
- **Structure:** `.fc-nav__heading` for a static section label, `<details
  class="fc-nav__group">` for one that folds (no script), `.fc-nav__list--nested` for a
  second level, `.fc-nav__meta` for a count, `.fc-nav__footer` pinned to the bottom.
- **Labels wrap rather than truncate**, so a long name is never clipped without a
  `data-fc-truncated` declaration.
- **Collapsing** is the toggle's `aria-expanded`, and only that: `.fc-nav` reads it
  through `:has()` and sets custom properties its parts read. The rail visually hides
  labels but keeps them as each link's accessible name, and hides headings, group labels,
  counts and nested lists. The binding flips the attribute, wires `aria-controls`, and
  moves focus to the toggle if it was on something the rail hides. In the rail it
  also gives each link its label as a `title`, so mouse users can read the names. Each
  title is refreshed as the pointer or focus reaches the link, so renamed and added links
  stay current. On expand the binding removes only titles that still hold the value it
  set. An `fc-tooltip` would be clipped by the sidebar's
  scroll container. Without the binding the sidebar stays expanded.
- **RTL:** the bar, the border and the toggle's chevrons move to the other edge.
  **Reduced motion:** the width, toggle and chevron transitions are zeroed by the reset,
  so collapsing is instant. On small screens, put the same markup in a side sheet
  (`fc-dialog--sheet`) rather than shrinking it.

## Data table (implemented)

`table.css` plus the `table` binding (`FutureCssTable`, `bindTables`). A real `<table>`
for reading rows; for a cell cursor and editing, use `fc-grid`.

```html
<div class="fc-table-wrap" role="region" aria-labelledby="runs-cap" tabindex="0">
  <table class="fc-table fc-table--sticky">
    <caption id="runs-cap">Recent runs</caption>
    <thead>
      <tr>
        <th scope="col" aria-sort="ascending">
          <button class="fc-table__sort" type="button">Name</button>
        </th>
        <th scope="col" class="fc-table__cell--num">
          <button class="fc-table__sort" type="button">Tokens</button>
        </th>
        <th scope="col"><button class="fc-table__sort" type="button">Updated</button></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row">Index docs</th>
        <td class="fc-table__cell--num">12,480</td>
        <td data-fc-sort-value="120">2 min ago</td>
      </tr>
    </tbody>
  </table>
</div>
```

- **`aria-sort` is the only sort state.** It sits on one header at a time (APG), and the
  arrow, the header emphasis, and the announcement all read from it. An unsorted
  sortable column shows a faint double arrow, so the affordance is visible before hover.
  The arrow is generated content with empty alternative text, because `aria-sort`
  already announces the direction.
- **The sort control is a `<button>` in the header**, so it is in the tab order and
  announces as a control. A disabled button (`disabled` or `aria-disabled`) is ignored.
- **The wrapper scrolls, not the page.** `.fc-table-wrap` is focusable and named, so a
  keyboard user can scroll a wide table, and the page does not overflow at 320px.
- **Sorting.** Values compare numerically when both parse (grouping separators are
  ignored), otherwise with `Intl.Collator` in the table's `lang`. `data-fc-sort-value`
  overrides a cell's text ("2 min ago", "12.5 KB") and gives a machine reader the raw
  value. The sort is stable. `mode: "manual"` only moves `aria-sort` and calls
  `onSort`, for rows that come from a server.
- **States.** Row hover, `aria-selected="true"` rows, `aria-busy="true"` while loading
  (render skeletons in the cells; the rows are not dimmed, which would break the
  declared contrast), and `.fc-table__empty` for a full-width "no rows" or error cell.
- **Modifiers.** `--sticky` header, `--striped` rows, `--compact` cells.
  `.fc-table__cell--num` end-aligns a column with tabular figures; on a header it also
  puts the arrow before the label so the label stays flush with the digits.
- **Forced colours** restate the selected row with a `Highlight` outline and the sort
  arrow in `Highlight`.

## Description list (implemented)

`description-list.css`. Key/value metadata on a `<dl>`, one `<div class="fc-dl__item">`
per pair (HTML allows it, and assistive technology ignores the `<div>`).

```html
<dl class="fc-dl fc-dl--divided">
  <div class="fc-dl__item"><dt>Model</dt><dd>Large</dd></div>
  <div class="fc-dl__item"><dt>Duration</dt><dd class="fc-dl__num">14.2 s</dd></div>
</dl>
```

The layout is intrinsic: the term takes `--fc-dl-term-size` (10rem) and the value wraps
under it once the two no longer fit, so no media or container query is involved. Values
break anywhere, so ids and hashes cannot overflow. `--divided` adds rules between pairs;
`--stacked` puts the term above the value at every width. Nothing moves and nothing
relies on a background colour, so it needs no reduced-motion or forced-colours branch.

## Spinners (implemented)

`spinner.css`. One block, `.fc-spinner`, with a drawing chosen by what the work is:

| Modifier | Drawing | Use it for |
| --- | --- | --- |
| (none) | ring with one solid quarter | generic loading: a page, a request, a save |
| `--arc` | tapering conic arc | the same, softer |
| `--dots` | three bouncing dots (3 child spans) | someone is composing a reply: the typing indicator |
| `--pulse` | a dot with a ripple | something live and listening: a connected agent, a recording |
| `--bars` | four bars (4 child spans) | a stream flowing: tokens arriving, audio playing |
| `--orbit` | two satellites | background work with several parts: indexing, syncing |
| `--sparkle` | a turning four-point star | a model is thinking |

Sizes `--xs` to `--xl` (or set `--fc-spinner-size`); tones `--muted` and `--current`
(inherit the text colour). Every drawing uses `currentColor`; the sparkle's gradient
can be replaced with `--fc-spinner-fill`. A spinner is always `aria-hidden`, beside a
`role="status"` text that says what is happening.

**Reduced motion:** spinners never stop, because a frozen spinner reads as a hung page.
Rotating ones slow to a third of their speed; dots, bars, pulse, and sparkle switch to an
opacity-only fade. **Forced colours:** they opt out of the adjustment and draw in
`CanvasText`, since forced colours would otherwise erase every drawing but the ring.

`.fc-shimmer-text` is the companion for status words ("Searching 12 sources"): a sweep
between two text tokens that both pass contrast, so it is legible at every frame.

## Agent status (implemented)

`agent-status.css`. The "what is the agent doing now" row: a spinner, a label, and an
elapsed time, all driven by `data-fc-state`. While `pending`, `queued`, `running`, or
`streaming`, the label shimmers and the spinner turns; on `complete`, `error`,
`aborted`, or `denied` the spinner is hidden and a glyph states the outcome.

```html
<div class="fc-agent-status" data-fc-kind="agent-status" data-fc-state="running">
  <span class="fc-spinner fc-spinner--sparkle fc-spinner--sm" aria-hidden="true"></span>
  <span class="fc-agent-status__label" role="status">Searching 12 sources</span>
  <span class="fc-agent-status__meta">14s</span>
</div>
```

`role="status"` goes on the label, not the row: the timer changes every second and
would be announced every second; the label changes at step boundaries.

## Skeleton and progress (implemented)

`loading.css`. `.fc-skeleton` (`--text`, `--circle`, `--block`; the shimmer reverses
in RTL) and `.fc-progress` on the native `<progress>`, with an indeterminate sweep. Under
reduced motion the shimmer and sweep stop, and the indeterminate bar becomes a static
hatch that cannot be read as a percentage.

## Avatar, empty state, and disclosure (implemented)

- `avatar.css`: image or initials, sizes `--xs` to `--xl`, `--square` for non-people
  (agents, tools, organisations), and `.fc-avatar-group`.
- `empty-state.css`: `.fc-empty` says why it is empty and what to do next; `--error`
  uses the same shape for "failed to load", so a failure never looks like no results.
- `disclosure.css`: `<details class="fc-disclosure">`. A shared `name` makes an
  exclusive accordion with no script; opening animates via `::details-content` and
  `interpolate-size` where supported. `--boxed` draws each item as a card.

## AI answer parts (implemented)

Four pieces an assistant answer is made of, each following the dual-audience contract:

- **Reasoning trace** (`reasoning.css`): `<details class="fc-reasoning"
  data-fc-kind="reasoning" data-fc-state="streaming">`. The label shimmers only while
  the state is `streaming` or `pending`, between two text tokens that both pass
  contrast, so it is legible at every frame. The body is not a live region.
- **Citations** (`citation.css`): `.fc-cite` inline markers with an `aria-label`
  naming the source (a bare "1" is a useless name), linking to `.fc-source` entries in
  an `.fc-sources` list, which highlight on `:target`.
- **Suggested prompts** (`suggestion.css`): `.fc-suggestions` of `.fc-suggestion`
  buttons whose label is the prompt that will be sent; `--grid` for starters, `--pill`
  for follow-ups.
- **Message actions** (`chat.css`): `.fc-msg__actions` / `.fc-msg__action` under a
  message. They recede until the message is hovered or focused, stay in the tab order,
  and are always visible on devices without hover. Feedback toggles use `aria-pressed`.

---

## Planned components

Ordered by dependency and by how often they appear. Full specifications are written as
each component is built.

| Component | Element | Notes |
| --- | --- | --- |
| Link | `<a href>` | Underline always; focus from base layer (styled in base today) |
| Combobox with free text | ARIA combobox | Builds on `fc-select` |

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
5. **Add fixtures** -- default, every variant, every state, RTL, long text, empty, loading,
   as a `data-fixture="<file name>"` section in `demo/fixtures.html`. `tests/bundle.test.ts`
   fails until the section exists, and the browser suite loads the page at 320px in both
   directions and schemes.
6. **Add to `BUNDLE_ORDER`** in `src/build/build.ts`.
7. **Run `npm run check`.** Lint and tests must pass.
8. **Run the review checklist.** Accessibility and i18n gates.
9. **Document** anatomy, states, and the no-JS fallback.

A component is not done at step 7. Steps 8 and 9 are the definition of done.

---

## Context strip

The row of controls above a chat composer: provider, model, effort, and model
parameters. Each control is an `fc-select`, so the strip itself is mostly
layout — but two behaviours belong to the *group*, and neither can live in a
select.

| Element | Description |
| --- | --- |
| `.fc-context-strip` | Root. Flex row that **wraps**, never scrolls horizontally. |
| `.fc-context-strip__field` | One labelled control. |
| `.fc-context-strip__label` | Visually hidden; each control takes its accessible name from it. |
| `.fc-context-strip__spacer` | Pushes the parameter chips to the end at wide sizes. |
| `.fc-context-strip__params` | Read-only parameter chips. |
| `.fc-context-strip__param` | One `name` / `value` pair. |
| `.fc-context-strip__notice` | Explains why effort does not apply. |

### Why it is a component at all

**Provider filters model.** A model from one provider selected under another is
a request nobody can fulfil, so provider change re-resolves the model. Two
providers that *do* share a model keep it, and each provider remembers the model
it last had — otherwise comparing two providers resets the model every time and
the user silently changes what they are about to send.

**Effort is not universally available.** Reasoning models take an effort level;
others ignore it. An inapplicable control is dimmed via `data-fc-applicable` and
explained in `fc-context-strip__notice` rather than removed, because a row that
reflows when the model changes makes the whole strip jump and the absence would
not be announced at all.

### DOM contract

`data-fc-provider`, `data-fc-model`, and `data-fc-effort` on the root mirror the
whole state, so a machine reads the context without walking three selects and
parsing their labels. **`data-fc-effort` is absent, not empty**, when effort does
not apply — an empty attribute claims a value of nothing, which is a different
claim. Per the dual-audience rule these are additive: nothing in the CSS depends
on them, so the strip degrades correctly for a consumer that ignores them.

```js
import { FutureCssContextStrip } from "future-css/context-strip";

const strip = new FutureCssContextStrip({
  root: "#strip-root",
  providers: [
    {
      id: "anthropic", name: "Anthropic",
      models: [
        { id: "opus-5", name: "Claude Opus 5",
          reasoning: true, parameters: { context: "200k" } },
      ],
    },
  ],
  onChange: (state) => send({ ...state }),
});
```

The catalogue is the application's, not the library's: these bindings do not know
what any vendor sells. Requires no WASM and no Rust toolchain.

---

## Git surface

A working tree: branch, status counts, a file list, and per-file line stats.

| Element | Description |
| --- | --- |
| `.fc-git` | Root. Header plus a scrolling file list. |
| `.fc-git__header` | Branch and summary; does not scroll. |
| `.fc-git__branch` | Branch name, or "Initial commit" when unborn. |
| `.fc-git__summary` | Counts, with `tabular-nums` so the header does not reflow. |
| `.fc-git__files` | The list. A `role="listbox"`. |
| `.fc-git__row` | One file. Roving tabindex, keyboard-selectable. |
| `.fc-git__file-name` / `__file-dir` | Filename with the directory de-emphasised. |
| `.fc-git__stages`, `__badge`, `__stage-button` | Per-side badges and the stage action. |
| `.fc-git__stat`, `__stat-add`, `__stat-remove` | Line counts. |
| `.fc-git__empty` | "No changes". |

### This does not run Git

Nothing shells out and nothing parses porcelain output. The surface renders
status entries the application already has — from libgit2, a language binding, or
a fixture. Spawning a process per render is not a UI layer's job and breaks in the
browser; parsing porcelain is a spec-following exercise whose failure mode is a
plausible-looking wrong answer.

### Three decisions worth knowing

**Staged and unstaged are counted separately.** They answer different questions —
"what is in the commit I am about to make" and "what have I not staged yet." A
file changed in both is counted in both, which is correct. Collapsing them is how a
commit silently includes edits the user did not intend.

**A missing stat is absent, not `+0 -0`.** If a file's contents were never
loaded, the surface says nothing about lines. `+0 -0` would claim the file is
unchanged, which it is not.

**Badges are per side, and carry a non-colour marker.** `data-fc-stage` is `index`
or `worktree`, because a file staged as modified *and* modified again is two facts.
Each badge also sets `data-fc-glyph`, used as `content` under forced colors — where
the badge colour is discarded, and without the glyph every state would read as the
same outlined word.

```js
import { FutureCssGitSurface } from "future-css/git";

const git = new FutureCssGitSurface({
  root: "#git-root",
  branch: "feat/git-surface",
  entries: [
    { path: "src/js/git.ts", index: "modified", worktree: "modified",
      before: "a\nb\nc\n", after: "a\nc\nd\nd\n" },
  ],
  onSelect: (path) => showDiffFor(path),
  onStage: (path) => stageFile(path),
});
```

### Rust and WASM

`summarizeStatus`, `orderEntries`, and `diffCounts` are pure and exist in
`crates/fc-git`, which is **primitives-only and under budget at 44.7 KB** — the
first module in the workspace to reach Phase A's target. Everything crosses as flat
arrays of numbers; no `js-sys`. 71 parity tests compare it against the JS twin.

One documented limitation: `order_entries_js` breaks ties by *input* order,
because paths never cross into WASM. The caller must present entries sorted by
path. A parity test caught this divergence and now pins the contract.


Code surfaces clip their header and gutter backgrounds to the shared outer
radius. The source clears the base inline-code decoration so only the enclosing
surface owns its background and corners. A numbered surface reserves a shrinking
source column; an optional header spans both columns. The demo's usage snippets
use this same `fc-code` surface and `renderHighlighted`, retaining the original
source text for selection and copying. Every demo section includes usage markup;
its viewport-width workbench keeps a shorter measure only on introductory prose.


## Masthead

`masthead.css` provides an application header. `.fc-masthead__brand` contains
an optional `.fc-masthead__mark`, `.fc-masthead__nav` is a list of navigation
links, and `.fc-masthead__actions` holds existing buttons, avatars, or controls.
The header wraps instead of hiding destinations at narrow widths. It has no
binding or autonomous motion; child components own loading and error states.
Current navigation reads `aria-current="page"`. Disabled links use
`aria-disabled="true"` and omit `href`; disabled buttons use `disabled`.
Use a page-level `<header>` for the banner landmark; a header nested within a
section, as in the demo, belongs to that section. Give every navigation landmark
a distinct accessible name.

```html
<header class="fc-masthead">
  <a class="fc-masthead__brand" href="/">
    <span class="fc-masthead__mark" aria-hidden="true">A</span>Acme
  </a>
  <nav aria-label="Workspace areas">
    <ul class="fc-masthead__nav">
      <li><a class="fc-masthead__link" href="/projects" aria-current="page">Projects</a></li>
      <li><a class="fc-masthead__link" href="/activity">Activity</a></li>
    </ul>
  </nav>
  <div class="fc-masthead__actions">
    <button class="fc-btn fc-btn--primary" type="button">New project</button>
  </div>
</header>
```

The live demo's App shell section nests this header above an `fc-nav` sidebar
and a content area. `bindNavs(document)` supplies the sidebar collapse behavior;
the demo switches from side-by-side to stacked content when its own container
is narrow, so the example remains usable at 400% zoom and in RTL.


## Control groups and integrated composers

`control-group.css` groups existing buttons, selects, and form controls. Give
`.fc-control-group` `role="group"` and an accessible name; use a real
`<fieldset>` and `<legend>` for related form fields. Each child retains its own
Tab stop and keyboard contract. This is not a toolbar with roving focus, nor a
tablist. `.fc-control-group__item` lets child controls shrink and wrap their text;
`aria-pressed="true"` styles real toggle state. Applications own toggle logic.
Use `disabled`/`aria-disabled` on each control, or a native disabled fieldset;
putting `aria-disabled` on a wrapper alone does not disable its descendants.

The default group has a subtle background and a small gap between controls.
`--plain` removes the surface, and `--vertical` stacks items. Buttons and selects
own hover, active, focus, disabled, loading, and error states. Groups add no
motion, preserve child focus rings, wrap at narrow widths, and draw an edge in
forced colors.

```html
<div class="fc-control-group" role="group" aria-label="Message tools">
  <button class="fc-btn fc-btn--ghost fc-btn--sm fc-control-group__item"
          type="button" aria-pressed="true">Web search</button>
  <button class="fc-btn fc-btn--ghost fc-btn--sm fc-control-group__item"
          type="button" aria-pressed="false">Research</button>
</div>
```

`fc-composer--contained` is an optional rounded, bordered surface that integrates
the textarea and footer controls. The default composer retains its attached-to-
thread presentation. Place model selectors, tool groups, and attachment actions
in `.fc-composer__tools` within `.fc-composer__row`; the send control aligns to the
end and wraps when needed. Popovers are not clipped. The input keeps a visible
focus ring and read-only styling, and the existing Send/Stop binding is unchanged.
Model selection uses the existing `FutureCssSelect`; related provider/model/effort
controls should use `FutureCssContextStrip` so their dependent state stays coherent.
Selection and tool settings belong to the application and can be read in
`onSubmit`. They are not implicitly sent or managed by the composer binding.

```html
<div class="fc-composer fc-composer--contained" data-fc-state="complete">
  <label class="fc-u-visually-hidden" for="message">Message</label>
  <textarea class="fc-composer__input" id="message" placeholder="Ask anything…"></textarea>
  <div class="fc-composer__row">
    <div class="fc-composer__tools">
      <div class="fc-control-group fc-control-group--plain" role="group" aria-label="Attachments">
        <button class="fc-btn fc-btn--ghost fc-btn--sm fc-control-group__item" type="button">Attach</button>
      </div>
      <!-- Add the named model select or tool group here. -->
    </div>
    <button class="fc-btn fc-btn--primary fc-composer__send" type="button">Send</button>
  </div>
  <p class="fc-composer__status" role="status"></p>
</div>
```

## Typography and mixed-direction values

Use `.fc-type-body-small`, `.fc-type-title`, `.fc-type-code`, `.fc-type-label`, or a named
heading role when typography must be independent of an element's semantic role. Change
`--fc-type-<role>` and its `-tracking` token to adopt an application ramp. Keep headings
as real headings; a type class does not change their accessibility meaning.

Wrap externally supplied mixed-direction values in `<bdi>` (preferred) or `.fc-u-bidi`:

```html
<p>Branch: <bdi>feature/new-composer</bdi></p>
<span class="fc-u-bidi">user@example.com</span>
```

Isolation prevents a filename, identifier or user name from rearranging surrounding RTL
text. It does not choose a writing direction for the whole component.

## Segmented button

`segmented.css` picks a **value**: a unit, a sort order, a set of sources. It is
Material's segmented button. The segmented tabs list (`fc-tabs__list--segmented`)
switches **views** and owns panels; picking a value with tabs announces panels that do
not exist.

```html
<fieldset class="fc-segmented">
  <legend class="fc-u-visually-hidden">Units</legend>
  <label class="fc-segmented__item">
    <input class="fc-segmented__input" type="radio" name="unit" value="c" checked>
    <span class="fc-segmented__check" aria-hidden="true"></span>Celsius
  </label>
  <label class="fc-segmented__item">
    <input class="fc-segmented__input" type="radio" name="unit" value="f">
    <span class="fc-segmented__check" aria-hidden="true"></span>Fahrenheit
  </label>
</fieldset>
```

Radios give one choice and checkboxes several. Either way the value is a form value,
arrow keys move a radio group with no script, and the selected state is `:checked`, so
nothing can disagree with what the form submits. Selection shows a check mark as well as
a fill, so it does not rest on colour. Disabled segments use `disabled` on the input;
`aria-invalid` or `:user-invalid` outlines the whole row. Labels wrap inside their
segments at narrow widths instead of the row wrapping or scrolling. No binding.

## Split button

`split-button.css` joins a default action to a menu of alternatives. It is two real
buttons, because they are two actions with two names.

```html
<div class="fc-split-btn" role="group" aria-label="Send">
  <button class="fc-btn fc-btn--primary fc-split-btn__action" type="button">Send</button>
  <button class="fc-btn fc-btn--primary fc-btn--icon fc-split-btn__toggle" type="button"
          id="send-more" aria-label="More send options">
    <span class="fc-split-btn__chevron" aria-hidden="true"></span>
  </button>
</div>
<div class="fc-menu" id="send-menu" popover>
  <button class="fc-menu__item" role="menuitem" type="button">Send later</button>
</div>
<script type="module">
  import { bindMenuButton } from "future-css/menu";
  bindMenuButton(document.querySelector("#send-more"), "#send-menu");
</script>
```

Colour, size and every state come from `.fc-btn`; the split button only joins the pair,
so load it after `button.css` (the bundle does). `bindMenuButton` sets `aria-haspopup`,
`aria-controls` and `aria-expanded`, toggles the menu beneath the trigger on click, Enter
or Space, opens it at the first item on ArrowDown and the last on ArrowUp, and returns
focus on Escape. Near the bottom of the viewport the menu opens above the trigger, and it
is clamped inside the viewport sideways. The open toggle turns round and
its chevron flips, drawn from `aria-expanded`. Without the binding both buttons still
work as buttons; only the menu needs script.

## Floating action button

`fab.css` is the one most important action on a screen. Use one per screen.

```html
<button class="fc-fab fc-fab--fixed" type="button" aria-label="New chat">
  <svg class="fc-fab__icon" aria-hidden="true">…</svg>
</button>

<button class="fc-fab fc-fab--extended" type="button">
  <svg class="fc-fab__icon" aria-hidden="true">…</svg>New chat
</button>
```

The default is tonal; `--primary` is solid and `--surface` neutral. `--sm` is 40px,
the default 56px and `--lg` 96px. `--lowered` drops the shadow for a FAB on a surface
that already floats, and `--fixed` docks it to the block-end, inline-end corner, which is
bottom-left in RTL, clear of a phone's home bar. An icon-only FAB needs `aria-label`.
Disabled, `aria-disabled` and `aria-busy` are styled; long labels wrap. As with
`fc-btn`, `aria-disabled` blocks pointer activation only, so the host ignores Enter and
Space (see [the `:disabled` vs `aria-disabled` decision](#the-disabled-vs-aria-disabled-decision));
use `disabled` when the action need not stay focusable.

A FAB menu is a FAB with `popovertarget` and a `.fc-fab-menu` popover of
`.fc-fab-menu__item` buttons. The platform provides light dismiss, Escape and returning
focus. Items are plain buttons in tab order rather than a `role="menu"`: three to six
actions do not need a menu's arrow-key contract. While open, the FAB shows the selected
colours. The menu fades in without sliding under reduced motion.

## List

`list.css` is the general list: settings, contacts, files, results. Rows have an optional
leading slot (icon, avatar, thumbnail), up to three lines of text (`__overline`,
`__headline`, `__supporting`), and a trailing slot for meta or a control.

```html
<ul class="fc-list fc-list--divided">
  <li class="fc-list__item">
    <span class="fc-list__leading" aria-hidden="true">…</span>
    <span class="fc-list__content">
      <a class="fc-list__action fc-list__headline" href="/settings/privacy" aria-current="page">Privacy</a>
      <span class="fc-list__supporting">Who can see your conversations</span>
    </span>
  </li>
  <li>
    <label class="fc-list__item">
      <span class="fc-list__content"><span class="fc-list__headline">Web search</span></span>
      <span class="fc-list__trailing"><input class="fc-switch" type="checkbox" role="switch"></span>
    </label>
  </li>
</ul>
```

A row is static, an action row (one `.fc-list__action`, a link or button, whose
`::after` covers the row so the whole row is the target while the accessible name stays
the headline), or a control row (`.fc-list__item` on a `<label>`). The focus ring is drawn
around the row. Selection is `aria-current` or `aria-selected="true"` on the action;
disabled is `disabled` or `aria-disabled` inside the row. Trailing buttons sit above the
stretched action and stay clickable. Supporting text clamps at two lines; when it does,
set `data-fc-truncated="true"` and keep the full text reachable. No binding: a list of
links or buttons is already keyboard-operable, and a list that needs arrow-key focus is a
listbox (`fc-select`) or a menu.

## Divider

`divider.css`: `<hr class="fc-divider">` between sections, `--inset` to start where a
list's text starts, `--middle` to inset both edges, and `--vertical` on an element with
`role="separator" aria-orientation="vertical"` inside a row. `--fc-divider-space` and
`--fc-divider-inset` adjust spacing. It uses the subtle border, which is decoration and
exempt from non-text contrast.

## Slider

`slider.css` styles `<input type="range">`, so the keyboard contract, the slider role and
the announced value come from the platform.

```html
<div class="fc-slider">
  <input class="fc-slider__input" type="range" id="temp" min="0" max="2" step="0.1"
         value="0.7" aria-label="Temperature">
  <output class="fc-slider__value" for="temp">0.7</output>
  <ol class="fc-slider__marks" aria-hidden="true"><li>0</li><li>1</li><li>2</li></ol>
</div>
<script type="module">
  import { bindSliders } from "future-css/slider";
  bindSliders(document);
</script>
```

Blink and WebKit have no pseudo-element for the filled part of the track, so the fill
reads `--fc-slider-pct`, which `bindSliders` keeps current and which it also mirrors into
any `<output for>`. The output is not a live region, because the input already announces
its value. After setting `value` from script, call `syncSlider(input)`. Without the
binding the track is unfilled and the thumb alone shows the value; Firefox draws the fill
natively. The fill and track colours are the declared 3:1 boundary pairs. Hover, active
(a larger thumb, held still under reduced motion), disabled and `aria-invalid` are
styled; forced colors restate the track and thumb in system colours. RTL fills from the
right, as the browser does.

## Toolbar

`toolbar.css` is the general toolbar; the rich text editor's formatting bar is one. It
moved out of `editor.css`, so a page that loads components one at a time loads
`toolbar.css` with `editor.css`.

```html
<div class="fc-toolbar fc-toolbar--floating" role="toolbar" aria-label="Selection">
  <button class="fc-toolbar__item" type="button" aria-pressed="false">Bold</button>
  <span class="fc-toolbar__divider" role="separator"></span>
  <button class="fc-toolbar__item fc-toolbar__item--icon" type="button" aria-label="Delete">…</button>
</div>
<script type="module">
  import { bindToolbars } from "future-css/toolbar";
  bindToolbars(document);
</script>
```

The default is the dense bar an editor uses. `--floating` is a raised pill for a
selection or a canvas, and `--docked` sticks to the block-end of its scroll container
for a screen's actions; both use 40px items. `aria-orientation="vertical"` stacks it.
`bindToolbar` makes the toolbar one tab stop: Left/Right (swapped in RTL) or Up/Down
when vertical move between items and wrap, Home/End jump, natively disabled items are
skipped and `aria-disabled` ones stay reachable, and a text field or select inside keeps
its own arrow keys. Focus moving by pointer moves the tab stop too. Without the binding,
every item is a tab stop.

## Navigation bar

`navbar.css` holds three to five top-level destinations at the block-end edge of a phone
layout; swap it for `fc-nav` at a breakpoint.

```html
<nav class="fc-navbar fc-navbar--fixed" aria-label="Primary">
  <a class="fc-navbar__item" href="/chats" aria-current="page">
    <span class="fc-navbar__icon" aria-hidden="true">…</span>
    <span class="fc-navbar__label">Chats</span>
  </a>
  <a class="fc-navbar__item" href="/inbox">
    <span class="fc-navbar__icon" aria-hidden="true">…<span class="fc-navbar__badge">3</span></span>
    <span class="fc-navbar__label">Inbox</span><span class="fc-u-visually-hidden">, 3 unread</span>
  </a>
</nav>
```

Labels are always visible. The current destination (`aria-current="page"`) gets an
indicator behind its icon and a heavier label. A badge sits inside the hidden icon, so
say the count in the link's name. An empty badge is a dot. `--fixed` pins the bar above
the phone's home indicator; the page reserves the space. A disabled destination is an
anchor with no `href` and `aria-disabled="true"`.

## Search

`search.css` is a search bar with an optional view beneath it for recent searches,
suggestions or results.

```html
<form class="fc-search" role="search" action="/search">
  <div class="fc-search__bar">
    <span class="fc-search__icon" aria-hidden="true">…</span>
    <input class="fc-search__input" type="search" name="q" aria-label="Search conversations"
           placeholder="Search conversations">
    <span class="fc-search__trailing">…</span>
  </div>
  <div class="fc-search__view" role="region" aria-label="Recent searches">
    <p class="fc-search__view-label">Recent</p>
    <ul class="fc-list">…</ul>
  </div>
</form>
```

The view opens while focus is inside the search, with no script, and floats over the
content below. `data-fc-open="true"` or `"false"` holds it open or closed, `--docked` puts
it in the page flow (a full-screen search on a phone), and `aria-busy="true"` dims stale
results while new ones load. Its contents are links or buttons, so Tab reaches them; when
suggestions should be chosen with arrow keys, use `fc-select`'s combobox instead. The
focus ring is drawn on the bar. Disabled and `aria-invalid` are styled. The browser's own
clear button stays unless the input has `fc-search__input--own-clear`, for a trailing slot
that supplies a named "Clear search" button.

## Bottom sheet

`fc-dialog--bottom` docks a dialog to the block-end edge at every width, edge to edge on
a phone and a centred 40rem panel above that. Open it with `showModal()` for a modal
sheet or `show()` for a standard sheet that leaves the page usable. It slides up on open
and down on close, with no script. `.fc-dialog__handle` is a decorative drag handle;
nothing makes it draggable, so every sheet keeps a close button or `closedby="any"`.

```html
<dialog class="fc-dialog fc-dialog--bottom" id="share" aria-labelledby="share-title" closedby="any">
  <div class="fc-dialog__handle" aria-hidden="true"></div>
  <header class="fc-dialog__header">
    <h2 class="fc-dialog__title" id="share-title">Share conversation</h2>
    <button class="fc-dialog__close" type="button" commandfor="share" command="close" aria-label="Close">✕</button>
  </header>
  <div class="fc-dialog__body">…</div>
</dialog>
```

## Progress ring

`fc-progress-ring` (in `loading.css`) is circular determinate progress. There is no
native circular element, so the role and values are ARIA, and the drawn value is
`--fc-progress-value` (0 to 100) stated beside them; update both in the same write. It
only shows a known amount; use a spinner when the amount is unknown. `--sm`, `--lg` and
`--error` are available, and value changes animate because the property is registered.

```html
<div class="fc-progress-ring" role="progressbar" aria-label="Uploading"
     aria-valuemin="0" aria-valuemax="100" aria-valuenow="42" style="--fc-progress-value: 42">
  <span class="fc-progress-ring__label">42%</span>
</div>
```

## Filled text field

`fc-input--filled` is a tinted field with an underline instead of an outline, for dense
forms. Invalid, disabled and focus states are the same as `fc-input`'s. The fill and the
underline are declared contrast pairs. The label stays above the field; floating labels
are a deliberate divergence (see `PLAN.md`, Phase D).

## Carousel

`carousel.css` is a scroll-snap row: touch, trackpad and arrow keys on the focused track
scroll it with no script.

```html
<section class="fc-carousel" aria-roledescription="carousel" aria-label="Templates">
  <div class="fc-carousel__controls" hidden>
    <button class="fc-btn fc-btn--secondary fc-btn--icon" type="button" data-fc-carousel="prev" aria-label="Previous">‹</button>
    <button class="fc-btn fc-btn--secondary fc-btn--icon" type="button" data-fc-carousel="next" aria-label="Next">›</button>
  </div>
  <ul class="fc-carousel__track" tabindex="0" aria-label="Templates">
    <li class="fc-carousel__item" aria-roledescription="slide" aria-label="1 of 4">
      <img src="…" alt="…"><p class="fc-carousel__caption">Weekly report</p>
    </li>
  </ul>
</section>
<script type="module">
  import { bindCarousels } from "future-css/carousel";
  bindCarousels(document);
</script>
```

The default multi-browse layout shows the next item peeking in; `--hero` shows one large
item and `--free` turns off snapping. `--fc-carousel-item` sets item width. The buttons
ship `hidden` and `bindCarousel` reveals them, pages by most of the visible width, and
sets `aria-disabled` at each end, in both directions. Captions sit on the inverse surface,
so they stay legible over any image. It never autoplays.

## Date and time pickers

`datepicker.css` styles a month calendar. The `datepicker` binding renders it and owns
the WAI-ARIA date-grid keyboard contract.

```html
<div class="fc-datepicker" id="due"></div>
<script type="module">
  import { bindDatePicker } from "future-css/datepicker";
  const picker = bindDatePicker(document.getElementById("due"), {
    value: "2026-10-21",
    min: "2026-10-01",
    isDisabled: (iso) => [0, 6].includes(new Date(iso).getUTCDay()),
    onChange: (iso) => form.elements.due.value = iso,
  });
</script>
```

Values are ISO `YYYY-MM-DD` strings, compared as calendar dates with no time zone. Month
and weekday names come from `Intl` in the page's `lang` (or `locale`), and the week
starts on the locale's first day unless `firstDayOfWeek` says otherwise. Arrow keys move
by day and week, Home and End to the week's ends, Page Up and Down by month, and with
Shift by year, mirrored in RTL. The selection is `aria-selected="true"` on the cell,
today is `aria-current="date"`, and unavailable days are `aria-disabled` so the arrow keys
still reach them. The root mirrors the selection as `data-fc-value`.

The calendar is for browsing. For entering a known date, and wherever script is absent,
use the native input, which `field.css` styles:

```html
<input class="fc-input" type="date" name="due">
<input class="fc-input" type="time" name="start">
```

For a time where the period must be stated explicitly, `fc-timepicker` lays out hour and
minute fields with an `fc-segmented` period. The row is isolated left to right, since
times read hours first in every script:

```html
<fieldset class="fc-timepicker">
  <legend class="fc-field__label">Start time</legend>
  <input class="fc-input fc-timepicker__unit" inputmode="numeric" aria-label="Hour" value="09" maxlength="2">
  <span class="fc-timepicker__separator" aria-hidden="true">:</span>
  <input class="fc-input fc-timepicker__unit" inputmode="numeric" aria-label="Minute" value="30" maxlength="2">
  <fieldset class="fc-segmented">…AM / PM…</fieldset>
</fieldset>
```

Material's clock dial is not offered; see the Phase D table in `docs/PLAN.md`.
