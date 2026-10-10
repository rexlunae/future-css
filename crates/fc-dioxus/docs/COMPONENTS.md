# fc-dioxus component API

The planned Rust API for every future-css component, with every option the CSS defines.
Signatures are the design target, written against Dioxus 0.7. Phase 0 of
[PLAN.md](PLAN.md) confirms them against the real API before the first component lands;
where Dioxus forces a change, this file changes in the same commit.

Conventions that apply to every entry, stated once here so they are not repeated:

- Every component also takes `attributes: Vec<Attribute>` (`extends = GlobalAttributes`,
  plus the native element's attributes for single-element components) and an optional
  `class: Option<String>` appended after the component's own classes.
- Every enum is declared with `fc_modifier!` and its `#[default]` variant is the bare
  block (no modifier class).
- `availability: Availability` is the shared enabled / disabled / unavailable-with-reason
  type; `busy: bool` renders `aria-busy` and the spinner while keeping the label.
- `children: Element` is omitted from the listings unless the component has none.
- Controlled state uses `value` / `default_value` / `onchange` or `open` / `default_open` /
  `onopenchange` through `use_controllable`.
- Components with dynamic data take `id: Option<String>`, `seq: Option<u64>`, and
  `ts: Option<Timestamp>` for the `data-fc-*` contract, shown below as `..FcIds`.

Shared types (`Availability`, `Lifecycle`, `MessageRole`, `Tone`, `Orientation`,
`HeadingLevel`, `AccessibleName`, `Alt`, `Clipped`, `Id`) are defined in
[DESIGN.md](DESIGN.md#the-shared-building-blocks).

---

## Coverage index

| CSS file | Module | Components |
| --- | --- | --- |
| `layout.css` | `layout` | `Stack`, `Cluster`, `Center`, `Container`, `Sidebar`, `SidebarMain`, `GridAuto`, `ScrollX`, `Truncate`, `Clamp` |
| `type.css` | `typography` | `Text`, `Heading` |
| `utilities.css` | `utilities` | `VisuallyHidden`, `Bdi`, `Utility` enum for the rest |
| `button.css` | `button` | `Button`, `IconButton`, `LinkButton` |
| `button-group.css` | `button_group` | `ButtonGroup`, `ButtonGroupItem` |
| `segmented.css` | `segmented` | `Segmented`, `SegmentedItem` |
| `split-button.css` | `split_button` | `SplitButton` |
| `fab.css` | `fab` | `Fab`, `FabMenu`, `FabMenuItem` |
| `control-group.css` | `control_group` | `ControlGroup`, `ControlGroupLabel` |
| `toolbar.css` | `toolbar` | `Toolbar`, `ToolbarItem`, `ToolbarDivider`, `ToolbarLabel` |
| `field.css` | `field` | `Field`, `Input`, `Textarea`, `InputGroup`, `InputAddon`, `ErrorSummary` |
| `check.css` | `check` | `Checkbox`, `Radio`, `CheckGroup`, `Switch`, `SwitchRow` |
| `select.css` | `select` | `Select`, `SelectOption`, `SelectGroup` |
| `slider.css` | `slider` | `Slider` |
| `search.css` | `search` | `Search`, `SearchView` |
| `datepicker.css` | `datepicker` | `DatePicker`, `TimePicker` |
| `card.css` | `card` | `Card`, `CardHeader`, `CardTitle`, `CardSubtitle`, `CardMedia`, `CardBody`, `CardFooter`, `CardLink` |
| `list.css` | `list` | `List`, `ListItem` |
| `divider.css` | `divider` | `Divider` |
| `description-list.css` | `description_list` | `DescriptionList`, `DescriptionItem` |
| `disclosure.css` | `disclosure` | `Disclosure` |
| `dialog.css` | `dialog` | `Dialog`, `DialogFooter`, `Sheet`, `BottomSheet` |
| `popover.css` | `popover` | `Popover`, `Tooltip` |
| `carousel.css` | `carousel` | `Carousel`, `CarouselItem` |
| `empty-state.css` | `empty_state` | `EmptyState` |
| `masthead.css` | `masthead` | `Masthead`, `MastheadLink` |
| `nav.css` | `nav` | `Nav`, `NavGroup`, `NavLink`, `NavList` |
| `navbar.css` | `navbar` | `NavBar`, `NavBarItem` |
| `tabs.css` | `tabs` | `Tabs`, `Tab`, `TabPanel` |
| `breadcrumb.css` | `breadcrumb` | `Breadcrumb`, `Crumb` |
| `pagination.css` | `pagination` | `Pagination` |
| `menu.css` | `menu` | `Menu`, `MenuItem`, `MenuCheckItem`, `MenuGroup`, `MenuSeparator`, `SubMenu`, `ContextMenu`, `MenuButton` |
| `alert.css` | `alert` | `Alert` |
| `toast.css` | `toast` | `Toaster`, `use_toaster()` |
| `badge.css` | `badge` | `Badge`, `Tag`, `Kbd` |
| `avatar.css` | `avatar` | `Avatar`, `AvatarGroup` |
| `spinner.css` | `spinner` | `Spinner`, `ShimmerText` |
| `loading.css` | `loading` | `Progress`, `ProgressRing`, `Skeleton` |
| `table.css` | `table` | `Table`, `TableColumn`, `SortHeader` |
| `grid.css` | `grid` | `DataGrid` |
| `code.css` | `code` | `CodeBlock` |
| `diff.css` | `diff` | `DiffView` |
| `terminal.css` | `terminal` | `Terminal` |
| `git.css` | `git` | `GitSurface` |
| `editor.css` | `editor` | `Editor`, `Prose` |
| `webview.css` | `webview` | `Webview` |
| `chat.css` | `chat` | `Chat`, `MessageGroup`, `Message`, `MessagePart`, `StreamingText`, `MessageActions`, `MessageAction` |
| `composer.css` | `composer` | `Composer` |
| `context-strip.css` | `context_strip` | `ContextStrip` |
| `agent-status.css` | `agent_status` | `AgentStatus` |
| `reasoning.css` | `reasoning` | `Reasoning` |
| `citation.css` | `citation` | `Cite`, `Sources`, `Source` |
| `suggestion.css` | `suggestion` | `Suggestions`, `Suggestion` |
| `tool-call.css` | `tool_call` | `ToolCall` |
| splitter CSS (PR #41, not yet merged) | `splitter` | `Split`, `SplitPane`, `Splitter`, `Resizable` (see [Splitter](#splitter-pending-pr-41)) |
| `metric.css`, `transfer.css`, `approval.css`, `user-prompt.css`, `device-auth.css` | `lifecycle_panel` | `Metric`, `Transfer`, `Approval`, `UserPrompt`, `DeviceAuth` (one shared implementation, below) |

---

## Foundation

### `FutureCss` and theming

Specified in [DESIGN.md](DESIGN.md#theme). `Theme`: `System`, `Light`, `Dark`,
`HighContrastLight`, `HighContrastDark`. `Brand`: `Forest` (the CSS library's brand theme
set; new brands are added there first). `Direction`: `Ltr`, `Rtl`.

### Layout (`layout.css`)

```rust
fc_modifier! { pub enum Space for "…" { #[default] Default => None, S0 => "0", S1 => "1",
    S2 => "2", S3 => "3", S4 => "4", S6 => "6", S8 => "8" } }
```

Each primitive declares only the steps its CSS defines (the macro makes that one line
each), so `Stack` offers `0, 1, 2, 3, 4, 6, 8` and `Cluster` `0, 1, 2, 3, 4, 6`.

| Component | Props |
| --- | --- |
| `Stack` | `gap: StackGap`, `inline: bool` (`--inline`), `as_: Tag` (default `div`) |
| `Cluster` | `gap: ClusterGap`, `justify: ClusterJustify` (`Start`, `Center`, `End`, `Between`), `align: ClusterAlign` (`Center` default, `Top`, `Stretch`) |
| `Center` | none |
| `Container` | `width: ContainerWidth` (`Default`, `Narrow`, `Wide`) |
| `Sidebar` / `SidebarMain` | `side: Element` and main `children`; collapse is the CSS's intrinsic wrap, no prop |
| `GridAuto` | `gap: GridAutoGap` (`0, 2, 4, 6`), `dense: bool`, `wide: bool` |
| `ScrollX` | `hide_scrollbar: bool` (`--hide`), required `label: AccessibleName` because a scroll region must be focusable and named (2.1.1) |
| `Truncate` | `text: Clipped` (single line) |
| `Clamp` | `text: Clipped`, `lines: ClampLines` (`Two`, `Three`) |

`Tag` is a small enum of the elements a layout primitive may render (`Div`, `Section`,
`Ul`, `Ol`, `Nav`, `Header`, `Footer`, `Main`, `Aside`, `Article`), so semantics stay with
the author without a stringly typed tag.

`GridAuto` renders `.fc-grid-auto`; `.fc-grid` belongs to the data grid, `DataGrid`. The
layout primitive was renamed to `-auto` after the two sharing `.fc-grid` broke the data
grid's columns, the bug the root AGENTS.md records.

### Typography (`type.css`)

```rust
pub enum TypeRole { Body, BodySmall, Title, Label, Code, Heading1, Heading2, Heading3,
    Heading4, Heading5, Heading6 }

#[component] fn Text(role: TypeRole, #[props(default)] as_: TextTag, children: Element) -> Element;
#[component] fn Heading(level: HeadingLevel, #[props(default)] role: Option<TypeRole>,
    children: Element) -> Element;
```

`Heading` always renders a real `h1` to `h6`; `role` changes appearance only, matching the
CSS doc's rule that a type class never changes meaning.

### Utilities (`utilities.css`)

`VisuallyHidden` (component, `.fc-u-visually-hidden`), `Bdi` (renders `<bdi>`, the
preferred isolation; `.fc-u-bidi` via `Bdi { span: true }`), and a `Utility` enum for
the rest (`TextMuted`, `TextAccent`, `TextDanger`, `TextDefault`, `TextStart`,
`TextCenter`, `TextEnd`, `Tabular`, `Prewrap`, `BgCanvas`, `BgSubtle`, `BgSurface`,
`ShadowRaised`, `FullBleed`, `ScrollSmooth`, `Hidden`, `M0`, `Mt4`, `Mb4`, `P0`, `P2`,
`P4`, `P6`, `Px4`, `Py2`) that any component accepts through `utilities: Vec<Utility>`.
Utilities are an escape hatch; the enum keeps them typo-proof without making them a
styling API.

---

## Actions

### Button (`button.css`)

```rust
fc_modifier! { pub enum ButtonVariant for "fc-btn" { #[default] Neutral => None,
    Primary => "primary", Secondary => "secondary", Ghost => "ghost",
    Subtle => "subtle", Danger => "danger" } }
fc_modifier! { pub enum ButtonSize for "fc-btn" { #[default] Md => None, Sm => "sm", Lg => "lg" } }

#[derive(Props, Clone, PartialEq)]
pub struct ButtonProps {
    #[props(default)] pub variant: ButtonVariant,
    #[props(default)] pub size: ButtonSize,
    /// Full width (`--block`). Layout, not a variant.
    #[props(default)] pub block: bool,
    #[props(default)] pub availability: Availability,
    /// `aria-busy` plus `.fc-btn__spinner`; the label stays.
    #[props(default)] pub busy: bool,
    /// Toggle buttons: renders `aria-pressed`.
    #[props(default)] pub pressed: Option<bool>,
    #[props(default)] pub r#type: ButtonType,       // Button (default), Submit, Reset
    #[props(optional)] pub onclick: Option<EventHandler<MouseEvent>>,
    #[props(extends = GlobalAttributes, extends = button)] pub attributes: Vec<Attribute>,
    pub children: Element,
}
```

- `IconButton`: same props minus `children`, plus required `label: AccessibleName` and
  `icon: Element` (rendered `aria-hidden`). Adds `--icon`.
- `LinkButton`: renders `<a href>` with button classes, for navigation that looks like an
  action. `availability` renders `aria-disabled` and drops `href`, as the masthead doc
  prescribes for disabled links.
- `ButtonType::Button` is the default, unlike HTML's `submit`, because an accidental form
  submit is the common bug; `Submit` is explicit.

### Connected button group (`button-group.css`)

```rust
#[component] fn ButtonGroup(label: AccessibleName, #[props(default)] selection: GroupSelection,
    value: Option<ReadSignal<Vec<String>>>, #[props(default)] default_value: Vec<String>,
    onchange: Option<EventHandler<Vec<String>>>, children: Element) -> Element;
#[component] fn ButtonGroupItem(value: String, #[props(default)] availability: Availability,
    children: Element) -> Element;

pub enum GroupSelection { #[default] None, Single, Multiple }
```

`None` is a plain action group; `Single` and `Multiple` render `aria-pressed` on items.
Roving focus via `behavior::roving`.

### Segmented button (`segmented.css`)

```rust
#[component] fn Segmented<T: SegmentValue>(legend: AccessibleName,
    #[props(default)] legend_hidden: bool,           // visually hidden legend, as the fixture
    mode: SegmentMode,                               // Single (radio) or Multiple (checkbox)
    value: Option<ReadSignal<Selection<T>>>, default_value: Selection<T>,
    onchange: Option<EventHandler<Selection<T>>>,
    #[props(default)] invalid: bool, #[props(default)] required: bool,
    children: Element) -> Element;
#[component] fn SegmentedItem<T: SegmentValue>(value: T, #[props(default)] disabled: bool,
    children: Element) -> Element;
```

Renders `fieldset` with native radios or checkboxes, so arrow keys are the platform's and
need no roving code. `SegmentValue: Clone + PartialEq + ToString + 'static`.

### Split button (`split-button.css`)

```rust
#[component] fn SplitButton(label: AccessibleName,            // group name
    action: Element, onaction: EventHandler<MouseEvent>,
    toggle_label: AccessibleName,                             // "More send options"
    menu: Element,                                            // MenuItem children
    #[props(default)] variant: ButtonVariant, #[props(default)] size: ButtonSize,
    #[props(default)] availability: Availability, #[props(default)] busy: bool,
    open: Option<ReadSignal<bool>>, onopenchange: Option<EventHandler<bool>>) -> Element;
```

`busy` sets the action busy and the toggle `aria-disabled`, as the fixture does. The menu
is a `Menu` (below), so its keyboard contract is the menu's.

### Floating action button (`fab.css`)

```rust
fc_modifier! { pub enum FabVariant for "fc-fab" { #[default] Default => None,
    Primary => "primary", Surface => "surface" } }
fc_modifier! { pub enum FabSize for "fc-fab" { #[default] Md => None, Sm => "sm", Lg => "lg" } }

#[component] fn Fab(icon: Element, label: AccessibleName,
    /// Extended FABs show the label; icon-only FABs use it as aria-label.
    #[props(default)] extended: bool,
    #[props(default)] variant: FabVariant, #[props(default)] size: FabSize,
    #[props(default)] lowered: bool, #[props(default)] fixed: bool,
    #[props(default)] availability: Availability, #[props(default)] busy: bool,
    onclick: Option<EventHandler<MouseEvent>>) -> Element;

#[component] fn FabMenu(trigger_label: AccessibleName, icon: Element,
    #[props(default)] variant: FabVariant, children: Element) -> Element;   // popover
#[component] fn FabMenuItem(#[props(default)] disabled: bool,
    onclick: EventHandler<MouseEvent>, children: Element) -> Element;
```

The label is required either way, so an extended FAB cannot lose its text and an icon FAB
cannot lose its name.

### Control group (`control-group.css`)

```rust
#[component] fn ControlGroup(label: AccessibleName, #[props(default)] plain: bool,
    #[props(default)] orientation: Orientation, children: Element) -> Element;
#[component] fn ControlGroupLabel(children: Element) -> Element;
```

Renders `role="group"` with `aria-label`. Children that are `Button`s get
`.fc-control-group__item` through context, not through a prop the author must remember.
For related form fields use `CheckGroup` or `Field` inside a `fieldset`, as the CSS doc
says. No roving focus: each child keeps its own tab stop by design.

### Toolbar (`toolbar.css`)

```rust
fc_modifier! { pub enum ToolbarPlacement for "fc-toolbar" { #[default] Inline => None,
    Docked => "docked", Floating => "floating" } }

#[component] fn Toolbar(label: AccessibleName, #[props(default)] orientation: Orientation,
    #[props(default)] placement: ToolbarPlacement, children: Element) -> Element;
#[component] fn ToolbarItem(#[props(default)] icon_only: Option<AccessibleName>,
    #[props(default)] pressed: Option<bool>, #[props(default)] availability: Availability,
    onclick: Option<EventHandler<MouseEvent>>, children: Element) -> Element;
#[component] fn ToolbarDivider() -> Element;
#[component] fn ToolbarLabel(children: Element) -> Element;
```

One tab stop with roving arrows (`behavior::roving`), per the toolbar pattern the
`toolbar.ts` binding implements.

---

## Forms

### Field, input, input group, error summary (`field.css`)

```rust
fc_modifier! { pub enum InputSize for "fc-input" { #[default] Md => None, Sm => "sm", Lg => "lg" } }

#[component] fn Field(label: Element, /// the visible label; required
    #[props(default)] hint: Option<Element>,
    #[props(default)] error: Option<Element>,          // renders __error, aria-invalid, describedby
    #[props(default)] necessity: Necessity,            // Default, Required, Optional
    children: Element) -> Element;                     // one control; reads FieldContext

pub enum Necessity { #[default] Unmarked, Required, Optional }

#[component] fn Input(#[props(default)] r#type: InputType, #[props(default)] size: InputSize,
    #[props(default)] filled: bool, #[props(default)] autosize: bool,
    value: Option<ReadSignal<String>>, #[props(default)] default_value: String,
    oninput: Option<EventHandler<String>>, onchange: Option<EventHandler<String>>,
    #[props(default)] autocomplete: Option<Autocomplete>,
    #[props(default)] availability: Availability, #[props(default)] readonly: bool,
    #[props(extends = GlobalAttributes, extends = input)] attributes: Vec<Attribute>) -> Element;
#[component] fn Textarea(/* same as Input, minus type; plus rows */) -> Element;

#[component] fn InputGroup(children: Element) -> Element;
#[component] fn InputAddon(children: Element) -> Element;   // __addon; control gets __control

#[component] fn ErrorSummary(title: Element, errors: Vec<FieldError>) -> Element;
pub struct FieldError { pub field: Id, pub message: String }
```

- `Field` provides a context with the control's id, hint id, and error id; `Input`,
  `Textarea`, `Select`, `Slider`, and the check family read it and wire `id`, `aria-
  describedby`, and `aria-invalid`. Associating a label is therefore not something the
  author does, and so not something the author can forget.
- `Autocomplete` is an enum of the HTML autofill tokens, because the CSS accessibility doc
  calls autofill an accessibility feature and a typo in a string silently disables it.
- `ErrorSummary` renders links to each field id and moves focus to itself when its error
  list becomes non-empty after a submit, the GOV.UK pattern the CSS follows.

### Checkbox, radio, switch (`check.css`)

```rust
fc_modifier! { pub enum SwitchSize for "fc-switch" { #[default] Md => None, Sm => "sm", Lg => "lg" } }

#[component] fn Checkbox(label: Element, #[props(default)] hint: Option<Element>,
    checked: Option<ReadSignal<CheckState>>, #[props(default)] default_checked: CheckState,
    onchange: Option<EventHandler<bool>>, #[props(default)] invalid: bool,
    #[props(default)] availability: Availability) -> Element;
pub enum CheckState { #[default] Off, On, Mixed }   // Mixed sets indeterminate via onmounted

#[component] fn Radio(label: Element, value: String, #[props(default)] hint: Option<Element>,
    #[props(default)] availability: Availability) -> Element;   // inside CheckGroup
#[component] fn CheckGroup(legend: Element, #[props(default)] inline: bool,
    #[props(default)] kind: CheckGroupKind,     // Checkboxes or Radios { name, value, onchange }
    #[props(default)] error: Option<Element>, children: Element) -> Element;

#[component] fn Switch(label: AccessibleName, #[props(default)] size: SwitchSize,
    checked: Option<ReadSignal<bool>>, #[props(default)] default_checked: bool,
    onchange: Option<EventHandler<bool>>, #[props(default)] invalid: bool,
    #[props(default)] availability: Availability) -> Element;
#[component] fn SwitchRow(label: Element, #[props(default)] hint: Option<Element>,
    #[props(default)] size: SwitchSize, /* checked/onchange as Switch */) -> Element;
```

`Switch` renders `<input type=checkbox role=switch>`, as the CSS does.

### Select (`select.css`)

```rust
#[component] fn Select(label: AccessibleName, #[props(default)] label_hidden: bool,
    options: ReadSignal<Vec<SelectItem>>,
    value: Option<ReadSignal<Option<String>>>, #[props(default)] default_value: Option<String>,
    onchange: Option<EventHandler<String>>, onopenchange: Option<EventHandler<bool>>,
    #[props(default)] placeholder: Option<String>,   // data-fc-placeholder
    #[props(default)] filterable: bool,
    #[props(default)] empty: Option<Element>,        // __empty when filtering finds nothing
    #[props(default)] size: InputSize,
    #[props(default)] invalid: bool, #[props(default)] availability: Availability) -> Element;

#[derive(Clone, PartialEq)]
pub struct SelectItem { pub value: String, pub label: String,
    pub group: Option<String>, pub disabled: bool }
```

- State is `fc_select::Select` directly: open, close with or without commit, move,
  Home/End, typeahead, and filter are its methods, so the Rust component and the WASM path
  of `select.ts` run the same code.
- Renders `button role=combobox` plus `role=listbox` with `aria-activedescendant`, as
  `select.ts` does. The full APG keyboard contract in the CSS doc is the browser test.
- Data-driven rather than compound, because the model needs the whole option list to
  filter and type ahead; `SelectOption`/`SelectGroup` exist only as builders for
  `SelectItem` lists in `rsx!`.

### Slider (`slider.css`)

```rust
#[component] fn Slider(label: AccessibleName, min: f64, max: f64, #[props(default = 1.0)] step: f64,
    value: Option<ReadSignal<f64>>, default_value: f64, onchange: Option<EventHandler<f64>>,
    #[props(default)] show_value: bool,                     // <output class=__value>
    #[props(default)] format: Option<Callback<f64, String>>, // value text, also aria-valuetext
    #[props(default)] marks: Vec<String>,                   // __marks, aria-hidden
    #[props(default)] invalid: bool, #[props(default)] availability: Availability) -> Element;
```

Writes `--fc-slider-pct` from the value, which is what `slider.ts` does in JavaScript.
Non-finite or out-of-range values clamp and report in debug builds.

### Search (`search.css`)

```rust
#[component] fn Search(label: AccessibleName, value: Option<ReadSignal<String>>,
    oninput: Option<EventHandler<String>>, onsubmit: Option<EventHandler<String>>,
    #[props(default)] icon: Option<Element>, #[props(default)] trailing: Option<Element>,
    /// The browser's own clear button is hidden when the app supplies one.
    #[props(default)] own_clear: bool,
    #[props(default)] view: Option<Element>,               // a SearchView
    #[props(default)] busy: bool, #[props(default)] invalid: bool,
    #[props(default)] availability: Availability, #[props(default)] form: bool) -> Element;

#[component] fn SearchView(label: AccessibleName, #[props(default)] heading: Option<Element>,
    #[props(default)] docked: bool, open: ReadSignal<bool>, #[props(default)] busy: bool,
    children: Element) -> Element;
```

`form: true` renders `<form role=search>`; otherwise a `div role=search`, matching both
fixture forms. `data-fc-open` mirrors `open`.

### Date and time pickers (`datepicker.css`)

```rust
#[component] fn DatePicker(label: AccessibleName,
    value: Option<ReadSignal<Option<Date>>>, default_value: Option<Date>,
    onchange: Option<EventHandler<Date>>,
    #[props(default)] min: Option<Date>, #[props(default)] max: Option<Date>,
    #[props(default)] locale: Option<Locale>, #[props(default)] first_day: Option<Weekday>,
    #[props(default)] today: Option<Date>,
    #[props(default)] is_disabled: Option<Callback<Date, bool>>,
    #[props(default)] labels: PickerLabels) -> Element;     // previous / next month names

#[component] fn TimePicker(label: AccessibleName, value: Option<ReadSignal<Time>>,
    onchange: Option<EventHandler<Time>>, #[props(default)] clock: Clock,   // H12, H24, Locale
    #[props(default)] step_minutes: u8, #[props(default)] availability: Availability) -> Element;
```

`Date` and `Time` are small validated value types in a new pure crate, `fc-calendar`,
which also holds the month grid, `add_months`, and locale first-day logic ported from
`datepicker.ts` with a parity test. Month and weekday names come from the platform
(`Intl` on web, an injected `Locale` table elsewhere) because shipping CLDR data is out of
proportion. Date ranges stay deferred, as in the CSS library's Phase D.

---

## Containers

### Card (`card.css`)

```rust
fc_modifier! { pub enum CardVariant for "fc-card" { #[default] Default => None,
    Elevated => "elevated", Subtle => "subtle" } }

#[component] fn Card(#[props(default)] variant: CardVariant,
    /// Shorthand for the common case; use the parts for anything else.
    #[props(default)] title: Option<String>, #[props(default)] heading: HeadingLevel,
    #[props(default)] as_: CardTag, children: Element) -> Element;  // Div, Article, Section, Li
#[component] fn CardHeader(children: Element) -> Element;
#[component] fn CardHeading(children: Element) -> Element;      // __heading wrapper
#[component] fn CardTitle(level: HeadingLevel, children: Element) -> Element;
#[component] fn CardSubtitle(children: Element) -> Element;
#[component] fn CardMedia(alt: Alt, src: String) -> Element;
#[component] fn CardBody(children: Element) -> Element;
#[component] fn CardLayout(children: Element) -> Element;       // __layout (media beside body)
#[component] fn CardFooter(#[props(default)] divided: bool, children: Element) -> Element;
#[component] fn CardLink(href: String, children: Element) -> Element;  // whole-card link
```

`CardLink` is the stretched-link pattern the CSS uses: one real link, so the card is one
tab stop with a meaningful name instead of a clickable `div`.

### List (`list.css`)

```rust
#[component] fn List(#[props(default)] divided: bool, #[props(default)] ordered: bool,
    #[props(default)] selection: ListSelection, children: Element) -> Element;
#[component] fn ListItem(headline: Element,
    #[props(default)] overline: Option<Element>, #[props(default)] supporting: Option<Element>,
    #[props(default)] leading: Option<Element>,           // aria-hidden by default
    #[props(default)] trailing: Option<Element>,
    #[props(default)] action: ListAction,                 // None, Link { href }, Button { onclick }, Label (wraps a control)
    #[props(default)] current: bool,                      // aria-current="page" on links
    #[props(default)] selected: bool,                     // aria-selected on buttons
    #[props(default)] availability: Availability) -> Element;
```

`ListAction::Label` renders the item as a `<label>` around a trailing `Switch` or
`Checkbox`, the settings-row pattern in the fixture.

### Divider (`divider.css`)

```rust
#[component] fn Divider(#[props(default)] orientation: Orientation,
    #[props(default)] inset: DividerInset) -> Element;   // None, Inset, Middle
```

Horizontal renders `<hr>`; vertical renders `role=separator aria-orientation=vertical`.

### Description list (`description-list.css`)

```rust
#[component] fn DescriptionList(#[props(default)] layout: DlLayout,  // Columns, Stacked
    #[props(default)] divided: bool, children: Element) -> Element;
#[component] fn DescriptionItem(term: Element, #[props(default)] numeric: bool,  // __num
    children: Element) -> Element;
```

### Disclosure (`disclosure.css`)

```rust
#[component] fn Disclosure(summary: Element, #[props(default)] boxed: bool,
    open: Option<ReadSignal<bool>>, #[props(default)] default_open: bool,
    onopenchange: Option<EventHandler<bool>>, children: Element) -> Element;
```

`<details>`/`<summary>`; works before hydration.

### Dialog and sheets (`dialog.css`)

```rust
fc_modifier! { pub enum DialogSize for "fc-dialog" { #[default] Md => None,
    Sm => "sm", Lg => "lg", Fullscreen => "fullscreen" } }

#[component] fn Dialog(title: Element, #[props(default)] title_level: HeadingLevel,
    #[props(default)] description: Option<Element>,
    open: ReadSignal<bool>, onopenchange: EventHandler<bool>,
    #[props(default = true)] modal: bool,                   // showModal(); false: show()
    #[props(default)] size: DialogSize,
    #[props(default)] close_label: Option<AccessibleName>,  // None hides the close button
    #[props(default)] footer: Option<Element>,
    #[props(default)] initial_focus: Option<Id>,
    children: Element) -> Element;

#[component] fn Sheet(/* Dialog props minus size */) -> Element;        // --sheet, inline end
#[component] fn BottomSheet(/* Dialog props minus size */,
    #[props(default = true)] handle: bool) -> Element;                   // --bottom, __handle
#[component] fn DialogFooter(children: Element) -> Element;
```

- Opening calls `showModal()` through `DomBridge`; Escape and the native `cancel` event
  route to `onopenchange(false)`; focus returns to the invoker on close.
- `role=alertdialog` is `Dialog { alert: true }`, which also makes `description` required
  at runtime (debug report), because an alert dialog without its message is just a box.

### Popover and tooltip (`popover.css`)

```rust
#[component] fn Popover(trigger: Element, title: Option<Element>,
    open: Option<ReadSignal<bool>>, onopenchange: Option<EventHandler<bool>>,
    #[props(default)] footer: Option<Element>, children: Element) -> Element;

#[component] fn Tooltip(text: String, #[props(default)] placement: TooltipPlacement,  // Above, Below
    children: Element) -> Element;   // exactly one focusable child
```

- `Popover` uses the `popover` attribute and `popovertarget`, so it works without script.
- `Tooltip` wires `aria-describedby` from the child to the bubble, dismisses on Escape and
  sets `data-fc-dismissed` (WCAG 1.4.13), and never carries the only copy of information:
  icon-only children still need their own `label`, so the tooltip is a description, not a
  name.

### Carousel (`carousel.css`)

```rust
fc_modifier! { pub enum CarouselLayout for "fc-carousel" { #[default] MultiBrowse => None,
    Hero => "hero", Free => "free" } }

#[component] fn Carousel(label: AccessibleName, #[props(default)] layout: CarouselLayout,
    #[props(default)] controls: Option<CarouselControls>,   // previous/next labels
    children: Element) -> Element;
#[component] fn CarouselItem(#[props(default)] caption: Option<Element>, children: Element) -> Element;
```

Items get `aria-roledescription="slide"` and an "n of m" label from context; the
previous/next buttons become `aria-disabled` at the ends, as `carousel.ts` does. No
autoplay prop: the CSS library ships none, and auto-advancing content needs a pause
control (2.2.2) that would be a new component.

### Empty state (`empty-state.css`)

```rust
#[component] fn EmptyState(title: Element, #[props(default)] heading: HeadingLevel,
    #[props(default)] icon: Option<Element>, #[props(default)] body: Option<Element>,
    #[props(default)] actions: Option<Element>, #[props(default)] compact: bool,
    #[props(default)] error: bool) -> Element;
```

`error: true` adds `--error` and `role=alert` only when the state was reached by a user
action (`announce: bool`, default false), so a page that loads empty does not shout.

---

## Navigation

### Masthead (`masthead.css`)

```rust
#[component] fn Masthead(brand: Element, brand_href: String,
    #[props(default)] mark: Option<Element>,
    nav_label: AccessibleName, #[props(default)] nav: Option<Element>,   // MastheadLinks
    #[props(default)] actions: Option<Element>,
    #[props(default)] banner: bool) -> Element;  // page-level <header> landmark vs nested
#[component] fn MastheadLink(href: String, #[props(default)] current: bool,
    #[props(default)] availability: Availability, children: Element) -> Element;
```

With the `router` feature, `MastheadLink`, `NavLink`, `NavBarItem`, `Crumb`, and list
links accept a `Route` and compute `current` from the router, so `aria-current` cannot
disagree with the URL.

### Navigation sidebar (`nav.css`)

```rust
#[component] fn Nav(label: AccessibleName, #[props(default)] header: Option<Element>,
    #[props(default)] title: Option<Element>, #[props(default)] footer: Option<Element>,
    #[props(default)] collapsible: bool, expanded: Option<ReadSignal<bool>>,
    ontoggle: Option<EventHandler<bool>>, #[props(default)] toggle_label: Option<AccessibleName>,
    children: Element) -> Element;
#[component] fn NavGroup(label: Element, #[props(default)] collapsible: bool,
    #[props(default)] default_open: bool, children: Element) -> Element;  // <details> when collapsible
#[component] fn NavList(#[props(default)] nested: bool, children: Element) -> Element;
#[component] fn NavLink(href: String, #[props(default)] icon: Option<Element>,
    #[props(default)] meta: Option<Element>, #[props(default)] current: NavCurrent,   // No, Page, Section
    #[props(default)] availability: Availability, children: Element) -> Element;
```

`NavCurrent::Page` renders `aria-current="page"`, `Section` renders `aria-current="true"`,
the two values the CSS styles.

### Navigation bar (`navbar.css`)

```rust
#[component] fn NavBar(label: AccessibleName, #[props(default)] fixed: bool, children: Element) -> Element;
#[component] fn NavBarItem(href: String, icon: Element, label: String,
    #[props(default)] badge: Option<NavBadge>,     // Dot or Count(u32), with a text alternative
    #[props(default)] current: bool, #[props(default)] availability: Availability) -> Element;
```

The label is visible text, not optional: Material's icon-only bottom bar is a recorded
divergence in the CSS library.

### Tabs (`tabs.css`)

```rust
#[component] fn Tabs(label: AccessibleName, #[props(default)] orientation: Orientation,
    #[props(default)] segmented: bool,                  // __list--segmented
    #[props(default)] activation: Activation,           // Automatic (default), Manual
    value: Option<ReadSignal<String>>, default_value: Option<String>,
    onchange: Option<EventHandler<String>>, children: Element) -> Element;
#[component] fn Tab(value: String, #[props(default)] count: Option<u32>,   // __count
    #[props(default)] availability: Availability, children: Element) -> Element;
#[component] fn TabPanel(value: String, children: Element) -> Element;
```

Tabs and panels are paired by `value` through context; ids, `aria-controls`, and
`aria-labelledby` are generated. Inactive panels render `hidden`, keeping their state.

### Breadcrumb (`breadcrumb.css`)

```rust
#[component] fn Breadcrumb(#[props(default)] label: Option<AccessibleName>,   // None: "Breadcrumb"
    children: Element) -> Element;
#[component] fn Crumb(#[props(default)] href: Option<String>, children: Element) -> Element;
```

The last `Crumb` (or the one without `href`) gets `aria-current="page"`.

### Pagination (`pagination.css`)

```rust
#[component] fn Pagination(label: AccessibleName, page: ReadSignal<u32>, pages: u32,
    href: Option<Callback<u32, String>>,            // links, for crawlable pages
    onchange: Option<EventHandler<u32>>,            // buttons, for in-app paging
    #[props(default = 1)] siblings: u32,            // pages shown either side before a gap
    #[props(default)] labels: PaginationLabels) -> Element;   // previous, next, page n
```

Gaps (`__gap`) are computed by one pure function, `behavior::pagination::window`, which is
unit-tested for every small `pages` value. Exactly one of `href` or `onchange` is used.

### Menu and context menu (`menu.css`)

```rust
#[component] fn Menu(label: AccessibleName, open: ReadSignal<bool>,
    onopenchange: EventHandler<bool>, #[props(default)] anchor: MenuAnchor,  // Invoker(Id) or Point { x, y }
    children: Element) -> Element;
#[component] fn MenuItem(onselect: EventHandler<()>, #[props(default)] danger: bool,
    #[props(default)] shortcut: Option<String>, #[props(default)] icon: Option<Element>,
    #[props(default)] availability: Availability, children: Element) -> Element;
#[component] fn MenuCheckItem(checked: bool, onchange: EventHandler<bool>,
    #[props(default)] radio: bool, children: Element) -> Element;   // menuitemcheckbox / menuitemradio
#[component] fn MenuGroup(label: Element, children: Element) -> Element;
#[component] fn MenuSeparator() -> Element;
#[component] fn SubMenu(label: Element, children: Element) -> Element;  // __submenu-arrow, data-fc-open

#[component] fn ContextMenu(target: Element, menu: Element) -> Element;  // right click, Shift+F10, Menu key
#[component] fn MenuButton(trigger: Element, menu: Element) -> Element;
```

Movement and typeahead come from `fc_context_menu::Menu`. Opening at a pointer position
flips at the viewport edge using the `MenuPoint` logic from `menu.ts`, ported as a pure
function with a parity test.

---

## Feedback

### Alert (`alert.css`)

```rust
#[component] fn Alert(tone: Tone, title: Option<Element>, #[props(default)] heading: HeadingLevel,
    #[props(default)] icon: AlertIcon,                  // Default (per tone), Custom(Element), None
    #[props(default)] banner: bool,
    #[props(default)] actions: Option<Element>,
    #[props(default)] dismiss: Option<Dismiss>,         // { label: AccessibleName, ondismiss }
    #[props(default)] urgency: Urgency,                 // Static (no role), Polite (status), Assertive (alert)
    children: Element) -> Element;
```

`Urgency` defaults to `Static`: an alert present at page load is content, and giving it
`role=alert` makes screen readers interrupt for something that did not just happen.
Every tone renders visible text, so the `color-alone` rule holds.

### Toast (`toast.css`)

```rust
#[component] fn Toaster(#[props(default)] position: ToasterPosition,   // Bottom, Top
    #[props(default = 3)] max: usize, #[props(default)] timeout: Duration,
    children: Element) -> Element;

pub fn use_toaster() -> ToasterHandle;
impl ToasterHandle {
    pub fn show(&self, toast: ToastSpec) -> ToastId;
    pub fn dismiss(&self, id: ToastId);
}
pub struct ToastSpec { pub title: Option<String>, pub body: Option<String>,
    pub tone: Option<Tone>, pub timeout: Timeout,          // Default, Never, After(Duration)
    pub action: Option<ToastAction>, pub id: Option<String> }
```

Queue policy is `behavior::toast_queue` (ported from `toast.ts`): danger toasts and toasts
with an action never auto-dismiss (2.2.1); timers pause on hover and focus; leaving toasts
render `data-fc-leaving`. Announcements go through `behavior::live`, one region per
toaster, polite except danger.

### Badge, tag, kbd (`badge.css`)

```rust
fc_modifier! { pub enum BadgeTone for "fc-badge" { #[default] Neutral => None,
    Accent => "accent", Info => "info", Success => "success",
    Warning => "warning", Danger => "danger",
    /// Filled accent: the one solid tone with a checked foreground pair.
    Solid => "solid" } }

#[component] fn Badge(#[props(default)] tone: BadgeTone, #[props(default)] outline: bool,
    #[props(default)] square: bool, #[props(default)] dot: bool,   // __dot, aria-hidden
    #[props(default)] count: Option<u64>,           // --count, tabular figures
    children: Element) -> Element;                  // __label

#[component] fn Tag(#[props(default)] pressed: Option<bool>,   // a toggle tag is a button
    #[props(default)] remove: Option<TagRemove>,              // { label: AccessibleName, onremove }
    #[props(default)] availability: Availability, children: Element) -> Element;

#[component] fn Kbd(keys: Vec<Key>) -> Element;   // one <kbd> per key, platform-aware names
```

`--solid` is a tone, not a fill, because the CSS defines it as the solid *accent*: making
it a `BadgeTone` variant means "solid danger", which has no checked contrast pair, cannot
be written.

A removable tag takes `TagRemove`, a struct whose `label` is not optional, so a remove
button without a name cannot be constructed.

### Avatar (`avatar.css`)

```rust
fc_modifier! { pub enum AvatarSize for "fc-avatar" { #[default] Md => None,
    Xs => "xs", Sm => "sm", Lg => "lg", Xl => "xl" } }

#[component] fn Avatar(name: String, #[props(default)] src: Option<String>,
    #[props(default)] alt: Option<Alt>,             // default: Alt::Text(name)
    #[props(default)] size: AvatarSize, #[props(default)] square: bool,
    #[props(default)] neutral: bool) -> Element;
#[component] fn AvatarGroup(label: AccessibleName, #[props(default)] max: Option<usize>,
    children: Element) -> Element;                  // overflow renders "+n" with a name
```

Initials are derived from `name` by a Unicode-aware function (first grapheme of the first
and last words), never by byte slicing.

### Spinner (`spinner.css`)

```rust
fc_modifier! { pub enum SpinnerKind for "fc-spinner" { #[default] Ring => None, Arc => "arc",
    Dots => "dots", Pulse => "pulse", Bars => "bars", Orbit => "orbit", Sparkle => "sparkle" } }
fc_modifier! { pub enum SpinnerSize for "fc-spinner" { #[default] Md => None,
    Xs => "xs", Sm => "sm", Lg => "lg", Xl => "xl" } }
fc_modifier! { pub enum SpinnerTone for "fc-spinner" { #[default] Accent => None,
    Muted => "muted", Current => "current" } }

#[component] fn Spinner(#[props(default)] kind: SpinnerKind, #[props(default)] size: SpinnerSize,
    #[props(default)] tone: SpinnerTone,
    label: SpinnerLabel) -> Element;     // Decorative (aria-hidden) or Status(AccessibleName)
#[component] fn ShimmerText(children: Element) -> Element;
```

`SpinnerLabel` has no default: a spinner is either decoration next to text that says what
is loading, or it is the status and must say so.

### Progress, progress ring, skeleton (`loading.css`)

```rust
#[component] fn Progress(label: AccessibleName, value: ProgressValue,   // Indeterminate, Of { value, max }
    #[props(default)] small: bool) -> Element;                           // native <progress>
fc_modifier! { pub enum RingSize for "fc-progress-ring" { #[default] Md => None, Sm => "sm", Lg => "lg" } }
#[component] fn ProgressRing(label: AccessibleName, percent: u8, #[props(default)] size: RingSize,
    #[props(default)] show_label: bool, #[props(default)] error: bool) -> Element;
fc_modifier! { pub enum SkeletonShape for "fc-skeleton" { #[default] Default => None,
    Text => "text", Block => "block", Circle => "circle" } }
#[component] fn Skeleton(#[props(default)] shape: SkeletonShape) -> Element;   // aria-hidden
#[component] fn Loading(label: AccessibleName, children: Element) -> Element;  // aria-busy region
```

Skeletons are always `aria-hidden`; the enclosing `Loading` carries `aria-busy` and the
name, as in the fixture. `percent` is clamped to 0..=100 by the type (`Percent` newtype).

---

## Data

### Table (`table.css`)

```rust
#[component] fn Table<R: Row>(caption: Element, #[props(default)] caption_hidden: bool,
    columns: Vec<TableColumn<R>>, rows: ReadSignal<Vec<R>>,
    #[props(default)] density: TableDensity,      // Default, Compact
    #[props(default)] striped: bool, #[props(default)] sticky_header: bool,
    #[props(default)] sort: SortMode<R>,          // None, Client, Manual { onsort }
    #[props(default)] selection: RowSelection,    // None, Single, Multiple (aria-selected)
    #[props(default)] busy: bool, #[props(default)] empty: Option<Element>,
    #[props(default)] scroll_label: Option<AccessibleName>) -> Element;  // fc-table-wrap

pub struct TableColumn<R> { pub header: String, pub cell: Callback<R, Element>,
    pub numeric: bool, pub sortable: Option<Callback<(R, R), Ordering>> }
pub trait Row: Clone + PartialEq + 'static { fn key(&self) -> String; }
```

Sorting state is a `(column, SortDirection)` pair; only that column renders `aria-sort`,
and the sort is announced politely ("Sorted by Name, ascending"), as `table.ts` does.
The comparator for `Client` mode is the parity-tested port in `behavior::sort`.

### Data grid (`grid.css`)

```rust
#[component] fn DataGrid(label: AccessibleName, model: Signal<GridModel>,
    columns: Vec<GridColumn>, #[props(default)] row_headers: bool,
    #[props(default)] readonly: bool,
    onactivecellchange: Option<EventHandler<CellRef>>,
    onselectionchange: Option<EventHandler<CellRange>>,
    oncelledit: Option<EventHandler<(CellRef, String)>>,
    #[props(default)] validate: Option<Callback<(CellRef, String), Result<(), String>>>) -> Element;
pub struct GridColumn { pub header: String, pub numeric: bool }
```

`GridModel` wraps `fc_grid::Grid`, `CellRange`, and `Viewport`, so range selection, fill
down, and the render window are the crate's. Cells render `aria-selected`,
`data-fc-active`, `data-fc-dirty`, `aria-invalid`, and `aria-readonly`; the editing cell
gets `__cell--editing` and `__input`. The render window is virtualized from `Viewport`.

### Code block (`code.css`)

```rust
#[component] fn CodeBlock(source: String, language: Option<String>,
    #[props(default)] numbered: bool, #[props(default)] scroll: bool,
    #[props(default)] label: Option<AccessibleName>,       // defaults to "<language> code"
    #[props(default)] toolbar: Option<Element>) -> Element; // __bar, e.g. a copy button
```

Tokens come from `fc-highlight` (the planned Rust port of `highlight.ts`, parity-tested),
rendered as `__tok--{role}` spans for every `SyntaxRole`. An unknown language renders
`--unsupported` with plain text rather than guessing.

### Diff viewer (`diff.css`)

```rust
#[component] fn DiffView(label: AccessibleName, before: ReadSignal<String>, after: ReadSignal<String>,
    #[props(default)] mode: DiffMode,         // Lines (computed), AddOnly (--add, new files)
    #[props(default)] scroll: bool, #[props(default)] stats: bool,
    #[props(default)] context: Option<usize>) -> Element;   // __gap for collapsed runs
```

`fc_diff::diff_lines` and `diff_stats` directly. Each line renders `data-fc-diff` and a
`__marker` with a text alternative ("added", "removed"), because colour is never the only
cue.

### Terminal (`terminal.css`)

```rust
#[component] fn Terminal(label: AccessibleName, output: ReadSignal<Vec<TermLine>>,
    #[props(default)] state: TermState,        // Running (default), Complete { exit: i32 }, Disconnected, Error
    #[props(default)] input: Option<TermInput>,  // prompt, value, onsubmit
    #[props(default)] cursor: CursorStyle) -> Element;   // None, Steady, Blink
```

ANSI SGR parsing (`fc-ansi`, a small pure module) turns raw output into runs with
`__bold`, `__dim`, `__italic`, `__underline`, `__strike`, `__inverse`, and the sixteen
`fc-term-ansi-*` colours. Colours are classes, never inline styles, so they stay themed
and contrast-checked. The output region is `role="log"` with `aria-live="polite"`, exactly as
the CSS doc's terminal markup, and never assertive, so a fast command does not flood the
screen reader. The `Terminal` component owns the batching, not the producer: it keeps a
count of lines already rendered and commits the newly appended tail of `output` at most
once per animation frame (`behavior::batch`, a frame-throttled view over any growing
signal, a `ReadSignal<Vec<_>>` here and a `ReadSignal<String>` in `StreamingText`). A producer may push one
line at a time; the polite region still announces chunks.

### Git surface (`git.css`)

```rust
#[component] fn GitSurface(branch: Option<String>, entries: ReadSignal<Vec<StatusEntry>>,
    #[props(default)] selected: Option<String>, onselect: Option<EventHandler<String>>,
    onstage: Option<EventHandler<String>>, #[props(default)] empty: Option<Element>) -> Element;
pub use fc_git::{Entry as StatusEntry, State as IndexState};
```

Counts, ordering, and per-file line stats are `fc_git::summarize_status`, `order_entries`,
and `diff_counts`. `branch: None` renders the no-commits state.

### Rich text editor (`editor.css`)

```rust
#[component] fn Editor(label: AccessibleName, value: ReadSignal<Document>,
    onchange: EventHandler<Document>, onselectionchange: Option<EventHandler<MarkSet>>,
    #[props(default)] state: EditorState,      // Idle, Saving, Error
    #[props(default)] readonly: bool, #[props(default)] toolbar: Option<Element>) -> Element;
#[component] fn Prose(children: Element) -> Element;   // .fc-prose for rendered rich text
```

The editor is the one component that cannot be built on the virtual DOM alone:
`contenteditable` content is mutated by the browser, and reconciling it with a virtual DOM
is the problem every editor framework exists to solve. The plan scopes it last (Phase 5):
the document model is `fc_rich_text::Block`, input arrives through `beforeinput` events,
and the editable region is rendered once and patched through `DomBridge`, never by
re-rendering. If that proves unworkable on desktop, the editor ships web-only and says so.

### Embedded browser (`webview.css`)

```rust
#[component] fn Webview(label: AccessibleName, url: ReadSignal<String>,
    onnavigate: EventHandler<String>, #[props(default)] tabs: Vec<WebviewTab>,
    #[props(default)] state: LoadState,        // Idle, Loading, Loaded, Error(String)
    #[props(default)] sandbox: Sandbox) -> Element;
```

`isSafeFrameUrl` from `webview.ts` is ported as `behavior::url::is_safe_frame_url` with a
parity test, and `url` is checked before it reaches `src`. An insecure origin renders
`data-fc-state="insecure"` and the `__secure` indicator in its warning form.
`Sandbox` is a set of allowed tokens with an empty default.

---

## Chat and agents

### Chat surface (`chat.css`)

```rust
#[component] fn Chat(label: AccessibleName, children: Element) -> Element;  // role=log
#[component] fn MessageGroup(role: MessageRole, children: Element) -> Element;
#[component] fn Message(role: MessageRole, #[props(default)] state: Option<Lifecycle>,
    #[props(default)] author: Option<Element>, #[props(default)] time: Option<Timestamp>,
    #[props(default)] meta: Option<Element>, #[props(default)] actions: Option<Element>,
    #[props(default)] truncated: Option<Clipped>, ..FcIds, children: Element) -> Element;
#[component] fn MessagePart(kind: PartKind, children: Element) -> Element;   // text, reasoning, tool, sources
/// Text that is still arriving. The producer appends to the signal per token; the
/// component renders through `behavior::batch`, so the DOM changes at most once a frame.
#[component] fn StreamingText(text: ReadSignal<String>, #[props(default)] markdown: bool) -> Element;
#[component] fn MessageActions(#[props(default)] persistent: bool, children: Element) -> Element;
#[component] fn MessageAction(label: AccessibleName, icon: Element,
    #[props(default)] pressed: Option<bool>, onclick: EventHandler<MouseEvent>,
    #[props(default)] availability: Availability) -> Element;
```

`Message` renders `data-fc-kind="message"`, `data-fc-role`, `data-fc-state`, `data-fc-id`,
`data-fc-seq`, and `data-fc-ts` through `FcData`. Streaming input is a
`ReadSignal<String>` passed to `StreamingText` inside a part, so the batching boundary is
that component: everything above it is static `Element` children. Streaming text is not
announced per token; `AgentStatus` announces phase changes.

### Chat composer (`composer.css`)

```rust
#[component] fn Composer(label: AccessibleName, value: Option<ReadSignal<String>>,
    onsubmit: EventHandler<Submission>, onstop: Option<EventHandler<()>>,
    #[props(default)] state: ComposerState,           // Idle, Running, Error(String)
    #[props(default)] contained: bool,
    #[props(default)] attachments: Option<AttachmentsConfig>,  // accept, max, onchange
    #[props(default)] tools: Option<Element>,          // ControlGroup, Select, ContextStrip
    #[props(default)] placeholder: Option<String>,
    #[props(default)] send_label: Option<AccessibleName>,
    #[props(default)] stop_label: Option<AccessibleName>) -> Element;

pub struct Submission { pub text: String, pub attachments: Vec<Attachment> }
pub struct Attachment { pub name: String, pub size: u64, pub mime: Option<String>,
    pub error: Option<String>, pub file: FileHandle }
```

The rules the CSS doc spells out become code paths with tests: Enter does not send during
IME composition (`compositionstart`/`end`); one control means Send or Stop by state and its
name changes with it; stopping is not sending; drag-over sets `data-fc-dragging`; focus
moves to a sensible neighbour when an attachment is removed. `FileHandle` keeps the
platform file (web `File`, desktop path) so the bytes stay reachable, the bug the
composer doc records.

### Context strip (`context-strip.css`)

```rust
#[component] fn ContextStrip(providers: ReadSignal<Vec<Provider>>,
    value: Option<ReadSignal<ContextState>>, onchange: EventHandler<ContextState>,
    #[props(default)] labels: ContextStripLabels) -> Element;

pub struct Provider { pub id: String, pub name: String, pub models: Vec<Model> }
pub struct Model { pub id: String, pub name: String, pub reasoning: bool,
    pub parameters: BTreeMap<String, String> }
pub enum Effort { Low, Medium, High }
pub struct ContextState { pub provider: String, pub model: String,
    pub effort: Option<Effort>, pub parameters: BTreeMap<String, String> }
```

The two group rules from the CSS doc live in one pure reducer,
`context_strip::resolve(state, change, &providers) -> ContextState`, with a parity test
against `context-strip.ts`: provider change re-resolves the model and remembers each
provider's last model; effort is `None`, and `data-fc-effort` absent, when the model has no
reasoning. The effort select dims with `data-fc-applicable="false"` and the notice explains
why, rather than disappearing.

### Agent status (`agent-status.css`)

```rust
#[component] fn AgentStatus(state: Lifecycle, label: String,
    #[props(default)] meta: Option<Element>, #[props(default)] spinner: Option<SpinnerKind>,
    #[props(default)] announce: bool) -> Element;
```

`announce` routes phase changes through `behavior::live` (polite, coalesced), so the status
row is the single place a run's progress is spoken.

### Reasoning trace (`reasoning.css`)

```rust
#[component] fn Reasoning(state: Lifecycle, #[props(default)] label: Option<String>,
    #[props(default)] summary: Option<Element>, #[props(default)] duration: Option<Duration>,
    open: Option<ReadSignal<bool>>, #[props(default)] default_open: bool,
    ..FcIds, children: Element) -> Element;
```

`<details data-fc-kind="reasoning">`; the body is never a live region.

### Citations and sources (`citation.css`)

```rust
#[component] fn Cite(index: u32, source: AccessibleName, target: Id) -> Element;
#[component] fn Sources(label: AccessibleName, children: Element) -> Element;
#[component] fn Source(id: Id, index: u32, title: String, href: String,
    #[props(default)] domain: Option<String>, #[props(default)] icon: Option<Element>) -> Element;
```

`Cite` renders `.fc-cite` linking to `#id`, named "Source n: title". The `idref` rule
checks that every `Cite` has a `Source`.

### Suggested prompts (`suggestion.css`)

```rust
#[component] fn Suggestions(label: AccessibleName, #[props(default)] layout: SuggestionLayout,  // List, Grid
    children: Element) -> Element;
#[component] fn Suggestion(prompt: String, #[props(default)] hint: Option<String>,
    #[props(default)] pill: bool, onselect: EventHandler<String>,
    #[props(default)] availability: Availability) -> Element;
```

The button's name is the prompt that will be sent, as the CSS doc requires.

### Tool call (`tool-call.css`)

```rust
#[component] fn ToolCall(name: String, state: ToolState,   // Running, Complete, Aborted, Denied, Error
    #[props(default)] label: Option<String>, #[props(default)] duration: Option<Duration>,
    #[props(default)] progress: Option<ProgressValue>,
    #[props(default)] payload: Option<Clipped>,
    #[props(default)] error: Option<String>, ..FcIds) -> Element;
```

`ToolState` is the subset of `Lifecycle` the CSS styles for tool calls, declared with
`From<ToolState> for Lifecycle` so the attribute stays a contract value. The visible state
text (`__state`) is rendered from the enum, so it can never disagree with
`data-fc-state`.

### Lifecycle panels (`metric.css`, `transfer.css`, `approval.css`, `user-prompt.css`, `device-auth.css`)

The five RustyClaw components share one anatomy and one state contract (see the root
[COMPONENT-CONTRACTS.md](../../../docs/COMPONENT-CONTRACTS.md)), so they share one
implementation:

```rust
pub trait PanelKind { const BEM: Bem; const KIND: &'static str; }

#[component] fn LifecyclePanel<K: PanelKind>(title: Element, #[props(default)] heading: HeadingLevel,
    state: Lifecycle, status_text: String,       // visible status text is required
    #[props(default)] meta: Option<Element>, #[props(default)] actions: Option<Element>,
    ..FcIds, children: Element) -> Element;

pub type Metric = LifecyclePanel<MetricKind>;       // plus __value
pub type Transfer = LifecyclePanel<TransferKind>;
pub type Approval = LifecyclePanel<ApprovalKind>;
pub type UserPrompt = LifecyclePanel<UserPromptKind>;
pub type DeviceAuth = LifecyclePanel<DeviceAuthKind>;  // plus __code, rendered as text, never an attribute
```

Each kind adds its one extra element (`Metric`'s value, `DeviceAuth`'s code) through a
wrapper component; the anatomy, state rendering, and announcement rules exist once.
Approvals render actions but never act on them: the application's handler authorizes,
as the contract says a CSS state must never imply.

---

## Splitter (pending PR #41)

Drag-to-resize controls are arriving in the CSS library in PR #41. This entry follows the
classes and options that PR defines; if they change before it merges, this entry changes
with them, and the coverage test holds it on the pending list until the CSS is on `main`.

```rust
#[component] fn Split(#[props(default)] orientation: Orientation,  // Horizontal: side by side
    /// `--stacked`; the block size comes from `--fc-split-block-size` (default 20rem).
    #[props(default)] stacked_block_size: Option<CssLength>,
    children: Element) -> Element;                                // SplitPane, Splitter, SplitPane
#[component] fn SplitPane(#[props(default)] primary: bool,        // __pane--primary, the pane the value sizes
    children: Element) -> Element;

#[component] fn Splitter(label: AccessibleName,                   // aria-label, "Resize sidebar"
    value: Option<ReadSignal<f64>>, default_value: f64,
    onresize: Option<EventHandler<Resize>>,
    min: f64, max: f64,
    #[props(default = 1.0)] step: f64,                            // data-step; Shift moves 10 steps
    #[props(default)] edge: bool,                                 // --edge, inside a Resizable
    #[props(default)] availability: Availability) -> Element;

#[component] fn Resizable(#[props(default)] block: bool,          // --block resizes the block axis
    children: Element) -> Element;                                // holds an edge Splitter

pub struct Resize { pub value: f64, pub unit: ResizeUnit, pub final_: bool }
pub enum ResizeUnit { Percent, Px }   // % of the split; CSS px for edge handles
```

- The handle renders the CSS contract: `role="separator"`, `tabindex="0"`,
  `aria-orientation`, `aria-controls` pointing at the primary pane (wired through
  context, so it cannot dangle), `aria-valuenow/min/max`, and `aria-disabled` from
  `Availability`. The value is written to the target as `--fc-split-size`.
- `Resize::final_` mirrors the binding's `fc-resize` event: false while dragging, true on
  release or a key press, so an application can persist only final sizes.
- Dragging is never the only way (WCAG 2.5.7). Arrow keys along the axis, RTL-aware, with
  Shift for ten steps; Home and End go to the bounds; Enter collapses and restores; Escape
  during a drag cancels it. A split pane at 0 renders `hidden`.
- The arithmetic (`splitterBounds`, clamping, stepping, collapse and restore) is a pure
  function in `behavior::splitter`, ported from the `splitter` binding with a parity test.
  Pointer capture goes through `DomBridge`; the virtual DOM only renders the value.
