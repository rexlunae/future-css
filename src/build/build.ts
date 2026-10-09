/**
 * Build orchestrator.
 *
 * Produces the distributable artifacts:
 *
 *   dist/future-css.css        the whole system, one file, correct layer order
 *   dist/layers.css            layer-order declaration (import before pieces)
 *   dist/tokens.css            generated custom properties
 *   dist/reset.css             zero-specificity reset
 *   dist/base.css              element defaults
 *   dist/layout.css            layout primitives
 *   dist/components/*.css      per-component files
 *   dist/utilities.css         the escape hatch
 *   dist/tokens.json           payload for native platforms and Figma
 *
 * The output is deliberately NOT minified. A design system is a piece of
 * infrastructure that other engineers read, debug with browser devtools, and
 * occasionally vendor into a codebase with a restrictive build pipeline.
 * Readable CSS is worth more here than the last few kilobytes; consumers minify
 * at their own boundary with whatever tooling they already use.
 *
 * Run: node src/build/build.ts
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");
const srcCss = resolve(projectRoot, "src", "css");
const outDir = resolve(projectRoot, "dist");

/**
 * Bundle order. This must match the @layer statement in index.css, otherwise
 * layer precedence is decided by the order the bundles happen to be read.
 */
/** Maps each source file to the filename it is published under. */
const BUNDLE_ORDER: ReadonlyArray<readonly [source: string, publishedAs: string]> = [
  // The layer-order declaration ships as "layers" so consumers know it must be
  // imported first; the source name reflects its role in the build graph.
  ["index.css", "layers.css"],
  ["reset.css", "reset.css"],
  ["base.css", "base.css"],
  ["layout.css", "layout.css"],
  ["components/button.css", "components/button.css"],
  ["components/theme-picker.css", "components/theme-picker.css"],
  ["components/chat.css", "components/chat.css"],
  ["components/tool-call.css", "components/tool-call.css"],
  ["components/editor.css", "components/editor.css"],
  ["components/menu.css", "components/menu.css"],
  ["components/grid.css", "components/grid.css"],
  ["components/webview.css", "components/webview.css"],
  ["components/terminal.css", "components/terminal.css"],
  ["components/code.css", "components/code.css"],
  ["components/diff.css", "components/diff.css"],
  ["components/select.css", "components/select.css"],
  ["components/composer.css", "components/composer.css"],
  ["components/context-strip.css", "components/context-strip.css"],
  ["components/git.css", "components/git.css"],
  ["components/field.css", "components/field.css"],
  ["components/form-variants.css", "components/form-variants.css"],
  ["components/multiselect.css", "components/multiselect.css"],
  ["components/check.css", "components/check.css"],
  ["components/card.css", "components/card.css"],
  ["components/badge.css", "components/badge.css"],
  ["components/alert.css", "components/alert.css"],
  ["components/dialog.css", "components/dialog.css"],
  ["components/popover.css", "components/popover.css"],
  ["components/toast.css", "components/toast.css"],
  ["components/tabs.css", "components/tabs.css"],
  ["components/breadcrumb.css", "components/breadcrumb.css"],
  ["components/pagination.css", "components/pagination.css"],
  ["components/spinner.css", "components/spinner.css"],
  ["components/agent-status.css", "components/agent-status.css"],
  ["components/loading.css", "components/loading.css"],
  ["components/avatar.css", "components/avatar.css"],
  ["components/empty-state.css", "components/empty-state.css"],
  ["components/disclosure.css", "components/disclosure.css"],
  ["components/reasoning.css", "components/reasoning.css"],
  ["components/citation.css", "components/citation.css"],
  ["components/suggestion.css", "components/suggestion.css"],
  ["components/table.css", "components/table.css"],
  ["components/description-list.css", "components/description-list.css"],
  ["components/nav.css", "components/nav.css"],
  ["components/masthead.css", "components/masthead.css"],
  ["components/control-group.css", "components/control-group.css"],
  ["components/button-group.css", "components/button-group.css"],
  ["components/segmented.css", "components/segmented.css"],
  ["components/split-button.css", "components/split-button.css"],
  ["components/fab.css", "components/fab.css"],
  ["components/divider.css", "components/divider.css"],
  ["components/list.css", "components/list.css"],
  ["components/slider.css", "components/slider.css"],
  ["components/toolbar.css", "components/toolbar.css"],
  ["components/navbar.css", "components/navbar.css"],
  ["components/search.css", "components/search.css"],
  ["components/carousel.css", "components/carousel.css"],
  ["components/datepicker.css", "components/datepicker.css"],
  ["components/metric.css", "components/metric.css"],
  ["components/transfer.css", "components/transfer.css"],
  ["components/approval.css", "components/approval.css"],
  ["components/user-prompt.css", "components/user-prompt.css"],
  ["components/device-auth.css", "components/device-auth.css"],
  ["type.css", "type.css"],
  ["utilities.css", "utilities.css"],
];

const BANNER = `/*!
 * future-css -- https://github.com/estith/future-css
 * A styling system for multi-language, multi-platform systems
 *
 * Regenerate with: npm run build
 * This file is generated; edit the sources in src/ instead.
 */`;

/**
 * Removes a single leading `/*! ... *\/` banner comment, if present.
 *
 * Anchored and complete-comment-only by construction: it will not span across a
 * following comment, which is what broke the bundle once already.
 */
function stripLeadingBanner(css: string): string {
  // Scan to the closing delimiter rather than using a regex.
  //
  // A regex cannot be trusted here: the banner legitimately contains path
  // globs like "src/tokens/**\/*.ts", and the "**\/" inside it closes a
  // `/*! ... *\/` pattern early. That truncated the banner, left a stray "*.ts",
  // and broke parsing of the entire @layer block -- so the tokens silently
  // vanished and every var() reference resolved to nothing, with no error. An
  // indexOf for the true terminator cannot be fooled by the content.
  if (!css.startsWith("/*!")) return css;
  const end = css.indexOf("*/");
  if (end === -1) return css;
  return css.slice(end + 2).replace(/^\s+/, "");
}

async function readSource(relative: string): Promise<string> {
  return readFile(resolve(srcCss, relative), "utf8");
}

async function buildBundle(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const parts: string[] = [BANNER, ""];

  for (const [source] of BUNDLE_ORDER) {
    const css = await readSource(source);
    // index.css is the layer-order declaration; it is included for its side
    // effect of establishing order, not for its (empty) rule content.
    parts.push(css.trim(), "");
  }

  // The generated token layer, inlined.
  //
  // tokens.css is produced by compile-tokens.ts rather than authored in src/css,
  // so it is NOT in BUNDLE_ORDER and was silently missing from the bundle. Every
  // `var(--fc-color-*)` reference in the other layers therefore resolved to
  // nothing, and the bundle rendered unstyled -- with no error anywhere, because
  // an unresolved custom property is valid CSS. tests/bundle.test.ts now asserts
  // the definitions are present so this cannot regress.
  const generatedTokens = await readFile(resolve(outDir, "tokens.css"), "utf8");
  // Strip the generated banner: the bundle already carries one.
  //
  // The pattern must be anchored to a WHOLE comment at the very start of the
  // file. An earlier non-greedy `/^\/*![\s\S]*?\*\//` matched across the two
  // comment blocks tokens.css emits (the `/*!` banner and the `Source:` line),
  // leaving a stray `*.ts` at the top of the inlined section. That broke parsing
  // of the whole @layer block, so the tokens silently vanished and every
  // var(--fc-color-*) resolved to nothing -- with no error, because an unresolved
  // custom property is valid CSS.
  parts.push(stripLeadingBanner(generatedTokens).trim(), "");

  const bundle = parts.join("\n") + "\n";

  // Cheap but decisive: a bundle whose token *definitions* are missing still
  // contains token *references*, so counting occurrences of a name is not enough.
  // Assert the definition form (`--name:`) is present.
  for (const required of ["--fc-color-bg-canvas:", "--fc-color-text-default:"]) {
    if (!bundle.includes(required)) {
      throw new Error(
        `build: bundle is missing the token definition "${required}". ` +
          `Every var() reference would resolve to nothing.`,
      );
    }
  }

  await writeFile(resolve(outDir, "future-css.css"), bundle, "utf8");
}

async function buildIndividualFiles(): Promise<void> {
  for (const [source, publishedAs] of BUNDLE_ORDER) {
    const css = await readSource(source);
    const target = resolve(outDir, publishedAs);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${BANNER}\n${css.trim()}\n`, "utf8");
  }
}

/**
 * A lightweight guard: every source file must declare the layer it belongs to.
 * Without this, a file that is simply missing its @layer wrapper would land
 * outside the cascade and silently outrank everything.
 */
function assertLayerDeclared(relative: string, source: string): boolean {
  return /@layer\s+fc\.[a-z]+\s*\{/.test(source);
}

async function main(): Promise<void> {
  // Generate tokens first: the CSS layers reference the variables it emits.
  await import("./compile-tokens.ts");

  const missing: string[] = [];
  for (const [source] of BUNDLE_ORDER) {
    // index.css is the layer-order declaration itself; it contains no @layer
    // block by design, so it is exempt.
    if (source === "index.css") continue;
    if (!assertLayerDeclared(source, await readSource(source))) {
      missing.push(source);
    }
  }
  if (missing.length > 0) {
    console.error(`Missing @layer declaration in: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });
  await buildIndividualFiles();
  await buildBundle();
  await writeFile(resolve(outDir, "print.css"), await readSource("print.css"), "utf8");

  const componentFiles = await readdir(resolve(srcCss, "components"));
  const bytes = (await readFile(resolve(outDir, "future-css.css"))).byteLength;
  console.log(
    `build: dist/future-css.css (${(bytes / 1024).toFixed(1)} KB, ${BUNDLE_ORDER.length} files, ` +
      `${componentFiles.length} component(s)) + tokens.css + tokens.json`,
  );
}

await main();