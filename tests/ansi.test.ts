/**
 * The JS ANSI parser on its own. tests/wasm.test.ts compares it with fc-ansi,
 * but only after a WASM build; these pin the behaviour the issue asked for so
 * a plain `npm test` still catches a regression, and so the two cannot agree
 * on a wrong answer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANSI_COLORS, ATTRIBUTES, AnsiParser, attributeNames, parseAnsi, runClassNames } from "../src/js/ansi.ts";

const one = (input: string) => {
  const lines = parseAnsi(input);
  assert.equal(lines.length, 1, JSON.stringify(input));
  return lines[0];
};

describe("ansi", () => {
  it("maps SGR 1, 2, 3, 4, 7 and 9 to attributes and 22-29 back off", () => {
    for (const [code, bit] of [[1, 1], [2, 2], [3, 4], [4, 8], [7, 16], [9, 32]]) {
      assert.deepEqual(one(`\x1b[${code}mx`), [{ text: "x", fg: null, attributes: bit }]);
    }
    for (const [code, left] of [[22, 60], [23, 59], [24, 55], [27, 47], [29, 31]]) {
      assert.deepEqual(one(`\x1b[1;2;3;4;7;9m\x1b[${code}mx`), [{ text: "x", fg: null, attributes: left }]);
    }
  });

  it("maps 30-37 and 90-97 to the sixteen slots, and 0 and 39 clear", () => {
    for (let n = 0; n < 8; n++) {
      assert.equal(one(`\x1b[${30 + n}mx`)[0]!.fg, ANSI_COLORS[n]);
      assert.equal(one(`\x1b[${90 + n}mx`)[0]!.fg, ANSI_COLORS[n + 8]);
    }
    assert.deepEqual(one("\x1b[1;31ma\x1b[39mb\x1b[0mc"), [
      { text: "a", fg: "red", attributes: 1 },
      { text: "b", fg: null, attributes: 1 },
      { text: "c", fg: null, attributes: 0 },
    ]);
  });

  it("falls back to the default foreground for 256-colour and truecolor, skipping their parameters", () => {
    assert.deepEqual(one("\x1b[31m\x1b[38;5;196;1mx"), [{ text: "x", fg: null, attributes: ATTRIBUTES.bold }]);
    assert.deepEqual(one("\x1b[31m\x1b[38;2;255;0;0;4mx"), [{ text: "x", fg: null, attributes: ATTRIBUTES.underline }]);
    assert.deepEqual(one("\x1b[32m\x1b[48;5;1mx"), [{ text: "x", fg: "green", attributes: 0 }]);
  });

  it("consumes cursor movement, other CSI and OSC rather than showing them", () => {
    assert.deepEqual(one("a\x1b[2J\x1b[1;1H\x1b[?25lb\x1b]0;title\x07c\x1b]8;;u\x1b\\d"), [{ text: "abcd", fg: null, attributes: 0 }]);
  });

  it("keeps state across chunks, so a sequence split between writes still parses", () => {
    const parser = new AnsiParser();
    for (const piece of ["a\x1b", "[3", "8;5", ";9;1", ";32mb\r", "\nc"]) parser.push(piece);
    assert.equal(parser.lines.length, 1);
    assert.deepEqual(parser.current, [{ text: "c", fg: "green", attributes: 1 }]);
    parser.finish();
    assert.deepEqual(parser.takeLines(), [
      [{ text: "a", fg: null, attributes: 0 }, { text: "b", fg: "green", attributes: 1 }],
      [{ text: "c", fg: "green", attributes: 1 }],
    ]);
  });

  it("reassembles a UTF-8 character split between byte chunks", () => {
    const parser = new AnsiParser();
    const bytes = new TextEncoder().encode("\x1b[1m😀");
    for (const b of bytes) parser.pushBytes(new Uint8Array([b]));
    assert.deepEqual(parser.current, [{ text: "😀", fg: null, attributes: 1 }]);
  });

  it("names the classes terminal.css styles", () => {
    assert.deepEqual(attributeNames(ATTRIBUTES.strike | ATTRIBUTES.bold), ["bold", "strike"]);
    assert.deepEqual(runClassNames({ text: "x", fg: "bright-cyan", attributes: ATTRIBUTES.dim | ATTRIBUTES.inverse }), [
      "fc-term-ansi-bright-cyan",
      "fc-terminal__dim",
      "fc-terminal__inverse",
    ]);
  });
});
