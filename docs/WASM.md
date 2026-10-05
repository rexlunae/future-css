# WASM architecture

How the Rust/WASM layer is organized, why it is split the way it is, and — most
importantly — how a **non-Rust project uses it without thinking about WASM**.

---

## The headline constraint, measured first

Before designing anything, I measured what a WASM module actually costs on this
project's toolchain (Node 26, Rust 1.99 nightly, `wasm32-unknown-unknown`,
`opt-level="z"`, `lto=true`, `panic=abort`, `strip=true`):

| Module contents | Bytes |
| --- | ---: |
| Trivial `add(a, b)`, no `js-sys` | 27,707 |
| …plus `format!` | 30,872 |
| …plus `HashMap`, `String`, `Vec` | 36,029 |
| …plus **one** `js_sys::Array::new()` | **329,588** |
| …plus `js_sys::Object::new()` instead | 329,716 |

**`js-sys` costs ~302 KB the instant it is linked, regardless of which API you
call.** A single `Array::new()` is enough. wasm-bindgen's `js-sys` glue
enumerates the WebIDL surface rather than tree-shaking to the used subset, so
LTO cannot remove it.

This is the single most important fact in this document, and it drives the whole
architecture:

1. A WASM module here is a **pure computation library**. It never touches the
   DOM. DOM work happens in JavaScript, where the DOM API is already free.
2. Modules exchange **primitives** — numbers, strings, flat numeric arrays —
   never JS objects. `Vec<JsValue>` and `js_sys::Array` both cost 300 KB and buy
   nothing a `Float64Array` over the boundary does not.
3. The wasm boundary is a **hot path to keep thin**, not a general-purpose
   marshalling layer.

An empty module is ~28 KB. That is the floor every consumer pays per crate they
opt into, and the reason crates are separate.

---

## The two-layer split

The design principle from PRINCIPLES.md applies to WASM as much as to CSS:
**the system must work with the powerful layer absent.**

```
Layer 1 (always)      CSS + progressive enhancement      zero cost, zero deps
Layer 2 (opt-in)      WASM model in Rust                ~28 KB per crate
```

A rich text editor with no WASM is a `<textarea>` with a toolbar. A spreadsheet
with no WASM is a plain `<table>`. A context menu with no WASM is a `<ul>` of
buttons. Each is genuinely usable, accessible, and correct — just less capable
on very large documents.

WASM is never required for content to be visible, for a component to be
operable, or for it to be keyboard-accessible. That is the same rule as the
progressive-enhancement principle in PRINCIPLES.md, and it is what makes this
usable from a plain TypeScript project.

---

## Using it without touching WASM

**This is the primary interface.** WASM is an optimization layer, not an
architectural requirement.

```ts
// Works in any TypeScript project. No Rust, no WASM, no build step.
import { FutureCssEditor } from "@future-css/rich-text";

const editor = new FutureCssEditor("#editor");
editor.applyMark("bold");   // models the mark in the DOM, no Rust involved
```

WASM is loaded only when you ask for it:

```ts
const editor = await FutureCssEditor.create({
  element: "#editor",
  // Optional. Omit it and everything still works, without the Rust model.
  accelerator: "wasm",   // or "auto" (default) | "none"
});
```

Three modes, and they are a real API rather than a build flag:

| Mode | Behavior |
| --- | --- |
| `"auto"` (default) | Loads WASM if the browser supports it and the document is large enough to justify it; otherwise uses the JS path |
| `"wasm"` | Always loads it; useful when you know you need the model |
| `"none"` | Never loads it; no network request at all |

The JS layer detects support via `WebAssembly` presence and feature detection, so
a browser without WASM silently takes the JS path. **No feature-detection code
leaks into your application** — that is the point of the abstraction.

---

## Crate layout

One workspace, one published module per *opt-in unit*. Boundaries follow *what a
consumer opts into*, and the dependency arrow points strictly downward.

Six crates produce four `.wasm` modules: `fc-core` is linked into the `fc-model` module
rather than published on its own, and `fc-diff` is Rust-only so far.

```
crates/
  fc-core/           ABI version, panic hook, structured errors
  fc-model/          UTF-16 text buffer primitives
  fc-rich-text/      inline formatting model      -> core, model
  fc-context-menu/   menu model + keyboard nav    -> core
  fc-grid/           grid, cells, selection       -> core
  fc-diff/           Myers line diff + stats      -> core  (no module yet)
```

Measured release sizes with the current code:

| Crate | Bytes | Contains |
| --- | ---: | --- |
| `fc-core` | 344,432 | errors, panic hook |
| `fc-model` | 369,512 | text buffer |
| `fc-rich-text` | 383,266 | marks and spans |
| `fc-context-menu` | 424,164 | menu traversal |
| `fc-grid` | 372,115 | cell ranges |

**These numbers are the problem, not the goal.** Each is ~300 KB of `js-sys`
glue plus ~30 KB of actual logic. The fix, and the next piece of work, is to
remove `js-sys` from the WASM boundary entirely and return primitives:

| Crate | Now | Target |
| --- | ---: | ---: |
| `fc-core` | 344 KB | ~28 KB |
| `fc-model` | 370 KB | ~30 KB |
| `fc-rich-text` | 383 KB | ~35 KB |
| `fc-context-menu` | 424 KB | ~30 KB |
| `fc-grid` | 372 KB | ~32 KB |
| **Consumer using only the grid** | 372 KB | **~32 KB** |

The current sizes are recorded deliberately, rather than quietly optimizing
later, because the "before" number is the justification for the design. See
Phase A in PLAN.md.

---

## What belongs in Rust, and what does not

This judgment call determines whether WASM helps or hurts, so it is worth stating
precisely.

**In Rust — pure computation over data you already have:**

| Concern | Why |
| --- | --- |
| UTF-16 offset conversion, text buffers | Byte/char/UTF-16 confusion is the top source of editor bugs |
| Mark/span algebra | Set operations over ranges, per keystroke |
| Menu keyboard traversal | Roving tabindex and typeahead are WCAG-relevant and easy to get wrong |
| Grid range arithmetic | Viewport intersection and selection geometry, per frame |
| Diffing, change tracking, formula graphs | O(n^2) -> O(n), and deterministic |

**In JavaScript — anything that observes the browser:**

| Concern | Why |
| --- | --- |
| Layout measurement, `getBoundingClientRect` | WASM cannot observe layout; it would need a stale copy |
| Scroll and resize handling | Same |
| Focus management | The browser owns focus; a model cannot steal it |
| Rendering | `contenteditable`, virtualization, canvas are DOM/graphics work |
| Menu positioning | Depends on scroll position and ancestor clipping |
| ARIA and announcements | The accessibility tree is a browser concern |

The rule: **if answering the question requires asking the browser something, it
stays in JavaScript.** WASM answers questions about *data*.

---

## The ABI handshake

CSS and WASM are versioned independently, because the CSS must work without the
WASM. That independence creates a failure mode: a consumer upgrades the JS layer
but serves a cached `.wasm` from a service worker or CDN, and the two disagree.

The result is not a crash. It is wrong-but-plausible behavior, which is much
worse. So `fc-core` exports an ABI version and the JS layer asserts it on init:

```ts
const abi = wasm.abiVersion();
if (abi !== CORE_ABI_VERSION) {
  throw new Error(
    `future-css: WASM ABI ${abi} does not match JS ${CORE_ABI_VERSION}. ` +
    `Clear the service worker cache or match the versions.`
  );
}
```

Cheap, and it converts silent corruption into an immediate, actionable error.

---

## Cross-boundary conventions

**Offsets are UTF-16 code units, everywhere.** JavaScript's own indexing,
selection APIs, and `slice` all use them. Converting at the boundary is what
keeps the Rust side free of JS-offset ambiguity.

**One deliberate divergence from JavaScript.** JS `slice(2,3)` on `"aé😀b"`
returns a lone surrogate. Rust cannot represent that — slicing a `str`
mid-codepoint panics, and on wasm32 a panic is an abort. So `fc-model` clamps to
the nearest character boundary and returns a valid string. This is documented at
the call site in `fc-model`, because a consumer porting JS logic must know the two
do not match.

**Errors are structured, not strings.** `FcError` carries an `invalidInput` /
`unsupported` / `outOfBounds` kind, because "the user typed something invalid"
and "we have a bug" need different handling at the JS boundary, and a string
destroys that distinction.

**Panics abort.** `panic = "abort"` removes unwinding tables, and a panic hook is
installed at init so a failure surfaces as a readable message rather than
`unreachable`.

---

## Toolchain notes

Two things that cost time to discover, recorded so they are not rediscovered.

**The `wasm-bindgen` CLI version must match the crate exactly.** The bindgen wire
format is unstable between patch releases. With a CLI of 0.2.118 and a crate
resolved to 0.2.129, the build fails deep in the pipeline:

```
rust Wasm file schema version: 0.2.129
 this binary schema version: 0.2.118
```

This reads like corruption rather than a version skew. The workspace pins
`wasm-bindgen = "=0.2.118"` to match the installed CLI for exactly this reason.

**Constructors need `#[wasm_bindgen(constructor)]`.** wasm-bindgen only generates
ABI glue for types it was told about, and a by-value static factory inside a
`#[wasm_bindgen] impl` block does not compile. Private fields must be explicit:
making any field private stops wasm-bindgen inferring the others, so they need
`#[wasm_bindgen(skip)]` or an explicit accessor.

**The `nodejs` bindgen target emits broken CommonJS in 0.2.118.** The generated
file assigns to `exports.TextBuffer`, `exports.abiVersion`, and so on, but never
defines `exports` or requires the `module` object — so the bindings land on an
undefined identifier and `require()` returns an empty object. The `web` target is
unaffected because it uses ESM `export`.

This is a bug in the pinned CLI, not in the crates, and it is why
`build-wasm.ts` emits both targets into **separate** directories and why
`tests/wasm.test.ts` loads the `web` build. When the CLI is next upgraded, the
`nodejs` build should be re-verified and this note removed.

---

## What is deliberately out of scope

**Spreadsheet formulas.** Formula evaluation is a dependency graph with cycle
detection, error propagation, and locale-dependent number formatting — tens of
thousands of lines plus a large external dependency. Folding it into `fc-grid`
would make it the largest module and force every consumer of the selection model
to download it. It belongs in a separate crate and a separate opt-in.

**A JS reimplementation of every model.** The JS path is progressive enhancement
on the DOM, not a second implementation of the Rust algorithms. Maintaining both
would mean every algorithm change lands twice and the two drift — which is how
"works on my machine" bugs are born. Where correctness matters and JS performance
does not, the JS path is simpler and slightly less capable, and that is accepted.

**Collaboration (CRDT) and OT.** Enormous, orthogonal, and a different product
category.

**DOM access from WASM.** See the table above. This is the decision most likely to
be second-guessed, so the reasoning is recorded rather than just the rule: a WASM
module that reached for the DOM would have to be reimplemented when the DOM
changed, and would duplicate something the browser already does better.
## What actually ships

The size report carries two numbers per module, and they answer different
questions. The **budget basis** is the pre-bindgen rustc output — the number the
budgets were set against, and the one where the ~302 KB `js-sys` cost is
visible. The **ships** column is what a consumer downloads: the post-bindgen web
module after the optional `wasm-opt -Oz --enable-bulk-memory` pass.

Measured (issue #16, binaryen 132):

| module | report basis | ships |
| --- | ---: | ---: |
| fc-core | 336.4 KB | 18.3 KB |
| fc-model | 360.9 KB | 36.3 KB |
| fc-rich-text | 374.3 KB | 45.9 KB |
| fc-context-menu | 414.2 KB | 81.3 KB |
| fc-grid | 363.4 KB | 35.1 KB |
| fc-diff | 56.2 KB | 34.8 KB |
| fc-select | 74.6 KB | 50.0 KB |
| fc-git | 45.0 KB | 25.9 KB |

Two facts follow, and both matter:

1. **The raw basis overstates the wire.** bindgen strips its custom sections and
   wasm-opt removes most of the remainder, so "`js-sys` costs ~302 KB" is a
   statement about the unoptimized linked artifact, not about what ships. The
   architecture rule (primitives only) still holds — it keeps the artifact small
   before any optimizer runs — but the wire cost of the current `js-sys` modules
   is tens of KB, not hundreds.
2. **The shipped basis re-prioritizes Phase A.** On what actually downloads,
   `fc-context-menu` (81.3 KB) is the real outlier, then `fc-select` (50.0) and
   `fc-rich-text` (45.9); `fc-core` ships 18.3 KB and `fc-grid` 35.1. The
   budgets remain on the raw basis until Phase A decides whether to re-derive
   them against shipped bytes — deliberately, because moving the goalposts and
   measuring the result are two different changes.

`wasm-opt` is an optional system tool, like the `wasm-bindgen` CLI: install
binaryen and the build uses it, skip it and the build is complete but the
shipped sizes are ~10% larger. The report says which happened. The parity suite
runs against the optimized modules, so a wasm-opt regression is caught by the
same tests that catch a Rust regression.
