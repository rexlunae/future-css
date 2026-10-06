/**
 * Tabs bindings.
 *
 * Wires the `fc-tabs` markup to the APG tabs keyboard contract: one tab in the
 * tab order, arrows move between tabs, Home and End jump to the ends, and the
 * selected tab's panel is the only one shown.
 *
 * # Three things that are easy to get wrong
 *
 * **Arrow direction follows the writing direction.** In a right-to-left
 * document the next tab is to the LEFT, so ArrowLeft must move forward. A tab
 * strip that hard-codes ArrowRight as "next" works in English and walks
 * backwards in Arabic. The direction is read from the list's computed style,
 * not from `document.dir`, because a tab strip can sit inside a region whose
 * direction differs from the page's.
 *
 * **Orientation decides which arrows apply.** A vertical list
 * (`aria-orientation="vertical"`) answers Up and Down, and leaves Left and Right
 * alone -- otherwise the page cannot be scrolled sideways while a tab has focus.
 *
 * **Disabled tabs are skipped but stay visible.** `aria-disabled` keeps the tab
 * in the accessibility tree so a user learns the option exists; it is never
 * selected and never receives focus from the arrows.
 *
 * Activation is automatic by default (arrowing to a tab shows its panel), which
 * is right when panels are cheap to show. `activation: "manual"` moves focus
 * only, and Enter or Space selects -- for panels that fetch or compute.
 */

export interface TabsOptions {
  /** "automatic" selects on focus; "manual" selects on Enter/Space or click. */
  activation?: "automatic" | "manual";
  /** Called with the selected tab's index and element whenever it changes. */
  onChange?: (index: number, tab: HTMLElement) => void;
}

let uid = 0;

export class FutureCssTabs {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly options: TabsOptions;
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKey(event);
  private readonly onClick = (event: MouseEvent) => this.handleClick(event);

  constructor(root: HTMLElement | string, options: TabsOptions = {}) {
    const el = typeof root === "string" ? document.querySelector<HTMLElement>(root) : root;
    if (!el) throw new Error(`FutureCssTabs: no element for ${String(root)}`);
    const list = el.querySelector<HTMLElement>("[role='tablist'], .fc-tabs__list");
    if (!list) throw new Error("FutureCssTabs: no tablist inside the root");

    this.root = el;
    this.list = list;
    this.options = options;

    this.wireRoles();
    // Honour a tab the markup already marked selected; otherwise the first
    // enabled one. A panel left visible beside another selected tab would show
    // two panels at once.
    const initial = this.tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    this.select(initial >= 0 ? initial : this.firstEnabled(), { focus: false, notify: false });

    this.list.addEventListener("keydown", this.onKeyDown);
    this.list.addEventListener("click", this.onClick);
  }

  /** Every tab, in DOM order. */
  get tabs(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>("[role='tab']")];
  }

  /** The index of the selected tab. */
  get selectedIndex(): number {
    return this.tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  }

  /**
   * Selects a tab by index: updates aria-selected, the roving tabindex, and
   * which panel is hidden. Disabled tabs are refused.
   */
  select(index: number, { focus = true, notify = true }: { focus?: boolean; notify?: boolean } = {}): void {
    const tabs = this.tabs;
    const target = tabs[index];
    if (!target || this.isDisabled(target)) return;
    const changed = target.getAttribute("aria-selected") !== "true";

    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = this.panelFor(tab);
      if (panel) panel.hidden = !selected;
    });

    if (focus) target.focus();
    if (changed && notify) this.options.onChange?.(index, target);
  }

  /** Removes listeners. The markup is left as it was last rendered. */
  destroy(): void {
    this.list.removeEventListener("keydown", this.onKeyDown);
    this.list.removeEventListener("click", this.onClick);
  }

  private wireRoles(): void {
    this.list.setAttribute("role", "tablist");
    const tabs = [...this.list.querySelectorAll<HTMLElement>("[role='tab'], .fc-tabs__tab")];
    const panels = [...this.root.querySelectorAll<HTMLElement>(".fc-tabs__panel, [role='tabpanel']")]
      // Nested tab sets own their own panels.
      .filter((p) => p.closest(".fc-tabs") === this.root);

    tabs.forEach((tab, i) => {
      tab.setAttribute("role", "tab");
      if (!tab.id) tab.id = `fc-tab-${++uid}`;
      // Pair by aria-controls when the markup says; otherwise by position.
      let panel = this.panelFor(tab);
      if (!panel && panels[i]) {
        panel = panels[i]!;
        if (!panel.id) panel.id = `fc-tabpanel-${++uid}`;
        tab.setAttribute("aria-controls", panel.id);
      }
      if (panel) {
        panel.setAttribute("role", "tabpanel");
        if (!panel.hasAttribute("aria-labelledby")) panel.setAttribute("aria-labelledby", tab.id);
        // A panel with no focusable content must still be reachable by Tab.
        if (!panel.hasAttribute("tabindex")) panel.tabIndex = 0;
      }
    });
  }

  private panelFor(tab: HTMLElement): HTMLElement | null {
    const id = tab.getAttribute("aria-controls");
    return id ? this.root.ownerDocument.getElementById(id) : null;
  }

  private isDisabled(tab: HTMLElement): boolean {
    return tab.getAttribute("aria-disabled") === "true" || (tab as HTMLButtonElement).disabled === true;
  }

  private firstEnabled(): number {
    return this.tabs.findIndex((t) => !this.isDisabled(t));
  }

  /** The next enabled tab from `from` in direction `step`, wrapping. */
  private step(from: number, step: 1 | -1): number {
    const tabs = this.tabs;
    for (let n = 1; n <= tabs.length; n += 1) {
      const i = (from + step * n + tabs.length) % tabs.length;
      if (!this.isDisabled(tabs[i]!)) return i;
    }
    return from;
  }

  private handleKey(event: KeyboardEvent): void {
    const tabs = this.tabs;
    const current = tabs.indexOf(event.target as HTMLElement);
    if (current === -1) return;

    const vertical = this.list.getAttribute("aria-orientation") === "vertical";
    const rtl = getComputedStyle(this.list).direction === "rtl";
    const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";

    let next: number | null = null;
    if (event.key === forward) next = this.step(current, 1);
    else if (event.key === backward) next = this.step(current, -1);
    else if (event.key === "Home") next = this.firstEnabled();
    else if (event.key === "End") {
      for (let i = tabs.length - 1; i >= 0; i -= 1) {
        if (!this.isDisabled(tabs[i]!)) { next = i; break; }
      }
    } else if ((event.key === "Enter" || event.key === " ") && this.options.activation === "manual") {
      event.preventDefault();
      this.select(current);
      return;
    }

    if (next === null) return;
    event.preventDefault();

    if (this.options.activation === "manual") {
      // Move the roving tabindex without changing the selection.
      tabs.forEach((t, i) => (t.tabIndex = i === next ? 0 : -1));
      tabs[next]!.focus();
    } else {
      this.select(next);
    }
  }

  private handleClick(event: MouseEvent): void {
    const tab = (event.target as HTMLElement).closest<HTMLElement>("[role='tab']");
    if (!tab || !this.list.contains(tab)) return;
    this.select(this.tabs.indexOf(tab));
  }
}

/** Binds every `.fc-tabs` under `root` that is not already bound. */
export function bindTabs(root: ParentNode = document, options: TabsOptions = {}): FutureCssTabs[] {
  const bound: FutureCssTabs[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(".fc-tabs:not([data-fc-bound])")) {
    el.setAttribute("data-fc-bound", "tabs");
    bound.push(new FutureCssTabs(el, options));
  }
  return bound;
}
