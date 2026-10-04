/**
 * Syntax highlighter.
 *
 * A small, dependency-free tokenizer that turns source text into a flat list of
 * `{ role, text }` spans, plus a DOM renderer for the `fc-code` component.
 *
 * # Why this exists rather than a `<textarea>` with a highlight overlay
 *
 * The alternative -- a transparent `<textarea>` layered over a `<pre>` of colored
 * spans -- is the usual trick, and it is genuinely hard to keep correct: the two
 * layers must agree on font, metrics, wrapping, scrolling and scrollbar width, or
 * the caret drifts away from the glyphs. It also cannot express an editable
 * document, since highlighting is only correct for text you are not currently
 * editing.
 *
 * This module highlights a *value*, not a caret. It is right for every surface
 * where the reader is reading rather than typing: documentation, diffs, chat
 * messages containing code, and a read-only code editor.
 *
 * # The hard part: spans must not overlap
 *
 * Regex alternation is first-match-wins, not longest-match, so a naive tokenizer
 * will happily match `//` inside a string literal and emit a `comment` span that
 * overlaps a `string` span. Overlapping spans produce broken DOM and, worse,
 * markup that re-serializes to different text than it started from.
 *
 * Every tokenizer here is therefore a **single combined regex with named
 * groups**, scanned left to right, so a token can never begin inside another.
 * That is the whole design; the per-language rules are just the group table.
 *
 * # Escape hatch
 *
 * Unmatched text is emitted as `fg` text, never dropped. A highlighter that
 * silently discards input is a data-loss bug, and this library is read by
 * machines as well as by people.
 */

/** A syntax role. Every one maps to a `--fc-code-<role>` token. */
export type SyntaxRole =
  | "fg"
  | "comment"
  | "keyword"
  | "string"
  | "number"
  | "function"
  | "type"
  | "operator"
  | "punctuation"
  | "property"
  | "constant"
  | "tag"
  | "attribute"
  | "regexp"
  | "heading"
  | "link"
  | "invalid";

/** One run of text sharing a role. Spans are contiguous and non-overlapping. */
export interface SyntaxSpan {
  role: SyntaxRole;
  text: string;
}

/** A language's grammar: one combined regex plus the role for each group. */
interface Grammar {
  /** Named groups -> roles. */
  roles: Readonly<Record<string, SyntaxRole>>;
  pattern: RegExp;
}

/**
 * Build a grammar that cannot overlap.
 *
 * `parts` is a list of `[groupName, source]`. They are joined into one
 * alternation, so the regex engine picks the leftmost match and, at that
 * position, the first alternative that matches -- exactly the order given.
 * Ordering therefore encodes precedence: multi-character tokens (template
 * strings, JSX tags) must precede the prefixes that would otherwise match first.
 */
function grammar(
  roles: Record<string, SyntaxRole>,
  parts: readonly (readonly [string, string])[],
  flags = "gu",
): Grammar {
  const source = parts.map(([name, body]) => `(?<${name}>${body})`).join("|");
  return { roles, pattern: new RegExp(source, flags) };
}

const IDENT = "[A-Za-z_$][\\w$]*";
/* -------------------------------------------------------------------------- */
/* Languages                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Keywords, longest-first *within* the alternation.
 *
 * Order matters because the engine takes the first alternative that matches at
 * the leftmost position: listing `in` before `instanceof` would match `in` and
 * leave `stanceof` as an identifier. Sorting by length at construction removes
 * that class of bug for good rather than relying on the author remembering.
 */
const JS_KEYWORDS = [
  "instanceof", "implements", "interface", "extends", "satisfies", "readonly",
  "override", "protected", "namespace", "abstract", "declare", "continue",
  "function", "return", "default", "switch", "break", "delete", "typeof",
  "static", "public", "private", "yield", "async", "await", "const", "class",
  "enum", "from", "import", "export", "throw", "catch", "final", "while",
  "true", "null", "keyof", "void", "case", "else", "for", "let", "new", "try",
  "var", "do", "if", "in", "of", "is", "as", "fn", "type", "def", "end", "use",
].sort((a, b) => b.length - a.length).join("|");

const js = grammar(
  {
    comment: "comment",
    string: "string",
    template: "string",
    regexp: "regexp",
    number: "number",
    keyword: "keyword",
    literal: "constant",
    fn: "function",
    type: "type",
    property: "property",
    punctuation: "punctuation",
    operator: "operator",
  },
  [
    // Comments first: `//` and `/* */` must beat everything else, including a
    // `/` division operator on the same line.
    ["comment", "//[^\\n]*|/\\*[\\s\\S]*?\\*/"],
    // Strings before regexps, because a `/` inside a string is not a regexp
    // delimiter. Comments already ran, so this cannot swallow a real comment.
    ["string", "\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'"],
    // A template literal as one string token. Its `${}` interpolations are not
    // parsed separately: a backtick inside `${}` ends the template early. That
    // is a documented limitation, not an oversight.
    ["template", "`(?:[^`\\\\]|\\\\.)*`"],
    /*
     * A regexp only where a *value* can begin. The leading alternation is the
     * whole trick: without it `a / b / c` highlights the division as a regexp,
     * which is the classic false positive in every hand-rolled tokenizer.
     */
    ["regexp", "(?:(?<=[=(,:[!&|?{};])|(?<=\\breturn\\s)|(?<=\\bcase\\s)|(?<=\\btypeof\\s)|^)\\s*/(?:[^/\\\\\\n\\[]|\\\\.|\\[(?:[^\\]\\\\\\n]|\\\\.)*\\])+/[gimsuy]*"],
    ["number", "\\b(?:0[xXbBoO][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)n?\\b"],
    ["keyword", `\\b(?:${JS_KEYWORDS})\\b`],
    ["literal", "\\b(?:true|false|null|undefined|NaN|Infinity)\\b"],
    // A call is an identifier immediately before `(`. Matched before `type` and
    // `property` so `foo()` reads as a function rather than an identifier.
    ["fn", `\\b${IDENT}(?=\\s*[(<])`],
    // Capitalised identifiers are types by convention. A heuristic, and marked
    // as one: a lowercase type will not be highlighted.
    ["type", "\\b[A-Z][\\w$]*\\b"],
    ["property", "(?<=\\.)[A-Za-z_$][\\w$]*"],
    ["punctuation", "[{}()\\[\\];,.]"],
    ["operator", "[+\\-*/%=<>!&|^~?:]+"],
  ],
);
/** JSON. No comments, so a `//` inside a string stays part of the string. */
const json = grammar(
  {
    property: "property",
    string: "string",
    number: "number",
    literal: "constant",
    punctuation: "punctuation",
    operator: "operator",
  },
  [
    ["property", "\"(?:[^\"\\\\]|\\\\.)*\"(?=\\s*:)"],
    ["string", "\"(?:[^\"\\\\]|\\\\.)*\""],
    ["number", "-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"],
    ["literal", "\\b(?:true|false|null)\\b"],
    ["punctuation", "[{}\\[\\],:]"],
    ["operator", "[-+*/]"],
  ],
);

/** CSS. At-rules, properties, and selectors are distinct roles. */
const css = grammar(
  {
    comment: "comment",
    atrule: "keyword",
    string: "string",
    property: "property",
    fn: "function",
    number: "number",
    keyword: "constant",
    punctuation: "punctuation",
    operator: "operator",
    selector: "tag",
  },
  [
    ["comment", "/\\*[\\s\\S]*?\\*/"],
    ["string", "\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'"],
    // `@media`, `@layer`, `@supports` -- including any dotted namespace.
    ["atrule", "@[\\w-]+"],
    // A declaration: the word after `{` or `;` and before a colon. The
    // lookbehind is what stops `https://` inside a string reading as one.
    ["property", "(?<=[{;])\\s*[-\\w]+(?=\\s*:)"],
    ["fn", "\\b(?:calc|var|url|clamp|min|max|rgb|rgba|hsl|hsla|oklch|linear-gradient)\\b(?=\\s*\\()"],
    ["number", "\\b\\d*\\.?\\d+(?:px|rem|em|%|vh|vw|s|ms|fr|deg|ch|ex)?\\b"],
    ["keyword", "\\b(?:important|inherit|initial|unset|revert|auto|none|solid|dashed|dotted|block|flex|grid|inline|absolute|relative|fixed|sticky)\\b"],
    // A selector: an identifier that opens a block later on the same line.
    ["selector", "[.#]?[-\\w]+(?=[^{}]*\\{)"],
    ["punctuation", "[{}();,:]"],
    ["operator", "[>+~*=^$|]"],
  ],
);

/** Rust. Lifetimes and macros are the parts a naive tokenizer gets wrong. */
const rust = grammar(
  {
    comment: "comment",
    string: "string",
    lifetime: "type",
    char: "string",
    attribute: "attribute",
    number: "number",
    keyword: "keyword",
    literal: "constant",
    fn: "function",
    type: "type",
    punctuation: "punctuation",
    operator: "operator",
  },
  [
    ["comment", "//[^\\n]*|/\\*[\\s\\S]*?\\*/"],
    ["string", "r?#*\"(?:[^\"\\\\]|\\\\.)*\"#*|\"(?:[^\"\\\\\\n]|\\\\.)*\""],
    /*
     * Ordering is not enough on its own, and the reason is worth recording.
     *
     * With `char` listed first, `'ab'` still matched `'a` as a lifetime: the
     * engine tries alternatives left to right, and when `char` matched at an
     * index the alternation still backtracked into `lifetime` to find a match
     * the overall pattern preferred.
     *
     * The fix is to make the lifetime possessive. `[A-Za-z_]\w*` cannot give
     * characters back, and `(?![\w'\\])` rejects any match whose next character
     * could extend it or close a quote. So a lifetime can only match where one
     * really is, as in `fn f<'a>(...)`.
     *
     * `char` stays single-character on purpose, because that is what a Rust char
     * literal is. Widening it to `+` was tried and rejected: it then swallowed
     * `fn f<'a>(x: &'a str)` as one enormous "char", destroying every lifetime in
     * the signature. A multi-character `'ab'` is a lifetime-less byte string and
     * is not valid Rust, so leaving it as plain text is the correct outcome --
     * and importantly it is *not* mis-tokenised as something else.
     */
    ["char", "'(?:[^'\\\\\\n]|\\\\.)'"],
    ["lifetime", "'(?:static|_|[A-Za-z_]\\w*)(?![\\w'\\\\])"],
    ["attribute", "#!?\\[[^\\]]*\\]"],
    ["number", "\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[iuf](?:8|16|32|64|128|size))?)\\b"],
    ["keyword", "\\b(?:macro_rules|struct|static|trait|union|where|while|unsafe|super|return|const|enum|extern|impl|async|await|break|continue|crate|false|fn|for|let|loop|match|mod|move|mut|pub|ref|self|Self|type|true|use|in|if|as|dyn)\\b"],
    ["literal", "\\b(?:Some|None|Ok|Err)\\b"],
    ["fn", `\\b${IDENT}(?=\\s*[(!<])`],
    ["type", "\\b[A-Z]\\w*\\b"],
    ["punctuation", "[{}()\\[\\];,.:]"],
    ["operator", "[+\\-*/%=<>!&|^~?@]+"],
  ],
);

/** HTML / XML. Attribute names are separate from tag names on purpose. */
const html = grammar(
  {
    comment: "comment",
    doctype: "keyword",
    tagopen: "tag",
    tagname: "tag",
    attr: "attribute",
    string: "string",
    punctuation: "punctuation",
    operator: "operator",
  },
  [
    ["comment", "<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>"],
    ["doctype", "<!DOCTYPE[^>]*>"],
    ["tagopen", "</?"],
    /*
     * Distinguishing a tag name from an attribute name.
     *
     * The obvious fix -- adding `(?!\s*=)` to `tagname` -- is wrong, and the
     * failure is instructive. A negative lookahead lets the engine *backtrack*
     * into a shorter match: in `<a href="x">`, `tagname` failed on `href`,
     * then matched `hre`, and `attr` claimed the trailing `f`. The result was
     * two wrong tokens where there should be one.
     *
     * The correct guard is possessive. `[A-Za-z][\w:-]*(?![\w:.-]|\s*=)` says
     * "consume the whole run, and the character after it must not be another
     * name character or an `=`". Because `[\w:.-]*` is greedy and cannot give
     * characters back, there is nothing left for a shorter tagname match to
     * find, so `href` is either taken whole by `attr` or not at all.
     */
    ["tagname", "[A-Za-z][\\w:-]*(?![\\w:.-]|\\s*=)"],
    ["attr", "[A-Za-z_:@][\\w:.-]*(?=\\s*=)"],
    ["string", "\"[^\"]*\"|'[^']*'"],
    ["operator", "="],
    ["punctuation", "[>]"],
  ],
);

/**
 * Markdown.
 *
 * The heading, link and code roles exist so Markdown reads the way it looks in
 * the editor rather than as flat grey text.
 */
const markdown = grammar(
  {
    heading: "heading",
    fence: "string",
    code: "string",
    link: "link",
    strong: "keyword",
    emphasis: "type",
    comment: "comment",
    listmarker: "operator",
  },
  [
    /*
     * The `m` flag, not just `g` and `u`.
     *
     * These block forms are anchored with `^`, and without `m` that anchor means
     * "start of the whole document". A two-line document therefore highlighted
     * its first heading and left the rest as plain text -- the most common case
     * for a document, which is usually more than one line. `m` makes `^` mean
     * "start of a line", which is what the pattern always meant.
     */
    ["heading", "^#{1,6}[^\\n]*"],
    ["fence", "^(?:```|~~~)[^\\n]*"],
    // Inline code before emphasis: `` `code` `` contains `_` and `*` that must
    // not be read as emphasis markers.
    ["code", "`[^`\\n]+`"],
    ["link", "!?(?:\\[[^\\]\\n]*\\])\\([^)\\n]*\\)|<[^ >\\n@]+@[^ >\\n]+>"],
    ["strong", "\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__"],
    ["emphasis", "\\*[^*\\n]+\\*|_[^_\\n]+_"],
    ["comment", "^\\s{4,}[^\\n]*"],
    ["listmarker", "^\\s*(?:[-*+]|\\d+\\.)\\s"],
  ],
  // `m` so the `^`-anchored block forms match at every line start. Without it a
  // multi-line document highlights only its first block construct.
  "gmu",
);
/** Languages with a tokenizer, addressable by name. */
export const languages = {
  javascript: js,
  typescript: js,
  json,
  css,
  rust,
  html,
  markdown,
} as const;

export type LanguageName = keyof typeof languages;

export const languageNames = Object.keys(languages) as LanguageName[];

/** Language aliases accepted in markup and configuration. */
const ALIASES: Readonly<Record<string, LanguageName>> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  rs: "rust",
  md: "markdown",
  mdx: "markdown",
  htm: "html",
  xml: "html",
  svg: "html",
  vue: "html",
};

/**
 * Resolve an alias or exact name to a supported language.
 *
 * Returns undefined rather than throwing for an unknown language: an
 * unrecognised `data-fc-lang` should render as plain text, not throw away the
 * user's code over a typo in an attribute.
 */
export function resolveLanguage(name: string): LanguageName | undefined {
  const key = name.trim().toLowerCase();
  if (key in languages) return key as LanguageName;
  return ALIASES[key];
}

/**
 * Tokenize `source` into contiguous, non-overlapping spans.
 *
 * The returned spans always concatenate back to exactly `source`. That property
 * is what makes the highlighter safe on untrusted input, and it is asserted by a
 * test rather than left to inspection.
 */
export function highlight(source: string, language: string): SyntaxSpan[] {
  const name = resolveLanguage(language);
  // An unsupported language is plain text, never an error and never empty.
  if (!name) return [{ role: "fg", text: source }];

  const { roles, pattern } = languages[name];
  /*
   * A fresh regex per call, deliberately. Reusing the shared instance is a
   * classic bug here: a `g`-flagged regex carries `lastIndex` between calls, so
   * the second highlight starts mid-string and silently drops the first half.
   */
  const re = new RegExp(pattern.source, pattern.flags);

  const spans: SyntaxSpan[] = [];
  let cursor = 0;

  const push = (role: SyntaxRole, text: string): void => {
    if (!text) return;
    const last = spans[spans.length - 1];
    // Coalesce adjacent same-role runs: fewer nodes, and the serialized output
    // stays compact for large files.
    if (last && last.role === role) last.text += text;
    else spans.push({ role, text });
  };

  for (const match of source.matchAll(re)) {
    const index = match.index;
    // Whatever the pattern skipped is plain text. Never dropped.
    if (index > cursor) push("fg", source.slice(cursor, index));

    const groups = match.groups ?? {};
    let role: SyntaxRole | undefined;
    let length = 0;
    for (const [group, value] of Object.entries(groups)) {
      if (value === undefined) continue;
      role = roles[group];
      length = value.length;
      break;
    }
    push(role ?? "fg", match[0]);
    cursor = index + length;
  }

  if (cursor < source.length) push("fg", source.slice(cursor));
  return spans;
}

/** Flatten spans back to the original text. Used by tests and by copy handlers. */
export function spansToText(spans: readonly SyntaxSpan[]): string {
  return spans.map((s) => s.text).join("");
}

/**
 * Render highlighted source into an element.
 *
 * Returns a `<code>` fragment whose text content is byte-identical to the input.
 * This is what makes `fc-code` safe to copy, serialize, and hand to a machine
 * reader: the markup is an enhancement, the text is the contract.
 */
export function renderHighlighted(source: string, language: string): HTMLElement {
  const code = document.createElement("code");
  code.className = "fc-code__source";
  for (const span of highlight(source, language)) {
    // Plain text goes in as a bare text node: wrapping every gap in a span would
    // multiply the node count for no benefit.
    if (span.role === "fg") {
      code.appendChild(document.createTextNode(span.text));
      continue;
    }
    const el = document.createElement("span");
    el.className = `fc-code__tok fc-code__tok--${span.role}`;
    el.textContent = span.text;
    code.appendChild(el);
  }
  return code;
}