/**
 * Embedded-browser chrome bindings.
 *
 * Navigation, address-bar handling, and load-state tracking for `fc-webview`.
 *
 * # Scope: chrome, not a browser
 *
 * This is the UI *around* an `<iframe>`. It does not intercept navigation, rewrite
 * URLs, or mediate requests -- and deliberately does not try to. A webview that
 * pretended to be a browser without being one would create a security boundary
 * that does not exist, which is worse than no boundary at all.
 *
 * # The cross-origin wall
 *
 * An embedded page on another origin cannot be read: `contentDocument` is null and
 * there is no supported way around it. Everything below works on the chrome only.
 * `load` tells us a navigation completed, not that it succeeded -- so the error
 * state is deliberately *not* derived from it, because a 404 and a successful page
 * both fire `load`.
 */

export interface WebviewOptions {
  /** The root `.fc-webview` element, or a selector for it. */
  root: Element | string;
  /** Called when the embedded URL should change. */
  onNavigate?: (url: string) => void;
  /** Called when the load state changes. */
  onStateChange?: (state: "idle" | "loading" | "loaded" | "error") => void;
}

/**
 * Schemes the address bar will navigate to.
 *
 * An allowlist, for the same reason the editor filters link URLs: a webview
 * address bar is a navigation primitive, and `javascript:` or `data:` in it is a
 * script-injection sink aimed at the host page's origin.
 */
const SAFE_SCHEMES = new Set(["http:", "https:", "about:"]);

export class FutureCssWebview {
  private readonly root: Element;
  private readonly frame: HTMLIFrameElement;
  private readonly options: WebviewOptions;

  /** The history this control owns; cross-origin back/forward is unavailable. */
  private history: string[] = [];
  private historyIndex = -1;

  constructor(options: WebviewOptions) {
    this.options = options;
    this.root =
      typeof options.root === "string" ? document.querySelector(options.root)! : options.root;
    if (!this.root) throw new Error("future-css: webview root not found");

    const frame = this.root.querySelector<HTMLIFrameElement>("iframe");
    if (!frame) throw new Error("future-css: webview has no iframe");
    this.frame = frame;

    this.applySecurity();
    this.wireNavigation();
    this.wireLoadStates();
    this.syncButtons();
  }

  /**
   * Sets the security attributes the frame needs.
   *
   * These are not optional hardening:
   *   - `sandbox` without `allow-same-origin` puts the embedded document in an
   *     opaque origin, so it cannot reach this page's cookies or storage. It is
   *     deliberately restrictive: a consumer who needs same-origin access should
   *     opt in knowingly.
   *   - `referrerpolicy` stops the embedded page from learning the host's URL,
   *     which is a real information leak in an authenticated app.
   *   - `allow` omits camera, microphone, and geolocation, so a third-party frame
   *     cannot prompt for them without the host saying so.
   */
  private applySecurity(): void {
    if (!this.frame.getAttribute("sandbox")) {
      this.frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
    }
    if (!this.frame.getAttribute("referrerpolicy")) {
      this.frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    }
    if (!this.frame.getAttribute("allow")) this.frame.setAttribute("allow", "");
  }

  /**
   * Navigates to a URL, recording it in history.
   *
   * An unsafe scheme is refused and reported rather than silently dropped: a user
   * who typed something they expected to work deserves to know it did not.
   */
  navigate(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl, window.location.href);
    } catch {
      this.setState("error");
      return;
    }

    if (!SAFE_SCHEMES.has(url.protocol)) {
      console.warn(`future-css: refused navigation to ${url.protocol}`);
      this.setState("error");
      return;
    }

    // A forward navigation discards the redo tail, exactly like browser history.
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(url.href);
    this.historyIndex = this.history.length - 1;

    this.frame.src = url.href;
    this.setState("loading");
    this.syncButtons();
    this.options.onNavigate?.(url.href);
  }
  /**
   * Goes back in this control's history.
   *
   * Returns false when there is nowhere to go, so the caller can disable the
   * button rather than presenting one that does nothing.
   */
  back(): boolean {
    if (this.historyIndex <= 0) return false;
    this.historyIndex -= 1;
    const url = this.history[this.historyIndex]!;
    this.frame.src = url;
    this.setState("loading");
    this.syncButtons();
    this.options.onNavigate?.(url);
    return true;
  }

  /** Goes forward, returning false when there is nothing ahead. */
  forward(): boolean {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex += 1;
    const url = this.history[this.historyIndex]!;
    this.frame.src = url;
    this.setState("loading");
    this.syncButtons();
    this.options.onNavigate?.(url);
    return true;
  }

  /**
   * Reloads the current document.
   *
   * `contentWindow.location.reload()` is unavailable cross-origin, so the src is
   * re-assigned, which works for every URL. No cache-busting counter: that defeats
   * the HTTP cache and makes reload measurably slower for no benefit.
   */
  reload(): void {
    const url = this.history[this.historyIndex];
    if (!url) return;
    this.frame.src = url;
    this.setState("loading");
  }

  private setState(state: "idle" | "loading" | "loaded" | "error"): void {
    this.root.dataset.fcState = state;
    this.options.onStateChange?.(state);
  }

  /**
   * Enables and disables the navigation buttons.
   *
   * Disabled rather than hidden: a button that disappears makes the control
   * change width as you navigate, shifting the layout under the pointer.
   */
  private syncButtons(): void {
    const set = (action: string, available: boolean) => {
      const button = this.root.querySelector<HTMLElement>(`[data-fc-action='${action}']`);
      if (!button) return;
      button.toggleAttribute("disabled", !available);
      button.setAttribute("aria-disabled", String(!available));
    };
    set("back", this.historyIndex > 0);
    set("forward", this.historyIndex < this.history.length - 1);
    set("reload", this.historyIndex >= 0);
  }

  private wireNavigation(): void {
    this.root.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-fc-action]");
      if (!action) return;
      event.preventDefault();

      switch (action.dataset.fcAction) {
        case "back": this.back(); break;
        case "forward": this.forward(); break;
        case "reload": this.reload(); break;
        case "home": this.navigate(this.root.dataset.fcHome ?? "about:blank"); break;
        default: break;
      }
    });

    // The address bar is a real form so Enter submits without a keydown handler,
    // which also gives mobile keyboards the right "Go" affordance for free.
    const form = this.root.querySelector<HTMLFormElement>("[data-fc-role='address-form']");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector<HTMLInputElement>("input");
      if (input?.value) this.navigate(input.value);
    });
  }

  private wireLoadStates(): void {
    this.frame.addEventListener("load", () => {
      // A `load` event means navigation completed, not that it succeeded: a 404
      // and a good page both fire it. Deriving `error` here would report failures
      // for pages that loaded fine.
      this.setState("loaded");
    });
    this.frame.addEventListener("error", () => this.setState("error"));
  }
}

/**
 * Whether a URL is safe to load in the frame.
 *
 * Exported so a host can validate a URL before showing it in the address bar,
 * rather than only at navigation time.
 */
export function isSafeFrameUrl(rawUrl: string, base?: string): boolean {
  try {
    const url = new URL(rawUrl, base ?? "about:blank");
    return SAFE_SCHEMES.has(url.protocol);
  } catch {
    return false;
  }
}
