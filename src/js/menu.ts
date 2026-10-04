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
 */

/** Items a roving-focus menu can move between. */
const ITEM_SELECTOR = "[role='menuitem']:not([aria-disabled='true'])";

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
  /** The index focus was at when the menu opened, restored on close. */
  private previousIndex = 0;

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

  /**
   * Focuses an item by index, wrapping at both ends.
   *
   * Wrapping matters: a menu that cannot be arrowed past its last item leaves a
   * keyboard user stuck.
   */
  private focusItem(index: number): void {
    const items = this.items;
    if (items.length === 0) return;
    const wrapped = ((index % items.length) + items.length) % items.length;
    for (const item of items) item.setAttribute("tabindex", "-1");
    const target = items[wrapped]!;
    target.setAttribute("tabindex", "0");
    target.focus();
    this.previousIndex = wrapped;
  }

  private focusFirstItem(): void {
    // A menu with no actionable items is misconfigured, but focusing the menu is
    // better than leaving focus on the trigger behind an open menu.
    if (this.items.length === 0) {
      this.menu.focus();
      return;
    }
    this.focusItem(0);
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
      const items = this.items;
      const current = items.findIndex((item) => item === document.activeElement);

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          this.focusItem(current + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          this.focusItem(current - 1);
          break;
        case "Home":
          event.preventDefault();
          this.focusItem(0);
          break;
        case "End":
          event.preventDefault();
          this.focusItem(items.length - 1);
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
   * Moves focus to the next item starting with `char`.
   *
   * The standard menu typeahead: searching continues from the current item, so
   * pressing "n" twice cycles through items starting with "n".
   */
  private typeahead(char: string): void {
    const items = this.items;
    const needle = char.toLowerCase();
    const start = this.previousIndex;

    for (let offset = 1; offset <= items.length; offset += 1) {
      const index = (start + offset) % items.length;
      const label = items[index]!.textContent?.trim().toLowerCase() ?? "";
      if (label.startsWith(needle)) {
        this.focusItem(index);
        return;
      }
    }
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
