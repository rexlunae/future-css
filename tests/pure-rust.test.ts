import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// A Rust consumer (the Dioxus library) links these crates with defaults off.
// The wasm-bindgen pin is exact, so if it leaks back into that tree the
// consumer's own wasm-bindgen fails to resolve: an outage for them that no
// test here would otherwise notice, because every build here keeps defaults on.
const CRATES = ['fc-core', 'fc-model', 'fc-rich-text', 'fc-select', 'fc-context-menu', 'fc-grid', 'fc-diff', 'fc-git', 'fc-highlight', 'fc-ansi', 'fc-theme'];
// These host-side data models have no JavaScript boundary to opt out of.
const RUST_ONLY_CRATES = ['fc-dialog'];
const SIBLINGS = /^(fc-[a-z-]+)\s*=\s*\{([^}]*)\}/gm;
const cargo = process.env.CARGO ?? 'cargo';

function hasCargo(): boolean {
  try { execFileSync(cargo, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

describe('pure Rust consumers', () => {
  it('every crate puts its JavaScript boundary behind a default-on bindgen feature', () => {
    for (const crate of CRATES) {
      const manifest = readFileSync(new URL(`../crates/${crate}/Cargo.toml`, import.meta.url), 'utf8');
      assert.match(manifest, /^default = \["bindgen"\]$/m, `${crate}: default features`);
      assert.match(manifest, /^wasm-bindgen = \{[^}]*optional = true[^}]*\}$/m, `${crate}: wasm-bindgen is optional`);
      for (const [, sibling, spec] of manifest.matchAll(SIBLINGS)) {
        // A sibling pulled with its defaults on would switch bindgen back on
        // underneath a consumer that asked for it off.
        assert.match(spec, /default-features = false/, `${crate} -> ${sibling}: defaults off`);
        assert.match(manifest, new RegExp(`^bindgen = \\[[^\\]]*"${sibling}/bindgen"`, 'm'), `${crate} forwards bindgen to ${sibling}`);
      }
    }
  });

  it('every crate packages the MIT notice itself, not a link to it', () => {
    // A symlink checked out where git cannot make one (Windows by default)
    // becomes a file holding the text `../../LICENSE`, and cargo publish would
    // ship that instead of the notice.
    const root = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
    for (const crate of [...CRATES, ...RUST_ONLY_CRATES]) {
      const copy = new URL(`../crates/${crate}/LICENSE`, import.meta.url);
      assert.ok(!lstatSync(copy).isSymbolicLink(), `${crate}: LICENSE is a symlink`);
      assert.equal(readFileSync(copy, 'utf8'), root, crate);
    }
  });

  it('links no wasm-bindgen with defaults off, natively or on wasm32', { skip: hasCargo() ? false : 'no cargo found' }, () => {
    for (const crate of [...CRATES, ...RUST_ONLY_CRATES]) {
      for (const target of ['all', 'wasm32-unknown-unknown']) {
        const tree = execFileSync(cargo, ['tree', '-q', '-p', crate, '--no-default-features', '-e', 'normal', '--target', target, '--prefix', 'none'], { encoding: 'utf8' });
        assert.doesNotMatch(tree, /^wasm-bindgen /m, `${crate} (${target})`);
      }
    }
  });

  it('Rust-only host models have no standalone script module or normal dependencies', { skip: hasCargo() ? false : 'no cargo found' }, () => {
    for (const crate of RUST_ONLY_CRATES) {
      const manifest = readFileSync(new URL(`../crates/${crate}/Cargo.toml`, import.meta.url), 'utf8');
      assert.match(manifest, /^crate-type = \["rlib"\]$/m, crate);
      const tree = execFileSync(cargo, ['tree', '-q', '-p', crate, '-e', 'normal', '--prefix', 'none'], { encoding: 'utf8' }).trim().split('\n');
      assert.equal(tree.length, 1, `${crate}: unexpected normal dependency`);
    }
  });
});
