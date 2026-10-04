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

  it("serializes nested inline marks", () => {
    assert.equal(serializeInline("x", ["bold", "italic"]), "***x***");
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