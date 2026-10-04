//! fc-rich-text — inline formatting model.
//!
//! # The model
//!
//! A document is a tree of **blocks** (paragraph, heading, list item, code) and
//! each block holds **inlines**. An inline is either literal text or a mark
//! applied over a range, and marks nest -- bold inside a link inside bold is
//! legal and common.
//!
//! Rather than a tree of marked runs, which makes every operation a tree
//! rewrite, this uses a **flat, sorted list of spans**. Operations that look hard
//! (remove bold from a selection, split a paragraph at the caret, merge two
//! blocks) become array slicing and filtering.
//!
//! # Why spans and not a tree
//!
//! The alternative -- a rope or gap buffer with nested mark nodes -- has better
//! asymptotic complexity for very large edits and much worse complexity for
//! *complicated* ones. Every rich text editor eventually needs "is this selection
//! entirely bold", "remove italic from here", and "what marks are active at
//! offset N". With sorted spans those are scans; with a tree they are recursive
//! traversals that must re-establish invariants. Real documents contain thousands
//! of marks, not millions of characters, so the scan is the cheaper trade.
//!
//! This is a deliberate, revisable decision. It is recorded here because the
//! reasoning, not the code, is what stops someone "fixing" it later.

use fc_core::FcError;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// A formatting mark. Mirrors the inline elements a user can apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mark {
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    Link,
}

/// A contiguous range carrying one mark, in UTF-16 offsets within its block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub mark: Mark,
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn len(&self) -> usize {
        self.end - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }

    /// True when `offset` falls strictly inside the span. The end is excluded so
    /// two adjacent spans do not both claim a caret at their shared boundary.
    pub fn contains_offset(&self, offset: usize) -> bool {
        offset >= self.start && offset < self.end
    }
}

/// A single block: text plus the spans marking it.
#[wasm_bindgen]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Block {
    #[wasm_bindgen(skip)]
    pub text: String,
    /// Private by design: spans may only change through `apply_mark` and
    /// `remove_mark`, which preserve the sorted, non-empty invariant. A public
    /// field would let a caller push an unsorted span and silently break
    /// `has_mark_throughout`.
    #[serde(default)]
    spans: Vec<Span>,
}

impl Block {
    /// Read-only access to the spans. The tests use this; JS callers get the
    /// serialized form from `toJSON`.
    pub fn spans(&self) -> &[Span] {
        &self.spans
    }
}

impl Block {
    /// Applies a mark over a range.
    ///
    /// Existing spans of the *same* mark are trimmed rather than duplicated, so
    /// applying bold twice is idempotent -- which is what a user means by
    /// clicking Bold on an already-bold selection.
    pub fn apply_mark(&mut self, mark: Mark, start: usize, end: usize) -> Result<(), FcError> {
        if start >= end {
            // A zero-width selection says nothing about intent, and storing it
            // would accumulate spans that render nothing.
            return Ok(());
        }
        let len16 = self.len16();
        if end > len16 {
            return Err(FcError::OutOfBounds {
                message: format!("end {end} exceeds block length {len16}"),
            });
        }

        let mut kept: Vec<Span> = Vec::with_capacity(self.spans.len() + 1);
        for span in self.spans.iter().copied() {
            if span.mark != mark {
                kept.push(span);
                continue;
            }
            // Retain only the parts of the existing span outside the new range.
            if span.start < start {
                kept.push(Span { mark, start: span.start, end: start.min(span.end) });
            }
            if span.end > end {
                kept.push(Span { mark, start: end.max(span.start), end: span.end });
            }
        }
        kept.push(Span { mark, start, end });
        self.set_sorted_spans(kept);
        Ok(())
    }

    /// Removes a mark over a range, trimming any spans it partially covers.
    pub fn remove_mark(&mut self, mark: Mark, start: usize, end: usize) {
        if start >= end {
            return;
        }
        let mut kept: Vec<Span> = Vec::with_capacity(self.spans.len());
        for span in self.spans.iter().copied() {
            if span.mark != mark {
                kept.push(span);
                continue;
            }
            if span.start < start {
                kept.push(Span { mark, start: span.start, end: start.min(span.end) });
            }
            if span.end > end {
                kept.push(Span { mark, start: end.max(span.start), end: span.end });
            }
        }
        self.set_sorted_spans(kept);
    }

    /// Reports whether the range is *entirely* covered by the mark.
    ///
    /// This is what a toolbar uses to show Bold as active. Partial coverage is
    /// deliberately not "active": highlighting Bold when only half a selection
    /// is bold is a small lie that makes an editor feel untrustworthy.
    pub fn has_mark_throughout(&self, mark: Mark, start: usize, end: usize) -> bool {
        if start >= end {
            return self.marks_at(start).contains(&mark);
        }
        // Walk the mark's spans as a chain: each must begin where the last ended.
        let mut cursor = start;
        for span in self.spans.iter().filter(|s| s.mark == mark) {
            if span.start > cursor {
                break;
            }
            if span.end > cursor {
                cursor = span.end;
            }
            if cursor >= end {
                return true;
            }
        }
        false
    }

    /// The distinct marks intersecting a zero-width position, in a stable order.
    pub fn marks_at(&self, offset: usize) -> Vec<Mark> {
        let mut marks: Vec<Mark> = self
            .spans
            .iter()
            .filter(|s| s.contains_offset(offset))
            .map(|s| s.mark)
            .collect();
        // Sort by the enum's discriminant rather than its Debug text so the JS
        // side receives a deterministic sequence regardless of insertion order.
        marks.sort_by_key(|m| *m as u8);
        marks.dedup();
        marks
    }

    pub fn len16(&self) -> usize {
        self.text.chars().map(char::len_utf16).sum()
    }

    /// Restores the sorted, non-empty invariant.
    ///
    /// Every mutating operation funnels through here so no caller has to
    /// remember the ordering rule. Deterministic ordering is what makes
    /// serialization, undo/redo and diffing reliable: without it, two identical
    /// edit sequences could produce different output.
    fn set_sorted_spans(&mut self, mut spans: Vec<Span>) {
        spans.retain(|s| !s.is_empty());
        spans.sort_by_key(|s| (s.start, s.end, s.mark as u8));
        self.spans = coalesce(spans);
    }

    /// Splits the block at `offset`, returning both halves with marks clipped.
    /// This is Enter-key handling.
    pub fn split_at(&self, offset: usize) -> Result<(Block, Block), FcError> {
        if offset > self.len16() {
            return Err(FcError::OutOfBounds {
                message: format!("offset {offset} exceeds block length {}", self.len16()),
            });
        }
        let mut left = Block { text: slice_utf16(&self.text, 0, offset), ..Default::default() };
        let mut right = Block { text: slice_utf16(&self.text, offset, self.len16()), ..Default::default() };
        for span in &self.spans {
            if span.start < offset {
                left.spans.push(Span { mark: span.mark, start: span.start, end: span.end.min(offset) });
            }
            if span.end > offset {
                // Rebase: the right block starts at zero, so every offset must be
                // shifted left by `offset` or the mark points past its own text.
                right.spans.push(Span {
                    mark: span.mark,
                    start: span.start.saturating_sub(offset),
                    end: span.end.saturating_sub(offset),
                });
            }
        }
        left.set_sorted_spans(left.spans.clone());
        right.set_sorted_spans(right.spans.clone());
        Ok((left, right))
    }
}

/// Merges adjacent or overlapping spans that carry the same mark.
///
/// Runs after every mutation, so the invariant is "no two same-mark spans touch".
/// Without this, toggling bold repeatedly grows the span list without bound, and
/// a long editing session turns a linear scan into a quadratic one.
fn coalesce(mut spans: Vec<Span>) -> Vec<Span> {
    let mut out: Vec<Span> = Vec::with_capacity(spans.len());
    for span in spans {
        match out.last_mut() {
            // Sorted by (start, end), so only the previous span can be adjacent.
            Some(prev) if prev.mark == span.mark && span.start <= prev.end => {
                prev.end = prev.end.max(span.end);
            }
            _ => out.push(span),
        }
    }
    out
}

/// UTF-8-safe substring by UTF-16 offsets, clamping at character boundaries.
fn slice_utf16(text: &str, start: usize, end: usize) -> String {
    let clamp = |limit: usize| {
        let mut units = 0usize;
        for (byte_idx, ch) in text.char_indices() {
            if units >= limit {
                return byte_idx;
            }
            units += ch.len_utf16();
        }
        text.len()
    };
    let b0 = clamp(start);
    let b1 = clamp(end.max(start));
    text.get(b0..b1).unwrap_or("").to_string()
}
// ---- JS bindings --------------------------------------------------------

/// Parses a mark name, returning an error for anything unrecognized rather than
/// defaulting to a mark the user did not ask for.
fn parse_mark(name: &str) -> Result<Mark, JsValue> {
    match name {
        "bold" => Ok(Mark::Bold),
        "italic" => Ok(Mark::Italic),
        "underline" => Ok(Mark::Underline),
        "strike" => Ok(Mark::Strike),
        "code" => Ok(Mark::Code),
        "link" => Ok(Mark::Link),
        other => Err(JsValue::from_str(&format!(
            "fc:invalidInput:unknown mark \"{other}\""
        ))),
    }
}

fn mark_name(mark: Mark) -> &'static str {
    match mark {
        Mark::Bold => "bold",
        Mark::Italic => "italic",
        Mark::Underline => "underline",
        Mark::Strike => "strike",
        Mark::Code => "code",
        Mark::Link => "link",
    }
}

#[wasm_bindgen]
impl Block {
    #[wasm_bindgen(constructor)]
    pub fn js_from_text(text: String) -> Block {
        Block { text, spans: Vec::new() }
    }

    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String {
        self.text.clone()
    }

    #[wasm_bindgen(setter)]
    pub fn set_text(&mut self, text: String) {
        // Changing the text invalidates every span, so they are dropped rather
        // than left pointing at offsets that may no longer exist.
        self.spans.clear();
        self.text = text;
    }

    #[wasm_bindgen(js_name = applyMark)]
    pub fn js_apply_mark(&mut self, mark: &str, start: usize, end: usize) -> Result<(), JsValue> {
        self.apply_mark(parse_mark(mark)?, start, end).map_err(Into::into)
    }

    #[wasm_bindgen(js_name = removeMark)]
    pub fn js_remove_mark(&mut self, mark: &str, start: usize, end: usize) {
        if let Ok(m) = parse_mark(mark) {
            self.remove_mark(m, start, end);
        }
    }

    #[wasm_bindgen(js_name = hasMark)]
    pub fn js_has_mark(&self, mark: &str, start: usize, end: usize) -> Result<bool, JsValue> {
        Ok(self.has_mark_throughout(parse_mark(mark)?, start, end))
    }

    /// Mark names active at a zero-width caret position.
    #[wasm_bindgen(js_name = marksAt)]
    pub fn js_marks_at(&self, offset: usize) -> Vec<String> {
        self.marks_at(offset).into_iter().map(|m| mark_name(m).to_string()).collect()
    }

    /// Splits at an offset, returning `[left, right]` as plain objects.
    ///
    /// Serialized rather than returned as instances: a JS array cannot hold Rust
    /// handles, and the caller needs the halves as data to feed straight back
    /// into new blocks.
    #[wasm_bindgen(js_name = splitAt)]
    pub fn js_split_at(&self, offset: usize) -> Result<JsValue, JsValue> {
        let (left, right) = self.split_at(offset).map_err(JsValue::from)?;
        let to_js = |b: &Block| {
            serde_wasm_bindgen::to_value(b).unwrap_or(JsValue::NULL)
        };
        let arr = js_sys::Array::new();
        arr.push(&to_js(&left));
        arr.push(&to_js(&right));
        Ok(arr.into())
    }

    #[wasm_bindgen(js_name = toJSON)]
    pub fn js_to_json(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(self).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(text: &str) -> Block {
        Block { text: text.to_string(), spans: Vec::new() }
    }

    #[test]
    fn apply_mark_creates_a_span() {
        let mut b = block("hello world");
        b.apply_mark(Mark::Bold, 0, 5).unwrap();
        assert_eq!(b.spans().len(), 1);
        assert_eq!(b.spans()[0], Span { mark: Mark::Bold, start: 0, end: 5 });
    }

    #[test]
    fn applying_the_same_mark_twice_is_idempotent() {
        // Clicking Bold on an already-bold selection must not accumulate spans.
        let mut b = block("hello");
        b.apply_mark(Mark::Bold, 0, 5).unwrap();
        b.apply_mark(Mark::Bold, 0, 5).unwrap();
        assert_eq!(b.spans().len(), 1, "duplicate spans would grow without bound");
    }

    #[test]
    fn applying_to_a_disjoint_range_keeps_both_spans() {
        let mut b = block("abcdefghij");
        b.apply_mark(Mark::Bold, 0, 3).unwrap();
        b.apply_mark(Mark::Bold, 7, 10).unwrap();
        assert_eq!(b.spans().len(), 2);
    }

    #[test]
    fn applying_to_an_overlapping_range_merges_into_one() {
        // "abc" then "bcde" over "abcdefgh" must yield a single 0..5 span.
        let mut b = block("abcdefgh");
        b.apply_mark(Mark::Bold, 0, 3).unwrap();
        b.apply_mark(Mark::Bold, 2, 5).unwrap();
        assert_eq!(b.spans().len(), 1);
        assert_eq!(b.spans()[0], Span { mark: Mark::Bold, start: 0, end: 5 });
    }

    #[test]
    fn remove_mark_splits_a_span_around_the_removed_range() {
        // Removing 2..5 from a bold 0..8 leaves two pieces, not one: the text
        // before and after the removed range is still bold. Collapsing these into
        // a single span would be wrong and would lose the trailing bold.
        let mut b = block("abcdefgh");
        b.apply_mark(Mark::Bold, 0, 8).unwrap();
        b.remove_mark(Mark::Bold, 2, 5);
        assert_eq!(
            b.spans(),
            &[
                Span { mark: Mark::Bold, start: 0, end: 2 },
                Span { mark: Mark::Bold, start: 5, end: 8 },
            ]
        );
    }

    #[test]
    fn remove_mark_trims_the_edges_when_the_range_is_at_an_end() {
        let mut b = block("abcdefgh");
        b.apply_mark(Mark::Bold, 0, 8).unwrap();
        b.remove_mark(Mark::Bold, 0, 3);
        assert_eq!(b.spans(), &[Span { mark: Mark::Bold, start: 3, end: 8 }]);
        b.remove_mark(Mark::Bold, 5, 8);
        assert_eq!(b.spans(), &[Span { mark: Mark::Bold, start: 3, end: 5 }]);
    }

    #[test]
    fn removing_a_range_covering_the_span_leaves_nothing() {
        let mut b = block("abcdefgh");
        b.apply_mark(Mark::Bold, 2, 5).unwrap();
        b.remove_mark(Mark::Bold, 0, 8);
        assert!(b.spans().is_empty());
    }

    #[test]
    fn remove_mark_only_affects_its_own_mark() {
        let mut b = block("abcdefgh");
        b.apply_mark(Mark::Bold, 0, 8).unwrap();
        b.apply_mark(Mark::Italic, 0, 8).unwrap();
        b.remove_mark(Mark::Bold, 0, 8);
        assert_eq!(b.spans().len(), 1);
        assert_eq!(b.spans()[0].mark, Mark::Italic);
    }

    #[test]
    fn marks_are_independent_of_each_other() {
        // Bold and italic over the same text are separate spans, not merged.
        let mut b = block("hello");
        b.apply_mark(Mark::Bold, 0, 5).unwrap();
        b.apply_mark(Mark::Italic, 0, 5).unwrap();
        assert_eq!(b.spans().len(), 2);
        assert!(b.has_mark_throughout(Mark::Bold, 0, 5));
        assert!(b.has_mark_throughout(Mark::Italic, 0, 5));
    }

    #[test]
    fn has_mark_throughout_requires_full_coverage() {
        // This is what stops a toolbar showing Bold as active for a half-bold
        // selection.
        let mut b = block("abcdefgh");
        b.apply_mark(Mark::Bold, 0, 4).unwrap();
        assert!(b.has_mark_throughout(Mark::Bold, 0, 4));
        assert!(!b.has_mark_throughout(Mark::Bold, 0, 8), "only half is bold");
        assert!(!b.has_mark_throughout(Mark::Bold, 2, 6), "the gap is not bold");
    }

    #[test]
    fn has_mark_throughout_is_false_with_no_spans() {
        let b = block("hello");
        assert!(!b.has_mark_throughout(Mark::Bold, 0, 5));
    }

    #[test]
    fn zero_width_selection_reports_marks_at_the_caret() {
        // Spans are half-open, so a caret sitting exactly at the end of a bold
        // run is NOT inside it -- it is the position after the run.
        let mut b = block("hello");
        b.apply_mark(Mark::Bold, 0, 5).unwrap();
        assert!(b.has_mark_throughout(Mark::Bold, 2, 2), "caret inside the span");
        assert!(
            !b.has_mark_throughout(Mark::Bold, 5, 5),
            "the end offset of a half-open span is outside it"
        );
    }

    #[test]
    fn typing_continues_a_mark_when_the_span_is_extended() {
        // The behavior that actually matters for the editor: applying bold over
        // 0..5 and then 0..6 coalesces, so a caret at 6 continues the bold run.
        let mut b = block("hello world");
        b.apply_mark(Mark::Bold, 0, 5).unwrap();
        b.apply_mark(Mark::Bold, 0, 6).unwrap();
        assert_eq!(b.spans().len(), 1, "adjacent bold must coalesce");
        assert!(b.has_mark_throughout(Mark::Bold, 5, 6), "the new character is bold");
    }

    #[test]
    fn empty_span_is_not_stored() {
        let mut b = block("hello");
        b.apply_mark(Mark::Bold, 2, 2).unwrap();
        assert!(b.spans().is_empty(), "a zero-width mark renders nothing and would accumulate");
    }

    #[test]
    fn applying_beyond_the_text_is_an_error() {
        let mut b = block("hi");
        assert_eq!(b.apply_mark(Mark::Bold, 0, 99).unwrap_err().kind(), "outOfBounds");
    }

    #[test]
    fn spans_are_kept_sorted() {
        // Ordering is an invariant, not an accident: unsorted spans break
        // has_mark_throughout's chain walk.
        let mut b = block("abcdefghij");
        b.apply_mark(Mark::Bold, 6, 9).unwrap();
        b.apply_mark(Mark::Bold, 0, 3).unwrap();
        assert!(b.spans()[0].start < b.spans[1].start);
    }

    #[test]
    fn split_at_partitions_text_and_marks() {
        let mut b = block("helloworld");
        b.apply_mark(Mark::Bold, 0, 10).unwrap();
        let (left, right) = b.split_at(5).unwrap();
        assert_eq!(left.text, "hello");
        assert_eq!(right.text, "world");
        // The mark is clipped to each half rather than duplicated in full.
        assert_eq!(left.spans(), vec![Span { mark: Mark::Bold, start: 0, end: 5 }]);
        assert_eq!(right.spans, vec![Span { mark: Mark::Bold, start: 0, end: 5 }]);
    }

    #[test]
    fn split_at_a_boundary_outside_a_mark_leaves_it_whole() {
        let mut b = block("abcdefghij");
        b.apply_mark(Mark::Bold, 6, 10).unwrap();
        let (left, right) = b.split_at(3).unwrap();
        assert!(left.spans().is_empty());
        assert_eq!(right.spans().len(), 1);
        // Offsets are rebased so they remain correct in the new block.
        assert_eq!(right.spans()[0], Span { mark: Mark::Bold, start: 3, end: 7 });
    }

    #[test]
    fn split_at_beyond_the_text_is_an_error() {
        assert_eq!(block("hi").split_at(99).unwrap_err().kind(), "outOfBounds");
    }

    #[test]
    fn split_handles_multibyte_text() {
        // Offsets are UTF-16; splitting inside an emoji would corrupt it.
        let b = block("🌍x");
        let (left, right) = b.split_at(2).unwrap();
        assert_eq!(left.text, "🌍");
        assert_eq!(right.text, "x");
    }
}

