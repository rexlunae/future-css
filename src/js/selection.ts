/**
 * Selection queries.
 *
 * Kept separate from the editor because almost none of it mutates anything, and
 * because these are the functions that are easy to get subtly wrong: they decide
 * what the toolbar claims is true about the current selection.
 *
 * # The rule everything here serves
 *
 * A toolbar that says "Bold is active" when only part of the selection is bold is
 * lying, and a user who trusts it will type expecting bold and get none. So every
 * "is this active" query asks about the **whole** range and returns false if any
 * part disagrees.
 *
 * The one deliberate exception is a *collapsed* selection -- a bare caret -- where
 * the question becomes "what mark would typing continue?", and the answer is the
 * enclosing element's mark.
 */

/** Resolves a node and offset to the element containing that text position. */
export function elementAt(node: Node | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  return node.parentElement;
}

/** Clones every range of the current selection, so callers can mutate safely. */
export function currentRanges(): Range[] {
  const selection = window.getSelection();
  if (!selection) return [];
  const out: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i += 1) {
    out.push(selection.getRangeAt(i).cloneRange());
  }
  return out;
}

/** The element a range should be scoped to when searching. */
export function rangeScope(range: Range, fallback: Element): Element {
  const root = range.commonAncestorContainer;
  if (root instanceof Element) return root;
  return root.parentElement ?? fallback;
}

/**
 * Every element intersecting a range.
 *
 * Includes elements the range only clips the edge of, which matters when
 * un-wrapping a mark: the selection may cover the middle of a `<strong>` without
 * covering the whole thing, and the mark should still be removed.
 */
export function elementsIn(range: Range, fallback: Element): Element[] {
  const out: Element[] = [];
  const scope = rangeScope(range, fallback);
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, null);
  let node = walker.nextNode();
  while (node) {
    const el = node as Element;
    if (range.intersectsNode(el)) out.push(el);
    node = walker.nextNode();
  }
  return out;
}

/**
 * Text nodes intersecting a range, skipping empty ones.
 *
 * Empty text nodes are skipped deliberately: an empty node is a caret position,
 * not content, and treating it as content makes `isMarkActive` report false for a
 * selection that only looks collapsed.
 */
export function textNodesIn(range: Range, fallback: Element): Node[] {
  const out: Node[] = [];
  const scope = rangeScope(range, fallback);
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    if (range.intersectsNode(node) && node.textContent && node.textContent.length > 0) {
      out.push(node);
    }
    node = walker.nextNode();
  }
  return out;
}

/** The nearest ancestor-or-self matching `tagName`, stopping at `boundary`. */
export function closestTag(el: Element | null, tagName: string, boundary: Element): Element | null {
  if (!tagName) return null;
  const upper = tagName.toUpperCase();
  let current: Element | null = el;
  while (current && current !== boundary) {
    if (current.tagName === upper) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Whether `tagName` covers the **entire** current selection.
 *
 * A collapsed selection reports the mark at the caret, which is what makes
 * typing onward continue the mark. A non-collapsed one requires every text node
 * in the range to be inside the element.
 */
export function selectionFullyMarked(
  tagName: string,
  boundary: Element,
): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  if (selection.isCollapsed) {
    const el = elementAt(selection.anchorNode);
    return el !== null && closestTag(el, tagName, boundary) !== null;
  }

  const ranges = currentRanges();
  if (ranges.length === 0) return false;

  for (const range of ranges) {
    const nodes = textNodesIn(range, boundary);
    // No text nodes means the selection is between blocks; nothing is marked, so
    // the honest answer is false rather than a vacuous true.
    if (nodes.length === 0) return false;
    for (const node of nodes) {
      const el = elementAt(node);
      if (!el || closestTag(el, tagName, boundary) === null) return false;
    }
  }
  return true;
}

/** Elements matching `tagName` that intersect the selection. */
export function markedInSelection(tagName: string, fallback: Element): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const upper = tagName.toUpperCase();

  const collect = (range: Range) => {
    for (const el of elementsIn(range, fallback)) {
      if (el.tagName === upper && !seen.has(el)) {
        seen.add(el);
        out.push(el);
      }
    }
  };

  for (const range of currentRanges()) {
    collect(range);
  }

  // A COLLAPSED range intersects nothing -- `Range.intersectsNode` is false for a
  // zero-length range, so the lookup above returns empty. That made toggling a
  // mark off at a bare caret silently do nothing, which is the most common way a
  // user interacts with a toolbar: bold some text, click bold again to unbold it.
  // For a caret the answer is its own enclosing element.
  const selection = window.getSelection();
  if (selection?.isCollapsed) {
    const el = elementAt(selection.anchorNode);
    if (el && el.tagName === upper && !seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  }

  return out;
}

/** Moves a collapsed range to a node/offset pair, clamped to its length. */
export function placeCaret(node: Node, offset: number): void {
  if (!node.isConnected) return;
  const range = document.createRange();
  try {
    range.setStart(node, Math.max(0, Math.min(offset, node.textContent?.length ?? 0)));
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // The node was replaced by a mutation since it was captured. Leaving the
    // selection where the browser put it beats throwing out of a click handler.
  }
}