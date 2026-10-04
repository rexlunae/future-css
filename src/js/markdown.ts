/**
 * Markdown serialization and parsing.
 *
 * Markdown is the library's rich text *format*: what the editor stores, what the
 * chat surface renders, and what a machine reads out of the DOM. This module is
 * the single place that format is defined, so the editor, the renderer, and the
 * diff viewer cannot disagree about it.
 *
 * # Why Markdown rather than HTML
 *
 * HTML is not a format, it is a rendering of one. Storing rich text as HTML means
 * the storage layer inherits every decision the browser made -- including the
 * ones you would have made differently -- and it means a machine reader has to
 * parse markup to recover meaning. Markdown inverts that: the stored value is
 * the document, and HTML is derived.
 *
 * Three consequences worth stating, because they are the actual arguments:
 *
 *   1. **Round-trippable.** `parse -> serialize -> parse` is stable, and the
 *      tests assert it. Losing a user's formatting on save is the failure mode
 *      that makes people stop trusting an editor.
 *   2. **Portable.** A document written here is readable in any Markdown viewer,
 *      in a terminal, in a diff, and in a text editor. No lock-in.
 *   3. **Safe by default.** There is no HTML passthrough, so there is no
 *      script-injection surface. `escapeMarkdown` escapes what it must.
 *
 * # Scope, deliberately
 *
 * CommonMark plus the inline constructs the editor can produce. Not implemented:
 * tables, footnotes, definition lists, raw HTML blocks, and setext headings.
 * That is a decision, not an oversight -- every unimplemented construct is a
 * round-trip that would silently drop a user's content. A subset that round-trips
 * is worth more than a superset that loses data.
 *
 * # Offsets are UTF-16 code units
 *
 * Every offset in this file, like every other module in this library, is a
 * UTF-16 code unit so it matches JavaScript and the editor's selection. See
 * AGENTS.md; the WASM boundary depends on this invariant.
 */

/** Block-level constructs the parser understands. */
export type BlockKind =
  | "paragraph"
  | "heading"
  | "code"
  | "quote"
  | "list"
  | "thematic-break";

/** Inline marks, mirroring the `Mark` enum in fc-rich-text. */
export type InlineMark = "bold" | "italic" | "code" | "link" | "strike";

/** A parsed block. `text` is the Markdown source of the block's content. */
export interface MarkdownBlock {
  kind: BlockKind;
  /** Heading level 1-6; undefined otherwise. */
  level?: number;
  /** Fenced-code language, when the fence declared one. */
  lang?: string;
  /** Block content, with inline markup still unparsed. */
  text: string;
}

/** Escape every character that would otherwise be read as markup. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!>|~])/g, "\\$1");
}

/**
 * Serialize inline marks to Markdown.
 *
 * `code` is applied first and therefore serialized innermost: its content must
 * not be escaped again, because a backslash inside a code span is literal.
 */
export function serializeInline(text: string, marks: readonly InlineMark[] = []): string {
  let out = text;
  if (marks.includes("code")) out = `\`${out}\``;
  if (marks.includes("bold")) out = `**${out}**`;
  if (marks.includes("italic")) out = `*${out}*`;
  if (marks.includes("strike")) out = `~~${out}~~`;
  return out;
}

/**
 * Parse Markdown into blocks.
 *
 * Fenced code is extracted whole, including its fence, so a `#` or `*` inside a
 * code block is never mistaken for a heading or emphasis. That is the single
 * most common bug in naive Markdown parsers and the reason this is line-based.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  // Accumulates the current paragraph, flushed when a block boundary appears.
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text) blocks.push({ kind: "paragraph", text });
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code: consume to the closing fence, whatever is inside.
    const fence = line.match(/^\s*(```|~~~)\s*(\S+)?\s*$/);
    if (fence) {
      flushParagraph();
      const marker = fence[1];
      const lang = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        body.push(lines[i]);
        i++;
      }
      // i now points at the closing fence, or one past the last line.
      i++;
      blocks.push(
        lang
          ? { kind: "code", lang, text: body.join("\n") }
          : { kind: "code", text: body.join("\n") },
      );
      continue;
    }

    // Thematic break: three or more of -, _, or * alone on a line.
    if (/^\s*(?:[-*_])(?:\s*[-*_]){2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: "thematic-break", text: "" });
      i++;
      continue;
    }

    // ATX heading: up to six leading #s, then a space.
    const heading = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    // Block quote: consume consecutive `>` lines into one block.
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    /*
     * List item: consume consecutive items, including any indented
     * continuation lines, into one block. Continuation is de-indented by two
     * spaces so a sub-list survives as text rather than being dropped.
     */
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!item) break;
        body.push(item[2]);
        i++;
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i])
        ) {
          body.push(lines[i].replace(/^\s{2}/, ""));
          i++;
        }
      }
      blocks.push({ kind: "list", text: body.join("\n") });
      continue;
    }

    // A blank line ends the paragraph.
    if (!line.trim()) {
      flushParagraph();
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }

  flushParagraph();
  return blocks;
}

/**
 * Serialize blocks back to Markdown.
 *
 * `parse -> serialize -> parse` is stable for everything the parser accepts: the
 * tests assert this, because a serializer that drifts from its parser is exactly
 * how formatting gets silently lost on save.
 */
export function serializeMarkdown(blocks: readonly MarkdownBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        out.push(`${"#".repeat(block.level ?? 1)} ${block.text}`);
        break;
      case "code":
        // Fenced, not indented: the content is never re-interpreted, and a fence
        // stays unambiguous when the block is nested inside a quote.
        out.push(`\`\`\`${block.lang ?? ""}\n${block.text}\n\`\`\``);
        break;
      case "quote":
        out.push(block.text.split("\n").map((l) => `> ${l}`).join("\n"));
        break;
      case "list":
        out.push(block.text.split("\n").map((l) => `- ${l}`).join("\n"));
        break;
      case "thematic-break":
        out.push("---");
        break;
      case "paragraph":
      default:
        out.push(block.text);
        break;
    }
  }
  // A blank line between blocks, so they re-parse as distinct blocks.
  return out.join("\n\n");
}

/**
 * Parse inline markup into flat spans over the *stripped* text.
 *
 * The offsets this returns index the plain text with all markup removed, which
 * is what the rich-text model wants and what "tokenize then compute offsets over
 * the original" gets subtly wrong. Spans are non-overlapping by construction:
 * the earliest match across all rules always wins, so a `**` inside a code span
 * is never treated as bold.
 */
export function parseInline(source: string): {
  text: string;
  spans: { mark: InlineMark; start: number; end: number }[];
} {
  const spans: { mark: InlineMark; start: number; end: number }[] = [];
  let text = "";

  const RULES: readonly [InlineMark, RegExp][] = [
    ["code", /`([^`]+)`/],
    ["bold", /\*\*([^*]+)\*\*/],
    ["strike", /~~([^~]+)~~/],
    ["link", /\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/],
    ["italic", /\*([^*]+)\*|_([^_]+)_/],
  ];

  let rest = source;
  while (rest.length > 0) {
    // Earliest match wins; ties go to the earlier rule in the table.
    let best: { mark: InlineMark; index: number; length: number; inner: string } | null = null;
    for (const [mark, re] of RULES) {
      const m = re.exec(rest);
      if (!m) continue;
      if (best && m.index >= best.index) continue;
      best = { mark, index: m.index, length: m[0].length, inner: m[1] ?? "" };
    }

    if (!best) {
      text += rest;
      break;
    }

    text += rest.slice(0, best.index);
    const start = text.length;
    text += best.inner;
    spans.push({ mark: best.mark, start, end: text.length });
    rest = rest.slice(best.index + best.length);
  }

  return { text, spans };
}