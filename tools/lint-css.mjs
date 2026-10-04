/**
 * CSS architecture linter.
 *
 * Documentation about rules that are not enforced is a wish list. This tool
 * turns the system's core constraints into build failures, which is the only
 * thing that keeps a design system consistent as it grows and as new
 * contributors arrive.
 *
 * Run: node tools/lint-css.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const cssRoot = resolve(projectRoot, "src", "css");

/**
 * Every physical-direction longhand that has a logical equivalent. This is the
 * single highest-value rule in the linter: it is what mechanically guarantees
 * the stylesheet works in right-to-left languages without a parallel RTL build.
 */
const PHYSICAL_PROPERTIES = [
  "margin-left", "margin-right", "margin-top", "margin-bottom",
  "padding-left", "padding-right", "padding-top", "padding-bottom",
  "border-left", "border-right", "border-top", "border-bottom",
  "border-left-width", "border-right-width",
  "border-top-width", "border-bottom-width",
  "border-left-color", "border-right-color",
  "border-top-color", "border-bottom-color",
  "border-top-left-radius", "border-top-right-radius",
  "border-bottom-left-radius", "border-bottom-right-radius",
  "left", "right", "top", "bottom",
  "float", "clear", "text-indent",
];

/**
 * Colour literals. Deliberately conservative regex-based detection: it will not
 * catch every colour syntax, but every match is a true positive worth fixing.
 */
/**
 * Documented exceptions. Each one is a case where the "no !important" and
 * "no px" rules have a well-known, correct exception. Keeping them enumerated
 * (rather than blanket-disabled per layer) means a new misuse is still caught.
 */
const IMPORTANT_EXEMPT = [
  // The reduced-motion blanket reset is the accessibility pattern itself:
  // author and library motion must not override a user's motion preference.
  /animation-duration|animation-iteration-count|transition-duration|scroll-behavior/,
  // Hiding content is the one case where !important is the correct tool: the
  // element must be hidden regardless of what the author or the browser does.
  // `[hidden]`, the .fc-u-hidden utility and dialog[open] all rely on this.
  /^\s*display\s*:\s*none\s*!important\s*;?$/,
];

const PX_EXEMPT = [
  // The autofill override uses an oversized inset shadow to paint a solid
  // background, because the UA injects its own and offers no other hook.
  /box-shadow:.*inset/,
];

const COLOR_LITERAL = new RegExp(
  [
    "#[0-9a-f]{3,8}\\b",            // hex
    "\\brgba?\\(",             // rgb()/rgba()
    "\\bhsla?\\(",             // hsl()/hsla()
    "\\boklch\\(",             // oklch()
    "\\boklab\\(",             // oklab()
    "\\blab\\(",               // lab()
    "\\bhwb\\(",                // hwb()
    // Bare CSS named colours. Only the ones that plausibly appear by mistake in
    // hand-written CSS; the full 148-entry list would catch more but is not
    // worth the false-positive risk (e.g. inside a font-family or a URL).
    "\\b(red|blue|green|black|white|grey|gray|orange|purple|pink|yellow|teal|navy|maroon|olive|silver|lime|aqua|fuchsia)\\b",
  ].join("|"),
  "i",
);

const findings = [];

function report(file, line, rule, message) {
  findings.push({ file, line, rule, message });
}

async function collectCssFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectCssFiles(full)));
    else if (extname(entry.name) === ".css") files.push(full);
  }
  return files;
}

/**
 * Line-by-line scanner. Comments are tracked with a small state machine so that
 * prose inside a comment block -- which discusses physical properties and colour
 * literals by name -- is never mistaken for a violation.
 */
function analyse(source, file) {
  // Whole-file facts, evaluated once and referenced by the rules below.
  const lines = source.split("\n");
  let inBlockComment = false;
  let currentLayer = null;
  // The selector of the block currently being entered. Persists across lines so
  // a multi-line rule's declarations can be judged against its own selector.
  let blockSelector = "";

// --- structural rules that need whole-file context ---

  // An animation is an accessibility commitment (reduced motion), so a file
  // that declares keyframes must show that it considered prefers-reduced-motion.
  // This caught a real gap: two animated components had no reduced-motion
  // branch of their own.
  if (/@keyframes\s/.test(source)) {
    if (!/prefers-reduced-motion/.test(source)) {
      report(file, 1, "reduced-motion",
        "this file declares @keyframes but never references prefers-reduced-motion. Confirm the motion is either covered by the reset layer or intentionally exempted, and say so in a comment.");
    }
    // Forced colors: the OS discards background-color and box-shadow, so any
    // component leaning on them for meaning needs an explicit system-color
    // fallback or it becomes an unreadable grey box.
    if (!/forced-colors/.test(source)) {
      report(file, 1, "forced-colors",
        "this file declares @keyframes but has no @media (forced-colors: active) block. If any meaning is carried by a background colour, restate it with a system color.");
    }
  }


  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;

    // --- comment state machine ---
    if (inBlockComment) {
      if (raw.includes("*/")) inBlockComment = false;
      continue;
    }
    const openAt = raw.indexOf("/*");
    if (openAt !== -1 && !raw.includes("*/", openAt + 2)) {
      inBlockComment = true;
      continue;
    }

    // Strip an inline trailing comment before inspecting the declaration.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!code) continue;

    const layerMatch = code.match(/@layer\s+([\w.]+)\s*\{/);
    if (layerMatch) {
      currentLayer = layerMatch[1];
      continue;
    }
    if (code === "}") currentLayer = null;

        const inKeyframes = code.startsWith("@keyframes") || /^\d+%|\bto\b|\bfrom\b/.test(code);

    // Update the selector of the block being entered.
    const selMatch = code.match(/^([^{}@]+)\{/);
    if (selMatch) blockSelector = selMatch[1].trim();
    else if (code === "}") blockSelector = "";

    // --- declaration-level rules ---
    // A rule may be written across lines (decl on its own line) or inline
    // (`.x { color: red }`). Normalise to the declaration text either way so
    // both forms are checked identically.
    const inlineBody = code.match(/\{([^}]*)\}/);
    // A selector with no braces is not a declaration at all. Falling back to the
    // raw line here is what made class names look like property values.
    const declText = inlineBody
      ? inlineBody[1].trim()
      : code.includes(":") && !code.trim().startsWith(".")
        ? code.trim()
        : "";
    const decl = declText.match(/^([-a-z]+)\s*:\s*([^;]*)/i);
    if (decl && !code.includes("@")) {
      const prop = decl[1].toLowerCase();
      const value = (decl[2] ?? "").trim();

      // 1. logical properties only
      if (PHYSICAL_PROPERTIES.includes(prop) && !inKeyframes) {
        report(file, lineNo, "logical-properties",
          `"${prop}" is physical. Use its logical equivalent so the rule works in any writing direction.`);
      }

      // 2. no colour literals
      //
      // Only the declaration VALUE is inspected, never the selector. The ANSI
      // classes are named by hue (`.fc-term-ansi-red`), and a rule that scanned
      // the whole line flagged all sixteen of them -- a false positive that would
      // eventually have pushed someone into disabling the rule.
      if (
        /(color|background|border|outline|fill|stroke|shadow|decoration|caret)/i.test(prop) &&
        // Strip var() references first. A token *name* may legitimately contain a
        // colour word -- `--fc-term-ansi-red` is the ANSI red slot -- and matching
        // inside the reference flagged all sixteen of them while missing nothing
        // real. What matters is a literal in the value itself.
        COLOR_LITERAL.test(value.replace(/var\([^)]*\)/g, ""))
      ) {
        report(file, lineNo, "no-color-literals",
          `literal colour in "${prop}". Reference a design token instead; literals break theming and contrast checking.`);
      }

      // 3. no px
      const px = value.match(/\b\d*\.?\d+px\b/g);
      if (px && !/^--/.test(prop) && !PX_EXEMPT.some((p) => p.test(code))) {
        report(file, lineNo, "no-px",
          `px unit (${px.join(", ")}) in "${prop}". Use rem so the value scales with the user's font size.`);
      }

      // 4. !important, narrowly permitted
      if (/!important/i.test(value)) {
        if (!IMPORTANT_EXEMPT.some((p) => p.test(declText.trim()))) {
          report(file, lineNo, "no-important",
            "!important defeats the layer strategy. Use a higher layer, or a token override, instead.");
        }
      }

      // 5. focus visibility
      // Scope-aware: removing the outline is correct when the selector
      // explicitly excludes keyboard focus, and wrong everywhere else.
      if (/^outline\s*:\s*(none|0)\s*;?$/i.test(declText)) {
        const scopedToNonKeyboardFocus =
          /:not\(:focus-visible\)/.test(code) || blockSelector.includes(":not(:focus-visible)");
        if (!scopedToNonKeyboardFocus) {
          report(file, lineNo, "preserve-focus",
            "removing the outline hides keyboard focus. Scope it to :not(:focus-visible) or delete it.");
        }
      }

      // 6. transition: all
      if (/^transition(-property)?$/i.test(prop) && /(^|[\s,])all([\s,]|$)/i.test(value)) {
        report(file, lineNo, "no-transition-all",
          "transition: all animates layout properties and causes jank. Name the properties explicitly.");
      }

      // 7. z-index scale
      if (/^z-index$/i.test(prop) && /\d/.test(value) && !/^--/.test(prop)) {
        report(file, lineNo, "z-index-scale",
          "raw z-index. Use a --fc-z-* token so stacking stays a closed, reviewable scale.");
      }

      // 8. text-align must use logical values
      if (/^text-align$/i.test(prop) && /:\s*(left|right)\b/i.test(declText)) {
        report(file, lineNo, "logical-values",
          'text-align: left/right does not follow writing direction. Use start, end, or center.');
      }

      // 9. no absolute font sizes
      if (/^font-size$/i.test(prop) && /px|pt\b/.test(value)) {
        report(file, lineNo, "no-absolute-font-size",
          "absolute font sizes ignore the user's preference. Use rem or a font-size token.");
      }
    }

    // --- selector-level rules ---
    if (/^\s*#/i.test(code) || /[.#&][\w-]+\s*[,>+~]\s*#/.test(code)) {
      report(file, lineNo, "no-id-selectors",
        "id selectors cannot be reused and outrank the whole system. Use a class or attribute.");
    }

    const compound = code.match(/^([^{]+)\{/);
    if (compound && !code.startsWith("@")) {
      const selector = compound[1];
      if (/\.[\w-]+\s*\.[\w-]+/.test(selector) && !/\[/.test(selector)) {
        report(file, lineNo, "no-over-qualified",
          "two classes in one compound raise specificity for no benefit. Use the modifier alone.");
      }
      if (/[+~]\s*\S+\s*[+~]/.test(selector)) {
        report(file, lineNo, "no-adjacent-sibling-chains",
          "long sibling chains are direction-fragile. Use flexbox/grid gap instead.");
      }
    }
  }
}

async function main() {
  const files = await collectCssFiles(cssRoot);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    // Generated output is not linted; its TypeScript inputs are tested instead.
    if (source.includes("GENERATED FILE, DO NOT EDIT")) continue;
    analyse(source, relative(projectRoot, file));
  }

  if (findings.length === 0) {
    console.log(`lint: ${files.length} CSS file(s) checked, 0 violations.`);
    return;
  }

  // Group by file:line so one line with several issues reports as one entry.
  const grouped = new Map();
  for (const f of findings) {
    const key = `${f.file}:${f.line}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(f);
  }

  console.error(`\nlint: ${findings.length} violation(s) in ${grouped.size} location(s):\n`);
  for (const [, list] of grouped) {
    console.error(`  ${list[0].file}:${list[0].line}`);
    for (const f of list) console.error(`    [${f.rule}] ${f.message}`);
  }
  console.error("");
  process.exitCode = 1;
}

await main();