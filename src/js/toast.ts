/**
 * Toast bindings.
 *
 * Owns the `fc-toaster` region: creates its two live regions, renders each
 * toast with text (never HTML), times it out, and removes it.
 *
 * # Why two regions, created up front
 *
 * A live region announces changes to its content, but only if the region was
 * already in the accessibility tree when the change happened. Creating the
 * region and its first message in the same task is announced inconsistently
 * across screen readers, and often not at all. Politeness also cannot vary per
 * message within one region. So the toaster creates a `polite` list and an
 * `assertive` list once, empty, and routes each toast to one of them.
 *
 * # Timing
 *
 * - The timer pauses while the pointer is over the stack or focus is inside it.
 *   A toast that vanishes while someone is reading it, or while their cursor is
 *   on its action button, fails WCAG 2.2.1 (timing adjustable).
 * - `danger` toasts do not time out by default. An error that disappears on its
 *   own is an error the user may never have read.
 * - A toast with an action gets a longer default, since reading and deciding
 *   takes longer than reading.
 *
 * # Focus
 *
 * Toasts never take focus when they appear. If the user moves into one and it
 * is then dismissed, focus returns to where they came from, rather than falling
 * to `<body>` and stranding a keyboard user at the top of the document.
 */

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastOptions {
  title?: string;
  body?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  timeout?: number;
  /** One optional action, rendered as a button inside the toast. */
  action?: { label: string; onAction: () => void };
  /** Stable id for the data-fc-id attribute; generated when omitted. */
  id?: string;
}

export interface ToastHandle {
  readonly id: string;
  readonly element: HTMLElement;
  dismiss(): void;
}

export interface ToasterOptions {
  /** Oldest toasts are dismissed past this many. */
  max?: number;
  /** Default timeout for non-danger toasts without an action. */
  timeout?: number;
}

const GLYPH: Record<ToastTone, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  danger: "✕",
};

let uid = 0;

interface Live {
  element: HTMLElement;
  remaining: number;
  started: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class FutureCssToaster {
  readonly region: HTMLElement;
  private readonly polite: HTMLElement;
  private readonly assertive: HTMLElement;
  private readonly options: Required<ToasterOptions>;
  private readonly live = new Map<string, Live>();
  private paused = false;
  private returnFocus: HTMLElement | null = null;
  private readonly ownsRegion: boolean;

  private readonly onEnter = () => this.pause();
  private readonly onLeave = () => {
    if (!this.region.matches(":focus-within")) this.resume();
  };
  private readonly onFocusIn = (event: FocusEvent) => {
    const from = event.relatedTarget as HTMLElement | null;
    if (from && !this.region.contains(from)) this.returnFocus = from;
    this.pause();
  };
  private readonly onFocusOut = (event: FocusEvent) => {
    const to = event.relatedTarget as Node | null;
    if (!to || !this.region.contains(to)) {
      if (!this.region.matches(":hover")) this.resume();
    }
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const toast = (event.target as HTMLElement).closest<HTMLElement>(".fc-toast");
    const id = toast?.getAttribute("data-fc-id");
    if (id) {
      event.preventDefault();
      this.dismiss(id);
    }
  };

  constructor(region?: HTMLElement | string | null, options: ToasterOptions = {}) {
    this.options = { max: options.max ?? 3, timeout: options.timeout ?? 6000 };

    let el = typeof region === "string" ? document.querySelector<HTMLElement>(region) : region ?? null;
    this.ownsRegion = !el;
    if (!el) {
      el = document.createElement("section");
      el.className = "fc-toaster";
      el.setAttribute("aria-label", "Notifications");
      document.body.append(el);
    }
    this.region = el;
    this.polite = this.ensureList("status", "polite");
    this.assertive = this.ensureList("alert", "assertive");

    el.addEventListener("pointerenter", this.onEnter);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("focusin", this.onFocusIn);
    el.addEventListener("focusout", this.onFocusOut);
    el.addEventListener("keydown", this.onKeyDown);
  }

  /** Shows a toast and returns a handle to dismiss it early. */
  show(opts: ToastOptions): ToastHandle {
    const tone = opts.tone ?? "info";
    const id = opts.id ?? `fc-toast-${++uid}`;
    const timeout =
      opts.timeout ??
      (tone === "danger" ? 0 : opts.action ? this.options.timeout * 1.5 : this.options.timeout);

    const li = document.createElement("li");
    li.className = `fc-toast fc-toast--${tone}`;
    li.setAttribute("data-fc-kind", "toast");
    li.setAttribute("data-fc-id", id);
    li.setAttribute("data-fc-ts", new Date().toISOString());

    const icon = document.createElement("span");
    icon.className = "fc-toast__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = GLYPH[tone];

    const content = document.createElement("div");
    content.className = "fc-toast__content";
    if (opts.title) {
      const title = document.createElement("p");
      title.className = "fc-toast__title";
      title.textContent = opts.title;
      content.append(title);
    }
    if (opts.body) {
      const body = document.createElement("p");
      body.className = "fc-toast__body";
      body.textContent = opts.body;
      content.append(body);
    }
    if (opts.action) {
      const { label, onAction } = opts.action;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fc-toast__action";
      button.textContent = label;
      button.addEventListener("click", () => {
        onAction();
        this.dismiss(id);
      });
      content.append(button);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "fc-toast__close";
    // The name says what is being dismissed, so a list of several close buttons
    // is not read as "Dismiss, Dismiss, Dismiss".
    close.setAttribute("aria-label", `Dismiss: ${opts.title ?? opts.body ?? "notification"}`);
    close.textContent = "✕";
    close.addEventListener("click", () => this.dismiss(id));

    li.append(icon, content, close);
    (tone === "danger" ? this.assertive : this.polite).append(li);

    const entry: Live = { element: li, remaining: timeout, started: Date.now(), timer: null };
    this.live.set(id, entry);
    if (timeout > 0 && !this.paused) this.arm(id, entry);

    // Past the cap, the oldest goes -- but never one the user is focused in.
    const ids = [...this.live.keys()];
    for (const old of ids.slice(0, Math.max(0, ids.length - this.options.max))) {
      if (!this.live.get(old)!.element.matches(":focus-within")) this.dismiss(old);
    }

    return { id, element: li, dismiss: () => this.dismiss(id) };
  }

  /** Dismisses a toast by id, animating it out where motion is allowed. */
  dismiss(id: string): void {
    const entry = this.live.get(id);
    if (!entry) return;
    this.live.delete(id);
    if (entry.timer) clearTimeout(entry.timer);

    const el = entry.element;
    const hadFocus = el.contains(document.activeElement);
    el.setAttribute("data-fc-leaving", "true");

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      el.remove();
      if (hadFocus) {
        const back = this.returnFocus;
        this.returnFocus = null;
        if (back?.isConnected) back.focus();
      }
      if (this.live.size === 0 && !this.region.matches(":hover")) this.paused = false;
    };
    el.addEventListener("transitionend", remove, { once: true });
    // Reduced motion collapses the transition to ~0ms and some engines then
    // skip transitionend entirely; the timeout guarantees removal regardless.
    setTimeout(remove, 400);
  }

  /** Dismisses every toast. */
  clear(): void {
    for (const id of [...this.live.keys()]) this.dismiss(id);
  }

  /** Removes listeners, and the region too if the toaster created it. */
  destroy(): void {
    for (const entry of this.live.values()) if (entry.timer) clearTimeout(entry.timer);
    this.live.clear();
    this.region.removeEventListener("pointerenter", this.onEnter);
    this.region.removeEventListener("pointerleave", this.onLeave);
    this.region.removeEventListener("focusin", this.onFocusIn);
    this.region.removeEventListener("focusout", this.onFocusOut);
    this.region.removeEventListener("keydown", this.onKeyDown);
    if (this.ownsRegion) this.region.remove();
  }

  private ensureList(role: "status" | "alert", politeness: "polite" | "assertive"): HTMLElement {
    let list = this.region.querySelector<HTMLElement>(`.fc-toaster__list[aria-live="${politeness}"]`);
    if (!list) {
      list = document.createElement("ol");
      list.className = "fc-toaster__list";
      list.setAttribute("role", role);
      list.setAttribute("aria-live", politeness);
      this.region.append(list);
    }
    return list;
  }

  private arm(id: string, entry: Live): void {
    entry.started = Date.now();
    entry.timer = setTimeout(() => this.dismiss(id), entry.remaining);
  }

  private pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const entry of this.live.values()) {
      if (!entry.timer) continue;
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.started));
    }
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const [id, entry] of this.live) {
      if (entry.remaining > 0 && !entry.timer) this.arm(id, entry);
    }
  }
}
