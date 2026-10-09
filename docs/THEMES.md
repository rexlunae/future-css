# Themes and the appearance picker

Twenty-one stock designs ship in `future-css/themes`; the picker and shared catalog ship in
`future-css/theme-picker` and `future-css/theme-presets`. Themes are opt-in so a page
that does not use them pays no CSS/download cost. No theme requires WASM, fonts from
a network, or a framework. Native controls keep keyboard behavior and focus visible. Each selector is scoped to its own design and palette and includes a miniature window with header, navigation, feature surface, card and action. Changing the active page theme does not restyle other theme previews.

| Design | Shape/elevation | Color placement and type | Default palette |
| --- | --- | --- | --- |
| Future | Balanced, soft | Neutral panels, system type | Future blue |
| Clarity | Crisp, flat | Outlined actions, neutral panels | Future blue |
| Helix | Crisp, soft | Charcoal header, mint actions, violet feature gradient | Helix violet & mint |
| Forest | Organic, soft | Tinted cards/composer/header | Forest |
| Editorial | Crisp, flat | Outlined actions, serif reading | Ink |
| Graphite | Balanced, edge shadows | Neutral panels | Ink |
| Ocean | Round, soft | Tinted cards/composer/header | Teal |
| Ember | Balanced, lifted | Tinted cards/composer/header | Ember |
| Blueprint | Square, edge shadows | Outlined actions | Blueprint blue |
| Bloom | Organic, lifted | Tinted cards/composer/header | Rose |
| Aurora | Round, lifted | Violet ribbons, luminous curves and floating surfaces. | Violet |
| Candy | Organic, soft | Rose candy stripes, pillowy panels and playful elevation. | Rose |
| Solar | Square, edge | Amber sunshine, square panels and decisive offset shadows. | Amber |
| Nocturne | Crisp, lifted | Ink chrome, violet spotlights and elegant serif reading. | Violet |
| Arcade | Square, edge | Green scanlines, square geometry and terminal-inspired type. | Forest |
| Parchment | Crisp, flat | Warm ruled paper, serif type and quiet outlined controls. | Amber |
| Bubble | Organic, lifted | Teal bubbles, generous curves and buoyant layered shadows. | Teal |
| Garnet | Crisp, soft | Rose jewel facets, crisp serif panels and charcoal chrome. | Rose |
| Origami | Square, soft | Blue folded ribbons, angular outlines and paper shadows. | Blue |
| Sundown | Round, lifted | Ember horizons, rounded reading panels and long soft shadows. | Ember |
| Pride | Round, soft | Six rainbow ribbons, violet actions and a readable text halo | Violet |

Candy and Arcade soften their patterns and add a small semantic text halo to feature
labels, in both the library cards and miniature previews. Picker names/descriptions
sit on solid backgrounds. Candy and Arcade ship this adjustment at version 1.0.1.
Pride ships at 1.0.0 and uses six dedicated rainbow color roles, each checked against
`text-on-accent` at 4.5:1 in both schemes and every palette. It uses the same halo.
The six `--fc-color-pride-*` tokens are emitted by the optional `themes.css`;
they remain in the shared token catalog and contrast contract. Token metadata
identifies each token’s stylesheet so consumers can load the appropriate layer.
Forced colors remove the patterns and shadows.

Decorative ribbons, facets, stripes, ruled paper and bubbles use semantic background
roles with declared foreground contrast. Patterns are static and disappear in forced
colors. New designs use the existing schema 1;
custom themes can use any of them as their base. Custom elevation, typography and
surface controls take precedence over the starting recipe. The optional
`--fc-theme-canvas-image` slot adds a static workspace texture; feature decoration
uses `--fc-theme-feature-image`. Both default to `none`. `--fc-theme-feature-text-shadow` defaults to `none` and
controls the feature label halo.

All presets work in light and dark. Choose the design first, then optionally replace
its palette. Ten palettes include Amber and Violet in addition to the defaults above.
Status, code syntax and terminal hues keep their meaning. Rounded badges/pills retain
their semantic shapes. Presets never shrink target sizes, font sizes or focus rings.

```html
<!-- CSS alone applies the stock design, including corners and shadows. -->
<html data-fc-design="forest" data-fc-palette="forest" data-fc-theme="light">
```

```js
import { FutureCssThemePicker } from 'future-css/theme-picker';
const picker = new FutureCssThemePicker({
  root: '#appearance',
  // Defaults to document.documentElement; an application region can be scoped.
  target: document.documentElement,
  initial: {design:'future', palette:'default', scheme:'system', contrast:'system'},
  storageKey: 'my-app-appearance', // optional; denied storage is harmless
  onChange: state => console.log(state),
});
```

The target must contain the region to theme. Use one picker owner per target.
`scheme` is `system`, `light` or `dark`; `contrast` is `system` or `high`. The system
contrast preference and forced colors take priority over decorative custom colors.
No theme-switch animation is added. `destroy()` cancels loading, removes listeners
and restores the original target attributes and owned inline properties.

Border weight follows the design: Future, Helix, Forest, Editorial, Ocean,
Ember, Bloom and all new designs except Solar and Arcade use fine 1px strokes.
Clarity, Graphite, Blueprint, Solar and Arcade use stronger
2px outlines. Soft surfaces use quieter decorative borders; interactive controls
retain their contrast-checked boundary color. The public component slots are
`--fc-border-width-control` and `--fc-border-width-surface`, each falling back to
`--fc-border-width-thin`. Custom designs inherit the starting theme's treatment;
choosing edge elevation gives them the stronger outline. Joined controls overlap
exactly their current border width, so either weight keeps one continuous seam.
Focus rings and forced-colors indicators keep their accessibility widths.

## Custom editor

The explicit **Custom** radio opens controls for the starting theme, corner shape,
drop shadows, color placement, typography and palette. Changes apply immediately
through the same bounded schema as installed themes. The editor preserves target
sizes and accessibility preferences. When `storageKey` is supplied, the draft is
saved with the selection. **Export Custom TOML** downloads a versioned installation
file; `picker.exportCustomTheme()` returns the same TOML as a string. When `contract` is supplied, the editor also offers semantic color selection
with separate light/dark color inputs. **Validate and apply color** checks the
complete resulting palette before changing the preview or page; a failed contrast
check leaves the last valid theme in place and announces the reason. Selecting a
stock Custom palette clears color overrides. Imported color pairs use the same check.

`fc-card--feature` is the shipped feature surface, using each theme's feature
background, foreground and gradient. Tinted designs also style cards, composers
and mastheads; palette-tinted canvas and neutral surfaces carry color through the
workspace. Blueprint uses dashed card borders; flat, edge, soft and lifted
presets provide distinct elevation. No appearance rule requires a demo class.

## Custom/loadable themes use TOML

Import a `.toml` file using the picker, or load an HTTP(S) URL through `loadTheme`.
A failed schema/contrast check leaves the current appearance intact and reports why.
Imports are bounded to 64 KiB and contain data, never CSS, scripts, assets or webfonts.

```toml
schema-version = 1
version = "1.0.0"
id = "reading-room"
name = "Reading room"
description = "Serif reading, soft shadows and calm forest color."
base = "editorial"
shape = "round"
depth = "soft"
surface = "tinted"
type = "serif"
palette = "forest"
```

Required fields are `schema-version`, `version`, `id`, `name`, `description` and `base` (a stock design ID). An ID
must be unique from stock IDs. Optional settings inherit from `base`:

- `shape`: `balanced`, `crisp`, `round`, `organic`, `square`.
- `depth`: `flat`, `soft`, `lifted`, `edge`.
- `surface`: `neutral`, `outline`, `tinted`, `helix`.
- `type`: `system`, `serif`.
- `palette`: a stock palette ID from the catalog.

For custom colors, supply the library-generated contrast contract to the picker:

```js
const contract = await fetch('/assets/theme-contract.json').then(r => r.json());
const picker = new FutureCssThemePicker({root:'#appearance', contract});
const id = await picker.loadTheme('/themes/reading-room.toml');
picker.setState({design:id, palette:'forest'});
```

Copy `dist/theme-contract.json` with your assets (also exported as
`future-css/theme-contract.json`). This machine-generated validation data is JSON;
the authored/loadable theme file is TOML. Do not author or weaken the contract.
For an imported color palette, use its custom theme ID as `palette`. The file chooser
selects the imported design/palette automatically. Programmatic loading registers it
without changing the active theme; `registerTheme(parseThemeToml(source))` is also
available. `customThemes` pre-registers definitions before restoring stored selections.
Saved state contains IDs/settings, not imported files: reload definitions at startup.

```toml
# Colors merge with the chosen stock palette, then every resulting pair is checked.
[colors.text-default]
light = "#0e0f13"
dark = "#f9fafb"
```

Both color-scheme values are required; only existing semantic color roles and six-digit
sRGB hex values are accepted. The validator checks all resulting pairs, including hover,
active, disabled, selected and focus colors. It rejects unknown settings and invalid
contrast before installing anything. A validated palette is completed from its base
so subsequent selection cannot accidentally mix partially checked colors.

The dependency-free parser supports this schema's single-line basic/literal TOML
strings, comments, optional `[theme]`, and `[colors.role-name]` (quoted role names are
also accepted). It supports escaped Unicode. Arrays, dates, multiline strings, dotted
assignments and unrelated tables are explicitly rejected; they are not theme settings.

## Validation tools and limits

```bash
npm run build:css
node tools/check-theme.mjs demo/themes/reading-room.toml
npm run check
```

The compiler rejects stock palettes failing any declared minimum in either scheme.
Tests cover all stock designs/palettes, custom rejection, TOML syntax, runtime changes,
keyboard controls, scoped application, narrow RTL layouts and accessibility preferences.
CI runs axe against actual rendered components; shape/elevation choices preserve targets
and do not rely on shadows for boundaries. Custom inline colors are removed in high
contrast and forced colors and restored when preferences return.

A passing palette is a mechanical guarantee about declared pairs, not certification of
an application: custom markup, translucent backgrounds, third-party CSS and user content
can introduce new pairs. Review keyboard, zoom, screen readers and translations in the
application. The parser/validator supports bounded settings deliberately; arbitrary CSS
overrides bypass these guarantees.

## Versioned installation and migrations

`schema-version` is an integer identifying the theme format (currently **1**).
`version` is a separate SemVer identifying the theme's own content (stock presets
start at **1.0.0**). A new theme release increments its version; a new library schema
increments the schema version and adds an explicit migration. Unknown future schemas
are rejected rather than guessed. Imported themes always require current schema/version.

The published package includes the installer, validator and migrator under `tools/`.
Installation runs schema and both-scheme contrast checks before writing any file:

```bash
node tools/install-theme.mjs reading-room.toml --to themes/reading-room.toml
node tools/install-theme.mjs reading-room-v2.toml --to themes/reading-room.toml --upgrade
```

New installation refuses to overwrite a file. An upgrade must keep the same theme ID
and have a strictly newer SemVer; it rejects downgrades and changed content under the
same version. The previous file is preserved as `reading-room.toml.<version>.bak` and
the new validated file replaces it atomically. A conflicting backup stops installation.
This is installation into an application's theme directory, not registry publishing.

`dist/theme-schema.json` (export `future-css/theme-schema.json`) is a generated JSON
Schema for the **parsed TOML object**, using `schemaVersion` for TOML's `schema-version`.
It covers structure and settings; the theme contract/validator additionally verifies
actual contrast. Both derive from the same schema constants and semantic role catalog.

The initial migration step upgrades schema 0 (unversioned early theme drafts) to schema
1 without changing their design settings. An unversioned theme needs an explicitly
chosen theme version. No migration occurs implicitly at install/load time:

```bash
# Without --to, show the migrated TOML; never rewrite the original.
node tools/migrate-theme.mjs legacy.toml --theme-version 1.0.0
node tools/migrate-theme.mjs legacy.toml --theme-version 1.0.0 --to current.toml
node tools/install-theme.mjs current.toml --to themes/current.toml
```

The migrator validates its final output, refuses to overwrite an output file and
preserves the source. Future schema steps belong in `src/js/theme-migrations.ts` with
round-trip and installation tests. Pure JS `migrateTheme` and `compareThemeVersions`
are exported for application-managed installation flows.

## Helix reference

The stock Helix design was informed by the rendered public homepage at
[HelixIde PPE](https://ppe.helixide.app/) on 2026-10-08: dark top bar, light mint
sidebar, filled blue/violet navigation, 4–10px control corners, quiet shadows and
a blue-to-violet feature gradient. It reproduces that visual vocabulary using the
library's own components and verified semantic colors, without copying branding or
requiring the reference site's fonts/assets. Colors differ where the contrast
contract requires it. The dark scheme adapts the same hierarchy to dark surfaces.

Feature panels can consume `--fc-theme-feature-bg`, `--fc-theme-feature-fg` and
`--fc-theme-feature-image` (with normal surface/text/none fallbacks). The Helix
preset supplies a gradient; other designs supply a neutral panel. The gradient uses
linear sRGB interpolation between checked endpoints with the same text foreground,
so intermediate luminance cannot exceed the endpoint bounds. High contrast maps
those endpoints to the same solid color; forced colors suppresses decorative images.
