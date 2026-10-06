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
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
  fc_select: 35_000,
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
  // Second primitives-only module. Together with fc-diff this gives Phase A a
  // worked example rather than a theory.
  ["fc-select", "fc-select"],
  // Third primitives-only module. Status folding and ordering for the git surface.
  ["fc-git", "fc-git"],
];

interface SizeReport {
  crate: string;
  module: string;
  /** Pre-bindgen rustc output — the basis the budgets are set on. */
  bytes: number;
  budget: number;
  withinBudget: boolean;
  /**
   * What a consumer actually downloads: the post-bindgen web-target module,
   * after the optional wasm-opt pass. Measured separately because it is the
   * number that reaches the network, while `bytes` is the number the budgets
   * were set against. The two differ by ~25% (bindgen strips its custom
   * sections; wasm-opt shrinks further), so conflating them made the report
   * overstate shipping cost.
   */
  shippedBytes: number;
}

async function main(): Promise<void> {
  const cargo = process.env.CARGO ?? "cargo";
  const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";

  // Optional binaryen pass. Skipped when the tool is absent, so a contributor
  // without binaryen still gets a complete build -- the report just shows the
  // unoptimized shipped size. `--enable-bulk-memory` is required because rustc
  // emits memory.copy/memory.fill without setting the feature bit, which
  // wasm-opt otherwise rejects at validation ("unexpected false" on every
  // memory.copy, which reads like corruption).
  let wasmOpt: string | null = null;
  try {
    await execFileAsync("wasm-opt", ["--version"]);
    wasmOpt = "wasm-opt";
  } catch {
    // Absent is a normal configuration, not an error.
  }
  // Set when an installed wasm-opt rejects a module at validation. Older binaryen releases
  // (Ubuntu's apt ships 108) predate features rustc now emits by default, such
  // as sign-ext, and fail validation the same way the bulk-memory case does.
  // An optional pass must not be able to fail the build, so the module ships
  // unoptimized and the report says why.
  let wasmOptFailure: string | null = null;

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
      if (wasmOpt) {
        // Write to a sibling and rename: wasm-opt reading and writing the same
        // path is undefined behavior on some filesystems, and a half-written
        // module would fail at instantiate time, far from the cause.
        const bg = resolve(targetOut, `${stem}_bg.wasm`);
        try {
          await execFileAsync(wasmOpt, ["-Oz", "--enable-bulk-memory", bg, "-o", `${bg}.opt`]);
          await rename(`${bg}.opt`, bg);
        } catch (err) {
          await rm(`${bg}.opt`, { force: true });
          const stderr = String((err as { stderr?: string }).stderr ?? "");
          // Only a validation rejection means "this binaryen is too old for the
          // module"; anything else (a crash, a full disk, a missing file) is a
          // real fault and must stop the build rather than hide in a footnote.
          if (!/validat/i.test(stderr)) throw err;
          const detail = stderr.split("\n").find((l) => l.trim()) ?? "";
          wasmOptFailure ??= `${stem}: ${detail.trim()}`;
        }
      }
    }

    let shippedBytes = 0;
    try {
      shippedBytes = (await stat(resolve(outDir, module, "web", `${stem}_bg.wasm`))).size;
    } catch {
      shippedBytes = 0;
    }

    const budget = BUDGET[stem] ?? 50_000;
    reports.push({ crate, module, bytes, budget, withinBudget: bytes <= budget, shippedBytes });
  }

  await writeFile(
    resolve(outDir, "size-report.json"),
    `${JSON.stringify(reports, null, 2)}\n`,
    "utf8",
  );

  // The report is the deliverable, so it prints whether or not it is good news.
  console.log("build:wasm — release module sizes\n");
  let total = 0;
  let shippedTotal = 0;
  for (const r of reports) {
    total += r.bytes;
    shippedTotal += r.shippedBytes;
    const kb = (r.bytes / 1024).toFixed(1);
    const shipped = (r.shippedBytes / 1024).toFixed(1);
    const status = r.withinBudget ? "ok  " : "OVER";
    console.log(
      `  [${status}] ${r.crate.padEnd(18)} ${kb.padStart(7)} KB   (budget ${(r.budget / 1024).toFixed(0)} KB, ships ${shipped} KB)`,
    );
  }
  console.log(`\n  sum: ${(total / 1024).toFixed(1)} KB across ${reports.length} modules`);
  console.log(`  ships: ${(shippedTotal / 1024).toFixed(1)} KB (post-bindgen, post-opt, web target)`);
  if (!wasmOpt) {
    console.log("\n  wasm-opt not found; shipped sizes are unoptimized. Install binaryen");
    console.log("  for ~10% smaller modules -- measured, not a guess. The build is");
    console.log("  complete without it.");
  } else if (wasmOptFailure) {
    console.log("\n  wasm-opt is installed but rejected a module, so shipped sizes are");
    console.log("  unoptimized. This usually means binaryen is older than the features");
    console.log("  rustc emits; a current release fixes it. First failure:");
    console.log(`    ${wasmOptFailure}`);
  }
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