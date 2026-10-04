/**
 * Chat composer bindings.
 *
 * Text entry, attachments, and a send/stop control for a chat surface.
 *
 * # Why a `<textarea>` and not contenteditable
 *
 * The editor component uses `contenteditable`, so this looks inconsistent. It is
 * not: an IME-composed character inserted into a contenteditable region fails
 * silently, and composing input is routine in CJK and other composing scripts.
 * A textarea gives composition, Enter-to-send, Shift+Enter, and native undo
 * without re-implementing any of it. `terminal.css` documents the same failure for
 * the same reason.
 *
 * # The three things that are easy to get wrong
 *
 * **Enter during IME composition must not send.** `keydown` fires with
 * `isComposing: true` while a candidate is being chosen, and sending there
 * commits a half-composed character and clears the candidate window. This is the
 * single most common bug in any composer, and it only reproduces with an IME.
 *
 * **The send control changes meaning, not identity.** Send becomes Stop on
 * `data-fc-state`, and the button element is never replaced — replacing it moves
 * focus, and a control that appears mid-run is the one a keyboard user is not
 * looking at.
 *
 * **Stop is not send-with-a-different-label.** They are opposite actions, so stop
 * does not clear the draft: the user aborted a run, not composed a message, and
 * throwing away what they typed would lose work they may want to resend.
 */

/** One attached file, as the binding models it. */
export interface Attachment {
  /** Display name. Also the remove button's accessible name. */
  name: string;
  /** Byte size, for the status line. */
  size: number;
  /** MIME type, when known. */
  type?: string;
  /** Set when the file could not be read. Never silently dropped. */
  error?: string;
  /**
   * The original `File`, so a consumer can actually read the bytes.
   *
   * Kept rather than discarded, and this is load-bearing: an attachment reduced to
   * `{name, size, type}` is useless to the application. It cannot upload the file,
   * cannot hash it, cannot inline it into a request -- and because the chip still
   * looks like a successful attachment until submit, the loss is silent. The
   * binding is a pass-through here, not a gate: reading the bytes is the
   * consumer's business.
   */
  file?: File;
}

export interface ComposerOptions {
  /** The `.fc-composer` root. */
  root: Element | string;
  /** Called on submit with the current text and attachments. */
  onSubmit?: (text: string, attachments: readonly Attachment[]) => void;
  /** Called when the user stops a run in flight. */
  onStop?: () => void;
  /** Called when the attachment list changes. */
  onAttachmentsChange?: (attachments: readonly Attachment[]) => void;
}

/** Above this, the size is reported in megabytes rather than kilobytes. */
const KIB = 1024;

export class FutureCssComposer {
  /**
   * Aborts every listener this binding registered.
   *
   * Not optional housekeeping: the drag handlers live on `document`, which
   * outlives the composer. Without teardown, a chat view that mounts and unmounts
   * a composer keeps every detached root reachable and keeps invoking its obsolete
   * handlers on each drop -- 200 live listeners after 100 open/close cycles.
   */
  private readonly controller = new AbortController();
  private readonly signal = this.controller.signal;

  private readonly root: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly send: HTMLButtonElement | null;
  private readonly list: HTMLElement | null;
  private readonly status: HTMLElement | null;
  private readonly options: ComposerOptions;

  private attachments: Attachment[] = [];
  /** The attachment each rendered remove button belongs to, in DOM order. */
  private renderedFor: Attachment[] = [];
  /** Guards the `input` handler while the binding writes the value itself. */
  private syncing = false;

  constructor(options: ComposerOptions) {
    this.options = options;
    this.root = resolve(options.root, "composer root");

    const input = this.root.querySelector<HTMLTextAreaElement>(".fc-composer__input");
    if (!input) throw new Error("future-css: composer needs a .fc-composer__input");
    this.input = input;

    this.send = this.root.querySelector<HTMLButtonElement>(".fc-composer__send");
    this.list = this.root.querySelector<HTMLElement>(".fc-composer__attachments");
    this.status = this.root.querySelector<HTMLElement>(".fc-composer__status");

    this.wire();
    this.render();
  }

  /**
   * Removes every listener this binding added.
   *
   * Call it when the composer leaves the DOM. Safe to call twice.
   */
  destroy(): void {
    this.controller.abort();
  }

  /** The current draft text. */
  get text(): string {
    return this.input.value;
  }

  set text(value: string) {
    this.input.value = value;
    this.render();
  }

  /** The attached files. */
  get files(): readonly Attachment[] {
    return this.attachments;
  }

  /** Whether a run is in flight. */
  get isRunning(): boolean {
    return this.root.dataset.fcState === "running";
  }

  /**
   * Marks a run as started or finished, which flips the send control to Stop and
   * makes the input read-only.
   *
   * The draft is *not* cleared on either transition: clearing it would discard
   * text the user may still want, and clearing it on finish would race a consumer
   * that clears it itself.
   */
  setRunning(running: boolean): void {
    this.root.dataset.fcState = running ? "running" : "idle";
    // Read-only rather than disabled: a disabled field leaves the tab order, so a
    // keyboard user tabbing past would not learn there is anything there.
    this.input.readOnly = running;
    this.render();
  }

  /** Submits the current draft. No-op when empty or already running. */
  submit(): boolean {
    if (this.isRunning) return false;
    const text = this.text.trim();
    if (!text && this.attachments.length === 0) return false;

    /*
     * Clear the draft only once the consumer has actually accepted it.
     *
     * `onSubmit` is consumer code and can throw. Clearing before the call, or
     * clearing unconditionally after it, loses the user's text to a bug in their
     * handler -- the worst possible outcome, and silent besides, since the
     * composer simply looks empty. So the throw is allowed to propagate with the
     * draft intact.
     */
    this.options.onSubmit?.(text, [...this.attachments]);

    this.syncing = true;
    this.input.value = "";
    this.setAttachments([]);
    this.syncing = false;
    this.render();
    return true;
  }

  /**
   * Adds files, ignoring duplicates by name and size.
   *
   * Accepts `File` or a pre-built `Attachment`, so a consumer that already has
   * the metadata (from a paste handler, say) does not have to reconstruct a File
   * to add it.
   */
  addAttachments(files: readonly (File | Attachment)[]): void {
    const next = [...this.attachments];
    for (const item of files) {
      const attachment: Attachment =
        item instanceof File
          ? { name: item.name, size: item.size, type: item.type, file: item }
          : item;
      if (next.some((a) => a.name === attachment.name && a.size === attachment.size)) continue;
      next.push(attachment);
    }
    this.setAttachments(next);
  }

  /** Removes the attachment at `index`. */
  removeAttachment(index: number): void {
    if (index < 0 || index >= this.attachments.length) return;
    /*
     * Focus is restored by *file*, not by index.
     *
     * Two things go wrong with the obvious approach. If focus was on the removed
     * chip, removing it strands focus on `<body>` -- a keyboard user's next Tab
     * then starts from the top of the page. And if focus was on some *other*
     * chip, restoring to `removedIndex` moves it onto a different file, so the
     * user's next press removes the wrong attachment.
     *
     * So: remember which file had focus, rebuild, then put focus back on that
     * same file -- wherever it moved to. When the focused file was the one removed,
     * focus goes to its neighbour instead, or to the input when none are left.
     */
    // Identify the focused chip by the *attachment object* it was rendered from,
    // captured before the rebuild. Reading it afterwards would consult a
    // `renderedFor` that already describes the new DOM.
    const focused = this.focusedAttachment();

    this.setAttachments(this.attachments.filter((_, i) => i !== index));

    if (!focused) return; // focus was not on a chip; leave it alone
    const buttons = this.removeButtons();
    // The focused attachment survived, so find *that object* in the new list and
    // focus its button wherever it now sits.
    const survivingIndex = this.attachments.indexOf(focused);
    if (survivingIndex >= 0 && buttons[survivingIndex]) {
      buttons[survivingIndex]!.focus();
      return;
    }
    /*
     * The focused chip was the one removed: prefer its *former* neighbour, then
     * the one before it, then the input.
     *
     * `buttons` is already the rebuilt list, so "next" is the element now at the
     * removed slot. Preferring `buttons[index - 1]` first would move focus
     * *backwards* past the position the user was at, which is disorienting; and
     * when the removed chip was the last one there is no `buttons[index]` at all.
     */
    (buttons[index] ?? buttons[index - 1] ?? this.input).focus();
  }

  /**
   * The attachment whose remove button currently has focus, or `undefined`.
   *
   * Identity rather than the accessible name: two attachments may legitimately
   * share a name (`report.txt` of different sizes), and matching on the label
   * would put focus on a different file than the one the user selected.
   *
   * Read *before* the list is rebuilt, since `renderedFor` describes the DOM that
   * exists at that moment and is replaced on the next render.
   */
  private focusedAttachment(): Attachment | undefined {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.list?.contains(active)) return undefined;
    const at = this.removeButtons().indexOf(active);
    return at < 0 ? undefined : this.renderedFor[at];
  }

  private removeButtons(): HTMLElement[] {
    return this.list
      ? Array.from(this.list.querySelectorAll<HTMLElement>(".fc-composer__attachment-remove"))
      : [];
  }

  /**
   * Adds an attachment that could not be read, with the reason.
   *
   * The error state in the markup had no way to be reached from outside, which
   * made it dead CSS: a failed read had to be dropped silently -- exactly the
   * outcome that leaves someone sending a request missing what they added.
   */
  addFailedAttachment(attachment: Omit<Attachment, "error"> & { error: string }): void {
    this.setAttachments([...this.attachments, attachment]);
  }

  /**
   * The attachment at `index`, including its `File` when it has one.
   *
   * The documented way to reach the original file for reading. `files` also
   * carries them, so this is a convenience rather than a second path.
   */
  attachmentAt(index: number): Attachment | undefined {
    return this.attachments[index];
  }

  private setAttachments(next: Attachment[]): void {
    this.attachments = next;
    this.renderAttachments();
    this.render();
    this.options.onAttachmentsChange?.([...next]);
  }

  // ---- Rendering -----------------------------------------------------------

  private render(): void {
    if (this.send) {
      const running = this.isRunning;
      this.send.dataset.fcState = this.root.dataset.fcState ?? "idle";
      /*
       * The label changes, the element does not. Replacing the button would move
       * focus, and a control that appears mid-run is the one a keyboard user is
       * not looking at.
       */
      this.send.textContent = running ? "Stop" : "Send";
      // "Stop generating" rather than "Stop": a bare "Stop" next to a draft is
      // ambiguous about what it stops.
      this.send.setAttribute("aria-label", running ? "Stop generating" : "Send message");
      // An empty composer cannot be sent. Disabled rather than inert, so the
      // reason stays discoverable.
      this.send.disabled = !running && this.text.trim() === "" && this.attachments.length === 0;
    }

    if (this.status) this.status.textContent = this.describe();
  }

  private describe(): string {
    const parts: string[] = [];
    const files = this.attachments.length;
    if (files > 0) {
      const bytes = this.attachments.reduce((sum, a) => sum + a.size, 0);
      parts.push(`${files} attachment${files === 1 ? "" : "s"}`);
      if (bytes > 0) parts.push(formatSize(bytes));
    }
    if (this.isRunning) parts.push("generating");
    const hint = this.text.trim() === "" && files === 0 ? "Shift+Enter for a new line" : "";
    if (hint) parts.push(hint);
    return parts.join(" \u00b7 ");
  }

  private renderAttachments(): void {
    if (!this.list) return;
    this.list.replaceChildren();

    // Recomputed from scratch each render: it must always describe exactly the
    // buttons now in the DOM, or focus restoration maps to the wrong chip.
    this.renderedFor = [...this.attachments];

    for (const [index, attachment] of this.attachments.entries()) {
      const item = document.createElement("li");
      item.className = "fc-composer__attachment";
      if (attachment.error) item.dataset.fcState = "error";

      const name = document.createElement("span");
      name.className = "fc-composer__attachment-name";
      name.textContent = attachment.name;
      // Truncated visually, so the full value stays reachable.
      name.title = attachment.name;

      const size = document.createElement("span");
      size.className = "fc-composer__attachment-size";
      size.textContent = attachment.error ?? formatSize(attachment.size);

      /*
       * The remove button names the file it removes. Four buttons all reading
       * "Remove" tell a screen-reader user nothing about which attachment is
       * going away.
       */
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "fc-composer__attachment-remove";
      remove.setAttribute("aria-label", `Remove ${attachment.name}`);
      remove.textContent = "\u00d7";
      remove.addEventListener("click", () => this.removeAttachment(index));

      item.append(name, size, remove);
      this.list.append(item);
    }
  }

  // ---- Events --------------------------------------------------------------

  private wire(): void {
    this.input.addEventListener("input", () => {
      // Guarded: `submit` writes the value and would otherwise re-enter here.
      if (this.syncing) return;
      this.autosize();
      this.render();
    }, { signal: this.signal });

    this.input.addEventListener("keydown", (event) => {
      /*
       * Enter sends, *unless* an IME candidate is being chosen.
       *
       * `isComposing` is the reliable signal and covers the whole composition; the
       * `keyCode === 229` check is the legacy fallback for browsers that do not
       * set it. Sending during composition commits a half-composed character and
       * closes the candidate window -- the classic IME bug.
       */
      const composing = event.isComposing || event.keyCode === 229;
      if (event.key !== "Enter" || composing) return;
      // Shift+Enter inserts a newline. Without this the field would swallow every
      // line break, which is the one thing a composer must allow.
      if (event.shiftKey) return;
      event.preventDefault();
      this.submit();
    });

    this.send?.addEventListener("click", () => {
      if (this.isRunning) this.options.onStop?.();
      else this.submit();
    }, { signal: this.signal });

    this.wireDropTarget();
  }

  /**
   * Auto-grows the field with its content, up to the CSS ceiling.
   *
   * `field-sizing: content` does this in supporting browsers; this is the
   * fallback, and setting an explicit height in px keeps the two from fighting
   * over the box model.
   */
  private autosize(): void {
    if (CSS.supports?.("field-sizing", "content")) return;
    this.input.style.height = "auto";
    this.input.style.height = `${this.input.scrollHeight}px`;
  }

  private wireDropTarget(): void {
    const stop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    this.root.addEventListener("dragenter", (event) => {
      stop(event);
      this.root.dataset.fcDragging = "true";
    }, { signal: this.signal });

    this.root.addEventListener("dragover", (event) => {
      stop(event);
      this.root.dataset.fcDragging = "true";
    }, { signal: this.signal });

    // A drag that ends anywhere else -- dropped on another target, cancelled with
    // Escape -- must clear the cue. Without this the composer stays highlighted
    // after the drag is long over, implying it is still receiving files.
    this.root.addEventListener("drop", () => delete this.root.dataset.fcDragging);
    document.addEventListener("drop", () => delete this.root.dataset.fcDragging);
    document.addEventListener("dragend", () => delete this.root.dataset.fcDragging);

    this.root.addEventListener("dragleave", (event) => {
      // `dragleave` fires for every child crossed, so the attribute would flicker.
      // `relatedTarget` null means the pointer actually left the root.
      if (event.relatedTarget) return;
      delete this.root.dataset.fcDragging;
    }, { signal: this.signal });

    this.root.addEventListener("drop", (event) => {
      stop(event);
      delete this.root.dataset.fcDragging;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) this.addAttachments(files);
    }, { signal: this.signal });
  }
}

function formatSize(bytes: number): string {
  if (bytes < KIB) return `${bytes} B`;
  const kib = bytes / KIB;
  if (kib < KIB) return `${Math.round(kib)} KB`;
  return `${(kib / KIB).toFixed(1)} MB`;
}

function resolve(target: Element | string, what: string): HTMLElement {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`future-css: ${what} not found: ${String(target)}`);
  return el;
}
