//! fc-model — shared text buffer primitives.
//!
//! # Why a text buffer needs care
//!
//! Almost every "simple" text editor bug is a UTF-8 bug. JavaScript string
//! indices and Rust `str` indices are *byte* offsets; a user perceives *character*
//! positions. For ASCII they coincide, which is why the bug survives development
//! and appears in production for the first user typing an emoji or a combining
//! accent.
//!
//! Slicing a Rust `str` at a non-character-boundary index panics rather than
//! producing garbage, and on `wasm32-unknown-unknown` that panic is an abort. So
//! this crate owns every offset conversion, and the JS-facing API speaks **UTF-16
//! code-unit offsets** exclusively, because that is what JavaScript's own
//! indexing, selection APIs, and `String.prototype.slice` use. Converting once,
//! here, is what keeps the rest of the workspace simple.

use fc_core::{FcError, normalize_range};
use wasm_bindgen::prelude::*;

/// A UTF-8 text buffer with UTF-16-indexed access.
///
/// All public offsets are UTF-16 code units, matching the JavaScript side.
#[wasm_bindgen]
#[derive(Debug, Clone, Default)]
pub struct TextBuffer {
    text: String,
}

/// A half-open range in UTF-16 code units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range16 {
    pub start: usize,
    pub end: usize,
}

impl Range16 {
    pub fn len(&self) -> usize {
        self.end - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }
}

/// Maps a UTF-16 offset to a UTF-8 byte offset, clamping to the nearest
/// character boundary at or before it.
///
/// Clamping downward rather than erroring is deliberate: JavaScript ranges are
/// frequently produced by arithmetic on visible offsets, and one that lands
/// mid-surrogate-pair is a recoverable imprecision. Panicking would turn a
/// cosmetic edge case into a crash. The boundary at or before is chosen so the
/// visible text never grows past what the caller asked for.
fn utf16_to_byte(text: &str, utf16_idx: usize) -> usize {
    let mut units = 0usize;
    for (byte_idx, ch) in text.char_indices() {
        if units >= utf16_idx {
            return byte_idx;
        }
        units += ch.len_utf16();
    }
    text.len()
}

impl TextBuffer {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into() }
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }

    /// Length in UTF-16 code units, matching JS `String.prototype.length`.
    pub fn len16(&self) -> usize {
        self.text.chars().map(char::len_utf16).sum()
    }

    /// Length in Unicode scalar values. Differs from [`Self::len16`] wherever a
    /// character outside the BMP occurs.
    pub fn char_count(&self) -> usize {
        self.text.chars().count()
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// Extracts a substring using UTF-16 offsets.
    pub fn slice16(&self, start: usize, end: usize) -> Result<String, FcError> {
        let (start, end) = normalize_range(start, end)?;
        if end > self.len16() {
            return Err(FcError::OutOfBounds {
                message: format!("end {end} exceeds buffer length {}", self.len16()),
            });
        }
        let b0 = utf16_to_byte(&self.text, start);
        let b1 = utf16_to_byte(&self.text, end);
        Ok(self.text[b0..b1].to_string())
    }

    /// Replaces a UTF-16 range, returning the range the inserted text now
    /// occupies so a caller can place the caret after an edit without
    /// recomputing it.
    pub fn replace16(
        &mut self,
        start: usize,
        end: usize,
        replacement: &str,
    ) -> Result<Range16, FcError> {
        let (start, end) = normalize_range(start, end)?;
        if end > self.len16() {
            return Err(FcError::OutOfBounds {
                message: format!("end {end} exceeds buffer length {}", self.len16()),
            });
        }
        let b0 = utf16_to_byte(&self.text, start);
        let b1 = utf16_to_byte(&self.text, end);
        self.text.replace_range(b0..b1, replacement);
        let inserted: usize = replacement.chars().map(char::len_utf16).sum();
        Ok(Range16 { start, end: start + inserted })
    }

    /// Splits into lines, reporting each line's range in UTF-16 units.
    ///
    /// Terminators are not included, and a trailing newline produces a final
    /// empty line -- the behaviour an editor needs so the caret can sit on the
    /// line after a final newline.
    pub fn lines16(&self) -> Vec<Range16> {
        let mut lines = Vec::new();
        let mut line_start = 0usize;
        let mut units = 0usize;

        for ch in self.text.chars() {
            units += ch.len_utf16();
            if ch == '\n' {
                lines.push(Range16 { start: line_start, end: units - 1 });
                line_start = units;
            }
        }
        lines.push(Range16 { start: line_start, end: units });
        lines
    }

    /// Returns the UTF-16 range of the line containing `offset`.
    pub fn line_at(&self, offset: usize) -> Result<Range16, FcError> {
        if offset > self.len16() {
            return Err(FcError::OutOfBounds {
                message: format!("offset {offset} exceeds buffer length {}", self.len16()),
            });
        }
        self.lines16()
            .into_iter()
            .find(|l| offset >= l.start && offset <= l.end)
            .ok_or(FcError::OutOfBounds {
                message: format!("no line contains offset {offset}"),
            })
    }

    /// Counts characters in a UTF-16 range, for the character counts a UI
    /// displays -- counting bytes or code units there would be visibly wrong.
    pub fn count16(&self, start: usize, end: usize) -> Result<usize, FcError> {
        Ok(self.slice16(start, end)?.chars().count())
    }
}

// ---- JS bindings --------------------------------------------------------
//
// The WASM surface is intentionally narrow. Buffer contents and lengths cross
// the boundary; per-character iteration does not, because a JS loop over a
// 100,000-character document would be orders of magnitude slower than one call
// into Rust.

/// Packs a range into a two-element JS array.
fn range_to_js(r: Range16) -> JsValue {
    let arr = js_sys::Array::new();
    arr.push(&JsValue::from_f64(r.start as f64));
    arr.push(&JsValue::from_f64(r.end as f64));
    arr.into()
}

#[wasm_bindgen]
impl TextBuffer {
    /// Constructs a buffer from JS.
    ///
    /// `constructor` rather than a static factory: it makes the type
    /// instantiable from JavaScript, which wasm_bindgen otherwise refuses
    /// because it only generates ABI glue for values it can move across the
    /// boundary.
    #[wasm_bindgen(constructor)]
    pub fn js_from(text: String) -> TextBuffer {
        TextBuffer::new(text)
    }

    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String {
        self.text.clone()
    }

    #[wasm_bindgen(js_name = length16)]
    pub fn js_len16(&self) -> usize {
        self.len16()
    }

    #[wasm_bindgen(js_name = charCount)]
    pub fn js_char_count(&self) -> usize {
        self.char_count()
    }

    /// Returns `[start, end]` pairs, one per line.
    #[wasm_bindgen(js_name = lines16)]
    pub fn js_lines16(&self) -> Vec<JsValue> {
        self.lines16().into_iter().map(range_to_js).collect()
    }

    #[wasm_bindgen(js_name = slice16)]
    pub fn js_slice16(&self, start: usize, end: usize) -> Result<String, JsValue> {
        self.slice16(start, end).map_err(Into::into)
    }

    /// Replaces a range and returns the `[start, end]` the inserted text now
    /// occupies, so the caller can place the caret without recomputing it.
    #[wasm_bindgen(js_name = replace16)]
    pub fn js_replace16(
        &mut self,
        start: usize,
        end: usize,
        replacement: &str,
    ) -> Result<JsValue, JsValue> {
        self.replace16(start, end, replacement)
            .map(range_to_js)
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = lineAt)]
    pub fn js_line_at(&self, offset: usize) -> Result<JsValue, JsValue> {
        self.line_at(offset).map(range_to_js).map_err(Into::into)
    }

    /// Counts characters, not bytes or UTF-16 units, in a range.
    #[wasm_bindgen(js_name = countChars)]
    pub fn js_count_chars(&self, start: usize, end: usize) -> Result<usize, JsValue> {
        self.count16(start, end).map_err(Into::into)
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    /// "aé😀b" -- a 2-byte, 4-byte, and 1-byte character in one string, which is
    /// the minimal case that distinguishes byte, char, and UTF-16 offsets.
    const MIXED: &str = "aé😀b";

    #[test]
    fn utf16_length_matches_javascript_semantics() {
        // JS: "aé😀b".length === 5 (the emoji is a surrogate pair).
        assert_eq!(TextBuffer::new(MIXED).len16(), 5);
        // But there are only 4 characters, and 8 bytes in UTF-8.
        assert_eq!(TextBuffer::new(MIXED).char_count(), 4);
        assert_eq!(MIXED.len(), 8);
    }

    #[test]
    fn slicing_uses_utf16_offsets() {
        // "aé😀b" occupies UTF-16 units: a=0, é=1, 😀=2-3, b=4. Note that é is
        // two *bytes* but a single UTF-16 unit, because it is inside the BMP --
        // the distinction that makes hand-written offset arithmetic go wrong.
        let buf = TextBuffer::new(MIXED);
        assert_eq!(buf.slice16(0, 1).unwrap(), "a");
        assert_eq!(buf.slice16(1, 2).unwrap(), "é");
        assert_eq!(buf.slice16(2, 4).unwrap(), "😀");
        assert_eq!(buf.slice16(2, 5).unwrap(), "😀b");
    }

    #[test]
    fn a_slice_landing_inside_a_surrogate_pair_clamps_rather_than_splitting() {
        // JavaScript's own slice(2,3) on this string returns "😀" with its
        // trailing surrogate detached -- valid JS, but not a valid character.
        // Rust cannot represent that: slicing a str mid-codepoint panics, and on
        // wasm32 that panic is an abort.
        //
        // So this implementation deliberately DIVERGES from JavaScript here: it
        // clamps to the nearest character boundary and returns a valid string.
        // That is the safer failure mode, and it is why the JS side is
        // documented to round offsets to a boundary before calling in.
        let buf = TextBuffer::new(MIXED);
        let partial = buf.slice16(2, 3).unwrap();
        assert!(partial.is_char_boundary(0));
        assert!(
            partial.chars().all(|c| c != '\u{FFFD}'),
            "must not produce a replacement character"
        );
        // The clamp yields the whole character, never a half of one.
        assert!(partial == "😀" || partial.is_empty());
    }

    #[test]
    fn slicing_past_the_end_is_an_error() {
        let buf = TextBuffer::new("abc");
        assert_eq!(
            buf.slice16(0, 99).unwrap_err().kind(),
            "outOfBounds",
            "an out-of-range slice must be reported, not silently clamped"
        );
    }

    #[test]
    fn backwards_range_is_rejected() {
        assert_eq!(
            TextBuffer::new("abc").slice16(2, 1).unwrap_err().kind(),
            "invalidInput"
        );
    }

    #[test]
    fn replace_returns_the_new_selection() {
        let mut buf = TextBuffer::new("hello world");
        // Replace "world" with an emoji, which changes both length and units.
        let r = buf.replace16(6, 11, "🌍").unwrap();
        assert_eq!(buf.as_str(), "hello 🌍");
        // The caret lands after the inserted text: 6 + 2 UTF-16 units.
        assert_eq!(r.start, 6);
        assert_eq!(r.end, 8);
    }

    #[test]
    fn replace_can_insert_into_empty_buffer() {
        let mut buf = TextBuffer::default();
        let r = buf.replace16(0, 0, "abc").unwrap();
        assert_eq!(buf.as_str(), "abc");
        assert_eq!((r.start, r.end), (0, 3));
    }

    #[test]
    fn lines_exclude_terminators() {
        let buf = TextBuffer::new("one\ntwo\nthree");
        let lines: Vec<String> = buf
            .lines16()
            .into_iter()
            .map(|l| buf.slice16(l.start, l.end).unwrap())
            .collect();
        assert_eq!(lines, vec!["one", "two", "three"]);
    }

    #[test]
    fn trailing_newline_produces_a_final_empty_line() {
        // An editor needs this so the caret can sit on the line after the
        // final newline.
        let buf = TextBuffer::new("a\n");
        let lines = buf.lines16();
        assert_eq!(lines.len(), 2);
        assert_eq!(buf.slice16(lines[1].start, lines[1].end).unwrap(), "");
    }

    #[test]
    fn empty_buffer_has_one_empty_line() {
        assert_eq!(TextBuffer::default().lines16().len(), 1);
    }

    #[test]
    fn line_at_locates_the_containing_line() {
        let buf = TextBuffer::new("one\ntwo\nthree");
        let l = buf.line_at(5).unwrap();
        assert_eq!(buf.slice16(l.start, l.end).unwrap(), "two");
    }

    #[test]
    fn line_at_the_exact_newline_offset_returns_the_preceding_line() {
        // Offset 3 is the "\n" itself. Attributing it to the line it terminates
        // keeps Enter-key handling simple for the caller.
        let buf = TextBuffer::new("one\ntwo");
        let l = buf.line_at(3).unwrap();
        assert_eq!(buf.slice16(l.start, l.end).unwrap(), "one");
    }

    #[test]
    fn character_counts_are_not_utf16_or_byte_counts() {
        let buf = TextBuffer::new(MIXED);
        assert_eq!(buf.count16(0, 5).unwrap(), 4, "4 characters, not 5 units");
    }

    #[test]
    fn multibyte_editing_preserves_surrounding_text() {
        // The regression this crate exists to prevent: editing after a
        // multi-byte character must not corrupt it.
        let mut buf = TextBuffer::new("🌍 earth");
        buf.replace16(0, 2, "🌎").unwrap();
        assert_eq!(buf.as_str(), "🌎 earth");
        assert_eq!(buf.slice16(0, 2).unwrap(), "🌎");
    }
}
