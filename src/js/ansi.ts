/**
 * ANSI SGR parsing for the terminal.
 *
 * Turns raw program output into lines of styled runs: one of the sixteen
 * `fc-term-ansi-*` colours plus bold, dim, italic, underline, inverse and
 * strike, which is everything `.fc-terminal` can render. `crates/fc-ansi` is
 * the Rust twin, and `tests/wasm.test.ts` holds the two to the same runs on the
 * same chunk sequences, including generated ones split at random.
 *
 * # Streaming
 *
 * Output arrives in writes that split wherever the pipe happened to flush, so
 * the parser keeps its state between chunks: an escape sequence, a CRLF or a
 * UTF-8 character cut in half by a write still parses. A string chunk must not
 * split a surrogate pair; a lone surrogate becomes U+FFFD, as it does on its
 * way into the WASM module. Feed bytes with `pushBytes` when the source is a
 * byte stream.
 *
 * # What is deliberately not mapped
 *
 * 256-colour and truecolor (`38;5;n`, `38;2;r;g;b`) fall back to the default
 * foreground: mapping them would mean writing inline colours, which no theme
 * can remap and no contrast test can check. Their parameters are still skipped,
 * so `38;5;196;1` remains bold. Backgrounds have no slot in a run.
 *
 * Cursor movement and every other non-SGR CSI, OSC (titles, hyperlinks),
 * DCS/SOS/PM/APC strings and two-byte escapes are consumed, never shown. This
 * styles a log; it does not emulate a screen.
 *
 * # Line breaks
 *
 * `\n`, `\r\n` and a lone `\r` each end exactly one line. A lone `\r` is how a
 * progress bar redraws itself; with no cursor to return, a line per frame loses
 * nothing, where dropping it would run every frame into one line. The break
 * happens on the `\r`, so a CRLF split between writes cannot add a blank line.
 *
 * Tab is text. Every other C0 control and DEL is dropped.
 */

/** The sixteen slots, in wire order: a colour's index here is its code. */
export const ANSI_COLORS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright-black", "bright-red", "bright-green", "bright-yellow",
  "bright-blue", "bright-magenta", "bright-cyan", "bright-white",
] as const;

export type AnsiColor = (typeof ANSI_COLORS)[number];

/**
 * Attribute bits. The names are also the `.fc-terminal__<name>` class
 * suffixes, and the values are the wire encoding the Rust twin uses.
 */
export const ATTRIBUTES = {
  bold: 1,
  dim: 2,
  italic: 4,
  underline: 8,
  inverse: 16,
  strike: 32,
} as const;

export type AttributeName = keyof typeof ATTRIBUTES;

/** Text sharing one style. Never empty, and never contains a line break. */
export interface AnsiRun {
  text: string;
  /** `null` is the terminal's default foreground. */
  fg: AnsiColor | null;
  /** A bitmask of `ATTRIBUTES`. */
  attributes: number;
}

/** One line of output: its runs, empty for a blank line. */
export type AnsiLine = AnsiRun[];

/**
 * At most this many parameters of one CSI are kept; an unbounded list would let
 * one malformed sequence grow memory without limit. Values saturate likewise.
 * Both limits are the Rust twin's.
 */
const MAX_PARAMS = 32;
const MAX_VALUE = 65_535;

// Parser states. Plain numbers rather than an enum: Node's type stripping, which
// runs these sources unbuilt, rejects enums because they emit code.
const GROUND = 0;
const ESCAPE = 1;
/** After ESC and an intermediate byte, as in `ESC ( B`. */
const ESCAPE_INTERMEDIATE = 2;
const CSI = 3;
/** OSC, DCS, SOS, PM or APC: ends at ST, or at BEL as xterm accepts. */
const STRING = 4;
/** ESC inside a string: `\` completes ST, anything else aborts the string. */
const STRING_ESCAPE = 5;

/** A streaming parser. Mirrors `fc_ansi::Parser`. */
export class AnsiParser {
  #state = GROUND;
  /** Pairs of value and first sub-parameter (-1 for none). */
  #params: number[] = [];
  #value = 0;
  #sub = -1;
  /** 0 outside a sub-parameter, 1 in the first, 2 in any later one. */
  #subDepth = 0;
  #isPrivate = false;
  #intermediate = false;
  #fg: AnsiColor | null = null;
  #attributes = 0;
  #afterCr = false;
  // ignoreBOM keeps a U+FEFF as text: the default strips it, the Rust decoder
  // does not, and output that differs by one invisible character is still a
  // divergence.
  #decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  #lines: AnsiLine[] = [];
  #open: AnsiLine = [];

  /** Parses a chunk of text. A sequence may continue into the next chunk. */
  push(chunk: string): void {
    for (const c of chunk) this.#step(c);
  }

  /**
   * Parses a chunk of UTF-8 bytes. A character split between chunks is
   * reassembled; an invalid sequence becomes U+FFFD.
   */
  pushBytes(chunk: Uint8Array): void {
    this.push(this.#decoder.decode(chunk, { stream: true }));
  }

  /**
   * Ends the stream: an incomplete UTF-8 character becomes U+FFFD, an
   * unterminated escape is dropped, and the open line, if it has any text,
   * becomes a completed line. Style carries over to later input.
   */
  finish(): void {
    this.push(this.#decoder.decode());
    this.#state = GROUND;
    this.#afterCr = false;
    if (this.#open.length > 0) this.#endLine();
  }

  /** Completed lines not yet taken. */
  get lines(): readonly AnsiLine[] {
    return this.#lines;
  }

  /** Removes and returns the completed lines. */
  takeLines(): AnsiLine[] {
    const lines = this.#lines;
    this.#lines = [];
    return lines;
  }

  /** The line still being written, which may be empty. */
  get current(): readonly AnsiRun[] {
    return this.#open;
  }

  /** The foreground text written now would get. */
  get fg(): AnsiColor | null {
    return this.#fg;
  }

  /** The attribute bitmask text written now would get. */
  get attributes(): number {
    return this.#attributes;
  }

  #endLine(): void {
    this.#lines.push(this.#open);
    this.#open = [];
  }

  #text(c: string): void {
    const last = this.#open.at(-1);
    if (last && last.fg === this.#fg && last.attributes === this.#attributes) last.text += c;
    else this.#open.push({ text: c, fg: this.#fg, attributes: this.#attributes });
  }

  #step(c: string): void {
    let code = c.codePointAt(0)!;
    // Iteration yields a lone surrogate on its own. Rust strings cannot hold
    // one, and wasm-bindgen replaces it on the way in, so this does the same.
    if (code >= 0xd800 && code <= 0xdfff) {
      c = "\ufffd";
      code = 0xfffd;
    }
    switch (this.#state) {
      case GROUND:
        return this.#ground(c, code);
      case ESCAPE:
        return this.#escape(c, code);
      case ESCAPE_INTERMEDIATE:
        if (code >= 0x20 && code <= 0x2f) return;
        this.#state = GROUND;
        if (code >= 0x30 && code <= 0x7e) return;
        return this.#ground(c, code);
      case CSI:
        return this.#csi(c, code);
      case STRING:
        if (code === 0x07) this.#state = GROUND;
        else if (code === 0x1b) this.#state = STRING_ESCAPE;
        return;
      case STRING_ESCAPE:
        if (c === "\\") {
          this.#state = GROUND;
          return;
        }
        // An ESC that is not ST starts a new sequence, as xterm treats it,
        // rather than vanishing into the string.
        this.#state = ESCAPE;
        return this.#escape(c, code);
    }
  }

  #ground(c: string, code: number): void {
    const afterCr = this.#afterCr;
    this.#afterCr = false;
    if (code === 0x0a) {
      if (!afterCr) this.#endLine();
    } else if (code === 0x0d) {
      this.#endLine();
      this.#afterCr = true;
    } else if (code === 0x1b) {
      this.#state = ESCAPE;
    } else if (code === 0x09 || (code > 0x1f && code !== 0x7f)) {
      this.#text(c);
    }
  }

  #escape(c: string, code: number): void {
    if (c === "[") {
      this.#state = CSI;
      this.#params = [];
      this.#value = 0;
      this.#sub = -1;
      this.#subDepth = 0;
      this.#isPrivate = false;
      this.#intermediate = false;
    } else if (c === "]" || c === "P" || c === "X" || c === "^" || c === "_") {
      this.#state = STRING;
    } else if (code >= 0x20 && code <= 0x2f) {
      this.#state = ESCAPE_INTERMEDIATE;
    } else if (code >= 0x30 && code <= 0x7e) {
      this.#state = GROUND;
    } else {
      // Not an escape after all: the ESC is dropped and the character handled
      // as if it had never arrived.
      this.#state = GROUND;
      this.#ground(c, code);
    }
  }

  #csi(c: string, code: number): void {
    if (code >= 0x30 && code <= 0x39) {
      const digit = code - 0x30;
      if (this.#subDepth === 0) this.#value = Math.min(this.#value * 10 + digit, MAX_VALUE);
      else if (this.#subDepth === 1) this.#sub = Math.min(this.#sub * 10 + digit, MAX_VALUE);
    } else if (c === ":") {
      if (this.#subDepth === 0) this.#sub = 0;
      this.#subDepth = Math.min(this.#subDepth + 1, 2);
    } else if (c === ";") {
      this.#endParam();
    } else if (code >= 0x3c && code <= 0x3f) {
      this.#isPrivate = true;
    } else if (code >= 0x20 && code <= 0x2f) {
      this.#intermediate = true;
    } else if (code >= 0x40 && code <= 0x7e) {
      this.#endParam();
      this.#state = GROUND;
      if (c === "m" && !this.#isPrivate && !this.#intermediate) this.#sgr();
    } else {
      // A control or non-ASCII character cannot be part of a CSI, so the
      // sequence was malformed: drop it and keep the character.
      this.#state = GROUND;
      this.#ground(c, code);
    }
  }

  #endParam(): void {
    if (this.#params.length < MAX_PARAMS * 2) this.#params.push(this.#value, this.#sub);
    this.#value = 0;
    this.#sub = -1;
    this.#subDepth = 0;
  }

  #sgr(): void {
    const params = this.#params;
    const count = params.length / 2;
    let i = 0;
    while (i < count) {
      const value = params[i * 2]!;
      const sub = params[i * 2 + 1]!;
      i++;
      if (value === 0) {
        this.#fg = null;
        this.#attributes = 0;
      } else if (value === 1) this.#attributes |= ATTRIBUTES.bold;
      else if (value === 2) this.#attributes |= ATTRIBUTES.dim;
      else if (value === 3) this.#attributes |= ATTRIBUTES.italic;
      // `4:0` is "no underline" in the colon form; curly and the other
      // underline styles are all still an underline here.
      else if (value === 4) {
        if (sub === 0) this.#attributes &= ~ATTRIBUTES.underline;
        else this.#attributes |= ATTRIBUTES.underline;
      } else if (value === 7) this.#attributes |= ATTRIBUTES.inverse;
      else if (value === 9) this.#attributes |= ATTRIBUTES.strike;
      else if (value === 22) this.#attributes &= ~(ATTRIBUTES.bold | ATTRIBUTES.dim);
      else if (value === 23) this.#attributes &= ~ATTRIBUTES.italic;
      else if (value === 24) this.#attributes &= ~ATTRIBUTES.underline;
      else if (value === 27) this.#attributes &= ~ATTRIBUTES.inverse;
      else if (value === 29) this.#attributes &= ~ATTRIBUTES.strike;
      else if (value >= 30 && value <= 37) this.#fg = ANSI_COLORS[value - 30]!;
      else if (value === 39) this.#fg = null;
      else if (value >= 90 && value <= 97) this.#fg = ANSI_COLORS[value - 90 + 8]!;
      else if (value === 38 || value === 48 || value === 58) {
        if (value === 38) this.#fg = null;
        // The colon form carries its colour inside the one parameter. The
        // semicolon form spreads it over the following ones, which must be
        // skipped or `38;5;1` would turn on bold.
        if (sub === -1 && i < count) {
          const kind = params[i * 2];
          if (kind === 5) i += 2;
          else if (kind === 2) i += 4;
        }
      }
    }
  }
}

/** Parses a complete string: push, then finish, then every line. */
export function parseAnsi(input: string): AnsiLine[] {
  const parser = new AnsiParser();
  parser.push(input);
  parser.finish();
  return parser.takeLines();
}

/** The names of the attributes in a bitmask, in bit order. */
export function attributeNames(attributes: number): AttributeName[] {
  return (Object.keys(ATTRIBUTES) as AttributeName[]).filter((name) => attributes & ATTRIBUTES[name]);
}

/** The `terminal.css` classes that style a run. */
export function runClassNames(run: AnsiRun): string[] {
  const classes = run.fg ? [`fc-term-ansi-${run.fg}`] : [];
  for (const name of attributeNames(run.attributes)) classes.push(`fc-terminal__${name}`);
  return classes;
}

/**
 * Renders one line as a `.fc-terminal__line`. Text goes in as text nodes, never
 * markup, because program output is untrusted. A blank line gets a no-break
 * space so it keeps its height.
 */
export function renderAnsiLine(line: readonly AnsiRun[], doc: Document = document): HTMLElement {
  const el = doc.createElement("div");
  el.className = "fc-terminal__line";
  if (line.length === 0) el.textContent = " ";
  for (const run of line) {
    const classes = runClassNames(run);
    if (classes.length === 0) {
      el.append(run.text);
      continue;
    }
    const span = doc.createElement("span");
    span.className = classes.join(" ");
    span.textContent = run.text;
    el.append(span);
  }
  return el;
}
