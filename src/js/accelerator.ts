/**
 * The accelerator abstraction.
 *
 * This file is the reason a WASM implementation of this design system is usable
 * from a plain TypeScript project. It defines one interface, two implementations
 * (WASM and a JS fallback), and the selection logic between them. Consumers
 * depend on the interface; nothing above this file knows which one they got.
 *
 * The rules this layer follows, in priority order:
 *
 *   1. WASM is never required. Every method on `Accelerator` has a working JS
 *      implementation, so a browser without WebAssembly loses performance and
 *      nothing else.
 *   2. Loading is asynchronous and non-blocking. Nothing here blocks the main
 *      thread on a network fetch.
 *   3. A WASM failure degrades to JS rather than throwing. A corrupt cache or an
 *      ABI mismatch must not take the editor down with it.
 *   4. Feature detection lives here, not in application code.
 */

/** How the accelerator should be chosen. */
export type AcceleratorMode = "auto" | "wasm" | "none";

/** Why a particular implementation was selected. Surfaced for diagnostics. */
export type AcceleratorReason =
  | "explicit-wasm"
  | "explicit-none"
  | "unsupported-runtime"
  | "load-failed"
  | "below-threshold"
  | "reduced-data"
  | "wasm-selected";

/**
 * The contract every implementation satisfies.
 *
 * Deliberately narrow: primitives in, primitives out. Methods take and return
 * numbers and strings, never JS objects, because marshalling objects across the
 * boundary is what makes a WASM module large (see docs/WASM.md).
 */
export interface Accelerator {
  /** Identifies the implementation, for logging and for tests. */
  readonly kind: "wasm" | "js";
  /**
   * The ABI version of the loaded module, or `0` for the JS path, which has no
   * ABI to speak of.
   */
  readonly abiVersion: number;

  /** Character count, not byte or UTF-16-unit count. */
  countChars(text: string, start: number, end: number): number;

  /**
   * Extracts a substring by UTF-16 offsets.
   *
   * Clamps to character boundaries rather than splitting a surrogate pair. This
   * is a deliberate divergence from `String.prototype.slice`; see docs/WASM.md.
   */
  slice(text: string, start: number, end: number): string;
}

/** The ABI this JS layer was built against. Asserted on every WASM load. */
export const CORE_ABI_VERSION = 1;

/**
 * Document size below which WASM is not worth loading.
 *
 * The floor for a module is ~28 KB plus a network round trip. The JS
 * implementations of these operations are native-speed for small inputs, so
 * loading WASM for a ten-character document is a pure loss.
 *
 * 4 KB is roughly one screen of prose. Below this the JS path is used and the
 * user never pays a download.
 */
export const WASM_THRESHOLD_BYTES = 4096;

/** Whether this runtime can load WASM at all. */
export function wasmSupported(): boolean {
  return (
    typeof WebAssembly === "object" &&
    typeof WebAssembly.instantiate === "function" &&
    typeof WebAssembly.compile === "function"
  );
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The pure-JS implementation.
 *
 * This is the baseline every path must remain correct without. It is also what
 * runs when WASM is unavailable, disabled, or too large to justify.
 */
export class JsAccelerator implements Accelerator {
  readonly kind = "js" as const;
  readonly abiVersion = 0;

  countChars(text: string, start: number, end: number): number {
    const [from, to] = this.clamp(text, start, end);
    // Spreading iterates code points, so an emoji counts as one character
    // rather than the two UTF-16 units it occupies.
    return [...text.slice(from, to)].length;
  }

  slice(text: string, start: number, end: number): string {
    const [from, to] = this.clamp(text, start, end);
    return text.slice(from, to);
  }

  /**
   * Clamps a range to the string, then to character boundaries.
   *
   * Both endpoints are *advanced* past a low surrogate rather than expanded
   * outward. That direction matters and is what keeps this in step with the Rust
   * implementation, which rounds each offset up to the next boundary:
   *
   *   - `slice(2, 3)` -- ends inside the emoji -- becomes `[2, 4]`, the whole
   *     character. Never a lone surrogate, which renders as a replacement glyph
   *     and corrupts any text it is stored in.
   *   - `slice(3, 3)` -- an empty range whose caret sits *between* surrogate
   *     halves, a position that cannot exist in character terms -- becomes
   *     `[4, 4]`, still empty. Expanding outward here would wrongly return half
   *     a character.
   *
   * Expanding on the start instead of advancing is the tempting alternative and
   * it is wrong for the empty case, which is precisely what the WASM/JS parity
   * test exists to catch.
   */
  private clamp(text: string, start: number, end: number): [number, number] {
    const len = text.length;
    const from = Math.max(0, Math.min(start, len));
    const to = Math.max(from, Math.min(end, len));
    return [advance(text, from), advance(text, to)];
  }
}

/**
 * Moves an offset past a trailing low surrogate, i.e. to the next valid
 * character boundary.
 *
 * A low surrogate is the second half of a pair, so an offset pointing at one is
 * inside a character. Advancing by one lands exactly on the following boundary:
 * a surrogate pair is always two units, so there is never a second low
 * surrogate to skip.
 */
function advance(text: string, offset: number): number {
  if (offset < text.length && isLowSurrogate(text.charCodeAt(offset))) {
    return offset + 1;
  }
  return offset;
}

/** Everything the loader needs, kept minimal so it is easy to stub in tests. */
export interface AcceleratorOptions {
  /** Resolves the module URL to a factory. Injected so tests never touch the network. */
  loadWasm?: (url: string) => Promise<unknown>;
  /** Base URL for published modules. */
  baseUrl?: string;
  /** Size of the document in UTF-16 units, used by the `"auto"` heuristic. */
  documentSize?: number;
  /** Override the browser preference for server-side rendering or app settings. */
  reducedData?: boolean;
}

/**
 * Chooses and builds an accelerator.
 *
 * Never throws on WASM failure. A consumer that opts into `"wasm"` and gets a
 * broken module should still get a working editor, because an editor that does
 * not open is worse than a slow one.
 */
export async function createAccelerator(
  mode: AcceleratorMode = "auto",
  options: AcceleratorOptions = {},
): Promise<{ accelerator: Accelerator; reason: AcceleratorReason }> {
  if (mode === "none") {
    return { accelerator: new JsAccelerator(), reason: "explicit-none" };
  }

  if (!wasmSupported()) {
    return { accelerator: new JsAccelerator(), reason: "unsupported-runtime" };
  }

  const reducedData = options.reducedData ?? (
    globalThis.matchMedia?.("(prefers-reduced-data: reduce)").matches === true ||
    (globalThis.navigator as Navigator & { connection?: { saveData?: boolean } } | undefined)?.connection?.saveData === true
  );
  if (mode === "auto" && reducedData) {
    return { accelerator: new JsAccelerator(), reason: "reduced-data" };
  }

  const size = options.documentSize ?? 0;
  if (mode === "auto" && size < WASM_THRESHOLD_BYTES) {
    return { accelerator: new JsAccelerator(), reason: "below-threshold" };
  }

  const url = options.baseUrl ?? "/wasm/fc-model";
  try {
    const glue = await options.loadWasm?.(url);
    const factory = (glue as { default?: unknown } | undefined)?.default;
    if (typeof factory !== "function") {
      return { accelerator: new JsAccelerator(), reason: "load-failed" };
    }

    const accelerator = (await (factory as () => Promise<Accelerator>)()) as Accelerator;

    // A version skew between the JS layer and a cached .wasm does not crash, but
    // it silently produces wrong results. Falling back keeps the editor correct
    // and the log explains why.
    if (accelerator.abiVersion !== CORE_ABI_VERSION) {
      console.warn(
        `future-css: WASM ABI ${accelerator.abiVersion} does not match ` +
          `JS ${CORE_ABI_VERSION}; using the JS implementation. ` +
          `Clear the service worker cache if this persists.`,
      );
      return { accelerator: new JsAccelerator(), reason: "load-failed" };
    }

    return {
      accelerator,
      reason: mode === "wasm" ? "explicit-wasm" : "wasm-selected",
    };
  } catch (error) {
    console.warn("future-css: WASM failed to load; using the JS implementation.", error);
    return { accelerator: new JsAccelerator(), reason: "load-failed" };
  }
}