import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// A Rust consumer (the Dioxus library) links these crates with defaults off.
// The wasm-bindgen pin is exact, so if it leaks back into that tree the
// consumer's own wasm-bindgen fails to resolve: an outage for them that no
// test here would otherwise notice, because every build here keeps defaults on.
const CRATES = ['fc-core', 'fc-model', 'fc-rich-text', 'fc-select', 'fc-context-menu', 'fc-grid', 'fc-diff', 'fc-git'];
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

  it('links no wasm-bindgen with defaults off, natively or on wasm32', { skip: hasCargo() ? false : 'no cargo found' }, () => {
    for (const crate of CRATES) {
      for (const target of ['all', 'wasm32-unknown-unknown']) {
        const tree = execFileSync(cargo, ['tree', '-q', '-p', crate, '--no-default-features', '-e', 'normal', '--target', target, '--prefix', 'none'], { encoding: 'utf8' });
        assert.doesNotMatch(tree, /^wasm-bindgen /m, `${crate} (${target})`);
      }
    }
  });
});
