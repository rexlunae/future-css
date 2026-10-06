/**
 * Context menu bindings.
 *
 * Opens the `fc-menu` surface at a point, keeps it inside the viewport, and
 * returns focus where it came from.
 *
 * # The two behaviors that are easy to get wrong
 *
 * **Focus restoration.** A menu that opens and does not restore focus strands the
 * user at the top of the document. Worse, it breaks keyboard use entirely: the
 * next Tab goes somewhere unrelated and there is no way back. The invoker is
 * captured on construction and restored on close, always -- including when the
 * close came from Escape rather than a click.
 *
 * **Viewport collision.** A menu opened near the bottom-right edge must flip or
 * shrink to stay on screen. Positioning is the browser's job, not ours: this file
 * decides *which way to flip* and lets the Popover API do the rest.
 *
 * # Why Popover
 *
 * `popover` gives top-layer rendering (no z-index war, no clipping by an
 * `overflow: hidden` ancestor), light-dismiss, and Escape handling from the
 * platform. The fallback matters: a context menu that simply does not open on an
 * older browser is worse than one that opens without light-dismiss.
 *
 * # What is delegated to WASM
 *
 * Opt-in via `useWasm`, the same arrangement as `select.ts`. Traversal -- the
 * arrow walk, Home/End, and typeahead -- is a pure computation over the item
 * list, so it can run in the `fc-context-menu` crate. Everything that asks the
 * browser something (focus, positioning, dismissal) stays here. Without WASM the
 * identical computations run in `MenuModel` below, and `tests/wasm.test.ts`
 * drives both over the same operations and requires identical answers.
 */

/**
 * Every item a menu contains, focusable or not.
 *
 * All three item roles, not just `menuitem`: the checkbox items in the demo
 * were unreachable by arrows because the selector named one role. Disabled
 * items are included and marked unfocusable rather than filtered out, so model
 * indices stay stable whichever items are currently available.
 */
const ITEM_SELECTOR = "[role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio']";

/**
 * How long typed characters accumulate into one typeahead search. Matches the
 * listbox; long enough to type "de" deliberately, short enough that a later "d"
 * starts over.
 */
const TYPEAHEAD_RESET_MS = 500;

/**
 * The model surface the binding uses. Two implementations: `MenuModel` (the JS
 * twin, always available) and `WasmMenuModel` (the Rust model, opt-in). The
 * binding must not be able to tell which one it has.
 */
export interface MenuModelLike {
  readonly activeIndex: number;
  setActive(index: number): void;
  move(delta: number): void;
  focusFirst(): void;
  focusLast(): void;
  typeahead(query: string): boolean;
  resetTypeahead(): void;
}

/**
 * The first code point of `s`, or undefined.
 *
 * Not `s[0]`: that is a UTF-16 code unit, and Rust's `chars().next()` is a code
 * point. For an astral character the two disagree, and the repeating-character
 * rule would diverge between the two paths.
 */
function firstCodePoint(s: string): string | undefined {
  for (const c of s) return c;
  return undefined;
}

/**
 * The buffer after a keystroke, before matching. Shared by both models.
 *
 * `query` arrives already lowercased, so "A" then "a" cycles exactly as "a"
 * then "a" does: holding Shift must not turn a cycle into a search.
 */
function extendBuffer(buffer: string, query: string, first: string): string {
  // Repeating one character cycles through items starting with it, rather than
  // searching for a doubled letter that matches nothing.
  const repeating = [...buffer].every((c) => c === first);
  return repeating ? query : buffer + query;
}

/**
 * The JS twin of the `fc-context-menu` model.
 *
 * Duplicated deliberately, for the reason `SelectModel` is: WASM is never
 * required, so this path has to be complete, and a parity test keeps the two
 * honest.
 */
export class MenuModel implements MenuModelLike {
  private readonly labels: readonly string[];
  private readonly focusable: readonly boolean[];
  private active = -1;
  private buffer = "";

  constructor(labels: readonly string[], focusable: readonly boolean[]) {
    // Folded once here rather than per keystroke; the WASM path needs them
    // folded anyway (see `WasmMenuModel`).
    this.labels = labels.map((l) => l.toLowerCase());
    this.focusable = focusable;
  }

  get activeIndex(): number {
    return this.active;
  }

  setActive(index: number): void {
    this.active = index >= 0 && index < this.focusable.length ? index : -1;
  }

  focusableIndices(): number[] {
    const out: number[] = [];
    this.focusable.forEach((f, i) => {
      if (f) out.push(i);
    });
    return out;
  }

  /** Wraps at both ends and skips separators and disabled items. */
  move(delta: number): void {
    const focusable = this.focusableIndices();
    if (focusable.length === 0) {
      this.active = -1;
      return;
    }
    const pos = Math.max(0, focusable.indexOf(this.active));
    const len = focusable.length;
    // The double modulo is Rust's `rem_euclid`: a large negative delta must land
    // in range rather than produce a negative index.
    this.active = focusable[(((pos + delta) % len) + len) % len]!;
  }

  focusFirst(): void {
    this.active = this.focusableIndices()[0] ?? -1;
  }

  focusLast(): void {
    this.active = this.focusableIndices().at(-1) ?? -1;
  }

  /**
   * Moves to the next focusable item whose label starts with the buffer,
   * searching from the item after the current one.
   */
  typeahead(raw: string): boolean {
    const query = raw.toLowerCase();
    const first = firstCodePoint(query);
    if (first === undefined) return false;
    this.buffer = extendBuffer(this.buffer, query, first);

    const needle = this.buffer;
    const n = this.labels.length;
    const start = this.active >= 0 ? this.active + 1 : 0;
    for (let step = 0; step < n; step += 1) {
      const index = (start + step) % n;
      if (this.focusable[index] && this.labels[index]!.toLowerCase().startsWith(needle)) {
        this.active = index;
        return true;
      }
    }
    // A dead prefix would swallow every later keystroke, so drop it.
    this.buffer = "";
    return false;
  }

  resetTypeahead(): void {
    this.buffer = "";
  }
}

/** The compiled `fc-context-menu` module, as the binding consumes it. */
export interface MenuWasmModule {
  default: (init?: { module_or_path?: string | Uint8Array }) => Promise<void>;
  menuMove: (focusable: number[], active: number, delta: number) => number;
  menuFocusFirst: (focusable: number[]) => number;
  menuFocusLast: (focusable: number[]) => number;
  menuTypeahead: (labels: string[], focusable: number[], active: number, buffer: string, query: string) => Int32Array | number[];
}

/**
 * The Rust model behind the stateless boundary.
 *
 * Holds the item arrays once and the view state (active index, typeahead
 * buffer) between calls; every decision delegates.
 *
 * Labels and queries are lowercased here, before they cross. Unicode case
 * folding is ~17 KB of tables inside the module and free in JavaScript, so the
 * crate's boundary takes folded text and never links the tables.
 */
export class WasmMenuModel implements MenuModelLike {
  private readonly mod: MenuWasmModule;
  private readonly labels: string[];
  private readonly flags: number[];
  private active = -1;
  private buffer = "";

  constructor(mod: MenuWasmModule, labels: readonly string[], focusable: readonly boolean[]) {
    this.mod = mod;
    this.labels = labels.map((l) => l.toLowerCase());
    this.flags = focusable.map((f) => (f ? 1 : 0));
  }

  get activeIndex(): number {
    return this.active;
  }

  setActive(index: number): void {
    this.active = index >= 0 && index < this.flags.length ? index : -1;
  }

  move(delta: number): void {
    this.active = this.mod.menuMove(this.flags, this.active, delta);
  }

  focusFirst(): void {
    this.active = this.mod.menuFocusFirst(this.flags);
  }

  focusLast(): void {
    this.active = this.mod.menuFocusLast(this.flags);
  }

  typeahead(raw: string): boolean {
    const query = raw.toLowerCase();
    const first = firstCodePoint(query);
    if (first === undefined) return false;
    const [active, matched] = Array.from(
      this.mod.menuTypeahead(this.labels, this.flags, this.active, this.buffer, query),
    );
    this.active = active!;
    // The concat is the same rule the crate applies internally; only whether it
    // matched decides the buffer's fate.
    this.buffer = matched === 1 ? extendBuffer(this.buffer, query, first) : "";
    return matched === 1;
  }

  resetTypeahead(): void {
    this.buffer = "";
  }
}

/** Builds a model over a menu's current items. */
type ModelFactory = (labels: readonly string[], focusable: readonly boolean[]) => MenuModelLike;

/**
 * The text a user would type to reach an item.
 *
 * `textContent` included the check glyph and the shortcut, so a checked item's
 * label began with "✓" and typeahead could never reach it. Anything marked
 * `aria-hidden` is decoration by the same definition a screen reader uses, so
 * it is excluded here too.
 */
function itemLabel(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  let text = "";
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
      else if (child instanceof Element && child.getAttribute("aria-hidden") !== "true") walk(child);
    }
  };
  walk(el);
  return text.trim();
}

function isFocusableItem(el: Element): boolean {
  return el.getAttribute("aria-disabled") !== "true" && !el.hasAttribute("disabled");
}

export interface MenuOptions {
  /** The menu element. */
  menu: HTMLElement;
  /** The element focus returns to on close. Defaults to the current activeElement. */
  invoker?: HTMLElement | null;
  /** Called after the menu opens. */
  onOpen?: (menu: HTMLElement) => void;
  /** Called after the menu closes. */
  onClose?: (menu: HTMLElement) => void;
}

export class FutureCssMenu {
  private readonly menu: HTMLElement;
  private readonly invoker: HTMLElement | null;
  private readonly options: MenuOptions;

  private opened = false;
  private factory: ModelFactory = (labels, focusable) => new MenuModel(labels, focusable);
  /** Rebuilt on open, so items re-rendered between openings are seen. */
  private model: MenuModelLike = new MenuModel([], []);
  private typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: MenuOptions) {
    this.menu = options.menu;
    // Captured at construction, which is the trigger's lifetime: by the time the
    // menu opens, activeElement may already have moved into the menu.
    this.invoker = options.invoker ?? null;
    this.options = options;

    this.menu.setAttribute("role", "menu");
    this.markupItems();

    this.wireDismissal();
    this.wireKeyboard();
  }

  /** Whether the menu is currently open. */
  get isOpen(): boolean {
    return this.opened;
  }

  /**
   * Opens the menu at an anchor element or a viewport point.
   *
   * Anchor positioning stays in CSS via anchor names where the browser supports
   * them; the numeric fallback positions directly. Either way the flip is CSS's
   * job via `position-area`.
   */
  open(anchor?: HTMLElement | { x: number; y: number }): void {
    if (this.opened) return;

    if (anchor instanceof HTMLElement) {
      this.menu.style.positionAnchor = `--fc-anchor-${anchor.id || "trigger"}`;
    } else if (anchor) {
      this.menu.style.position = "fixed";
      this.menu.style.insetInlineStart = `${anchor.x}px`;
      this.menu.style.insetBlockStart = `${anchor.y}px`;
      this.menu.style.positionArea = "bottom span-right-end";
    }

    this.opened = true;
    this.menu.dataset.fcState = "open";
    this.rebuildModel();

    // `showPopover` is the top-layer path; the attribute is the fallback. Both are
    // attempted because a browser may support one and not the other.
    if (typeof this.menu.showPopover === "function") {
      try {
        this.menu.showPopover();
      } catch {
        this.menu.setAttribute("popover", "manual");
      }
    } else {
      this.menu.setAttribute("popover", "manual");
      this.menu.style.display = "block";
    }

    this.focusFirstItem();
    this.options.onOpen?.(this.menu);
  }

  /**
   * Closes the menu and restores focus.
   *
   * Always restores the invoker. Returning focus to the trigger is what makes
   * Escape feel correct: the user is back where they were, able to keep typing.
   */
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.menu.dataset.fcState = "closed";

    if (typeof this.menu.hidePopover === "function") {
      try {
        this.menu.hidePopover();
      } catch {
        // Not shown as a popover; the attribute path already hid it.
      }
    }
    this.menu.style.display = "";

    this.restoreFocus();
    this.options.onClose?.(this.menu);
  }

  /**
   * Swaps the JS traversal model for the Rust one, when the module loads.
   *
   * Returns false -- and keeps the JS model -- on any failure: a menu that lost
   * its keyboard navigation because a fetch failed is worse than one that never
   * got the accelerator. Never swaps while open, where it would replace view
   * state under an active interaction.
   *
   * `init` passes through to the bindgen glue. Browsers omit it; Node passes
   * `module_or_path`.
   */
  async useWasm(url: string, init?: { module_or_path?: string | Uint8Array }): Promise<boolean> {
    if (this.opened) return false;
    try {
      const mod = (await import(url)) as MenuWasmModule;
      await mod.default(init);
      this.factory = (labels, focusable) => new WasmMenuModel(mod, labels, focusable);
      return true;
    } catch {
      return false;
    }
  }

  // ---- internals --------------------------------------------------------

  /**
   * Adds the roles a menu needs if the markup omitted them.
   *
   * Additive rather than required: a consumer who wrote the roles gets identical
   * behavior, and one who did not still gets a working menu. Styling never
   * depends on this, so the component degrades without it.
   */
  private markupItems(): void {
    for (const el of this.menu.querySelectorAll<HTMLElement>(".fc-menu__item")) {
      if (!el.hasAttribute("role")) el.setAttribute("role", "menuitem");
      if (el.hasAttribute("aria-disabled") && !el.hasAttribute("tabindex")) {
        el.setAttribute("tabindex", "-1");
      }
    }
  }

  private get items(): HTMLElement[] {
    return Array.from(this.menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  }

  private rebuildModel(): void {
    const items = this.items;
    this.model = this.factory(items.map(itemLabel), items.map(isFocusableItem));
  }

  /** Moves roving focus to whatever the model now says is active. */
  private focusActive(): void {
    const index = this.model.activeIndex;
    const items = this.items;
    const target = items[index];
    if (!target) return;
    for (const item of items) item.setAttribute("tabindex", "-1");
    target.setAttribute("tabindex", "0");
    target.focus();
  }

  private focusFirstItem(): void {
    this.model.focusFirst();
    // A menu with no actionable items is misconfigured, but focusing the menu is
    // better than leaving focus on the trigger behind an open menu.
    if (this.model.activeIndex < 0) {
      this.menu.focus();
      return;
    }
    this.focusActive();
  }

  private restoreFocus(): void {
    const target = this.invoker ?? (document.activeElement as HTMLElement | null);
    // `isConnected` because the invoker may have been removed while the menu was
    // open -- a list that re-rendered underneath its own context menu.
    if (target && target.isConnected) target.focus();
  }

  private wireDismissal(): void {
    // Light dismiss, when the platform provides it.
    this.menu.addEventListener("toggle", (event) => {
      if ((event as ToggleEvent).newState === "closed") this.close();
    });

    // Fallback light-dismiss for browsers without the Popover API. Checked
    // against `opened` so it cannot swallow clicks meant for the page.
    document.addEventListener("pointerdown", (event) => {
      if (!this.opened) return;
      const target = event.target as Node;
      if (this.menu.contains(target)) return;
      this.close();
    });

    // The `toggle` event only fires on the Popover path; this covers the
    // attribute fallback so Escape restores focus in both cases.
    document.addEventListener("keydown", (event) => {
      if (this.opened && event.key === "Escape") this.close();
    });
  }

  /**
   * Keyboard behavior, per the WAI-ARIA menu pattern.
   *
   * Arrows move, Home/End jump, Escape closes, and a printable character moves by
   * typeahead. Tab is deliberately *not* trapped: a menu is a single stop, and
   * trapping it is the most common way menus become keyboard traps.
   */
  private wireKeyboard(): void {
    this.menu.addEventListener("keydown", (event) => {
      // Re-seed from the DOM: a pointer hover or a programmatic focus can move
      // focus without passing through the model.
      this.model.setActive(this.items.findIndex((item) => item === document.activeElement));

      const navigate = (step: () => void): void => {
        event.preventDefault();
        // Any navigation other than typing ends the search, so a later "b" is
        // not appended to a stale prefix.
        this.model.resetTypeahead();
        step();
        this.focusActive();
      };

      switch (event.key) {
        case "ArrowDown":
          navigate(() => this.model.move(1));
          break;
        case "ArrowUp":
          navigate(() => this.model.move(-1));
          break;
        case "Home":
          navigate(() => this.model.focusFirst());
          break;
        case "End":
          navigate(() => this.model.focusLast());
          break;
        case "Escape":
          event.preventDefault();
          this.close();
          break;
        case "Tab":
          // One stop in, one stop out. No trap.
          this.close();
          break;
        default:
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            this.typeahead(event.key);
            event.preventDefault();
          }
      }
    });

    this.menu.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".fc-menu__item")) this.close();
    });
  }

  /**
   * Moves focus by typeahead. Characters typed within `TYPEAHEAD_RESET_MS` of
   * each other form one search, so "dep" reaches "Deploy" past "Delete", while
   * pressing "d" twice cycles through the items starting with "d".
   */
  private typeahead(char: string): void {
    clearTimeout(this.typeaheadTimer);
    if (this.model.typeahead(char)) this.focusActive();
    this.typeaheadTimer = setTimeout(() => this.model.resetTypeahead(), TYPEAHEAD_RESET_MS);
  }
}

/**
 * Opens a menu at a pointer event and restores focus to its trigger.
 *
 * The common case, wrapped so a caller does not have to wire all of it.
 */
export function bindContextMenu(target: HTMLElement, menuSelector: string): FutureCssMenu {
  const menuEl = document.querySelector<HTMLElement>(menuSelector);
  if (!menuEl) throw new Error(`future-css: menu not found: ${menuSelector}`);

  const menu = new FutureCssMenu({ menu: menuEl, invoker: target });

  target.addEventListener("contextmenu", (event) => {
    // The browser's own menu is suppressed: on a right-click inside an app surface
    // it is noise, and leaving it up breaks the illusion that this is the app's menu.
    event.preventDefault();
    menu.open({ x: event.clientX, y: event.clientY });
  });

  return menu;
}
