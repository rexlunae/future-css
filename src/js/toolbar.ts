/**
 * Toolbar binding: the WAI-ARIA toolbar keyboard contract.
 *
 * A toolbar is one tab stop. Inside it, the arrow keys move between items --
 * Left/Right for a horizontal toolbar, Up/Down for one with
 * `aria-orientation="vertical"` -- and Home/End jump to the ends. Without
 * this, every button is its own tab stop and a keyboard user crosses the
 * whole bar to get past it.
 *
 * Roving tabindex rather than `aria-activedescendant`: focus really moves, so
 * each item's own focus ring, tooltip and accessible name work unchanged.
 *
 * Natively disabled items are skipped, because the browser cannot focus them.
 * `aria-disabled` items stay in the order, per the APG pattern, so a user can
 * still discover that the action exists.
 */

const ITEMS = "button, a[href], input, select, [tabindex]";
const TOGGLES = new Set(["button", "checkbox", "submit", "reset"]);

function items(toolbar: HTMLElement): HTMLElement[] {
  return [...toolbar.querySelectorAll<HTMLElement>(ITEMS)].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.closest("[role='toolbar']") === toolbar,
  );
}

/** Makes `target` the single tab stop. */
function rove(list: HTMLElement[], target: HTMLElement): void {
  for (const el of list) el.tabIndex = el === target ? 0 : -1;
}

/**
 * Binds one toolbar. Returns a function that removes the listeners and the
 * observer; the
 * tabindex values it set are left in place, which is still a valid order.
 */
export function bindToolbar(toolbar: HTMLElement): () => void {
  const initial = items(toolbar);
  // Keep a stop the markup already chose, so a pressed item can be the entry point.
  const chosen = initial.find((el) => el.getAttribute("tabindex") === "0") ?? initial[0];
  if (chosen) rove(initial, chosen);

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items(toolbar);
    const active = document.activeElement as HTMLElement;
    const current = list.indexOf(active);
    if (current < 0) return;
    // A text field or select inside a toolbar keeps its own arrow keys.
    if (active instanceof HTMLSelectElement) return;
    if (active instanceof HTMLInputElement && !TOGGLES.has(active.type)) return;

    const vertical = toolbar.getAttribute("aria-orientation") === "vertical";
    // In RTL the toolbar runs right to left, so Left moves forward.
    const rtl = getComputedStyle(toolbar).direction === "rtl";
    const next = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const prev = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";

    let index: number;
    if (event.key === next) index = (current + 1) % list.length;
    else if (event.key === prev) index = (current - 1 + list.length) % list.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = list.length - 1;
    else return;

    event.preventDefault();
    rove(list, list[index]);
    list[index].focus();
  };

  // A click or programmatic focus moves the stop too, so Tab back into the
  // toolbar returns to the item last used.
  const onFocusIn = (event: FocusEvent) => {
    const list = items(toolbar);
    const target = event.target as HTMLElement;
    if (list.includes(target)) rove(list, target);
  };

  // Apps disable and add items as commands come and go. Disabling the item
  // that holds the stop, or removing it, would leave no way to Tab back in,
  // so the stop moves to the first enabled item whenever it is lost.
  const reconcile = (): void => {
    const list = items(toolbar);
    if (list.length && !list.some((el) => el.tabIndex === 0)) rove(list, list[0]);
  };
  const observer = typeof MutationObserver === "function" ? new MutationObserver(reconcile) : null;
  observer?.observe(toolbar, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });

  toolbar.addEventListener("keydown", onKeyDown);
  toolbar.addEventListener("focusin", onFocusIn);
  return () => {
    observer?.disconnect();
    toolbar.removeEventListener("keydown", onKeyDown);
    toolbar.removeEventListener("focusin", onFocusIn);
  };
}

/** Binds every `[role="toolbar"]` under `root`. */
export function bindToolbars(root: ParentNode = document): Array<() => void> {
  return [...root.querySelectorAll<HTMLElement>("[role='toolbar']")].map(bindToolbar);
}
