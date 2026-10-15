# Migration guide

The project is pre-alpha (`0.0.0`); no stable release compatibility is promised yet.
Pin a commit or package version and retain the old `tokens.json` when updating.

This update adds state tokens, typography roles, optional themes and component slots.
No existing public class or token is removed. The radius, leading and shadow defaults
change rendering; applications requiring the former appearance should explicitly set
those tokens in `fc.overrides` and review both schemes, RTL and narrow viewports.

Use `selected-bg` / `selected-fg` for selection instead of borrowing accent-subtle
colors. Use `disabled-bg` / `disabled-fg` / `disabled-border` for inactive controls;
reducing whole-control opacity can make text illegible. Use `text-on-warning` with
solid warning fills, and retain `warning-text` for subtle surfaces.

Import optional `themes`, `type`, `print`, or `wide-gamut` pieces only when needed.
Load `layers` first, `tokens` before consumers, `themes` after tokens, and print last.
The full bundle includes type classes but excludes optional themes, gamut and print.
JSON named-token values retain their shape; `$metadata` is reserved for descriptions.
Iterate only keys beginning with `--fc-` when processing values.

For future class/token renames, create an explicit JSON map:

```json
{"--fc-old-token":"--fc-new-token","fc-old-class":"fc-new-class"}
```

```bash
node tools/migrate-tokens.mjs --map renames.json app.css page.html
node tools/migrate-tokens.mjs --map renames.json --write app.css page.html
```

The default is a dry run. `--write` preserves each changed file in an exclusive
`.fc-migration.bak` backup and refuses to overwrite an existing backup. Replacements
match complete names in one pass, including class element/modifier names. Review the
diff: this is text migration, so comments and string literals are included. The tool
cannot infer changed DOM structure, ARIA behavior, runtime semantics or replacement
color pairings. Follow each release's specific migration notes for those changes.

## fc-highlight: one call for spans

`highlightSpans(source, language)` returns a `Uint32Array` of pairs, each span's
end in UTF-16 code units and then its role as an index in the roles list. It
tokenizes once. `highlightRoles` and `highlightEnds` still work and return what
they did, but each tokenizes the whole source again, so calling both costs two
passes. They are deprecated; move to `highlightSpans`:

```js
const spans = mod.highlightSpans(source, language);
for (let i = 0, start = 0; i < spans.length; i += 2) {
  render(ROLES[spans[i + 1]], source.slice(start, spans[i]));
  start = spans[i];
}
```

## Core WASM ABI 2

The core/text/grid/rich-text boundaries now return primitive data. Update raw WASM
consumers using the shapes in [WASM.md](WASM.md#core-abi-2-migration), particularly
flat `Uint32Array` coordinates, `JSON.parse(block.serialize())`, decoded `splitAt()`
results, and tagged error strings. The core ABI check is 2 and rejects cached ABI 1.
Select and menu keep their independent ABIs. Browser binding APIs are unchanged;
editor and grid continue to use JS.

Git file lists now render an ARIA grid of rows and cells, allowing native Stage
buttons inside each row. The initial/empty `.fc-git__files` container uses
`role="group"`; the binding assigns `grid` when files exist. Consumers querying
`role="option"` for git files should use `.fc-git__row` or `[data-fc-path]`.
Arrow Up/Down and Home/End navigate rows; Stage retains native Enter/Space behavior.

Custom select invokers need an explicit accessible label (`aria-label` or
`aria-labelledby`) because a combobox does not derive its name from button text.
Scrollable code sources and terminal outputs need `tabindex="0"` on the actual
scroll container for keyboard scrolling. Dim terminal text now satisfies 4.5:1
on both output and chrome backgrounds.
