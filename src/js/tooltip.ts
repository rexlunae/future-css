/**
 * Tooltip bindings.
 *
 * The `fc-tooltip` CSS shows the bubble on hover and keyboard focus with no
 * script. This adds the two things CSS cannot do:
 *
 * 1. **Escape dismisses it** without moving focus or the pointer (WCAG 1.4.13,
 *    "dismissible"). A tooltip that covers the content beside it and cannot be
 *    closed without moving away is a barrier for magnifier users, whose whole
 *    view may be the tooltip.
 * 2. **The description is wired.** A bubble with no `id`, or a trigger with no
 *    `aria-describedby`, is silent to a screen reader; the binding connects them
 *    when the markup did not.
 *
 * One listener at the document handles every tooltip, including ones added
 * after binding, so a chat that renders new messages needs no re-binding.
 */

let uid = 0;

const DISMISSED = "data-fc-dismissed";

/** Connects each trigger to its bubble with aria-describedby. */
export function describeTooltips(root: ParentNode = document): void {
  for (const wrapper of root.querySelectorAll<HTMLElement>(".fc-tooltip")) {
    const bubble = wrapper.querySelector<HTMLElement>(".fc-tooltip__bubble");
    const trigger = wrapper.querySelector<HTMLElement>(
      "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    if (!bubble || !trigger) continue;
    bubble.setAttribute("role", "tooltip");
    if (!bubble.id) bubble.id = `fc-tooltip-${++uid}`;
    const ids = (trigger.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    if (!ids.includes(bubble.id)) trigger.setAttribute("aria-describedby", [...ids, bubble.id].join(" "));
  }
}

/**
 * Installs the Escape handler and the reset that lets a dismissed tooltip show
 * again once the user leaves it. Returns a function that removes both.
 */
export function bindTooltips(root: Document | HTMLElement = document): () => void {
  describeTooltips(root);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // Every tooltip currently showing: hovered or holding keyboard focus.
    const open = root.querySelectorAll<HTMLElement>(".fc-tooltip:hover, .fc-tooltip:has(:focus-visible)");
    let handled = false;
    for (const wrapper of open) {
      if (wrapper.getAttribute(DISMISSED) === "true") continue;
      wrapper.setAttribute(DISMISSED, "true");
      handled = true;
    }
    // Only swallow the key when it did something, so Escape still closes a
    // dialog the tooltip happens to sit in when no tooltip is showing.
    if (handled) event.stopPropagation();
  };

  // pointerleave does not bubble, so it is caught in the capture phase; only the
  // wrapper's own event counts; moving from the trigger onto the bubble fires
  // pointerleave on the trigger while the pointer is still inside the tooltip.
  const onPointerLeave = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.classList?.contains("fc-tooltip")) target.removeAttribute(DISMISSED);
  };

  const onFocusOut = (event: FocusEvent) => {
    const wrapper = (event.target as HTMLElement).closest?.(".fc-tooltip");
    if (wrapper && !wrapper.contains(event.relatedTarget as Node | null)) wrapper.removeAttribute(DISMISSED);
  };

  root.addEventListener("keydown", onKeyDown as EventListener, true);
  root.addEventListener("pointerleave", onPointerLeave, true);
  root.addEventListener("focusout", onFocusOut as EventListener, true);

  return () => {
    root.removeEventListener("keydown", onKeyDown as EventListener, true);
    root.removeEventListener("pointerleave", onPointerLeave, true);
    root.removeEventListener("focusout", onFocusOut as EventListener, true);
  };
}
