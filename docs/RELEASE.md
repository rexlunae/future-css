# Release and support policy

Until a stable version is published, `0.0.0` is a development snapshot. Pin consumers
to a known version/commit. Public release, registry credentials and CDN publication
remain maintainer operations; adding CI does not publish this checkout.

After 1.0, removed/renamed classes or tokens, changed DOM/binding contracts, and default
value changes that alter rendering require a major version. Additions are minor;
behavior-preserving fixes are patches. Security corrections may necessarily change
behavior and must state that explicitly in release notes.

Deprecations include the replacement, a migration example and the planned removal
version. Keep deprecated public names through at least one minor release and remove
only in a major release. Do not silently repurpose a token. WASM ABI changes increment
the corresponding version and retain a JS fallback on mismatched cached modules.

Maintain fixes for the current stable major and security fixes for the previous major
for twelve months after its successor releases. Pre-alpha snapshots have no maintenance
window. The actual browser support policy is in [PLATFORMS.md](PLATFORMS.md); supported
targets and verified targets are distinct.

Each release records changes in a checked-in Markdown changelog, with migration notes
for rendering, DOM and token changes. The dependency-free repository does not install
the Changesets package: release records serve the same review purpose without adding a
package manager workflow. Revisit that choice if maintaining multiple published
packages makes automated version coordination useful.

Before release, require `npm run check` with Chrome and WASM present, perform the manual
accessibility/translation checks in PLAN.md, inspect `npm pack --dry-run`, and verify
version, license and exported artifacts. A successful local gate does not establish
npm/CDN distribution or cross-browser certification. Follow [CONTRIBUTING.md](CONTRIBUTING.md)
for review and [MIGRATION.md](MIGRATION.md) for rename tooling.

## Rust crates on crates.io

The nine model crates publish to crates.io so that pure Rust consumers, `fc-dioxus`
first, can depend on them without a git dependency, which crates.io rejects. Sibling
path dependencies therefore also carry a `version`: cargo uses the path in this
workspace and the version in the published manifest. Each crate links the root
`LICENSE` so the MIT notice travels inside every package.

Publish them together, from the commit the Dioxus library pins, after
`cargo publish --workspace --dry-run` passes. Cargo orders the upload so `fc-core`
precedes `fc-model`, `fc-grid` and `fc-rich-text`. A crates.io version can be yanked
but never replaced, so a fix ships as a new patch version. The crates' versions are
independent of the npm package's `0.0.0` snapshot.
