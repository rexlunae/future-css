/**
 * Splitter bindings.
 *
 * Wires `fc-splitter` to the WAI-ARIA window splitter pattern. The separator's
 * `aria-valuenow` is the size of the element named by `aria-controls`, and the
 * binding keeps that element's `--fc-split-size` equal to it, so what a screen
 * reader hears and what is drawn cannot drift apart.
 *
 * - Drag with a pointer (mouse, pen or touch). Escape during a drag puts the
 *   size back where the drag started.
 * - Arrows along the bar's axis move it by `data-step` (5 for a percentage,
 *   16 for pixels); Shift moves it ten times as far.
 * - Home and End go to `aria-valuemin` and `aria-valuemax`.
 * - Enter collapses to the minimum, and restores the previous size from there.
 *
 * # Three things that are easy to get wrong
 *
 * **The keys move the bar, not the value.** ArrowRight moves a vertical bar
 * toward the right. Whether that grows or shrinks the controlled element
 * depends on which side of the bar it is on, and in a right-to-left region the
 * right is the inline start. Both are read from the DOM and computed style,
 * never assumed, so a sidebar on the inline end of an Arabic page resizes the
 * way the pointer does.
 *
 * **A percentage is of the split, a pixel is of the element.** Inside an
 * `fc-split` the value is the controlled pane's share of the split, so the
 * layout survives a window resize. On an `fc-splitter--edge` the value is the
 * element's border-box size in CSS pixels.
 *
 * **A collapsed pane is hidden.** A pane at zero size still holds focusable
 * content, and Tab would walk into controls nobody can see; its padding would
 * also keep a sliver of it drawn. The pane is `hidden` while it is at zero and
 * shown again as soon as it has any size.
 *
 * WASM: none. The model is a clamp and a ratio, smaller than the empty-module
 * cost of a crate; the work that matters here is measuring layout, which stays
 * in JavaScript by rule.
 */

export type SplitterUnit = "%" | "px";

export interface SplitterChange {
  value: number;
  unit: SplitterUnit;
  /** False while a drag is in progress, true when the size has settled. */
  final: boolean;
}

/** Whether the bar is vertical, i.e. it moves along the inline axis. */
function isInlineAxis(splitter: HTMLElement): boolean {
  return splitter.getAttribute("aria-orientation") !== "horizontal";
}

export function splitterUnit(splitter: HTMLElement): SplitterUnit {
  return splitter.classList.contains("fc-splitter--edge") ? "px" : "%";
}

/** The element whose size the splitter controls. */
export function splitterTarget(splitter: HTMLElement): HTMLElement | null {
  const id = splitter.getAttribute("aria-controls");
  if (id) {
    // A detached subtree has no getElementById; querySelector covers it.
    const root = splitter.getRootNode() as ParentNode;
    const named = root.querySelector(`#${CSS.escape(id)}`);
    if (named instanceof HTMLElement) return named;
  }
  if (splitterUnit(splitter) === "px") return splitter.parentElement;
  const prev = splitter.previousElementSibling;
  return prev instanceof HTMLElement ? prev : null;
}

/** The box a value is a fraction of (split) or bounded by (edge). */
function frame(splitter: HTMLElement, target: HTMLElement): HTMLElement | null {
  return splitterUnit(splitter) === "%" ? splitter.parentElement : target.parentElement;
}

function along(el: Element, inline: boolean): number {
  const r = el.getBoundingClientRect();
  return inline ? r.width : r.height;
}

function numberAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Edge splitters whose `aria-valuemax` the binding wrote from the container's
 * size. That bound follows the layout, so it is re-measured rather than read
 * back: a written number would freeze the container's size at bind time.
 */
const measuredMax = new WeakSet<HTMLElement>();

/** `aria-valuemin` and `aria-valuemax`, with defaults that keep the element on the page. */
export function splitterBounds(splitter: HTMLElement): { min: number; max: number } {
  const min = numberAttr(splitter, "aria-valuemin") ?? 0;
  let max = measuredMax.has(splitter) ? null : numberAttr(splitter, "aria-valuemax");
  if (max === null) {
    if (splitterUnit(splitter) === "%") max = 100;
    else {
      const target = splitterTarget(splitter);
      const box = target && frame(splitter, target);
      max = box ? along(box, isInlineAxis(splitter)) : Number.POSITIVE_INFINITY;
    }
  }
  return { min, max: Math.max(min, max) };
}

function round(value: number, unit: SplitterUnit): number {
  return unit === "%" ? Math.round(value * 10) / 10 : Math.round(value);
}

/** The current value: `aria-valuenow`, or the measured size when it is absent. */
export function splitterValue(splitter: HTMLElement): number {
  const now = numberAttr(splitter, "aria-valuenow");
  if (now !== null) return now;
  const target = splitterTarget(splitter);
  if (!target) return 0;
  const inline = isInlineAxis(splitter);
  const size = along(target, inline);
  if (splitterUnit(splitter) === "px") return round(size, "px");
  const box = frame(splitter, target);
  const total = box ? along(box, inline) : 0;
  return total > 0 ? round((size / total) * 100, "%") : 0;
}

/**
 * Sets the size, clamped to the bounds, and returns the value applied. Fires a
 * bubbling `fc-resize` event with a {@link SplitterChange} when the value
 * changes, and always when `final` is set, so a drag ends with one settled event.
 */
export function setSplitterValue(splitter: HTMLElement, value: number, final = true): number {
  return apply(splitter, value, final, final ? "always" : "changed");
}

type Emit = "always" | "changed" | "never";

function apply(splitter: HTMLElement, value: number, final: boolean, emit: Emit): number {
  const unit = splitterUnit(splitter);
  const { min, max } = splitterBounds(splitter);
  const next = round(Math.min(max, Math.max(min, value)), unit);
  const changed = numberAttr(splitter, "aria-valuenow") !== next;
  splitter.setAttribute("aria-valuenow", String(next));
  if (measuredMax.has(splitter) && Number.isFinite(max)) splitter.setAttribute("aria-valuemax", String(round(max, unit)));
  const target = splitterTarget(splitter);
  if (target) {
    target.style.setProperty("--fc-split-size", `${next}${unit}`);
    // An edge splitter lives inside its target; hiding that would hide the
    // handle that has to bring it back.
    if (!target.contains(splitter)) target.hidden = next <= 0;
  }
  if (emit === "always" || (emit === "changed" && changed)) {
    splitter.dispatchEvent(new CustomEvent<SplitterChange>("fc-resize", {
      bubbles: true,
      detail: { value: next, unit, final },
    }));
  }
  return next;
}

/** +1 when moving the bar toward the inline (or block) end grows the target. */
function growth(splitter: HTMLElement, target: HTMLElement): number {
  if (target.contains(splitter)) return 1;
  return target.compareDocumentPosition(splitter) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
}

function isRtl(el: Element): boolean {
  return getComputedStyle(el).direction === "rtl";
}

function disabled(splitter: HTMLElement): boolean {
  return splitter.getAttribute("aria-disabled") === "true";
}

/** The size Enter restores to, per splitter. */
const restore = new WeakMap<HTMLElement, number>();

/** Brings the target's size and the ARIA value into agreement. */
export function syncSplitter(splitter: HTMLElement): void {
  if (numberAttr(splitter, "aria-valuenow") === null && !splitterTarget(splitter)?.getClientRects().length) return;
  // A separator is a range widget once focusable; its bounds must be stated.
  if (!splitter.hasAttribute("aria-valuemax") && splitterUnit(splitter) === "px") measuredMax.add(splitter);
  // Silent: binding is not a change anyone made.
  const value = apply(splitter, splitterValue(splitter), true, "never");
  const { min, max } = splitterBounds(splitter);
  if (value > min && !restore.has(splitter)) restore.set(splitter, value);
  if (!splitter.hasAttribute("aria-valuemin")) splitter.setAttribute("aria-valuemin", String(min));
  if (!splitter.hasAttribute("aria-valuemax") && Number.isFinite(max)) splitter.setAttribute("aria-valuemax", String(round(max, splitterUnit(splitter))));
}

/** Re-clamps a splitter whose bound is its container, after the container resized. */
function reclamp(splitter: HTMLElement): void {
  if (!splitter.isConnected) return;
  // Announces only a real change: a shrink that pushed the value down.
  apply(splitter, splitterValue(splitter), true, "changed");
}

function onKeydown(event: KeyboardEvent, splitter: HTMLElement): void {
  if (disabled(splitter)) return;
  const target = splitterTarget(splitter);
  if (!target) return;
  const unit = splitterUnit(splitter);
  const { min, max } = splitterBounds(splitter);
  const current = splitterValue(splitter);
  const inline = isInlineAxis(splitter);
  const step = (numberAttr(splitter, "data-step") ?? (unit === "%" ? 5 : 16)) * (event.shiftKey ? 10 : 1);

  // Toward the end of the axis: right in LTR, left in RTL, down for a block bar.
  let towardEnd = 0;
  if (inline && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
    towardEnd = event.key === "ArrowRight" ? 1 : -1;
    if (isRtl(splitter)) towardEnd = -towardEnd;
  } else if (!inline && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    towardEnd = event.key === "ArrowDown" ? 1 : -1;
  }

  let next: number;
  if (towardEnd !== 0) next = current + towardEnd * growth(splitter, target) * step;
  else if (event.key === "Home") next = min;
  else if (event.key === "End") next = max;
  else if (event.key === "Enter") {
    if (current > min) {
      restore.set(splitter, current);
      next = min;
    } else next = restore.get(splitter) ?? max;
  } else return;

  event.preventDefault();
  setSplitterValue(splitter, next, true);
}

function onPointerdown(event: PointerEvent, splitter: HTMLElement, active: Set<() => void>): void {
  if (event.button !== 0 || disabled(splitter)) return;
  const target = splitterTarget(splitter);
  if (!target) return;
  const inline = isInlineAxis(splitter);
  const unit = splitterUnit(splitter);
  const box = frame(splitter, target);
  const total = box ? along(box, inline) : 0;
  if (unit === "%" && total <= 0) return;

  // Stops text selection and the compatibility mouse events; focus is moved by
  // hand so a keyboard user who grabs the bar can carry on with the arrows.
  event.preventDefault();
  splitter.focus({ preventScroll: true });
  splitter.setPointerCapture(event.pointerId);

  const start = splitterValue(splitter);
  const origin = inline ? event.clientX : event.clientY;
  const sign = growth(splitter, target) * (inline && isRtl(splitter) ? -1 : 1);
  const perPixel = unit === "%" ? 100 / total : 1;

  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    const delta = (inline ? e.clientX : e.clientY) - origin;
    setSplitterValue(splitter, start + sign * delta * perPixel, false);
  };
  const cancel = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    end(start);
  };
  const end = (settle?: number) => {
    splitter.removeEventListener("pointermove", move);
    splitter.removeEventListener("pointerup", up);
    splitter.removeEventListener("pointercancel", up);
    splitter.removeEventListener("keydown", cancel, true);
    if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
    active.delete(abort);
    const value = setSplitterValue(splitter, settle ?? splitterValue(splitter), true);
    if (value > splitterBounds(splitter).min) restore.set(splitter, value);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === event.pointerId) end();
  };
  // Unbinding mid-drag settles where the pointer left it, so no listener
  // outlives the binding that installed it.
  const abort = () => end();
  active.add(abort);

  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", up);
  splitter.addEventListener("pointercancel", up);
  // Capture phase, so Escape ends the drag before the arrow-key handler sees it.
  splitter.addEventListener("keydown", cancel, true);
}

function splitterFrom(event: Event): HTMLElement | null {
  const el = (event.target as Element | null)?.closest?.(".fc-splitter");
  return el instanceof HTMLElement ? el : null;
}

/**
 * Syncs every `.fc-splitter` under `root`, including ones added later, and
 * handles drag and keyboard for them. Returns a function that ends any drag in
 * progress and removes every listener and observer.
 */
export function bindSplitters(root: Document | HTMLElement = document): () => void {
  const active = new Set<() => void>();

  // An edge's default bound is its container, which can resize at any time.
  const watched = new Map<Element, Set<HTMLElement>>();
  const resized = new ResizeObserver((entries) => {
    for (const entry of entries) for (const splitter of watched.get(entry.target) ?? []) reclamp(splitter);
  });

  const init = (splitter: HTMLElement) => {
    syncSplitter(splitter);
    if (!measuredMax.has(splitter)) return;
    const target = splitterTarget(splitter);
    const box = target && frame(splitter, target);
    if (!box) return;
    if (!watched.has(box)) {
      watched.set(box, new Set());
      resized.observe(box);
    }
    watched.get(box)!.add(splitter);
  };
  for (const splitter of root.querySelectorAll<HTMLElement>(".fc-splitter")) init(splitter);

  // Splitters added later are synced on arrival, before anyone reads or
  // operates them: until then the drawn size and the announced one disagree.
  const added = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(".fc-splitter")) init(node);
        for (const splitter of node.querySelectorAll<HTMLElement>(".fc-splitter")) init(splitter);
      }
    }
  });
  added.observe(root, { childList: true, subtree: true });

  const keydown = (event: Event) => {
    const splitter = splitterFrom(event);
    if (splitter && event.target === splitter) onKeydown(event as KeyboardEvent, splitter);
  };
  const pointerdown = (event: Event) => {
    const splitter = splitterFrom(event);
    if (splitter) onPointerdown(event as PointerEvent, splitter, active);
  };
  root.addEventListener("keydown", keydown);
  root.addEventListener("pointerdown", pointerdown);
  return () => {
    for (const abort of [...active]) abort();
    added.disconnect();
    resized.disconnect();
    root.removeEventListener("keydown", keydown);
    root.removeEventListener("pointerdown", pointerdown);
  };
}
