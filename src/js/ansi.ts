/**
 * ANSI SGR parsing for the terminal.
 *
 * Turns program output -- text with escape sequences in it -- into the lines of
 * styled runs `.fc-terminal` renders: one of the sixteen `fc-term-ansi-*`
 * colours plus bold, dim, italic, underline, inverse and strike. The `fc-ansi`
 * crate is the same parser in Rust, and `tests/wasm.test.ts` holds the two to
 * identical output, so read the crate root for the rules; this file follows it
 * line for line.
 *
 * 256-colour and truecolor fall back to the default foreground, because an
 * inline colour cannot be themed or contrast-checked. Every non-SGR sequence is
 * consumed rather than shown.
 *
 * Output is untrusted. `renderAnsiLine` writes text with `textContent` only;
 * nothing a program prints can become markup.
 */

export const ANSI_COLORS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright-black", "bright-red", "bright-green", "bright-yellow",
  "bright-blue", "bright-magenta", "bright-cyan", "bright-white",
] as const;

export type AnsiColor = (typeof ANSI_COLORS)[number];

/** In wire-format bit order, which is also the order runs list them in. */
export const ANSI_ATTRIBUTES = ["bold", "dim", "italic", "underline", "inverse", "strike"] as const;

export type AnsiAttribute = (typeof ANSI_ATTRIBUTES)[number];

export interface AnsiRun {
  text: string;
  /** `null` is the terminal's default foreground. */
  fg: AnsiColor | null;
  attributes: AnsiAttribute[];
}

/** One output line, without its line ending. An empty line has no runs. */
export interface AnsiLine {
  runs: AnsiRun[];
  /**
   * The line's position in the stream since the parser was created or reset,
   * from 0. `renderAnsiLine` writes it as `data-fc-seq`, so a consumer can order
   * lines and spot a gap once the host trims scrollback.
   */
  seq: number;
}

const BOLD = 1, DIM = 2, ITALIC = 4, UNDERLINE = 8, INVERSE = 16, STRIKE = 32;

/** See `MAX_PARAMS` in the crate. */
const MAX_PARAMS = 256;

/** Parser states; see `State` in the crate. Constants, because type stripping has no enums. */
const State = { Ground: 0, Escape: 1, EscapeIntermediate: 2, Csi: 3, Str: 4, StrEscape: 5 } as const;

/** Runs while parsing: colour as 0-15 or -1, attributes as bits, as in Rust. */
interface RawRun { text: string; fg: number; attrs: number }

/**
 * wasm-bindgen encodes a lone surrogate as U+FFFD on the way in, so the WASM
 * parser never sees one. Doing the same here keeps the two paths identical.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export class AnsiParser {
  private state: number = State.Ground;
  private fg = -1;
  private attrs = 0;
  private params = "";
  private ignore = false;
  private intermediate = false;
  private cr = false;
  private line: RawRun[] = [];
  private done: RawRun[][] = [];
  /** Lines ended so far: the pending line's `seq`. */
  private ended = 0;
  // `ignoreBOM` keeps a U+FEFF as text, as Rust's decoder does, rather than
  // silently dropping it from the first chunk.
  private decoder = new TextDecoder("utf-8", { ignoreBOM: true });

  /** Feeds a chunk of text. */
  push(chunk: string): void {
    this.flushCarry();
    this.feedText(chunk.replace(LONE_SURROGATE, "�"));
  }

  /** Feeds a chunk of UTF-8 bytes; a character split across chunks is held. */
  pushBytes(chunk: Uint8Array): void {
    this.feedText(this.decoder.decode(chunk, { stream: true }));
  }

  /** Lines finished since the last call, oldest first. */
  takeLines(): AnsiLine[] {
    const first = this.ended - this.done.length;
    const lines = this.done.map((runs, i) => publicLine(runs, first + i));
    this.done = [];
    return lines;
  }

  /** The line still being written, which has no line ending yet. */
  get pending(): AnsiLine {
    return publicLine(this.line, this.ended);
  }

  /** Forgets everything: lines, style, and any partial sequence. */
  reset(): void {
    Object.assign(this, new AnsiParser());
  }

  /**
   * Text after bytes that ended mid-character makes that character invalid, as
   * in Rust. Flushing an idle decoder returns nothing, so this needs no flag.
   */
  private flushCarry(): void {
    this.feedText(this.decoder.decode());
  }

  private feedText(text: string): void {
    for (const c of text) this.feed(c);
  }

  private feed(c: string): void {
    const code = c.codePointAt(0)!;
    switch (this.state) {
      case State.Ground:
        return this.ground(c, code);
      case State.Escape:
        if (c === "[") {
          this.state = State.Csi;
          this.params = "";
          this.ignore = false;
          this.intermediate = false;
        } else if (c === "]" || c === "P" || c === "X" || c === "^" || c === "_") {
          this.state = State.Str;
        } else if (code === 0x1b) {
          // Stays in Escape.
        } else if (code >= 0x20 && code <= 0x2f) {
          this.state = State.EscapeIntermediate;
        } else if (code >= 0x30 && code <= 0x7e) {
          this.state = State.Ground;
        } else {
          this.state = State.Ground;
          this.ground(c, code);
        }
        return;
      case State.EscapeIntermediate:
        if (code >= 0x20 && code <= 0x2f) return;
        if (code >= 0x30 && code <= 0x7e) this.state = State.Ground;
        else if (code === 0x1b) this.state = State.Escape;
        else {
          this.state = State.Ground;
          this.ground(c, code);
        }
        return;
      case State.Csi:
        if (code >= 0x30 && code <= 0x3f) {
          if (this.intermediate || this.params.length >= MAX_PARAMS) this.ignore = true;
          else this.params += c;
        } else if (code >= 0x20 && code <= 0x2f) {
          this.intermediate = true;
        } else if (code >= 0x40 && code <= 0x7e) {
          this.state = State.Ground;
          if (c === "m" && !this.ignore && !this.intermediate) this.sgr();
        } else if (code === 0x1b) {
          this.state = State.Escape;
        } else {
          this.state = State.Ground;
          this.ground(c, code);
        }
        return;
      case State.Str:
        if (code === 0x07) this.state = State.Ground;
        else if (code === 0x1b) this.state = State.StrEscape;
        return;
      case State.StrEscape:
        if (c === "\\") this.state = State.Ground;
        else {
          this.state = State.Escape;
          this.feed(c);
        }
        return;
    }
  }

  private ground(c: string, code: number): void {
    if (this.cr) {
      this.cr = false;
      if (c === "\n") return this.endLine();
      this.line = [];
    }
    if (c === "\n") this.endLine();
    else if (c === "\r") this.cr = true;
    else if (code === 0x1b) this.state = State.Escape;
    else if (c === "\t") this.append(c);
    else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return;
    else this.append(c);
  }

  private append(c: string): void {
    const last = this.line[this.line.length - 1];
    if (last && last.fg === this.fg && last.attrs === this.attrs) last.text += c;
    else this.line.push({ text: c, fg: this.fg, attrs: this.attrs });
  }

  private endLine(): void {
    this.done.push(this.line);
    this.line = [];
    this.ended++;
  }

  private sgr(): void {
    if (/^[<=>?]/.test(this.params)) return;
    const parts = this.params.split(";");
    this.params = "";
    let i = 0;
    while (i < parts.length) {
      const part = parts[i++];
      const fields = part.split(":");
      const code = number(fields[0]);
      const colon = part.includes(":");
      switch (code) {
        case 0: this.fg = -1; this.attrs = 0; break;
        case 1: this.attrs |= BOLD; break;
        case 2: this.attrs |= DIM; break;
        case 3: this.attrs |= ITALIC; break;
        case 4:
          if (colon && number(fields[1] ?? "") === 0) this.attrs &= ~UNDERLINE;
          else this.attrs |= UNDERLINE;
          break;
        case 7: this.attrs |= INVERSE; break;
        case 9: this.attrs |= STRIKE; break;
        case 22: this.attrs &= ~(BOLD | DIM); break;
        case 23: this.attrs &= ~ITALIC; break;
        case 24: this.attrs &= ~UNDERLINE; break;
        case 27: this.attrs &= ~INVERSE; break;
        case 29: this.attrs &= ~STRIKE; break;
        case 39: this.fg = -1; break;
        case 38: case 48: case 58:
          if (!colon && i < parts.length) {
            const kind = number(parts[i]);
            if (kind === 5) i += 2;
            else if (kind === 2) i += 4;
          }
          if (code === 38) this.fg = -1;
          break;
        default:
          if (code !== null && code >= 30 && code <= 37) this.fg = code - 30;
          else if (code !== null && code >= 90 && code <= 97) this.fg = code - 90 + 8;
      }
    }
  }
}

/** Every line of a complete text, including a last line with no line ending. */
export function parseAnsi(text: string): AnsiLine[] {
  const parser = new AnsiParser();
  parser.push(text);
  const lines = parser.takeLines();
  const pending = parser.pending;
  if (pending.runs.length > 0) lines.push(pending);
  return lines;
}

/** The terminal classes for a run, such as `fc-term-ansi-red fc-terminal__bold`. */
export function ansiClassName(run: AnsiRun): string {
  const classes = run.fg ? [`fc-term-ansi-${run.fg}`] : [];
  for (const attribute of run.attributes) classes.push(`fc-terminal__${attribute}`);
  return classes.join(" ");
}

/** A `.fc-terminal__line` holding the line's runs as text. */
export function renderAnsiLine(line: AnsiLine, doc: Document = document): HTMLElement {
  const el = doc.createElement("div");
  el.className = "fc-terminal__line";
  el.dataset.fcSeq = String(line.seq);
  for (const run of line.runs) {
    const className = ansiClassName(run);
    if (!className) {
      el.append(run.text);
      continue;
    }
    const span = doc.createElement("span");
    span.className = className;
    span.textContent = run.text;
    el.append(span);
  }
  return el;
}

/** A line's runs in the crate's wire format; see `wire_runs` in fc-ansi. */
export function wireRuns(line: AnsiLine): number[] {
  const out: number[] = [];
  let end = 0;
  for (const run of line.runs) {
    end += run.text.length;
    let bits = 0;
    for (const attribute of run.attributes) bits |= 1 << ANSI_ATTRIBUTES.indexOf(attribute);
    out.push(end, run.fg ? ANSI_COLORS.indexOf(run.fg) : -1, bits);
  }
  return out;
}

function publicLine(runs: RawRun[], seq: number): AnsiLine {
  return {
    seq,
    runs: runs.map((run) => ({
      text: run.text,
      fg: run.fg < 0 ? null : ANSI_COLORS[run.fg],
      attributes: ANSI_ATTRIBUTES.filter((_, bit) => run.attrs & (1 << bit)),
    })),
  };
}

/** See `number` in the crate: empty is 0, non-digits are no number, and it saturates. */
function number(text: string): number | null {
  let value = 0;
  for (const c of text) {
    if (c < "0" || c > "9") return null;
    value = Math.min(value * 10 + (c.charCodeAt(0) - 48), 0xffffffff);
  }
  return value;
}

