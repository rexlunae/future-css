/**
 * ANSI parser tests.
 *
 * Parity with the fc-ansi crate lives in tests/wasm.test.ts. These pin the
 * behaviour itself, and that every class the parser can name is one the
 * terminal stylesheet actually styles: a run classed `fc-term-ansi-orange`
 * would render in the default colour with nothing to say why.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ANSI_ATTRIBUTES, ANSI_COLORS, AnsiParser, ansiClassName, parseAnsi } from "../src/js/ansi.ts";
import { ansiColorNames } from "../src/tokens/semantic/terminal.ts";

const css = readFileSync(new URL("../src/css/components/terminal.css", import.meta.url), "utf8");

describe("ANSI parser", () => {
  it("maps SGR colours and attributes onto runs", () => {
    assert.deepEqual(parseAnsi("\x1b[31mred\x1b[1;92mbold\x1b[0m plain"), [{
      seq: 0,
      runs: [
        { text: "red", fg: "red", attributes: [] },
        { text: "bold", fg: "bright-green", attributes: ["bold"] },
        { text: " plain", fg: null, attributes: [] },
      ],
    }]);
  });

  it("clears only the attribute an off code names", () => {
    const [line] = parseAnsi("\x1b[1;2;4mA\x1b[22mB\x1b[24mC");
    assert.deepEqual(line.runs.map((r) => r.attributes), [["bold", "dim", "underline"], ["underline"], []]);
  });

  it("falls back to the default colour for 256-colour and truecolor, skipping their arguments", () => {
    const [line] = parseAnsi("\x1b[31;38;5;1mA\x1b[38;2;255;0;0;1mB");
    assert.deepEqual(line.runs, [
      { text: "A", fg: null, attributes: [] },
      { text: "B", fg: null, attributes: ["bold"] },
    ]);
  });

  it("consumes cursor movement and OSC instead of showing them", () => {
    assert.equal(parseAnsi("a\x1b[2K\x1b[1Gb\x1b]0;title\x07c\x1b]8;;https://x\x1b\\d")[0].runs[0].text, "abcd");
  });

  it("parses a sequence split between writes", () => {
    const parser = new AnsiParser();
    parser.push("ok \x1b[3");
    parser.push("2mpass\x1b[0m\r");
    parser.push("\n");
    assert.deepEqual(parser.takeLines(), [{
      seq: 0,
      runs: [{ text: "ok ", fg: null, attributes: [] }, { text: "pass", fg: "green", attributes: [] }],
    }]);
  });

  it("decodes UTF-8 split between byte chunks", () => {
    const parser = new AnsiParser();
    const bytes = new TextEncoder().encode("日本");
    parser.pushBytes(bytes.subarray(0, 2));
    parser.pushBytes(bytes.subarray(2));
    assert.equal(parser.pending.runs[0].text, "日本");
  });

  it("numbers lines across takes, keeps the number through a carriage return, and restarts on reset", () => {
    // `seq` is what renderAnsiLine writes as data-fc-seq: the line's place in
    // the stream, not its index in one takeLines batch.
    const parser = new AnsiParser();
    parser.push("a\nb\n");
    assert.deepEqual(parser.takeLines().map((l) => l.seq), [0, 1]);
    parser.push("10%\r50%");
    assert.equal(parser.pending.seq, 2);
    parser.push("\nc\n");
    assert.deepEqual(parser.takeLines().map((l) => l.seq), [2, 3]);
    parser.reset();
    parser.push("d\n");
    assert.deepEqual(parser.takeLines().map((l) => l.seq), [0]);
  });

  it("starts a line over at a bare carriage return", () => {
    assert.equal(parseAnsi("10%\r50%\n")[0].runs[0].text, "50%");
  });

  it("names only colours and attributes the terminal styles", () => {
    const palette = ansiColorNames.filter((n) => n.startsWith("ansi-")).map((n) => n.slice("ansi-".length));
    assert.deepEqual([...ANSI_COLORS], palette);
    for (const color of ANSI_COLORS) assert.match(css, new RegExp(`\\.fc-term-ansi-${color}\\b`), color);
    for (const attribute of ANSI_ATTRIBUTES) assert.match(css, new RegExp(`\\.fc-terminal__${attribute}\\b`), attribute);
    assert.equal(ansiClassName({ text: "x", fg: "bright-red", attributes: ["bold", "strike"] }), "fc-term-ansi-bright-red fc-terminal__bold fc-terminal__strike");
  });
});
