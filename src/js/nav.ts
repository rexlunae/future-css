/**
 * Navigation sidebar bindings.
 *
 * The sidebar is links, so it needs no keyboard model: Tab walks them and the
 * browser activates them. The one behaviour it adds is collapsing to an icon
 * rail, driven by the toggle's `aria-expanded`. The stylesheet reads that same
 * attribute, so the announced state and the drawn state cannot disagree.
 *
 * Collapsing hides labels visually but keeps them as each link's accessible
 * name, so a screen reader hears the same sidebar either way.
 *
 * If focus is inside a part the rail hides (a group label, or a nested link),
 * collapsing would strand it on an invisible element, so focus moves to the
 * toggle first.
 *
 * In the rail, each link's label becomes its `title`, so a mouse user can read
 * the name the icon stands for. An `fc-tooltip` cannot do this job: the sidebar
 * scrolls, and a scroll container clips an absolutely positioned bubble.
 */

export interface NavOptions {
  /** Called with the new expanded state after a toggle. */
  onToggle?: (expanded: boolean) => void;
}

let uid = 0;

/** The instance `bindNavs` created for each sidebar, which alone may clear its marker. */
const markerOwner = new WeakMap<HTMLElement, FutureCssNav>();

/** Links whose `title` a binding set for the rail, so only those are cleared on expand. */
const railTitles = new WeakSet<HTMLElement>();

export class FutureCssNav {
  private readonly root: HTMLElement;
  private readonly toggle: HTMLElement | null;
  private readonly options: NavOptions;
  private readonly onClick = () => {
    // aria-disabled keeps the toggle focusable, so it still receives clicks.
    if (this.toggle?.getAttribute("aria-disabled") === "true") return;
    this.setExpanded(!this.expanded);
  };

  constructor(root: HTMLElement | string, options: NavOptions = {}) {
    const el = typeof root === "string" ? document.querySelector<HTMLElement>(root) : root;
    if (!el) throw new Error(`FutureCssNav: no element for ${String(root)}`);
    this.root = el;
    this.options = options;
    this.toggle = el.querySelector<HTMLElement>(".fc-nav__toggle");

    if (this.toggle) {
      if (!el.id) el.id = `fc-nav-${++uid}`;
      if (!this.toggle.hasAttribute("aria-controls")) this.toggle.setAttribute("aria-controls", el.id);
      if (!this.toggle.hasAttribute("aria-expanded")) this.toggle.setAttribute("aria-expanded", "true");
      this.toggle.addEventListener("click", this.onClick);
    }
    this.syncTitles();
  }

  /** Whether the sidebar shows its labels. A sidebar with no toggle is always expanded. */
  get expanded(): boolean {
    return this.toggle?.getAttribute("aria-expanded") !== "false";
  }

  /** Expands or collapses the sidebar. A no-op without a toggle. */
  setExpanded(expanded: boolean): void {
    const toggle = this.toggle;
    if (!toggle || expanded === this.expanded) return;
    if (!expanded && this.focusWillBeHidden()) toggle.focus();
    toggle.setAttribute("aria-expanded", String(expanded));
    this.syncTitles();
    this.options.onToggle?.(expanded);
  }

  /**
   * Removes listeners, and releases the bound marker if `bindNavs` gave it to
   * this instance, so the sidebar can be bound again. Safe to call twice. The
   * sidebar keeps its last state.
   */
  destroy(): void {
    this.toggle?.removeEventListener("click", this.onClick);
    if (markerOwner.get(this.root) === this) {
      markerOwner.delete(this.root);
      // A host may have handed the element to another binding since; its
      // marker is not ours to remove.
      if (this.root.getAttribute("data-fc-bound") === "nav") this.root.removeAttribute("data-fc-bound");
    }
  }

  private syncTitles(): void {
    const collapsed = !this.expanded;
    for (const link of this.root.querySelectorAll<HTMLElement>(".fc-nav__link")) {
      if (collapsed) {
        // A title the author wrote says something the label does not; keep it.
        if (link.hasAttribute("title") && !railTitles.has(link)) continue;
        const label = link.querySelector(".fc-nav__label")?.textContent?.trim();
        if (!label) continue;
        link.setAttribute("title", label);
        railTitles.add(link);
      } else if (railTitles.has(link)) {
        link.removeAttribute("title");
        railTitles.delete(link);
      }
    }
  }

  private focusWillBeHidden(): boolean {
    const active = this.root.ownerDocument.activeElement;
    if (!active || !this.root.contains(active)) return false;
    return active.closest(".fc-nav__group-label, .fc-nav__list--nested") !== null;
  }
}

/** Binds every `.fc-nav` under `root` that is not already bound. */
export function bindNavs(root: ParentNode = document, options: NavOptions = {}): FutureCssNav[] {
  const bound: FutureCssNav[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(".fc-nav:not([data-fc-bound])")) {
    el.setAttribute("data-fc-bound", "nav");
    const nav = new FutureCssNav(el, options);
    markerOwner.set(el, nav);
    bound.push(nav);
  }
  return bound;
}
