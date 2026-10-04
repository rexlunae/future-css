/**
 * Syntax highlighting, Markdown, and diff tests.
 *
 * These three modules are pure functions over strings, so they are tested
 * without a DOM. That is deliberate: the invariants that matter here --
 * that spans never overlap, that a diff reconstructs its input, that Markdown
 * round-trips -- are properties of the algorithm, and a DOM test would only
 * obscure them behind rendering.
 *
 * The tests below were written after two real bugs. Both are the kind that pass
 * a smoke test and fail a user: a division operator highlighted as a regular
 * expression, and a diff whose backtracking dropped every unchanged line. Both
 * are now asserted directly, so neither can come back quietly.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  highlight,
  languageNames,
  resolveLanguage,
  spansToText,
} from "../src/js/highlight.ts";
import {
  escapeMarkdown,
  parseInline,
  parseLinkTarget,
  parseMarkdown,
  serializeInline,
  serializeMarkdown,
} from "../src/js/markdown.ts";
import { diffLines, diffStats, splitLines } from "../src/js/diff.ts";
import {
  checkSyntaxContrast,
  syntaxColorNames,
  syntaxContrastPairs,
} from "../src/tokens/semantic/syntax.ts";

/** A representative sample per language, including its awkward cases. */
const SAMPLES: Record<string, string> = {
  javascript: [
    '// a comment containing "quotes" and \'apostrophes\'',
    'const x = "he said \\"hi\\"";',
    "const y = 'it\\'s';",
    "const re = /ab+c/g;",
    "const d = a / b / c;",
    "function foo(a, b) { return a instanceof Object ? 1 : 2; }",
    "class Foo extends Bar {}",
    "const n = 0xFF + 1.5e10 + 42n;",
    "const t = `a${b}c`;",
    "export default foo;",
  ].join("\n"),
  typescript: [
    "interface A<T> { readonly x?: T; }",
    "type B = A<string> | null;",
    "enum E { A = 1, B }",
    "const f = (x: unknown): x is string => typeof x === 'string';",
  ].join("\n"),
  json: ['{"a": 1, "b": [true, false, null], "c": {"d": "e\\"f"}}', "// not a comment in json"].join("\n"),
  css: [
    "@media (min-width: 40rem) {",
    "  .foo-bar:hover > a[href] { color: var(--x); }",
    "  /* note https://example.com is not a declaration */",
    "}",
  ].join("\n"),
  rust: ["/// doc", "pub struct Foo<'a> { x: &'a str }", 'fn main() { println!("{}", 0xFFi32); }'].join("\n"),
  html: ['<!DOCTYPE html><a href="x" data-y=\'z\'><!-- c --><br/></a>'].join("\n"),
  markdown: ["# Title", "", "**bold** and *em* and `code` and [l](http://x)", "", "- item", "", "```js", "let a = 1;", "```"].join("\n"),
};

describe("syntax highlighting", () => {
  it("has a tokenizer for every declared language", () => {
    assert.ok(languageNames.length > 0);
    for (const lang of languageNames) {
      assert.ok(SAMPLES[lang], `no sample for declared language ${lang}`);
    }
  });

  for (const [lang, source] of Object.entries(SAMPLES)) {
    it(`reconstructs ${lang} exactly`, () => {
      // THE invariant: spans always concatenate back to the input. A highlighter
      // that drops or reorders text is a data-loss bug, and no visual check
      // would catch it.
      assert.equal(spansToText(highlight(source, lang)), source);
    });

    it(`emits contiguous non-empty spans for ${lang}`, () => {
      let total = 0;
      for (const span of highlight(source, lang)) {
        assert.ok(span.text.length > 0, "empty span");
        total += span.text.length;
      }
      assert.equal(total, source.length);
    });
  }

  it("does not read division as a regular expression", () => {
    // The classic false positive in a hand-rolled tokenizer: without a
    // "where can a value begin" guard, the first `/` opens a regexp.
    const spans = highlight("const d = a / b / c;", "js");
    assert.equal(spans.filter((s) => s.role === "regexp").length, 0);
  });

  it("does not read a comment inside a string as a comment", () => {
    const spans = highlight('const s = "http://example.com";', "js");
    assert.equal(spans.filter((s) => s.role === "comment").length, 0);
  });

  it("prefers the longest keyword at a position", () => {
    // `in` listed before `instanceof` would match `in` and leave `stanceof`.
    const spans = highlight("a instanceof B", "js");
    assert.ok(spans.some((s) => s.role === "keyword" && s.text === "instanceof"));
  });

  it("treats a rust lifetime as a lifetime, not a char literal", () => {
    const spans = highlight("fn f<'a>(x: &'a str) {}", "rust");
    assert.ok(spans.some((s) => s.role === "type" && s.text.includes("'a")));
  });

  it("does not treat a url in JSON as a comment", () => {
    const spans = highlight('{"a": "// not a comment"}', "json");
    assert.equal(spans.filter((s) => s.role === "comment").length, 0);
  });

  it("does not carry regex state between calls", () => {
    // A shared `g`-flagged regex keeps `lastIndex`, so the second call would
    // start mid-string and silently drop the first half.
    assert.equal(spansToText(highlight("let a = 1;", "js")), "let a = 1;");
    assert.equal(spansToText(highlight("let b = 2;", "js")), "let b = 2;");
  });

  it("treats an unknown language as plain text rather than an error", () => {
    assert.equal(spansToText(highlight("x = 1", "brainfuck")), "x = 1");
  });

  it("handles empty input", () => {
    assert.equal(spansToText(highlight("", "js")), "");
  });

  it("resolves aliases", () => {
    assert.equal(resolveLanguage("ts"), "typescript");
    assert.equal(resolveLanguage("RS"), "rust");
    assert.equal(resolveLanguage("  js  "), "javascript");
    assert.equal(resolveLanguage("nope"), undefined);
  });

  /*
   * Markdown's block forms are anchored with `^`. Without the `m` flag that
   * anchor means "start of the document", so only the *first* heading, fence, or
   * list marker in a multi-line document was highlighted. Since documents are
   * nearly always longer than one line, this was the common case, not the edge.
   */
  it("highlights block constructs on every line of a Markdown document", () => {
    const headings = highlight("# one\n## two\n\n### three", "markdown").filter(
      (s) => s.role === "heading",
    );
    assert.equal(headings.length, 3, "each heading needs its own token");

    const markers = highlight("- a\n- b\n* c", "markdown").filter(
      (s) => s.role === "operator",
    );
    assert.equal(markers.length, 3, "each list marker needs its own token");

    const fences = highlight("text\n```ts\nx\n```", "markdown").filter(
      (s) => s.role === "string",
    );
    assert.equal(fences.length, 2, "an opening and a closing fence");
  });

  /*
   * In Rust `'a` is a lifetime far more often than it is a character literal,
   * so the lifetime pattern runs first. Without a negative lookahead it also
   * ate the opening quote of `'a'`, leaving the closing quote as stray text.
   */
  it("tells a Rust lifetime apart from a character literal", () => {
    const ch = highlight("let c = 'a';", "rust");
    assert.equal(
      ch.find((s) => s.text === "'a'")?.role,
      "string",
      "a char literal must not be tokenised as a lifetime",
    );
    assert.equal(ch.some((s) => s.text === "'"), false, "no stray quote left over");

    // The disambiguation must not over-correct: this is the common lifetime case.
    const life = highlight("fn f<'a>(x: &'a str) -> &'a str {}", "rust");
    assert.equal(
      life.filter((s) => s.role === "type").length,
      3,
      "all three lifetimes still tokenise as lifetimes",
    );
    assert.equal(spansToText(life), "fn f<'a>(x: &'a str) -> &'a str {}");
  });

  /*
   * Regression, found by review: `'ab'` matched `'a` as a lifetime and left
   * `b'` as stray text. Two earlier fixes were wrong in instructive ways -- a
   * broad lookahead broke lifetimes in generic position, and reordering was not
   * enough because the engine still backtracked into a shorter lifetime match.
   * The possessive `(?![\w'\\])` is what actually fixes it.
   *
   * `'ab'` is not valid Rust, so plain text is the correct outcome. What matters
   * is that it is *not* mis-tokenised as something else, which is the failure
   * this guards against.
   */
  it("does not split a quoted Rust literal into a lifetime", () => {
    const ab = highlight("let c = 'ab';", "rust");
    assert.equal(
      ab.find((s) => s.role === "type"),
      undefined,
      "no lifetime may be invented inside a quoted literal",
    );
    // `'ab'` is left as one piece of plain text, not cut into `'a` + `b'`. The
    // check is that no *individual* quote is stranded in its own span, which is
    // what the bug produced.
    assert.equal(
      ab.filter((s) => s.role === "fg" && s.text.trim() === "'").length,
      0,
      "no lone quote may be left stranded",
    );
    assert.equal(spansToText(ab), "let c = 'ab';");
    assert.equal(
      highlight("let c = '\\'';", "rust").find((s) => s.role === "string")?.text,
      "'\\''",
    );
  });

  /*
   * `tagname` precedes `attr` in the alternation and has no `=` guard, so it used
   * to swallow `href` and colour an ordinary attribute as a tag. The fix has to
   * resist backtracking: a plain `(?!\s*=)` lets the engine retry with a shorter
   * name and split `href` into `hre` + `f`.
   */
  it("separates HTML tag names from attribute names", () => {
    const tags = highlight('<a href="x">', "html");
    assert.equal(tags.find((s) => s.text === "href")?.role, "attribute");
    assert.equal(
      tags.some((s) => s.text === "hre" || s.text === "f"),
      false,
      "the attribute must not be split by backtracking",
    );
    assert.equal(
      highlight('<div data-fc-id="m-1" class="y">', "html")
        .filter((s) => s.role === "attribute")
        .map((s) => s.text)
        .join(","),
      "data-fc-id,class",
    );
    // A bare tag with no attributes must still be a tag.
    assert.equal(highlight("<input>", "html").find((s) => s.role === "tag")?.text, "<input");
    assert.equal(spansToText(tags), '<a href="x">');
  });
});

describe("markdown", () => {
  const DOC = [
    "# Title",
    "",
    "Some *emphasis* and **strong** text.",
    "",
    "```ts",
    "const a = 1; // not a heading # nor bold **",
    "```",
    "",
    "> A quote",
    "> across lines",
    "",
    "- one",
    "- two",
    "  continued",
    "",
    "---",
    "",
    "Last paragraph.",
  ].join("\n");

  it("parses every block kind it claims to support", () => {
    const kinds = parseMarkdown(DOC).map((b) => b.kind);
    for (const kind of ["heading", "paragraph", "code", "quote", "list", "thematic-break"]) {
      assert.ok(kinds.includes(kind as never), `missing ${kind}`);
    }
  });

  it("round-trips: parse -> serialize -> parse is stable", () => {
    // A serializer that drifts from its parser silently loses formatting on save,
    // which is how users stop trusting an editor. This is the whole reason
    // Markdown was chosen as the format.
    const first = parseMarkdown(DOC);
    assert.deepEqual(parseMarkdown(serializeMarkdown(first)), first);
  });

  it("preserves all text across a round-trip", () => {
    const flatten = (md: string) =>
      parseMarkdown(md).map((b) => b.text).join(" ").replace(/\s+/g, " ").trim();
    assert.equal(flatten(serializeMarkdown(parseMarkdown(DOC))), flatten(DOC));
  });

  it("shields fenced contents from block parsing", () => {
    // A `#` or `**` inside a code block must stay literal. This is the most
    // common bug in naive Markdown parsers.
    const code = parseMarkdown(DOC).find((b) => b.kind === "code");
    assert.ok(code);
    assert.equal(code.lang, "ts");
    assert.ok(code.text.includes("// not a heading # nor bold **"));
  });

  it("indexes inline offsets into the stripped text", () => {
    // Offsets must address the plain text with markup removed, which is what the
    // rich-text model stores. Computing them over the original is the subtle bug.
    const { text, spans } = parseInline("a **b** `c`");
    assert.equal(text, "a b c");
    const bold = spans.find((s) => s.mark === "bold");
    assert.equal(text.slice(bold!.start, bold!.end), "b");
  });

  it("does not apply emphasis inside a code span", () => {
    assert.equal(parseInline("`a **b**`").spans.filter((s) => s.mark === "bold").length, 0);
  });

  it("escapes markup-significant characters", () => {
    assert.equal(escapeMarkdown("a*b_c[d]"), "a\\*b\\_c\\[d\\]");
  });

  /*
   * `escapeMarkdown` writes backslashes that `parseInline` used to ignore, so an
   * escape intended to protect a literal asterisk had the opposite effect: the
   * backslashes were dropped and the word was marked italic. The escape is the
   * one thing that must not be offered to the rule table.
   */
  it("treats an escaped character as literal, not as markup", () => {
    const escaped = parseInline(escapeMarkdown("*word*"));
    assert.equal(escaped.spans.length, 0, "escaped asterisks must not mark anything");
    assert.equal(escaped.text, "*word*", "the escaped text survives, unescaped");

    // The flip side: real marks must still be found.
    assert.equal(parseInline("**bold**").spans[0]?.mark, "bold");
    assert.equal(parseInline("*it*").spans[0]?.mark, "italic");
    assert.equal(parseInline("~~s~~").spans[0]?.mark, "strike");
    // An escaped code span must not become bold, and vice versa.
    assert.equal(parseInline("\\*not italic\\*").spans.length, 0);
    assert.equal(parseInline("`a **b**`").spans[0]?.mark, "code");
    /*
     * `\\` is an escape *for a backslash*, so it collapses to one. The
     * assertion that it must be preserved verbatim is wrong: CommonMark treats
     * `\\` as an escaped backslash, and keeping both would mean a literal
     * backslash can never be written.
     */
    assert.equal(parseInline("a\\\\b").text, "a\\b", "an escaped backslash collapses");
    // A backslash before an ordinary character is not an escape and stays put.
    assert.equal(parseInline("a\\qb").text, "a\\qb", "\\q is not escapable");
  });

  it("round-trips a document containing every supported block", () => {
    // The property the whole module exists for: an editor that reformats on save
    // is how users stop trusting it. The serializer emits a canonical form, so
    // the fixture is already in that form -- no trailing newline.
    const doc = "# H\n\n- a\n- b\n\n> q\n\n```ts\nx\n```";
    assert.equal(serializeMarkdown(parseMarkdown(doc)), doc);
  });

  it("serializes nested inline marks", () => {
    assert.equal(serializeInline("x", ["bold", "italic"]), "***x***");
  });

  /*
   * A closing fence is a bare marker line. Matching on `startsWith` instead
   * meant a code line like "```example" -- a nested fence inside a shell
   * snippet -- closed the block early, so its content was re-read as prose and
   * the real closing fence opened a second block. The code was silently
   * reclassified as prose.
   */
  it("closes a fence only on a bare marker line", () => {
    const blocks = parseMarkdown("```ts\n```example\nx\n```\n");
    assert.equal(blocks.length, 1, "one fenced block, not three");
    assert.equal(blocks[0]?.kind, "code");
    assert.equal(blocks[0]?.text, "```example\nx", "the nested marker is code");

    assert.equal(
      parseMarkdown("```sh\necho ```\n```\n")[0]?.text,
      "echo ```",
      "a backtick run inside code must not close the fence",
    );
  });

  /*
   * Documented boundary, asserted so it cannot regress silently: `parseInline`
   * records that a range is a link but not where it points. `parseLinkTarget`
   * is the escape hatch, and this test records that the limitation is known
   * rather than discovered by a user losing a URL.
   */
  it("exposes link destinations separately, since spans drop them", () => {
    assert.equal(parseLinkTarget("[docs](https://x.dev)"), "https://x.dev");
    assert.equal(parseLinkTarget("no link here"), null);

    // A title must not be folded into the URL: that yields a broken link rather
    // than an obviously-wrong one, so it would be pasted without complaint.
    assert.equal(parseLinkTarget('[docs](https://x.dev "API")'), "https://x.dev");
    assert.equal(parseLinkTarget("[docs](<https://x.dev>)"), "https://x.dev");
    assert.equal(parseLinkTarget("[docs](/rel/path)"), "/rel/path");

    const { spans, text } = parseInline("see [docs](https://x.dev) now");
    assert.deepEqual(spans, [{ mark: "link", start: 4, end: 8 }]);
    // The label survives; the destination is the documented lossy part.
    assert.equal(text, "see docs now");
  });
});

describe("diff", () => {
  /**
   * The invariant that makes a diff trustworthy: dropping the added lines must
   * reproduce the original, and dropping the removed lines must reproduce the
   * revision. This catches every possible backtracking off-by-one at once.
   */
  const cases: [string, string, string][] = [
    ["single change", "a\nb\nc", "a\nx\nc"],
    ["from empty", "", "new"],
    ["to empty", "gone", ""],
    ["both empty", "", ""],
    ["identical", "same", "same"],
    ["middle edit", "a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nX\nY\ne\nf\ng\nh"],
    ["reversed", "1\n2\n3\n4\n5", "5\n4\n3\n2\n1"],
    ["blank lines removed", "a\n\n\nb", "a\nb"],
    ["duplicated", "x", "x\nx\nx"],
    ["full replace", "l1\nl2", "totally\ndifferent\ncontent\nhere"],
  ];

  for (const [name, before, after] of cases) {
    it(`reconstructs both sides: ${name}`, () => {
      const lines = diffLines(before, after);
      const before2 = lines.filter((l) => l.kind !== "add").map((l) => l.text).join("\n");
      const after2 = lines.filter((l) => l.kind !== "remove").map((l) => l.text).join("\n");
      assert.equal(before2, splitLines(before).join("\n"));
      assert.equal(after2, splitLines(after).join("\n"));
    });
  }

  it("does not invent a line for a trailing newline", () => {
    // A trailing newline is a terminator, not an empty final line. Rendering it
    // as a row is the off-by-one that makes a diff report one line too many.
    assert.equal(splitLines("a\n").length, 1);
  });

  it("treats empty input as having no lines", () => {
    // `"".split("\n")` is `[""]`, so an empty file used to diff as a removal --
    // making "created a new file" render as "emptied an existing one".
    assert.deepEqual(splitLines(""), []);
    const fromEmpty = diffStats(diffLines("", "new"));
    assert.equal(fromEmpty.added, 1);
    assert.equal(fromEmpty.removed, 0, "an empty original must not report a removal");
  });

  it("normalizes CRLF without leaving a stray carriage return", () => {
    const lines = diffLines("a\r\nb", "a\r\nc");
    assert.ok(!lines.some((l) => l.text.includes("\r")));
    assert.equal(lines.map((l) => l.text).join(","), "a,b,c");
  });

  it("reports accurate counts", () => {
    const stats = diffStats(diffLines("a\nb\nc", "a\nc\nd\ne"));
    assert.equal(stats.added, 2);
    assert.equal(stats.removed, 1);
    assert.equal(stats.identical, false);
    assert.equal(diffStats(diffLines("a", "a")).identical, true);
  });

  it("uses 1-based line numbers", () => {
    // What a human reads, and what `git blame` prints. Internally the algorithm
    // is 0-based; the conversion is part of the contract.
    for (const line of diffLines("a\nb\nc", "a\nB\nc")) {
      if (line.kind !== "add") assert.ok((line.oldLine ?? 0) >= 1);
      if (line.kind !== "remove") assert.ok((line.newLine ?? 0) >= 1);
    }
  });

  it("leaves a number blank on the side a line does not exist", () => {
    // Never invent a line number for a line that was never there.
    const added = diffLines("a", "a\nb").find((l) => l.kind === "add");
    assert.equal(added?.oldLine, null);
    assert.equal(added?.newLine, 2);
  });

  it("handles a large file with a small edit efficiently", () => {
    // The reason for Myers over a DP table: O(ND), not O(N*M) in time *and*
    // memory. A 20k-line file with one changed line must stay fast.
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join("\n");
    const stats = diffStats(diffLines(big, big.replace("line 10000", "line 10000 CHANGED")));
    assert.equal(stats.added, 1);
    assert.equal(stats.removed, 1);
  });
});

describe("syntax palette contract", () => {
  it("meets every minimum in both color schemes", () => {
    // Every syntax color carries meaning, so an illegible one is a bug you
    // cannot see rather than an ugly color. Same treatment as the ANSI palette.
    const failures = checkSyntaxContrast();
    const report = failures
      .map((f) => `[${f.scheme}] ${f.pair.usage}: ${f.ratio.toFixed(2)}:1, needs ${f.pair.min}:1`)
      .join("\n");
    assert.equal(failures.length, 0, `Contrast failures:\n${report}`);
  });

  it("declares a pair for every text role", () => {
    for (const role of ["comment", "keyword", "string", "number", "function", "type", "invalid"]) {
      assert.ok(
        syntaxContrastPairs.some((p) => p.fg === role),
        `role ${role} is unchecked`,
      );
    }
  });

  it("defines every token the contract names", () => {
    assert.ok(syntaxColorNames.length > 0);
    for (const pair of syntaxContrastPairs) {
      assert.ok(
        syntaxColorNames.includes(pair.fg as never) || pair.fg === "canvas-ref",
        `contract references unknown token ${pair.fg}`,
      );
    }
  });
});