/**
 * Select / listbox bindings.
 *
 * Wires a `<button role="combobox">` to a `role="listbox"` popup: keyboard
 * navigation, typeahead, filtering, and focus restoration.
 *
 * # The three things that make a listbox hard
 *
 * **1. Focus must not move.** The DOM focus stays on the invoker for the entire
 * time the list is open, and the highlighted option is pointed at with
 * `aria-activedescendant`. The roving-`tabindex` approach `menu.ts` uses is
 * correct *for a menu* and wrong here: a combobox that moves focus into its
 * listbox can no longer be reached with Tab, and screen readers stop reporting
 * it as a combobox. This is the single most common way custom listboxes break.
 *
 * **2. Escape must restore, not commit.** A menu fires an action, so closing it
 * has no state to restore. A select *holds a value*, so dismissing the list has
 * to put back whatever was in effect before it opened -- otherwise closing a
 * listbox silently discards the user's choice.
 *
 * **3. The option list must be rebuilt, not just shown.** A filtered or
 * typeahead-navigated list changes which options exist, and a stale list means
 * arrows move through rows that are no longer there.
 *
 * # What is delegated to WASM
 *
 * `fc-select` owns the navigation *model* -- which option is active, how
 * typeahead accumulates, which options survive a filter. It never touches the
 * DOM. Everything here is the part WASM cannot do: ARIA, focus, positioning, and
 * rendering. WASM is optional throughout; without it the identical model runs in
 * `SelectModel` below and nothing is lost but speed.
 */

/** One option as the binding understands it. */
export interface SelectOption {
  /** Stable value, carried back on change. Not the label. */
  value: string;
  /** Visible text. */
  label: string;
  /** Group heading, or omitted for ungrouped. */
  group?: string;
  /** Unavailable: skipped by arrows, never selected. */
  disabled?: boolean;
}

export interface SelectOptions {
  /** The `<button role="combobox">`. */
  invoker: HTMLElement | string;
  /** The `role="listbox"` element. */
  list?: HTMLElement | string;
  /** Called with the committed value whenever it changes. */
  onChange?: (value: string, option: SelectOption) => void;
  /** Called after the list opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * The JS twin of the Rust model.
 *
 * Duplicated deliberately: WASM is never required, so the pure-JS path has to be
 * complete, and `tests/wasm.test.ts` asserts the two agree. Keeping them separate
 * files would mean one of them is never loaded in a test; keeping them together
 * makes the duplication visible and therefore reviewable.
 */
class SelectModel {
  private readonly options: readonly SelectOption[];
  /** Indices surviving the current filter. */
  private visible: number[];
  private active = -1;
  private committed = "";
  private buffer = "";

  constructor(options: readonly SelectOption[]) {
    this.options = options;
    this.visible = options.map((_, i) => i);
  }

  /**
   * Indices surviving the current query.
   *
   * Held *inside* the model rather than only in the renderer, because navigation
   * has to obey the same filter the user can see. Keeping the filter in the view
   * alone let arrows walk options that were hidden, and Enter commit one of them.
   */
  visibleIndices(): number[] {
    return this.visible;
  }

  /** First selectable visible option. */
  firstSelectableVisible(): number {
    return this.visible.find((i) => !this.options[i]?.disabled) ?? -1;
  }

  /** Last selectable visible option. */
  lastSelectableVisible(): number {
    for (let p = this.visible.length - 1; p >= 0; p -= 1) {
      const i = this.visible[p]!;
      if (!this.options[i]?.disabled) return i;
    }
    return -1;
  }

  /** Index of `value`, or -1. */
  indexOf(value: string): number {
    return this.options.findIndex((o) => o.value === value);
  }

  get committedValue(): string {
    return this.committed;
  }

  /**
   * Sets the committed value without any navigation side effects.
   *
   * Needed because the invoker's `data-fc-value` and the model's `committed` are
   * two stores of one fact. A programmatic `setValue` writing only the dataset
   * leaves the model stale, and every later `open()` re-seeds the highlight from
   * the stale copy.
   */
  setCommitted(value: string): void {
    this.committed = value;
  }

  /** Opens, highlighting `value` when it is still present. */
  open(value: string | undefined): void {
    this.committed = value ?? "";
    // Preserve the committed value even when the current filter hides it, so
    // Escape can still restore it; only the *highlight* falls back to something
    // visible.
    const found = value ? this.indexOf(value) : -1;
    this.active = found >= 0 && this.visible.includes(found) ? found : this.firstSelectableVisible();
    this.buffer = "";
  }

  /**
   * Closes. `commit` is false for Escape, which must restore rather than keep
   * whatever was highlighted.
   */
  close(commit: boolean): void {
    if (commit && this.active >= 0 && !this.options[this.active]?.disabled) {
      this.committed = this.options[this.active]!.value;
    }
    this.active = -1;
    this.buffer = "";
  }

  /** Steps by `delta`, wrapping, skipping unavailable options. */
  move(delta: number): void {
    const len = this.visible.length;
    if (len === 0) return;
    // Step through *visible* positions, so arrows cannot land on an option the
    // filter has hidden. Bounded by the visible count so an all-disabled list
    // terminates rather than looping.
    const fromPos = this.active < 0 ? (delta > 0 ? -1 : 0) : this.visible.indexOf(this.active);
    const start = fromPos < 0 ? (delta > 0 ? -1 : 0) : fromPos;
    for (let step = 1; step <= len; step += 1) {
      const pos = (((start + delta * step) % len) + len) % len;
      const index = this.visible[pos]!;
      if (!this.options[index]?.disabled) {
        this.active = index;
        return;
      }
    }
  }

  private firstSelectable(): number {
    return this.options.findIndex((o) => !o.disabled);
  }

  /** Highlights the first selectable *visible* option. */
  focusFirst(): void {
    const index = this.firstSelectableVisible();
    if (index >= 0) this.active = index;
  }

  /** Highlights the last selectable *visible* option. */
  focusLast(): void {
    const index = this.lastSelectableVisible();
    if (index >= 0) this.active = index;
  }

  /** Appends `query` to the typeahead buffer and moves to the next match. */
  typeahead(query: string): boolean {
    const first = query[0];
    if (!first) return false;
    // Repeating one character cycles rather than searching for "SS".
    const repeating = [...this.buffer].every((c) => c === first);
    this.buffer = repeating ? query : this.buffer + query;

    const needle = this.buffer.toLowerCase();
    const len = this.visible.length;
    if (len === 0) {
      this.buffer = "";
      return false;
    }
    // Positions in `visible`, not raw option indices: with a filter active those
    // index different things, which silently skipped matches.
    const activePos = this.active < 0 ? -1 : this.visible.indexOf(this.active);
    const start = activePos < 0 ? 0 : activePos + 1;
    for (let step = 0; step < len; step += 1) {
      const index = this.visible[(start + step) % len]!;
      const option = this.options[index]!;
      // Never select an unavailable option: a search landing on one is a dead
      // end the user cannot escape by typing.
      if (!option.disabled && option.label.toLowerCase().startsWith(needle)) {
        this.active = index;
        return true;
      }
    }
    // Clear the buffer so the next keystroke starts fresh instead of extending a
    // prefix that can never match.
    this.buffer = "";
    return false;
  }

  /** Case-insensitive substring match on label or value. */
  filter(query: string): number[] {
    const needle = query.trim().toLowerCase();
    this.visible = !needle
      ? this.options.map((_, i) => i)
      : this.options
          .map((o, i) => ({ o, i }))
          .filter(
            ({ o }) =>
              o.label.toLowerCase().includes(needle) ||
              o.value.toLowerCase().includes(needle),
          )
          .map(({ i }) => i);

    // Reconcile the highlight to something still visible. Leaving it on a hidden
    // option would let Enter commit something the user cannot see.
    if (!this.visible.includes(this.active)) {
      this.active = this.firstSelectableVisible();
    }
    return this.visible;
  }

  get activeIndex(): number {
    return this.active;
  }

  /**
   * Moves the highlight to `index` without changing the committed value.
   *
   * Used by the pointer path: a click picks an option directly, and the close
   * that follows must commit *that* option rather than whatever was highlighted
   * when the list opened.
   */
  setActive(index: number): void {
    if (index >= 0 && index < this.options.length) this.active = index;
  }
}

const OPTION_SELECTOR = "[role='option']";

export class FutureCssSelect {
  private readonly invoker: HTMLElement;
  private readonly list: HTMLElement | null;
  /** The option list. Named `items`, not `options`: the constructor argument
   * is the *config* object, and sharing one name for both meant the callbacks
   * were unreachable -- `this.options.onChange` read a property off an array,
   * which is `undefined`, so nothing ever fired and nothing threw. */
  private readonly items: readonly SelectOption[];
  private readonly config: SelectOptions;
  private readonly model: SelectModel;

  private open = false;
  private visible: number[] = [];
  /** Characters typed while open, for the 600ms typeahead window. */
  private lastKeystroke = 0;

  constructor(options: SelectOptions) {
    // Stored first and used by every callback below. Forgetting this assignment
    // leaves `this.config` undefined, so `this.config.onOpenChange` throws on the
    // first open rather than failing quietly -- which is the better failure, but
    // still a bug worth the guard.
    this.config = options;
    this.invoker = resolve(options.invoker, "select invoker");
    this.list = options.list ? resolve(options.list, "select list") : null;
    this.items = this.readOptions();

    // `data-fc-value` is the machine-readable half of the DOM contract: a reader
    // gets the selection without parsing the label, which is free to change.
    this.invoker.setAttribute("role", "combobox");
    this.invoker.setAttribute("aria-haspopup", "listbox");
    this.invoker.setAttribute("aria-expanded", "false");
    if (this.list?.id) this.invoker.setAttribute("aria-controls", this.list.id);

    this.model = new SelectModel(this.items);
    this.visible = this.model.visibleIndices();

    this.wire();
  }

  /** The committed value. */
  get value(): string {
    return this.invoker.dataset.fcValue ?? "";
  }

  /** Options declared in the markup. */
  get allOptions(): readonly SelectOption[] {
    return this.items;
  }

  /** The options currently listed. */
  get visibleOptions(): readonly SelectOption[] {
    return this.visible.map((i) => this.items[i]!);
  }

  /** Whether the list is open. */
  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Reads options out of the markup.
   *
   * Reading rather than requiring a script-supplied array means the component
   * degrades to plain, readable HTML: a server-rendered select works with no JS
   * at all, which is what makes this usable in a non-SPA.
   */
  private readOptions(): SelectOption[] {
    if (!this.list) return [];
    const out: SelectOption[] = [];
    for (const el of this.list.querySelectorAll<HTMLElement>(OPTION_SELECTOR)) {
      out.push({
        value: el.dataset.fcValue ?? el.textContent?.trim() ?? "",
        label: el.querySelector(".fc-select__option-label")?.textContent?.trim()
          ?? el.textContent?.trim() ?? "",
        group: groupLabelFor(el),
        disabled: el.getAttribute("aria-disabled") === "true",
      });
    }
    return out;
  }

  // ---- Open / close --------------------------------------------------------

  /** Opens the list, highlighting the current value. */
  openList(): void {
    if (this.open) return;
    if (this.items.length === 0) {
      // An empty list must not open. Showing an empty popup reads as a bug; a
      // control with nothing to choose from is a legitimate state.
      this.invoker.setAttribute("aria-disabled", "true");
      return;
    }
    this.invoker.removeAttribute("aria-disabled");
    this.open = true;
    // Ask the model for its current visible set rather than recomputing one: a
    // filter applied before opening used to be discarded, so the list showed every
    // option while the user still expected the filtered set.
    this.visible = this.model.visibleIndices();
    this.model.open(this.value || undefined);
    this.invoker.setAttribute("aria-expanded", "true");
    this.showList();
    this.render();
    this.config.onOpenChange?.(true);
  }

  /**
   * Closes the list. `commit` is false for Escape, which restores the value in
   * effect before the list opened.
   */
  closeList(commit = true): void {
    if (!this.open) return;
    const before = this.value;
    this.model.close(commit);
    this.open = false;
    this.invoker.setAttribute("aria-expanded", "false");
    this.invoker.removeAttribute("aria-activedescendant");
    this.hideList();

    /*
     * Write the model's committed value back to the invoker *before* rendering.
     *
     * `data-fc-value` and the model's `committed` are two stores of one fact, and
     * committing updates only the latter. Without this the invoker kept the old
     * value: `Enter` on a newly-highlighted option fired onChange with the right
     * value but left the control displaying and reporting the previous one, so the
     * next open highlighted the wrong row. Render first and the list would be
     * drawn from the stale attribute too.
     *
     * Escape takes the same path with the model restored, which is why it needs
     * no separate branch: the value written is whatever the model holds.
     */
    const after = this.model.committedValue;
    if (after) this.invoker.dataset.fcValue = after;
    this.render();

    // Compared against `before`, captured before the dataset was rewritten above.
    // Reading the attribute here would compare the value against itself and the
    // callback would never fire.
    if (commit && after && after !== before) this.emit(after);

    this.config.onOpenChange?.(false);
    // Focus stays on the invoker throughout; returning it explicitly matters when
    // the close came from a pointer event on an option.
    if (this.invoker.ownerDocument.activeElement !== this.invoker) this.invoker.focus();
  }

  /** Commits `value` programmatically. */
  setValue(value: string): void {
    if (!value || value === this.value) return;
    if (this.model.indexOf(value) < 0) return;
    this.invoker.dataset.fcValue = value;
    // The model holds its own committed value, and `open()` seeds the highlight
    // from it. Updating only the dataset therefore left the highlight pointing at
    // the previous option -- so opening a programmatically-set select highlighted
    // the wrong row, and Escape "restored" the wrong value. Two sources of truth
    // for one piece of state, which is the bug this comment exists to prevent.
    this.model.setCommitted(value);
    this.render();
    this.emit(value);
  }

  /** Filters the list to options whose label or value contains `query`. */
  filter(query: string): void {
    // The model owns the filter so arrows and typeahead obey it too. Letting the
    // view filter independently let Enter commit an option that was hidden.
    this.visible = this.model.filter(query);
    this.render();
  }

  private emit(value: string): void {
    const option = this.items.find((o) => o.value === value);
    if (option) this.config.onChange?.(value, option);
  }

  private showList(): void {
    if (!this.list) return;
    // The Popover API gives top-layer rendering, light dismiss, and Escape for
    // free; `data-fc-open` is the fallback where it is missing, so a closed list
    // is never a flash of unpositioned options.
    this.list.setAttribute("data-fc-open", "true");
    this.list.setAttribute("popover", "manual");
    this.position();
  }

  private hideList(): void {
    this.list?.removeAttribute("data-fc-open");
    this.invoker.removeAttribute("aria-activedescendant");
  }

  /**
   * Places the list under the invoker, flipping above when there is no room
   * below.
   *
   * Positioning is the browser's job where it can be -- `position-anchor` handles
   * this in CSS -- but the flip decision needs the available space, so it is
   * measured here and applied as a pair of inline coordinates.
   */
  private position(): void {
    if (!this.list) return;
    const anchor = this.invoker.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom;
    const above = anchor.top;
    // An offset of 2px so the list does not sit flush against the border.
    const GAP = 2;
    /*
     * Both block edges are written on every call, never just one.
     *
     * Setting only the edge being used leaves the *other* one from the previous
     * open applied. A `position: fixed` element with both `top` and `bottom` set
     * is stretched to fill the viewport, so a list opened below an invoker
     * inherited a stale `bottom` and stretched upward off-screen -- visible as a
     * list at `top: -786px`. Clearing the unused edge is what keeps the two
     * branches independent.
     */
    const flip = below < 160 && above > below;

    /*
     * `setProperty` rather than assigning to `style.insetBlockStart`.
     *
     * Assigning the logical longhands in sequence serialises as the
     * `inset-block` *shorthand*, and the shorthand replaces both edges: setting
     * `insetBlockStart = "24px"` and then `insetBlockEnd = "auto"` left
     * `inset-block: auto auto` and the position silently reverted to its default.
     * Through `setProperty` the two longhands are written independently.
     *
     * Both edges are always written for the same reason: a `position: fixed`
     * element with both `top` and `bottom` set is stretched to fill the viewport,
     * so a leftover edge from the previous open would stretch the list off-screen.
     */
    const style = this.list.style;
    style.setProperty("inset-block-start", flip ? "auto" : `${anchor.bottom + GAP}px`);
    style.setProperty("inset-block-end", flip ? `${above - GAP}px` : "auto");
    style.setProperty("inset-inline-start", `${anchor.left}px`);
    style.setProperty("min-inline-size", `${anchor.width}px`);

    /*
     * Cap the height to the space actually available on the chosen side.
     *
     * The stylesheet's `max-block-size: min(60vh, 24rem)` is a ceiling for a
     * centered list, not a guarantee: with the invoker near the bottom of the
     * viewport there is less than 60vh below it, so the list ran off the screen
     * by exactly the difference. Measuring is what makes the list fit, and it is
     * also why this cannot live in CSS -- the available space depends on where
     * the invoker happens to be.
     */
    const available = (flip ? above : below) - GAP;
    const CSS_CEILING = 384; // 24rem, matching the stylesheet's cap
    const height = Math.max(80, Math.min(available, CSS_CEILING));
    style.setProperty("max-block-size", `${height}px`);
  }

  // ---- Rendering -----------------------------------------------------------

  /**
   * Writes the model back to the DOM.
   *
   * Rebuilt rather than toggled: filtering and typeahead change *which* options
   * exist, and a stale list would let arrows move through rows that are gone.
   */
  private render(): void {
    if (!this.list) return;
    const active = this.model.activeIndex;

    /*
     * The list is rebuilt from `this.options`, which was read out of the markup
     * once at construction. That is safe *only* because the read happens before
     * the first render: rebuilding destroys the very elements the options were
     * read from, so a second construction over the same (now rewritten) markup
     * would find one option -- the last thing rendered -- or none.
     *
     * So `options` is the source of truth and the DOM is a projection of it, never
     * the other way round. Re-reading here would make the control unable to
     * survive its own re-render.
     */
    this.list.replaceChildren();
    let currentGroup: string | undefined;

    for (const index of this.visible) {
      const option = this.items[index];
      if (!option) continue;

      if (option.group && option.group !== currentGroup) {
        currentGroup = option.group;
        const label = document.createElement("div");
        label.className = "fc-select__group-label";
        // `role="presentation"`: the group element carries the name, and a second
        // announcement of the same heading would be noise.
        label.setAttribute("role", "presentation");
        label.textContent = option.group;
        this.list.append(label);
      }

      const el = document.createElement("div");
      el.className = "fc-select__option";
      el.setAttribute("role", "option");
      el.dataset.fcValue = option.value;
      // The option's index into the full list, so a click can move the model to
      // it. Reading it from `data-fc-value` would work too, but a lookup by value
      // is ambiguous if two options ever share one.
      el.dataset.fcIndex = String(index);
      el.id = `${this.list.id || "fc-select"}-opt-${index}`;
      // Selection is ARIA, not a class: `aria-selected` is what is announced, and
      // a stale class would say something a screen reader never heard.
      el.setAttribute("aria-selected", String(option.value === this.model.committedValue));
      if (option.disabled) el.setAttribute("aria-disabled", "true");
      // The highlight is a data attribute so the CSS follows the same value the
      // ARIA does -- two sources of truth would eventually disagree.
      if (this.open && index === active) el.dataset.fcActive = "true";

      const check = document.createElement("span");
      check.className = "fc-select__option-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = option.value === this.model.committedValue ? "\u2713" : "";

      const label = document.createElement("span");
      label.className = "fc-select__option-label";
      label.textContent = option.label;

      el.append(check, label);
      this.list.append(el);
    }

    if (this.visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fc-select__empty";
      empty.textContent = "No matches";
      this.list.append(empty);
    }

    this.renderValue();
    this.syncActiveDescendant();
    this.scrollActiveIntoView();
  }

  private renderValue(): void {
    const current = this.items.find((o) => o.value === this.model.committedValue);
    const target = this.invoker.querySelector(".fc-select__value");
    if (target) {
      target.textContent = current?.label ?? this.invoker.dataset.fcPlaceholder ?? "Select\u2026";
      target.dataset.fcPlaceholder = String(!current);
    }
  }

  /**
   * Points `aria-activedescendant` at the highlighted option.
   *
   * The whole point of keeping focus on the invoker: this is what tells AT which
   * option is current without DOM focus ever leaving the button.
   */
  private syncActiveDescendant(): void {
    const active = this.model.activeIndex;
    if (!this.open || active < 0 || !this.list) {
      this.invoker.removeAttribute("aria-activedescendant");
      return;
    }
    const el = this.list.querySelector<HTMLElement>(`#${CSS.escape(this.optionId(active))}`);
    if (el) this.invoker.setAttribute("aria-activedescendant", el.id);
  }

  private optionId(index: number): string {
    return `${this.list?.id || "fc-select"}-opt-${index}`;
  }

  /**
   * Keeps the highlight visible in a long list.
   *
   * `nearest` rather than `center`: centring every arrow press makes the list
   * jump around, which is disorienting when stepping through many options.
   */
  private scrollActiveIntoView(): void {
    const active = this.model.activeIndex;
    if (active < 0 || !this.list) return;
    const el = this.list.querySelector<HTMLElement>(`#${CSS.escape(this.optionId(active))}`);
    el?.scrollIntoView({ block: "nearest" });
  }

  // ---- Events --------------------------------------------------------------

  private wire(): void {
    this.invoker.addEventListener("click", () => {
      if (this.open) this.closeList(true);
      else this.openList();
    });

    this.invoker.addEventListener("keydown", (e) => this.onKeydown(e));

    if (!this.list) return;

    // Light dismiss. Checked against `open` so it cannot swallow clicks meant
    // for the page after the list has closed.
    document.addEventListener("pointerdown", (e) => {
      if (!this.open) return;
      const target = e.target as Node;
      if (this.list.contains(target) || this.invoker.contains(target)) return;
      // Commit false (dismissed, not chosen) and no focus restore.
      this.closeList(false, false);
    });

    this.list.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(OPTION_SELECTOR);
      if (!el || el.getAttribute("aria-disabled") === "true") return;
      const value = el.dataset.fcValue;
      if (value) {
        /*
         * Move the model's highlight to the clicked option, then close.
         *
         * Writing `data-fc-value` first and closing after was wrong in two ways:
         * `closeList` commits the model's *active index*, so it wrote the
         * previously-highlighted value straight back over the clicked one, and
         * `onChange` reported the old value. The click became a no-op.
         */
        this.model.setActive(Number(el.dataset.fcIndex ?? -1));
        this.closeList(true);
      }
    });

    // The Popover API's own Escape, so the platform and the keydown handler agree
    // on when the list is open.
    this.list.addEventListener("toggle", (e) => {
      if ((e as ToggleEvent).newState === "closed" && this.open) this.closeList(false);
    });
  }

  private onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        // Alt+ArrowDown opens without moving, the platform convention.
        if (!this.open) this.openList();
        else this.model.move(1);
        this.render();
        return;
      case "ArrowUp":
        e.preventDefault();
        if (!this.open) this.openList();
        else this.model.move(-1);
        this.render();
        return;
      case "Home":
        if (!this.open) return;
        e.preventDefault();
        // Explicit first/last, not a large delta. `1e9 % 5 === 0`, so a delta
        // lands on an arbitrary offset -- End silently did nothing on a
        // five-option list.
        this.model.focusFirst();
        this.render();
        return;
      case "End":
        if (!this.open) return;
        e.preventDefault();
        this.model.focusLast();
        this.render();
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (this.open) this.closeList(true);
        else this.openList();
        return;
      case "Escape":
        if (!this.open) return;
        // Not `preventDefault` on the outer path: Escape must still bubble when
        // the list is closed so a parent dialog can use it.
        e.preventDefault();
        // Commit false: Escape restores. This is the difference from a menu.
        this.closeList(false);
        return;
      case "Tab":
        // One stop in, one stop out. No trap: a listbox that captures Tab strands
        // a keyboard user, and committing on Tab matches native select.
        if (this.open) this.closeList(true);
        return;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (!this.open) return;
          e.preventDefault();
          this.typeahead(e.key);
        }
    }
  }

  /**
   * Typeahead with a 600ms window.
   *
   * The window is what makes multi-character search possible: without it, typing
   * "sonnet" quickly would be treated as five separate single-letter searches.
   */
  private typeahead(char: string): void {
    const now = Date.now();
    if (now - this.lastKeystroke > 600) this.model.open(this.value || undefined);
    this.lastKeystroke = now;
    this.model.typeahead(char);
    this.render();
  }
}

function resolve(target: HTMLElement | string, what: string): HTMLElement {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`future-css: select ${what} not found: ${String(target)}`);
  return el;
}

/**
 * The group heading an option sits under.
 *
 * Walks back past *every* earlier option rather than stopping at the first one.
 * Stopping early meant only the first option of each group got its heading, so
 * filtering to the second one produced a list with no heading at all and an
 * `onChange` payload with no group. A heading applies to every option until the
 * next heading, so the scan has to agree with that.
 */
function groupLabelFor(option: HTMLElement): string | undefined {
  for (let el = option.previousElementSibling; el; el = el.previousElementSibling) {
    if (el.classList.contains("fc-select__group-label")) {
      return el.textContent?.trim() || undefined;
    }
  }
  return undefined;
}
