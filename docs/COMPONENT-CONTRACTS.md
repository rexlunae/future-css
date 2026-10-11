# Component contracts

The six required sections for every shipped component. Complete markup/state examples are linked to the source fixture; detailed usage and bindings are in [COMPONENTS.md](COMPONENTS.md). These contracts describe supported behavior, not a completed manual screen-reader audit.

## agent-status

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-agent-status) define required parts, labels and attributes. Load `future-css/components/agent-status` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

data-fc-state carries lifecycle; adjacent text names the status and elapsed time.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static state text is readable; application updates the state. WASM is optional and has a JS fallback.

### When not to use it

Avoid an indicator with no explanation of which agent is working.

## alert

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-alert) define required parts, labels and attributes. Load `future-css/components/alert` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Use role=status for polite updates or role=alert for urgent failures; avoid repeating announcements.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static alert text is visible; dismissal needs application behavior. WASM is optional and has a JS fallback.

### When not to use it

Avoid announcing every streamed token.

## avatar

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-avatar) define required parts, labels and attributes. Load `future-css/components/avatar` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Decorative portraits have empty alt text; otherwise supply a meaningful name, including initials.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Images or initials render without JS. WASM is optional and has a JS fallback.

### When not to use it

Avoid the only source of a person’s name.

## badge

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-badge) define required parts, labels and attributes. Load `future-css/components/badge` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Status text carries meaning without color; removal controls need an explicit name.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Status remains readable; interactive tag removal requires application behavior. WASM is optional and has a JS fallback.

### When not to use it

Avoid the sole explanation of an error.

## breadcrumb

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-breadcrumb) define required parts, labels and attributes. Load `future-css/components/breadcrumb` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named nav with an ordered list; current page uses aria-current=page.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native links work. WASM is optional and has a JS fallback.

### When not to use it

Avoid pagination or arbitrary action buttons.

## button-group

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-button-group) define required parts, labels and attributes. Load `future-css/components/button-group` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named role=group; each native control retains its own tab stop and accessible name.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native controls work; application owns actions and state. WASM is optional and has a JS fallback.

### When not to use it

Avoid claiming toolbar arrow navigation from visual grouping alone.

## button

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-button) define required parts, labels and attributes. Load `future-css/components/button` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Native button; Enter/Space activate; aria-busy names loading without hiding the label.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native activation works; the application owns its action. WASM is optional and has a JS fallback.

### When not to use it

Avoid navigation to another URL; use an anchor.

## icon

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-icon) define required parts, labels and attributes. Load `future-css/components/icon` with the token foundation; take the SVG from `future-css/icons` (`iconMarkup`, `createIcon`), `dist/icons.svg` (`<use href="icons.svg#fc-icon-NAME">`), or `dist/icons.json`.

### States

None of its own. The icon is never the interactive element; it takes the enclosing control's state through `currentColor`, so a disabled or danger button's icon matches its label.

### Accessibility

Decorative by default (`aria-hidden="true"`). An icon-only button carries its name on the button with `aria-label`, never on the icon; a standalone icon that means something is `role="img"` with `aria-label`. Sized in `em`, so it scales with text zoom.

### Internationalization

Icons that point along the line of text (`*-start`, `*-end`, send, undo, redo, external-link, sidebar) carry `.fc-icon--mirror` and flip under `dir="rtl"`. Physical and rotational icons (play, upload, refresh) do not.

### No-JS fallback

Static SVG markup; `iconMarkup` writes presentation attributes so the icon draws before the stylesheet loads. No icon font, CDN, or script is involved.

### When not to use it

Avoid an icon alone where the action is unfamiliar or has no widely understood symbol; give the button a visible label and keep the icon beside it.

## card

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-card) define required parts, labels and attributes. Load `future-css/components/card` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Use headings for card titles; use a named link or button for an action.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Content and native links remain available. WASM is optional and has a JS fallback.

### When not to use it

Avoid turning an entire card into an unnamed click target.

## carousel

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-carousel) define required parts, labels and attributes. Load `future-css/components/carousel` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind carousel; name previous/next controls and slides; keyboard navigation, position status and reduced-motion scrolling are supported.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Keep slide content reachable in the scroll region; enhanced controls need binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid auto-advancing essential information or hiding the only path to a task.

## chat

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-chat) define required parts, labels and attributes. Load `future-css/components/chat` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named thread and message authors; data-fc-id/seq/role/state expose runtime identity; announce useful boundaries.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static conversation and native message-action links remain readable. WASM is optional and has a JS fallback.

### When not to use it

Avoid replacing a document with a live region that announces every token.

## check

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-check) define required parts, labels and attributes. Load `future-css/components/check` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Labeled native checkbox/radio; Space toggles; radios use native arrow navigation.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native checkbox, radio and switch inputs retain their form values. WASM is optional and has a JS fallback.

### When not to use it

Avoid a command that runs immediately without changing an on/off value.

## citation

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-citation) define required parts, labels and attributes. Load `future-css/components/citation` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named source links; visible numbering is stable and associated with the cited passage.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native links and source details work. WASM is optional and has a JS fallback.

### When not to use it

Avoid links with no discoverable destination or fabricated provenance.

## code

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-code) define required parts, labels and attributes. Load `future-css/components/code` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named region with pre/code; source text is selectable; copy controls have names; line numbers are decorative.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Source remains readable; syntax highlighting and clipboard actions require JS. WASM is optional and has a JS fallback.

### When not to use it

Avoid rendering source by inserting unsanitized HTML.

## composer

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-composer) define required parts, labels and attributes. Load `future-css/components/composer` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind composer; labeled textarea, IME-safe send, same send/stop node, named attachment removal.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Textarea retains native editing; application can use ordinary form submission as fallback. WASM is optional and has a JS fallback.

### When not to use it

Avoid discarding drafts when controls or model settings change.

## context-strip

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-context-strip) define required parts, labels and attributes. Load `future-css/components/context-strip` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind context strip; provider/model/effort resolved together; controls have names and unavailable options are excluded.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Expose compatible native selects or a static context summary; dependent state needs the binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid three independent selects that can disagree about compatible models.

## control-group

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-control-group) define required parts, labels and attributes. Load `future-css/components/control-group` with the token foundation.

The joined modifier uses direct `fc-control-group__joined-item` controls and an expanding `fc-control-group__control` input. Labels stay outside the row. Inner corners default to square; outer corners follow the theme. The shared `--fc-joined-inner-radius` override opts into rounded seams.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named role=group; controls keep their native tab stops; aria-pressed expresses toggle state.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native controls work; mutually dependent values require application logic. WASM is optional and has a JS fallback.

### When not to use it

Avoid claiming role=toolbar without implementing its arrow-key contract.

## datepicker

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-datepicker) define required parts, labels and attributes. Load `future-css/components/datepicker` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Label native date/time inputs; bind calendar grid for arrows, Home/End and month/year paging; Intl supplies locale names and week starts.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native date/time inputs retain browser entry; custom calendar needs binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid assuming the display format is the stored ISO value or that range selection is implemented.

## description-list

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-dl) define required parts, labels and attributes. Load `future-css/components/description-list` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Native dl/dt/dd establishes term/value relationships.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

All terms and descriptions remain readable. WASM is optional and has a JS fallback.

### When not to use it

Avoid a two-dimensional data set; use table.

## dialog

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-dialog) define required parts, labels and attributes. Load `future-css/components/dialog` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Name the dialog with aria-labelledby; showModal traps focus and Escape closes it; restore opener focus.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Content can be rendered inline; opening a modal needs showModal from application JS. WASM is optional and has a JS fallback.

### When not to use it

Avoid information that should stay visible beside the main task.

## diff

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-diff) define required parts, labels and attributes. Load `future-css/components/diff` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Name the diff; additions/removals have +/- markers and text beyond color; line numbers remain associated.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static diff markup remains readable; computing a diff requires JS or host data. WASM is optional and has a JS fallback.

### When not to use it

Avoid assuming color alone communicates changed lines.

## disclosure

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-disclosure) define required parts, labels and attributes. Load `future-css/components/disclosure` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Native details/summary supplies keyboard activation and expanded state.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native disclosure works. WASM is optional and has a JS fallback.

### When not to use it

Avoid hiding essential instructions or mandatory consent text.

## divider

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-divider) define required parts, labels and attributes. Load `future-css/components/divider` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Use hr for a thematic break; decorative separators are aria-hidden and have no tab stop.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

CSS and native semantic separation work. WASM is optional and has a JS fallback.

### When not to use it

Avoid communicating a status through a line alone.

## editor

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-editor) define required parts, labels and attributes. Load `future-css/components/editor` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind editor; named editing surface and toolbar; roving toolbar arrows and pressed formatting state.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

The contenteditable surface uses native editing; custom toolbar requires the binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid an application needing a complete word processor or collaborative model.

## empty-state

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-empty) define required parts, labels and attributes. Load `future-css/components/empty-state` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Heading and useful next action; errors explain retry rather than displaying only an icon.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Text and native links remain usable. WASM is optional and has a JS fallback.

### When not to use it

Avoid concealing a loading state or reporting unloaded data as empty.

## fab

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-fab) define required parts, labels and attributes. Load `future-css/components/fab` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Name icon-only buttons; expose expanded state for a speed dial; entries are native controls in tab order.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native action and popover disclosure work; the application owns commands. WASM is optional and has a JS fallback.

### When not to use it

Avoid multiple competing floating primary actions or content-obscuring placement.

## field

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-field) define required parts, labels and attributes. Load `future-css/components/field` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Explicit label plus hint/error IDs in aria-describedby; native editing and validation.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native inputs remain editable; the application owns validation and error-summary focus. WASM is optional and has a JS fallback.

### When not to use it

Avoid a custom listbox when a native select suffices.

## git

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-git) define required parts, labels and attributes. Load `future-css/components/git` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind git; the file grid contains rows/cells so Stage buttons remain interactive. Arrow Up/Down and Home/End move the selected row; Enter/Space select. Stage uses native activation and a path-specific name. Status fixtures are caller supplied and selection state is exposed.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static status and diff text remain readable; binding adds navigation, the host performs git operations. WASM is optional and has a JS fallback.

### When not to use it

Avoid claiming that this component runs git or stages files itself.

## grid

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-grid) define required parts, labels and attributes. Load `future-css/components/grid` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind grid; single active cell, arrow navigation, named headers and row/column counts.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Render data as a native table; interactive cell navigation/editing needs the binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid simple read-only tabular data; use table.

## list

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-list) define required parts, labels and attributes. Load `future-css/components/list` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Use ul/li for informational items or named native controls for actions; supporting text must remain reachable.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Content and native links remain usable. WASM is optional and has a JS fallback.

### When not to use it

Avoid claiming listbox selection semantics for ordinary list styling.

## loading

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-loading) define required parts, labels and attributes. Load `future-css/components/loading` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Skeletons are decorative; label the loading region; progress uses native progress or progressbar values.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static loading/progress markup is visible; application updates values. WASM is optional and has a JS fallback.

### When not to use it

Avoid a fake percentage for indeterminate work.

## masthead

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-masthead) define required parts, labels and attributes. Load `future-css/components/masthead` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Header with a named navigation region; current links use aria-current; native tab order.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native navigation and header actions work. WASM is optional and has a JS fallback.

### When not to use it

Avoid a second unnamed navigation landmark with identical links.

## menu

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-menu) define required parts, labels and attributes. Load `future-css/components/menu` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind menu; arrows/Home/End navigate, Escape restores focus; disabled items are skipped.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Render the commands as visible native buttons/links; ARIA menu keyboard behavior requires binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid a value picker; use select.

## nav

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-nav) define required parts, labels and attributes. Load `future-css/components/nav` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind nav; rail toggle uses aria-expanded; native links remain named in the rail.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Keep navigation expanded and use native links; collapse needs the binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid a menu of commands rather than navigation destinations.

## navbar

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-navbar) define required parts, labels and attributes. Load `future-css/components/navbar` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named nav with native links; aria-current=page identifies the destination, not aria-selected.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native links work; application sets current destination. WASM is optional and has a JS fallback.

### When not to use it

Avoid tabs that swap panels within the page.

## pagination

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-pagination) define required parts, labels and attributes. Load `future-css/components/pagination` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Named nav; each page link has a meaningful name and current page state.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native page links work; client-side paging belongs to the application. WASM is optional and has a JS fallback.

### When not to use it

Avoid hiding a small amount of content behind unnecessary pages.

## popover

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-popover) define required parts, labels and attributes. Load `future-css/components/popover` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Native popovertarget controls open and light-dismiss; keep the trigger named.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native popover works without library JS; older unsupported browsers need inline content. WASM is optional and has a JS fallback.

### When not to use it

Avoid modal decisions requiring a focus trap.

## reasoning

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-reasoning) define required parts, labels and attributes. Load `future-css/components/reasoning` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Use native disclosure; keep summaries meaningful; lifecycle is data-fc-state.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static text and native disclosure work. WASM is optional and has a JS fallback.

### When not to use it

Avoid presenting unknown internal reasoning as verified evidence.

## search

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-search) define required parts, labels and attributes. Load `future-css/components/search` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Use a labeled native search input in a search form; suggestions use the select binding; name clear/filter controls.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native form submission works; custom suggestions require binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid hiding search results behind unexplained automatic navigation.

## segmented

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-segmented) define required parts, labels and attributes. Load `future-css/components/segmented` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Name the group; use native radios for one value, checkboxes for multiple values, or aria-pressed buttons with application state.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native radio/checkbox selection works; pressed-button state needs application behavior. WASM is optional and has a JS fallback.

### When not to use it

Avoid tabs with panels; use tabs for content navigation.

## select

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-select) define required parts, labels and attributes. Load `future-css/components/select` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind select; named trigger/listbox, arrows/Home/End/typeahead; commit differs from highlight.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Use a native select as the fallback; a custom listbox requires binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid a command list; use menu.

## slider

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-slider) define required parts, labels and attributes. Load `future-css/components/slider` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Label native range inputs; bind the slider for value output/fill and multi-thumb constraints; native arrow keys remain operable.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native range inputs remain editable; enhanced output and multi-thumb constraints require the binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid precise values best entered as text without offering that alternative.

## splitter

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-splitter) define required parts, labels and attributes. Load `future-css/components/splitter` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Focusable role=separator with aria-valuenow, aria-valuemin, aria-valuemax and aria-controls naming the resized pane; arrows, Home/End and Enter follow the WAI-ARIA window splitter pattern. A pane whose content can scroll needs `tabindex="0"` and a name so keyboard users can scroll it.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Panes render at their declared `--fc-split-size`; resizing requires the splitter binding. WASM is not used.

### When not to use it

Avoid a splitter for content that should simply reflow, or as the only way to reveal a collapsed pane.

## spinner

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-spinner) define required parts, labels and attributes. Load `future-css/components/spinner` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Associate with a named status; decorative spinners are aria-hidden; announce completion once.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Animation runs in CSS; reduced motion retains an indication of ongoing work. WASM is optional and has a JS fallback.

### When not to use it

Avoid determinate work whose actual progress is known.

## split-button

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-split-button) define required parts, labels and attributes. Load `future-css/components/split-button` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Primary action and named disclosure are separate controls; native popover uses popovertarget; ARIA menus need the menu binding.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Native popover and tab-order buttons work; menu roving focus needs binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid an ambiguous primary action with no discoverable alternative label.

## suggestion

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-suggestion) define required parts, labels and attributes. Load `future-css/components/suggestion` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Native named buttons/links; keyboard activation matches the action.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Links work; applying a prompt needs application behavior. WASM is optional and has a JS fallback.

### When not to use it

Avoid silently submitting consequential actions.

## table

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-table) define required parts, labels and attributes. Load `future-css/components/table` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Native table with caption and scoped headers; sort buttons update aria-sort; stable sorting preserves row focus.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Read-only data stays visible; sorting needs the binding or server-side links. WASM is optional and has a JS fallback.

### When not to use it

Avoid a spreadsheet with cell editing; use grid.

## tabs

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-tabs) define required parts, labels and attributes. Load `future-css/components/tabs` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind tabs; one tab stop, arrows/Home/End move selection; panels have matching IDs.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Expose panel content as ordinary sections instead of leaving hidden panels unreachable. WASM is optional and has a JS fallback.

### When not to use it

Avoid sequential steps that must be completed in order.

## terminal

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-terminal) define required parts, labels and attributes. Load `future-css/components/terminal` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Name the output region; avoid live announcements per character; input needs a label.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static preformatted output remains visible; command execution belongs to the host. WASM is optional and has a JS fallback.

### When not to use it

Avoid embedding untrusted output as executable HTML.

## toast

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-toast) define required parts, labels and attributes. Load `future-css/components/toast` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind the pre-existing polite/assertive region; pause timeouts during focus and restore focus on dismissal.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Render the same message inline; a timed transient toast requires the binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid essential instructions that disappear on a timer.

## tool-call

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-tool) define required parts, labels and attributes. Load `future-css/components/tool-call` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Name the tool and state; use native disclosure; full truncated payload remains reachable.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Static arguments/results and native disclosure work. WASM is optional and has a JS fallback.

### When not to use it

Avoid treating tool-supplied text as trusted HTML.

## toolbar

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-toolbar) define required parts, labels and attributes. Load `future-css/components/toolbar` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind toolbar for roving tabindex; arrows/Home/End follow orientation and RTL, disabled controls are skipped; group has a name.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

Controls retain native behavior; restore ordinary tab stops if the binding is absent. WASM is optional and has a JS fallback.

### When not to use it

Avoid role=toolbar without the keyboard binding.

## webview

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-webview) define required parts, labels and attributes. Load `future-css/components/webview` with the token foundation.

### States

Rest, hover, active, focus-visible, disabled and application states use the [shared state matrix](COMPONENTS.md#the-state-matrix) where applicable. The fixture shows the component-specific states; use ARIA or `data-fc-state` as the source of truth.

### Accessibility

Bind chrome; named navigation/address controls; host owns loading and iframe title/sandbox.

### Internationalization

Logical spacing follows `dir`. Keep full localized labels and values reachable; isolate external names with `<bdi>`. Verify this fixture at 320px in both directions before adapting its markup. Native controls follow browser direction; directional indicators are covered by the component CSS/binding.

### No-JS fallback

A titled iframe or destination link remains usable; simulated navigation needs host/binding. WASM is optional and has a JS fallback.

### When not to use it

Avoid a security boundary; chrome does not make remote content safe.

## theme-picker

### Anatomy

The [complete markup and state examples](../demo/fixtures.html#fx-theme-picker) use a fieldset/legend with native theme radios, independently labelled palette/scheme/contrast selects, a TOML file input and a polite status. Load `future-css/components/theme-picker` and `future-css/themes`.

Each option renders a window scoped to its own stock or custom design and palette.
The explicit Custom option opens native parameter controls and, with a supplied
contrast contract, light/dark semantic color editors. Invalid colors leave the
last valid draft intact. Export uses the installation TOML schema and versions.

### States

Radio checked/unchecked, hover, active, focus-visible, disabled/aria-disabled; asynchronous imports expose pending/complete/error in `data-fc-state` and `aria-busy`. Invalid themes leave the current theme intact and report a visible error.

### Accessibility

Native radio arrows/Space, select keyboard controls and file chooser work without a custom focus model. Focus rings, minimum targets and contrast remain enforced. High contrast and forced colors override palette decoration; no transition is introduced for theme changes.

### Internationalization

Logical spacing and wrapping work in RTL and narrow viewports; system/serif stacks retain multilingual fallbacks. Descriptions are plain text, never interpreted markup. Hosts can translate the stock control strings for their locale.

### No-JS fallback

Static `data-fc-design` / `data-fc-palette` / `data-fc-theme` attributes apply a stock theme with CSS alone. A static radio group needs host binding to apply changes; retain the initial design if scripting is unavailable.

### When not to use it

Do not claim a custom theme is certified accessible solely because its palette passes contrast. Application content, third-party overrides and manual screen-reader/translation behavior still need review. Imported TOML cannot supply arbitrary CSS, fonts, assets or scripts.

## multiselect

### Anatomy

A native details summary reveals named checkboxes, optional search, select-visible and clear actions. Selected values remain successful native form controls even when filtered. See [fixtures](../demo/fixtures.html#fx-multiselect).

### States

Rest, hover, active, focus-visible, selected and disabled states are expressed through native properties and ARIA. Invalid text fields inherit the field component's error styling.

### Accessibility

Use visible labels, native controls and a fieldset/legend for related choices. Controls retain focus rings and OS colors. Do not nest buttons inside choice labels.

### Internationalization

Labels wrap and logical spacing follows direction. Native checkbox/radio keyboard handling follows the platform.

### No-JS fallback

Native disclosure and form controls remain operable and submit their values. Filtering and automatic selection summaries require the optional multiselect binding.

### When not to use it

Use a native select for short single-choice lists; use the grid for large editable datasets.

## form-variants

### Anatomy

Native fields use soft or underlined treatments; an inline field pairs label and control responsively. Choice cards wrap a real checkbox or radio with supporting text. See [fixtures](../demo/fixtures.html#fx-form-variants).

### States

Rest, hover, active, focus-visible, selected and disabled states are expressed through native properties and ARIA. Invalid text fields inherit the field component's error styling.

### Accessibility

Use visible labels, native controls and a fieldset/legend for related choices. Controls retain focus rings and OS colors. Do not nest buttons inside choice labels.

### Internationalization

Labels wrap and logical spacing follows direction. Native checkbox/radio keyboard handling follows the platform.

### No-JS fallback

These are CSS presentations of native inputs, textareas, selects and checkbox/radio choice cards, so every control types, validates and submits its value with no script. No binding or WASM is involved.

### When not to use it

Use a native select for short single-choice lists; use the grid for large editable datasets.

## metric

### Anatomy

See [markup and lifecycle examples](../demo/fixtures.html#fx-metric). The root groups a title, content, optional metadata and actions. Load `metric.css` plus button, field/check, code/disclosure or loading CSS for the parts used.

### States

All eight data-fc-state values have fixtures. Pending/queued/running/streaming use an accent edge; error/denied use the danger boundary; complete uses double and aborted dashed borders. Visible status text is required. Long-content and empty fixtures exercise expanded arguments, destinations, labels and unavailable values. Controls inherit hover, active, focus-visible, disabled and aria-disabled from their component.

### Accessibility

Use a named section or native form; associate every field with a label and groups with legends. Keep status announcements in a separate polite region, updated at phase boundaries, never per byte or second. Native progress needs a name and no value for unknown totals. Do not autofocus background updates. Actions require application handlers; fixtures label unavailable actions explicitly.

### Internationalization

Logical properties, wrapping text and tabular numbers; isolate paths and codes. Format totals and dates with Intl. No text is clipped. Codes remain in text, never attributes.

### No-JS fallback

Readable server-rendered content and native controls. Forms may submit to an application endpoint. CSS does not execute approvals, poll authorization, transfer files or copy secrets. No motion is introduced; forced colors preserves boundaries and text.

### When not to use it

Do not use a lifecycle panel for ordinary navigation or imply that a CSS state authorizes an operation. Runtime permissions remain the application's responsibility.

## transfer

### Anatomy

See [markup and lifecycle examples](../demo/fixtures.html#fx-transfer). The root groups a title, content, optional metadata and actions. Load `transfer.css` plus button, field/check, code/disclosure or loading CSS for the parts used.

### States

All eight data-fc-state values have fixtures. Pending/queued/running/streaming use an accent edge; error/denied use the danger boundary; complete uses double and aborted dashed borders. Visible status text is required. Long-content and empty fixtures exercise expanded arguments, destinations, labels and unavailable values. Controls inherit hover, active, focus-visible, disabled and aria-disabled from their component.

### Accessibility

Use a named section or native form; associate every field with a label and groups with legends. Keep status announcements in a separate polite region, updated at phase boundaries, never per byte or second. Native progress needs a name and no value for unknown totals. Do not autofocus background updates. Actions require application handlers; fixtures label unavailable actions explicitly.

### Internationalization

Logical properties, wrapping text and tabular numbers; isolate paths and codes. Format totals and dates with Intl. No text is clipped. Codes remain in text, never attributes.

### No-JS fallback

Readable server-rendered content and native controls. Forms may submit to an application endpoint. CSS does not execute approvals, poll authorization, transfer files or copy secrets. No motion is introduced; forced colors preserves boundaries and text.

### When not to use it

Do not use a lifecycle panel for ordinary navigation or imply that a CSS state authorizes an operation. Runtime permissions remain the application's responsibility.

## approval

### Anatomy

See [markup and lifecycle examples](../demo/fixtures.html#fx-approval). The root groups a title, content, optional metadata and actions. Load `approval.css` plus button, field/check, code/disclosure or loading CSS for the parts used.

### States

All eight data-fc-state values have fixtures. Pending/queued/running/streaming use an accent edge; error/denied use the danger boundary; complete uses double and aborted dashed borders. Visible status text is required. Long-content and empty fixtures exercise expanded arguments, destinations, labels and unavailable values. Controls inherit hover, active, focus-visible, disabled and aria-disabled from their component.

### Accessibility

Use a named section or native form; associate every field with a label and groups with legends. Keep status announcements in a separate polite region, updated at phase boundaries, never per byte or second. Native progress needs a name and no value for unknown totals. Do not autofocus background updates. Actions require application handlers; fixtures label unavailable actions explicitly.

### Internationalization

Logical properties, wrapping text and tabular numbers; isolate paths and codes. Format totals and dates with Intl. No text is clipped. Codes remain in text, never attributes.

### No-JS fallback

Readable server-rendered content and native controls. Forms may submit to an application endpoint. CSS does not execute approvals, poll authorization, transfer files or copy secrets. No motion is introduced; forced colors preserves boundaries and text.

### When not to use it

Do not use a lifecycle panel for ordinary navigation or imply that a CSS state authorizes an operation. Runtime permissions remain the application's responsibility.

## user-prompt

### Anatomy

See [markup and lifecycle examples](../demo/fixtures.html#fx-user-prompt). The root groups a title, content, optional metadata and actions. Load `user-prompt.css` plus button, field/check, code/disclosure or loading CSS for the parts used.

### States

All eight data-fc-state values have fixtures. Pending/queued/running/streaming use an accent edge; error/denied use the danger boundary; complete uses double and aborted dashed borders. Visible status text is required. Long-content and empty fixtures exercise expanded arguments, destinations, labels and unavailable values. Controls inherit hover, active, focus-visible, disabled and aria-disabled from their component.

### Accessibility

Use a named section or native form; associate every field with a label and groups with legends. Keep status announcements in a separate polite region, updated at phase boundaries, never per byte or second. Native progress needs a name and no value for unknown totals. Do not autofocus background updates. Actions require application handlers; fixtures label unavailable actions explicitly.

### Internationalization

Logical properties, wrapping text and tabular numbers; isolate paths and codes. Format totals and dates with Intl. No text is clipped. Codes remain in text, never attributes.

### No-JS fallback

Readable server-rendered content and native controls. Forms may submit to an application endpoint. CSS does not execute approvals, poll authorization, transfer files or copy secrets. No motion is introduced; forced colors preserves boundaries and text.

### When not to use it

Do not use a lifecycle panel for ordinary navigation or imply that a CSS state authorizes an operation. Runtime permissions remain the application's responsibility.

## device-auth

### Anatomy

See [markup and lifecycle examples](../demo/fixtures.html#fx-device-auth). The root groups a title, content, optional metadata and actions. Load `device-auth.css` plus button, field/check, code/disclosure or loading CSS for the parts used.

### States

All eight data-fc-state values have fixtures. Pending/queued/running/streaming use an accent edge; error/denied use the danger boundary; complete uses double and aborted dashed borders. Visible status text is required. Long-content and empty fixtures exercise expanded arguments, destinations, labels and unavailable values. Controls inherit hover, active, focus-visible, disabled and aria-disabled from their component.

### Accessibility

Use a named section or native form; associate every field with a label and groups with legends. Keep status announcements in a separate polite region, updated at phase boundaries, never per byte or second. Native progress needs a name and no value for unknown totals. Do not autofocus background updates. Actions require application handlers; fixtures label unavailable actions explicitly.

### Internationalization

Logical properties, wrapping text and tabular numbers; isolate paths and codes. Format totals and dates with Intl. No text is clipped. Codes remain in text, never attributes.

### No-JS fallback

Readable server-rendered content and native controls. Forms may submit to an application endpoint. CSS does not execute approvals, poll authorization, transfer files or copy secrets. No motion is introduced; forced colors preserves boundaries and text.

### When not to use it

Do not use a lifecycle panel for ordinary navigation or imply that a CSS state authorizes an operation. Runtime permissions remain the application's responsibility.
