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

The editor, grid and menu bindings provide their browser behavior entirely in JS.
The editor uses contenteditable, the grid uses an accessible grid focus model, and
the menu binding implements its keyboard contract. Native textareas, tables and
visible command buttons are no-JS alternatives; these are different from no-WASM.

WASM is never required for content to be visible, for a component to be
operable, or for it to be keyboard-accessible. That is the same rule as the
progressive-enhancement principle in PRINCIPLES.md, and it is what makes this
usable from a plain TypeScript project.

---

## Using it without touching WASM

Browser bindings import from the package directly:

```ts
import { FutureCssEditor } from "future-css/editor";
const editor = new FutureCssEditor({ root: ".fc-editor" });
```

Editor and grid Rust models are not wired into these bindings. Select and menu
bindings have explicit `useWasm` options with JS fallback; git computation also has
an optional model. Do not assume a `.create()` or editor accelerator option exists.

`createAccelerator` from `future-css/js` is the generic loader abstraction. Its
`loadWasm` callback supplies an adapter implementing the Accelerator interface;
raw bindgen initialization is not itself such an adapter.

| Mode | Behavior |
| --- | --- |
| `"auto"` | JS below the size threshold, under reduced-data/Save-Data, or without WASM support; otherwise try the supplied loader |
| `"wasm"` | Explicitly try the supplied loader; failures and ABI mismatches retain JS |
| `"none"` | JS without a download |

The bindings remain usable without WASM. The generic loader's core ABI is 2;
select and menu retain their independent version handshakes.

---

## Crate layout

One workspace, one published module per *opt-in unit*. Boundaries follow *what a
consumer opts into*, and the dependency arrow points strictly downward.

Ten crates produce nine importable modules: `fc-core` is emitted into the `fc-model`
module directory rather than published on its own.

```
crates/
  fc-core/           ABI version, panic hook, structured errors
  fc-model/          UTF-16 text buffer primitives
  fc-rich-text/      inline formatting model      -> core, model
  fc-context-menu/   menu model + keyboard nav    (primitives only, no core)
  fc-grid/           grid, cells, selection       -> core
  fc-diff/           Myers line diff + stats      -> core
  fc-select/         option list + typeahead      (no deps; primitives only)
  fc-git/            working-tree summary         (no deps; primitives only)
  fc-highlight/      highlight.ts's tokenizer     (no deps; primitives only)
  fc-ansi/           ansi.ts's SGR parser        (no deps; primitives only)
```

Measured release sizes when the workspace was first built (historical; the
current figures are in [What actually ships](#what-actually-ships)):

| Crate | Bytes | Contains |
| --- | ---: | --- |
| `fc-core` | 344,432 | errors, panic hook |
| `fc-model` | 369,512 | text buffer |
| `fc-rich-text` | 383,266 | marks and spans |
| `fc-context-menu` | 424,164 | menu traversal |
| `fc-grid` | 372,115 | cell ranges |

**These numbers are the problem, not the goal.** Each is ~300 KB of `js-sys`
glue plus ~30 KB of actual logic. The implemented fix removes `js-sys` from the WASM boundary entirely and return primitives:

| Crate | Then | Target |
| --- | ---: | ---: |
| `fc-core` | 344 KB | ~28 KB |
| `fc-model` | 370 KB | ~30 KB |
| `fc-rich-text` | 383 KB | ~35 KB |
| `fc-context-menu` | 424 KB | ~30 KB |
| `fc-grid` | 372 KB | ~32 KB |
| **Consumer using only the grid** | 372 KB | **~32 KB** |

These historical sizes explain the boundary design. The current report measures
actual shipped binaries and fails the build above the unchanged targets. See
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

**Errors retain a kind.** Native Rust uses `FcError`. Core ABI 2 throws tagged primitive
strings `fc:<kind>:<message>` rather than constructing JS Error objects in Rust.
The prefix preserves `invalidInput`, `unsupported` and `outOfBounds` classification;
a JS adapter may wrap it in its own Error type. This removes the last `js-sys` import.

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

As of 2026-10-08, the build gates the **shipped web-target .wasm** against the
unchanged numeric targets. `bytes` retains the raw rustc measurement;
`shippedBytes` measures the actual file after bindgen and optional optimization.
`budgetBasis` is `"shipped"`, `withinBudget` refers to that basis, and
`rawWithinBudget` retains the diagnostic comparison.

Raw artifacts include bindgen descriptor sections that consumers never download.
Gating them would reject a smaller shipped module for metadata alone. No target
was raised: 40 KB core, 45 KB model/menu/grid, 50 KB rich-text/git, 35 KB
diff/select/highlight (all decimal bytes). Every module also fits without wasm-opt. JS glue is separate
from this binary budget. The report remains reproducible in `dist/wasm/size-report.json`;
`tests/wasm-budget.test.ts` verifies its sizes against the actual files and pins targets.

The primitives-only boundary removes `js-sys` and `serde-wasm-bindgen` entirely.
Menu, select, diff, git and highlight use the isolated `bare` builds. Native serde derives remain
available for internal Rust data; they do not marshal JS objects at the boundary.

### Core ABI 2 migration

- TextBuffer `lines16()` returns `Uint32Array([start,end,...])`, rather than nested
  arrays. `lineAt()` and `replace16()` return a two-coordinate Uint32Array.
- CellRange `toArray()`, Viewport `visibleRange()` / `renderRange()` return four
  coordinates. CellRange `cells()` returns flat row/column pairs in row-major order.
- Block replaces the automatic `toJSON()` method with `serialize()` returning JSON
  text. Decode with `JSON.parse(block.serialize())`. `splitAt()` returns JSON text
  containing the two blocks; decode with `JSON.parse(block.splitAt(offset))`.
- Errors are tagged strings as described above. Treat a cached ABI 1 module as
  incompatible; the generic loader already falls back to JS.

Range and split offsets clamp forward at a surrogate boundary. Returned replacement
coordinates and rebased formatting spans now use that same actual boundary.
`tests/wasm-boundary.test.ts` covers every offset pair in multilingual samples,
all JSON control characters, quotes/backslashes, row-major cells and overscan.
The existing exhaustive slice/count parity tests remain unchanged in strength.

### Case folding belongs to JavaScript

`fc-select` was the largest primitives-only module, and it had no `js-sys` to
blame. Profiling the shipped module (`twiggy top` on a build with
`CARGO_PROFILE_RELEASE_STRIP=false`) showed why: `str::to_lowercase` and the
Unicode case tables behind it were about a fifth of the bytes, and `format!` —
used once, to concatenate the typeahead buffer — pulled in more of the formatting
machinery. JavaScript already ships the same tables as `toLowerCase()`.

So the boundary now takes **pre-folded match keys**: the binding lowercases labels
and values once, and lowercases (and trims) each query, and the crate matches them
verbatim. Native Rust callers keep a case-insensitive model through
`Select::new`; the boundary builds every model with `Select::prefolded`, and the
two are selected by function pointer rather than an enum so the linker can drop
the Unicode path entirely. Measured with rustc 1.97 and binaryen 132, before and
after on the same toolchain: **48.9 KB → 38.4 KB shipped**, 73.0 → 61.9 KB raw.

It is also a parity fix. Rust's `to_lowercase` and JavaScript's `toLowerCase`
each follow their own Unicode version, so "case-insensitive" had two definitions
that could disagree on a character one side had not learnt yet. Now there is
one. The cost is that the typeahead buffer must be folded as a whole on the JS
side — lowercasing is context-sensitive, and a final capital sigma folds
differently from a medial one — so `selectTypeaheadFrom` takes the folded
buffer as a needle and answers only the match. `tests/wasm.test.ts` drives the
adapter and the JS twin through exactly those cases.

The pattern generalises: any crate that folds, normalises, or segments text for
matching should take the result from JavaScript rather than link the tables.

### No std for primitives-only crates

With case folding gone, `fc-select` and `fc-diff` were still over budget, and the
profile (same method) put most of the remainder in code neither crate wrote: std's
panic runtime, which formats every message it might print -- `Debug` for ranges, char
escaping for `str` slicing errors, integer padding -- and links all of it as soon as
any bounds check or string slice can fail. With `panic = "abort"` a panic was already a
trap, so the formatting bought nothing.

Both crates now have a `bare` feature that builds them `no_std` on wasm: a panic
handler that traps without formatting, and std's own allocator (`dlmalloc`) named as a
dependency instead of arriving with std. Two edits went with it, because core's own
string search panics through the same formatting: `fc-diff` splits lines by scanning
bytes rather than with `replace` and `split`, and `fc-select` matches substrings with a
byte scan rather than `str::contains`. Both terminators and substrings are byte-exact
in valid UTF-8, so neither changes a result; the parity suite pins every line
terminator shape.

Measured with rustc 1.97, no wasm-opt, before and after on the same toolchain:

| module | raw | ships |
| --- | ---: | ---: |
| fc-diff | 54.4 → 37.7 KB | 36.8 → **20.9 KB** |
| fc-select | 62.1 → 47.4 KB | 41.5 → **27.5 KB** |

`bare` is off by default and build:wasm builds those crates in a separate cargo
invocation. Feature unification is per build: compiled alongside the std crates,
wasm-bindgen's `std` feature comes back on, std's panic handler arrives with it, and the
two handlers collide. A plain `cargo build --target wasm32-unknown-unknown` of the
workspace therefore still works, and produces the larger std build. `cargo test` runs
natively and never sees the feature.

The remaining raw bytes are mostly wasm-bindgen's descriptor section (about 8 KB for
fc-diff), which bindgen strips and which never ships, plus the allocator (about 5 KB).

### A tokenizer without a regex engine

`fc-highlight` ports `highlight.ts`, whose grammars are regexes with lookahead and
lookbehind. The `regex` crate has neither, and an engine that does would cost more
than the module's whole budget, so each token is a matcher returning the end the JS
regex would choose, backtracking included. The parity test runs every sample and
1,500 generated strings per language through both tokenizers.

Its first build shipped 44.5 KB. Two things were most of the excess: `to_lowercase`
for resolving a language name linked Unicode's case tables, though every name is
ASCII (only the Kelvin sign folds into ASCII from outside it, and it is mapped by
hand); and `str::contains` with a `char` builds a substring searcher, for sets that
are all ASCII bytes. Without both it ships **26.8 KB**.

### A streaming parser across the boundary

`fc-ansi` ports `ansi.ts`, the SGR parser behind the terminal. Its state lives in a
`#[wasm_bindgen]` struct, because output arrives in writes that split anywhere: inside
an escape sequence, between `\r` and `\n`, inside a UTF-8 character. Finished lines
are taken in a batch and read one at a time, each as its text plus a flat `Int32Array`
of `(end, colour, attributes)` triples, ends in UTF-16 units and `-1` for the default
colour. Lone surrogates arrive as U+FFFD, because wasm-bindgen encodes them that way,
so `ansi.ts` replaces them too. Its parity test feeds 1,500 generated strings to both
parsers in random chunks, as text and as bytes, and compares after every chunk. It ships
**17.8 KB** against a 25 KB budget.

### Pure Rust consumers: the `bindgen` feature

The models are useful without a JavaScript boundary: the Dioxus component library
links them as ordinary Rust. Every crate therefore puts wasm-bindgen behind a
default-on `bindgen` feature (in `fc-core` it also carries the console panic hook).
With defaults on nothing changes, so build:wasm, the bindings and the size budgets
are untouched. With defaults off a crate links no wasm-bindgen on any target:

```toml
fc-model = { path = "...", default-features = false }
```

That matters more than the bytes. The pin is exact (`=0.2.118`) because the CLI
must match, and Cargo allows one wasm-bindgen per semver range in a build. With
bindgen on, a Dioxus 0.7.9 app is dragged back to wasm-bindgen 0.2.118 (it would
otherwise resolve 0.2.129), and an existing lockfile holding the newer version
fails to resolve at all.

Exports are written `#[cfg_attr(feature = "bindgen", wasm_bindgen(...))]`, so the
same functions and methods stay public to Rust callers. Only what names `JsValue`
is compiled out: `From<FcError> for JsValue`, `init_panic_hook`, and the
`Result<_, JsValue>` wrappers (`slice16`, `replace16`, `lineAt`, `countChars`,
`applyMark`, `hasMark`, `splitAt`, `fillDown`), each of which wraps a public Rust
method returning `FcError`. Siblings are pulled with defaults off and `bindgen`
forwarded explicitly, so turning it off at the top turns it off all the way down.

`bindgen` and `bare` are independent: a pure Rust consumer has std and never enables
`bare`. `npm run test:rust` runs the Rust tests both ways and checks wasm32 with
defaults off, and `tests/pure-rust.test.ts` fails if `cargo tree` finds wasm-bindgen
in a defaults-off crate.

`wasm-opt` is an optional system tool, like the `wasm-bindgen` CLI: install
binaryen and the build uses it, skip it and the build is complete but the
shipped sizes are ~10% larger. The report says which happened. The parity suite
runs against the optimized modules, so a wasm-opt regression is caught by the
same tests that catch a Rust regression.
