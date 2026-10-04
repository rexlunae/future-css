/**
 * WASM build orchestrator.
 *
 * Compiles each Rust crate to its own module and emits a size report. The size
 * report is not decoration: `js-sys` alone costs ~302 KB (see docs/WASM.md), so
 * a regression that pulls it in is invisible in the source and obvious in the
 * numbers. Making size a build output means it gets noticed.
 *
 * Each crate builds to a separate file. That is the whole point of the crate
 * split: a consumer loading only the grid should not download the editor.
 *
 * Run: node src/build/build-wasm.ts
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");
const outDir = resolve(projectRoot, "dist", "wasm");

/**
 * Per-crate byte budgets, in bytes, for the raw (pre-bindgen) module.
 *
 * Set from the measured baseline of 27,707 bytes for an empty wasm-bindgen
 * module plus headroom. They are deliberately tight: the current sizes are
 * roughly 10x these because of `js-sys`, and Phase A in PLAN.md brings them
 * down. Until then these are aspirational, which is why the script reports the
 * number rather than failing on it.
 */
const BUDGET: Record<string, number> = {
  fc_core: 40_000,
  fc_model: 45_000,
  fc_rich_text: 50_000,
  fc_context_menu: 45_000,
  fc_grid: 45_000,
  // fc_diff is the module the budgets were set for: it links no js-sys, so it
  // should be the first to come in under. Measuring it is how the rest of the
  // workspace gets a number to aim at.
  fc_diff: 35_000,
};

/** Cargo crate name -> the module name JS imports. */
const CRATES: ReadonlyArray<readonly [crate: string, module: string]> = [
  ["fc-core", "fc-model"],
  ["fc-model", "fc-model"],
  ["fc-rich-text", "fc-rich-text"],
  ["fc-context-menu", "fc-context-menu"],
  ["fc-grid", "fc-grid"],
  // Its own module, unlike fc-core/fc-model which share one. It links no js-sys,
  // so it does not inherit their 302 KB, and it needs no shared runtime state.
  ["fc-diff", "fc-diff"],
];

interface SizeReport {
  crate: string;
  module: string;
  bytes: number;
  budget: number;
  withinBudget: boolean;
}

async function main(): Promise<void> {
  const cargo = process.env.CARGO ?? "cargo";
  const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";

  try {
    await execFileAsync(cargo, ["build", "--release", "--target", "wasm32-unknown-unknown"], {
      cwd: projectRoot,
    });
  } catch (error) {
    console.error(
      "build:wasm failed. If the Rust toolchain is missing, install it from " +
        "https://rustup.rs and add the target:\n" +
        "  rustup target add wasm32-unknown-unknown\n\n" +
        "The CSS build does not need any of this -- see docs/WASM.md.\n",
    );
    console.error(String(error));
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });
  const reports: SizeReport[] = [];

  for (const [crate, module] of CRATES) {
    const stem = crate.replace(/-/g, "_");
    const source = resolve(
      projectRoot,
      "target/wasm32-unknown-unknown/release",
      `${stem}.wasm`,
    );

    let bytes: number;
    try {
      bytes = (await stat(source)).size;
    } catch {
      console.error(`build:wasm: missing ${stem}.wasm; did cargo skip this crate?`);
      process.exitCode = 1;
      return;
    }

    // wasm-bindgen produces the JS glue plus the optimized module. Both targets
    // are emitted: `web` for browsers, `nodejs` for SSR and tests.
    // Separate directories per target: wasm-bindgen writes filenames derived
    // from the crate, so emitting both targets into one directory silently
    // overwrites the first.
    for (const target of ["web", "nodejs"] as const) {
      const targetOut = resolve(outDir, module, target);
      await mkdir(targetOut, { recursive: true });
      await execFileAsync(
        bindgen,
        ["--target", target, "--out-dir", targetOut, "--no-typescript", source],
        { cwd: projectRoot },
      );
    }

    const budget = BUDGET[stem] ?? 50_000;
    reports.push({ crate, module, bytes, budget, withinBudget: bytes <= budget });
  }

  await writeFile(
    resolve(outDir, "size-report.json"),
    `${JSON.stringify(reports, null, 2)}\n`,
    "utf8",
  );

  // The report is the deliverable, so it prints whether or not it is good news.
  console.log("build:wasm — release module sizes\n");
  let total = 0;
  for (const r of reports) {
    total += r.bytes;
    const kb = (r.bytes / 1024).toFixed(1);
    const status = r.withinBudget ? "ok  " : "OVER";
    console.log(`  [${status}] ${r.crate.padEnd(18)} ${kb.padStart(7)} KB   (budget ${(r.budget / 1024).toFixed(0)} KB)`);
  }
  console.log(`\n  sum: ${(total / 1024).toFixed(1)} KB across ${reports.length} modules`);
  const over = reports.filter((r) => !r.withinBudget);
  if (over.length > 0) {
    console.log(
      `\n  ${over.length} module(s) over budget. The dominant cause is js-sys,` +
        `\n  which costs ~302 KB the moment it is linked. See docs/WASM.md and` +
        `\n  Phase A in docs/PLAN.md.`,
    );
  }
}

await main();