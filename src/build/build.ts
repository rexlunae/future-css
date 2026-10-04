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
  ["components/chat.css", "components/chat.css"],
  ["components/tool-call.css", "components/tool-call.css"],
  ["utilities.css", "utilities.css"],
];

const BANNER = `/*!
 * future-css -- https://github.com/estith/future-css
 * A styling system for multi-language, multi-platform systems
 *
 * Regenerate with: npm run build
 * This file is generated; edit the sources in src/ instead.
 */`;

async function readSource(relative: string): Promise<string> {
  return readFile(resolve(srcCss, relative), "utf8");
}

async function buildBundle(): Promise<void> {
  const parts: string[] = [BANNER, ""];

  for (const [source] of BUNDLE_ORDER) {
    const css = await readSource(source);
    // index.css is the layer-order declaration; it is included for its side
    // effect of establishing order, not for its (empty) rule content.
    parts.push(css.trim(), "");
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "future-css.css"), `${parts.join("\n")}\n`, "utf8");
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

  const componentFiles = await readdir(resolve(srcCss, "components"));
  const bytes = (await readFile(resolve(outDir, "future-css.css"))).byteLength;
  console.log(
    `build: dist/future-css.css (${(bytes / 1024).toFixed(1)} KB, ${BUNDLE_ORDER.length} files, ` +
      `${componentFiles.length} component(s)) + tokens.css + tokens.json`,
  );
}

await main();