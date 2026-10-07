/**
 * Comment-and-whitespace stripper, used only to measure the performance budget.
 *
 * The shipped CSS stays unminified (see build.ts), so this never touches dist/.
 * It exists so the budget can be stated in minified bytes -- what a consumer's
 * own minifier will actually send -- without adding a minifier dependency. It
 * deliberately does less than a real minifier: no colour shortening, no rule
 * merging. On this codebase it lands within a few percent of esbuild, and the
 * error is always on the high side, so a page that passes here passes there.
 */

/** Strips comments and collapsible whitespace, leaving strings untouched. */
export function stripCss(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      // A comment between two tokens still separates them: `a/**/b` is two
      // identifiers, so it collapses to whitespace rather than to nothing.
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return collapse(out);
}

/** Whitespace is only removed next to punctuation where it never carries meaning.
 *  Around `:` it is kept, because `a :hover` and `a:hover` select different
 *  elements; inside `calc()` it is kept, because `+` and `-` need it. */
function collapse(css: string): string {
  const parts = css.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/\s+/g, " ")
            .replace(/\s*([{};,])\s*/g, "$1")
            .replace(/;}/g, "}"),
    )
    .join("")
    .trim();
}
