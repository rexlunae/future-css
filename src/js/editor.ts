/**
 * Rich text editor bindings.
 *
 * Connects the `fc-editor` markup to behavior. The CSS is complete without any
 * of this: an un-enhanced editor is a region of formatted text with a toolbar
 * that does nothing, which is degraded but not broken.
 *
 * # Why this is not in WASM
 *
 * Everything here needs to ask the browser something: where the selection is,
 * what the browser considers a word, what the IME is composing. WASM cannot
 * observe any of that. The Rust/WASM layer owns the *document model* -- which
 * marks exist, how they nest, how to apply and remove them -- and this file owns
 * the DOM interaction. See docs/WASM.md.
 *
 * # The three things that are easy to get wrong
 *
 *   1. **Command state.** The toolbar must reflect the marks across the whole
 *      selection. Getting this wrong is how toolbars end up lying.
 *   2. **Marking without destroying the document.** Wrapping a selection in
 *      `<strong>` mutates the DOM under the caret, which collapses the selection
 *      and breaks IME composition.
 *   3. **Removing a mark must keep the text.** An editor that deletes content when
 *      a user clicks "remove bold" loses their work. `unwrap` is the most
 *      important function here for that reason.
 */

import {
  closestTag,
  currentRanges,
  elementAt,
  markedInSelection,
  placeCaret,
  selectionFullyMarked,
} from "./selection.ts";
import { checkUrl } from "./urls.ts";
import { bindToolbar } from "./toolbar.ts";

/** The marks this editor supports. Mirrors the `Mark` enum in fc-rich-text. */
export type Mark =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "link";

/** Block-level tags, which cannot be applied to a partial selection. */
export type BlockTag = "h1" | "h2" | "h3" | "pre" | "blockquote";

/** Marks expressible as a wrapping element. */
const WRAPPERS: Readonly<Partial<Record<Mark, string>>> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  strike: "s",
  code: "code",
};

/**
 * Tags that name a section rather than style a run.
 *
 * Excluded from mark removal: unwrapping a `<pre>` is not a formatting operation,
 * and doing it because the user clicked "remove code" would silently discard the
 * block's contents.
 */
const BLOCK_LEVEL = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6",
  "PRE", "BLOCKQUOTE", "UL", "OL", "DIV", "P", "SECTION",
]);

export interface EditorOptions {
  /** The root `.fc-editor` element, or a selector for it. */
  root: Element | string;
  /** Called whenever the document changes, with the current HTML. */
  onChange?: (html: string) => void;
  /** Called on selection change, with the active state of each mark. */
  onSelectionChange?: (active: Readonly<Record<Mark, boolean>>) => void;
}

export class FutureCssEditor {
  private readonly root: Element;
  private readonly content: HTMLElement;
  private readonly toolbar: HTMLElement | null;
  private readonly options: EditorOptions;

  /** Saved before a mutation, restored after, so the caret does not jump. */
  private selectionAnchor: { node: Node; offset: number; offsetInSelection: number } | null =
    null;

  /** Set during a DOM mutation so the input handler does not recurse. */
  private mutating = false;

  /** An empty mark started at a caret, waiting for the next keystroke; see `insertEmptyElement`. */
  private pendingMark: Element | null = null;

  /** Undoes every listener this editor added; see `destroy`. */
  private readonly cleanups: Array<() => void> = [];

  constructor(options: EditorOptions) {
    this.options = options;
    this.root =
      typeof options.root === "string" ? document.querySelector(options.root)! : options.root;
    if (!this.root) throw new Error("future-css: editor root not found");

    this.content = this.root.querySelector<HTMLElement>(".fc-editor__content")!;
    if (!this.content) {
      throw new Error("future-css: editor has no .fc-editor__content region");
    }
    this.toolbar = this.root.querySelector<HTMLElement>(".fc-toolbar");
    // The arrow-key contract the toolbar's role promises.
    if (this.toolbar) this.cleanups.push(bindToolbar(this.toolbar));

    this.wireToolbar();
    this.wireSelectionTracking();
  }

  /**
   * Removes every listener the editor added, for a host that unmounts it. The
   * document and its markup are left as they are.
   */
  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  /** Current document HTML. */
  get value(): string {
    return this.content.innerHTML;
  }

  /**
   * Replaces the document.
   *
   * `innerHTML` is correct here and only here: the content comes from the
   * application's own state. Passing untrusted HTML to this method is an XSS
   * sink, and it is called out because "rich text editor, takes HTML" is
   * exactly where that mistake gets made.
   */
  set value(html: string) {
    this.mutating = true;
    try {
      this.content.innerHTML = html;
    } finally {
      this.mutating = false;
    }
    this.options.onChange?.(html);
    this.syncToolbar();
  }

  /** Whether `mark` covers the whole current selection. See selection.ts. */
  isMarkActive(mark: Mark): boolean {
    // Links first: they have no wrapper entry, so the lookup below returns early.
    // The same whole-selection rule as the other marks: a selection that is only
    // partly linked must not press the link button.
    if (mark === "link") return selectionFullyMarked("A", this.content);
    const tagName = WRAPPERS[mark];
    if (!tagName) return false;
    return selectionFullyMarked(tagName, this.content);
  }

  /**
   * Applies a mark, or removes it if already active across the selection.
   *
   * Toggling is what clicking a toolbar button means, and it is why
   * `isMarkActive` asks about the whole selection rather than the focus: a
   * selection that is partly bold should bold the rest, not unbold it.
   */
  applyMark(mark: Mark): void {
    if (mark === "link") {
      this.promptForLink();
      return;
    }
    const tagName = WRAPPERS[mark];
    if (!tagName) return;

    // Saved here as well as in the toolbar handler: `applyMark` is a public API,
    // and a caller using it directly gets the same caret behavior as a click.
    this.preserveSelection();
    if (this.isMarkActive(mark)) this.removeMark(mark);
    else this.wrapSelection(tagName);

    this.afterMutation();
  }

  /**
   * Removes a mark by unwrapping it.
   *
   * The text always survives. See `unwrap`.
   */
  removeMark(mark: Mark): void {
    const tagName = WRAPPERS[mark];
    if (!tagName) return;

    for (const el of markedInSelection(tagName, this.content)) {
      // A container carries meaning beyond its formatting; unwrapping it would
      // change the document's structure rather than its appearance.
      if (BLOCK_LEVEL.has(el.tagName)) continue;
      this.unwrap(el);
    }
    this.afterMutation();
  }

  /**
   * Toggles a block: a heading, code block, or quote.
   *
   * Applies to the block containing the selection rather than the selection
   * itself, since `pre` cannot meaningfully wrap half a sentence.
   */
  toggleBlock(tag: BlockTag): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    this.preserveSelection();
    const already = this.blocksOfType(tag).length > 0;
    for (const el of this.blocksOfType(tag)) {
      this.unwrap(el);
    }

    if (!already) {
      // Wrap the innermost block that intersects the selection.
      const range = this.ownRanges()[0];
      if (range) {
        const container = elementAt(range.commonAncestorContainer)?.closest(
          "p,div,li,h1,h2,h3,h4,h5,h6,pre,blockquote",
        );
        if (container && container !== this.content) {
          const block = document.createElement(tag);
          // `append`, not `appendChild`: the latter takes one node and silently
          // dropped every child after the first when the paragraph was replaced.
          block.append(...Array.from(container.childNodes));
          container.replaceWith(block);
        }
      }
    }
    this.afterMutation();
  }

  // ---- internals --------------------------------------------------------

  /**
   * Wraps the selected range in `tagName`.
   *
   * `surroundContents` throws when the range partially selects a non-text node,
   * so the extract-and-reinsert path handles that case: it never throws, at the
   * cost of rebuilding the range.
   */
  private wrapSelection(tagName: string): void {
    this.mutating = true;
    try {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        this.insertEmptyElement(tagName);
        return;
      }
      for (const range of this.ownRanges()) {
        const wrapper = document.createElement(tagName);
        try {
          range.surroundContents(wrapper);
        } catch {
          wrapper.appendChild(range.extractContents());
          range.insertNode(wrapper);
        }
      }
    } finally {
      this.mutating = false;
    }
  }

  /** Inserts an empty marked element with the caret inside, so typing marks up. */
  private insertEmptyElement(tagName: string): void {
    this.mutating = true;
    try {
      const el = document.createElement(tagName);
      // At the caret, where the next keystroke lands, not at the end of the document.
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      // A caret in some other document is not this editor's to mark.
      if (!range || !this.content.contains(range.startContainer)) return;
      range.insertNode(el);
      placeCaret(el, 0);
      // The caret saved before the insert is still valid (the split left its text
      // node in place), so restoring it would move the caret back outside the new
      // element and the next keystroke would stay unmarked.
      this.selectionAnchor = null;
      // Even with the caret inside, Chrome moves typed text out of an empty inline
      // element; `beforeinput` puts the first character in it instead.
      this.pendingMark = el;
    } finally {
      this.mutating = false;
    }
  }

  /**
   * Prompts for a URL and wraps the selection in a link.
   *
   * A refused URL is reported rather than silently rewritten: quietly changing
   * what someone typed is worse than telling them it was rejected.
   */
  private promptForLink(): void {
    const href = window.prompt("Link URL");
    if (href === null) return;

    const verdict = checkUrl(href);
    if (!verdict.safe) {
      console.warn(
        `future-css: refused link with ${verdict.reason} "${verdict.scheme}:"`,
      );
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    this.preserveSelection();
    this.mutating = true;
    try {
      for (const range of this.ownRanges()) {
        const anchor = document.createElement("a");
        anchor.href = href;
        // `noopener` stops a `target="_blank"` link handing the opener over;
        // `noreferrer` withholds the referrer. A safe scheme does not imply either.
        anchor.rel = "noopener noreferrer";
        try {
          range.surroundContents(anchor);
        } catch {
          anchor.appendChild(range.extractContents());
          range.insertNode(anchor);
        }
      }
    } finally {
      this.mutating = false;
    }
    this.afterMutation();
  }

  /**
   * The selection's ranges that lie in this editor. The selection is global: with
   * two editors on a page, or a selection elsewhere, a toolbar click must not wrap,
   * link, or re-block text in a document it does not belong to.
   */
  private ownRanges(): Range[] {
    return currentRanges().filter((range) => this.content.contains(range.commonAncestorContainer));
  }

  /** Block elements of a given tag intersecting the selection. */
  private blocksOfType(tag: BlockTag): Element[] {
    return markedInSelection(tag.toUpperCase(), this.content);
  }
  /**
   * Removes an element while preserving its children.
   *
   * The single most important function in this file. An editor that deletes text
   * when a user clicks "remove bold" loses their work, so the children are moved
   * out before the shell is discarded -- never deleted.
   */
  private unwrap(el: Element): void {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    // Merging adjacent text nodes keeps the serialized HTML clean and stops
    // later queries from missing a mark that spans the seam.
    if (parent instanceof Element) parent.normalize();
  }

  /**
   * After a mutation: restore the caret, notify, resync the toolbar.
   *
   * Order matters. The caret is restored *before* the toolbar sync, because the
   * sync answers "what is marked at the caret?" -- and after a wrap the browser
   * has collapsed the selection to offset 0 of the container, just outside the
   * element it just created. Syncing first reported "not bold" for text the user
   * had just bolded.
   */
  private afterMutation(): void {
    this.restoreSelection();
    this.options.onChange?.(this.value);
    this.syncToolbar();
  }

  /**
   * Saves the selection before a DOM rewrite destroys it.
   *
   * Saving a node reference is not enough on its own: `surroundContents` *moves*
   * the selected text into a new element, leaving the original node detached or
   * emptied. So the offset is captured relative to the selection's own text, and
   * reapplied to whatever node ends up holding that text afterwards.
   */
  private preserveSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // The END of the selection, not the start.
    //
    // `Selection.anchorNode` is the *focus* edge, which for a forward selection is
    // the far end -- restoring that after a wrap lands the caret past the new
    // element rather than inside it, and the toolbar then reports the mark as
    // inactive immediately after it was applied. What the user cares about is
    // where their next keystroke will land, which is the end of the range.
    //
    // The character offset is recorded alongside because the node reference does
    // not survive the wrapper moving the text into a new element.
    const range = selection.getRangeAt(0);
    // Nothing to restore for a selection outside this editor; restoring "offset 0"
    // would pull the caret into this document.
    if (!this.content.contains(range.endContainer)) {
      this.selectionAnchor = null;
      return;
    }
    const endContainer = range.endContainer;
    const endOffset = range.endOffset;
    this.selectionAnchor = {
      node: endContainer,
      offset: endOffset,
      offsetInSelection: characterOffsetIn(endContainer, endOffset, this.content),
    };
  }

  /**
   * Restores the caret to the same *character position* the user had.
   *
   * The node reference is tried first and is usually still live. When a mark
   * wrapper moved the text, the browser has left the caret at offset 0 of the
   * container -- just outside the element it just created -- which makes the
   * toolbar report the mark as inactive immediately after applying it. Falling
   * back to the character offset puts the caret back inside the marked text,
   * where both the reported state and the user's next keystroke are correct.
   */
  private restoreSelection(): void {
    const anchor = this.selectionAnchor;
    if (!anchor) return;

    // `isConnected` is necessary but NOT sufficient. `surroundContents` empties the
    // original text node and leaves it in the tree, parking the caret inside that
    // now-empty node -- connected, but outside the element just created. That is
    // why the toolbar read "not bold" immediately after bolding text.
    const stillHasText =
      anchor.node.isConnected &&
      (anchor.node.textContent?.length ?? 0) > 0 &&
      anchor.offset <= (anchor.node.textContent?.length ?? 0);

    if (stillHasText) {
      placeCaret(anchor.node, anchor.offset);
      return;
    }

    // The text moved. Re-find it by character offset: it now lives inside the
    // element the command created, and putting the caret there is what makes both
    // the reported mark state and the user's next keystroke correct.
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const target = this.textNodeAtCharacterOffset(anchor.offsetInSelection);
    if (!target) return;

    const range = document.createRange();
    range.setStart(target.node, target.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * Finds the position `offset` characters into the content.
   *
   * Used only to restore the caret after a wrapper moved the text, so it walks
   * text nodes in document order and counts characters.
   */
  private textNodeAtCharacterOffset(offset: number): { node: Node; offset: number } | null {
    let remaining = Math.max(0, offset);
    const walker = document.createTreeWalker(this.content, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      node = walker.nextNode();
    }
    // Past the end: put the caret at the very end of the last text node.
    const last = this.content.lastChild;
    return last ? { node: last, offset: last.textContent?.length ?? 0 } : null;
  }

  // ---- wiring -----------------------------------------------------------

  private wireToolbar(): void {
    if (!this.toolbar) return;

    const onClick = (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-fc-mark], [data-fc-block]",
      );
      if (!button) return;
      event.preventDefault();

      this.preserveSelection();
      const mark = button.dataset.fcMark as Mark | undefined;
      const block = button.dataset.fcBlock as BlockTag | undefined;
      if (mark) this.applyMark(mark);
      else if (block) this.toggleBlock(block);

      // Return focus to the text, or the user has to click back in to keep typing.
      this.content.focus();
    };
    const toolbar = this.toolbar;
    toolbar.addEventListener("click", onClick);
    this.cleanups.push(() => toolbar.removeEventListener("click", onClick));
  }

  private wireSelectionTracking(): void {
    // `selectionchange` fires on the document, not the element: it does not
    // bubble from the element and is not delivered to it directly.
    const onSelectionChange = () => this.syncToolbar();
    document.addEventListener("selectionchange", onSelectionChange);
    // `document` outlives the editor; without removal, every editor ever mounted
    // would keep its tree alive and keep syncing on each selection change.
    this.cleanups.push(() => document.removeEventListener("selectionchange", onSelectionChange));

    const onInput = () => {
      if (this.mutating) return;
      this.options.onChange?.(this.value);
      this.syncToolbar();
    };
    this.content.addEventListener("input", onInput);
    this.cleanups.push(() => this.content.removeEventListener("input", onInput));

    const onBeforeInput = (event: InputEvent) => {
      const mark = this.pendingMark;
      if (!mark) return;
      // An IME's interim text is not the insertion the mark waits for: the
      // composition reaches the mark whole, at `compositionend`.
      if (event.isComposing || COMPOSITION_INPUT.has(event.inputType)) return;
      this.pendingMark = null;
      if (event.inputType !== "insertText" || !event.data) return;
      const selection = window.getSelection();
      // Only while the caret is still where the mark was started, and the mark empty.
      if (!mark.isConnected || mark.firstChild || !selection?.isCollapsed) return;
      if (selection.anchorNode !== mark) return;
      event.preventDefault();
      this.fillPendingMark(mark, event.data);
    };
    this.content.addEventListener("beforeinput", onBeforeInput);
    this.cleanups.push(() => this.content.removeEventListener("beforeinput", onBeforeInput));

    const onCompositionEnd = (event: CompositionEvent) => {
      const mark = this.pendingMark;
      this.pendingMark = null;
      const data = event.data;
      if (!mark || !data || !mark.isConnected || mark.firstChild) return;
      // Chrome commits the composition beside the empty mark rather than in it.
      // Select exactly that text, and only when it touches the mark, so nothing
      // else the user wrote is ever pulled into the mark.
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      if (!selection?.isCollapsed || !(node instanceof Text)) return;
      const end = selection.anchorOffset;
      const start = end - data.length;
      if (start < 0 || node.data.slice(start, end) !== data) return;
      const before = node.nextSibling === mark && end === node.length;
      const after = node.previousSibling === mark && start === 0;
      if (!before && !after) return;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      selection.removeAllRanges();
      selection.addRange(range);
      this.fillPendingMark(mark, data);
    };
    this.content.addEventListener("compositionend", onCompositionEnd);
    this.cleanups.push(() => this.content.removeEventListener("compositionend", onCompositionEnd));
  }

  /**
   * Replaces the selection -- the caret inside `mark`, or committed IME text
   * beside it -- with `mark` holding `text`, as one undoable edit.
   *
   * The empty mark was a plain DOM insert the browser's undo stack never saw.
   * Appending text to it directly kept the first character off that stack too,
   * so Undo skipped it and reverted an earlier edit instead. `insertHTML` records
   * the mark and its text together, and one Undo removes both.
   */
  private fillPendingMark(mark: Element, text: string): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed && range.startContainer === mark) {
      range.setStartBefore(mark);
      range.collapse(true);
    }
    const shell = mark.cloneNode(false) as Element;
    shell.textContent = text;
    // Taken out before the insert, so the recorded edit is the whole change.
    const parent = mark.parentNode;
    const next = mark.nextSibling;
    mark.remove();
    selection.removeAllRanges();
    selection.addRange(range);

    this.mutating = true;
    let inserted = false;
    try {
      inserted = document.execCommand("insertHTML", false, shell.outerHTML);
    } catch {
      inserted = false;
    } finally {
      this.mutating = false;
    }
    if (!inserted) {
      // No editing commands: keep the mark, outside the undo stack as before.
      parent?.insertBefore(mark, next);
      mark.textContent = text;
    }
    const filled = inserted ? this.markBeforeCaret(shell.tagName) : mark;
    // Chrome's insert matches the computed style of the insertion point and writes
    // the difference inline (`font-family: inherit` beside a heading, say). The
    // stylesheet already styles the mark; an inline copy would outlive a theme
    // change. The node is the one the undo entry holds, so Undo still removes it.
    if (inserted && filled && !mark.hasAttribute("style")) filled.removeAttribute("style");
    if (filled?.lastChild) placeCaret(filled.lastChild, filled.lastChild.textContent?.length ?? 0);
    // The insert ran with `mutating` set, so its own `input` reported nothing.
    this.options.onChange?.(this.value);
    this.syncToolbar();
  }

  /** The `tagName` element the caret sits at the end of, after an insert. */
  private markBeforeCaret(tagName: string): Element | null {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || !this.content.contains(node)) return null;
    const inside = closestTag(node instanceof Element ? node : node.parentElement, tagName, this.content);
    if (inside) return inside;
    const offset = selection!.anchorOffset;
    const previous =
      node instanceof Text ? (offset === 0 ? node.previousSibling : null) : node.childNodes[offset - 1];
    return previous instanceof Element && previous.tagName === tagName ? previous : null;
  }

  /**
   * Pushes mark state into the toolbar.
   *
   * Writes `aria-pressed` rather than a class, so the visual state and the
   * announced state cannot drift -- the same reasoning as the CSS.
   */
  private syncToolbar(): void {
    if (!this.toolbar) return;
    const active = {} as Record<Mark, boolean>;

    for (const button of this.toolbar.querySelectorAll<HTMLElement>("[data-fc-mark]")) {
      const mark = button.dataset.fcMark as Mark;
      const on = this.isMarkActive(mark);
      active[mark] = on;
      button.setAttribute("aria-pressed", String(on));
    }

    this.options.onSelectionChange?.(active);
  }
}

export { closestTag };

/** Input types an IME sends while composing; see `onCompositionEnd`. */
const COMPOSITION_INPUT = new Set(["insertCompositionText", "deleteCompositionText", "insertFromComposition"]);

/**
 * Characters between the start of `content` and a text position.
 *
 * Returns 0 rather than throwing for an offset that cannot be resolved, because
 * the caller uses this to *restore* a caret after a DOM rewrite -- a wrong guess
 * there is a caret in a slightly wrong place, whereas a throw would leave the
 * editor permanently unable to accept a mark.
 */
function characterOffsetIn(node: Node, offset: number, root: Element): number {
  // Measured as the text of a range from the root's start, which handles an element
  // endpoint (a block boundary, with `offset` counting children) as well as a text
  // one. Walking text nodes alone answered 0 for element endpoints, sending the caret
  // to the start of the document after a block change.
  if (!root.contains(node)) return 0;
  try {
    const range = document.createRange();
    range.setStart(root, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
}
