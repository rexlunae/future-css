//! fc-ansi — ANSI SGR parsing, the Rust twin of `src/js/ansi.ts`.
//!
//! Turns raw program output into lines of styled [`Run`]s: one of the sixteen
//! `fc-term-ansi-*` colours plus bold, dim, italic, underline, inverse and
//! strike, which is everything the terminal component can render.
//!
//! # Streaming
//!
//! Output arrives in writes that split wherever the pipe happened to flush, so
//! the [`Parser`] keeps its state between chunks: an escape sequence, a CRLF or a
//! UTF-8 character cut in half by a write still parses. Completed lines are
//! drained with [`Parser::take_lines`]; the line still being written is
//! [`Parser::current`], and [`Parser::finish`] closes it at end of stream.
//!
//! # What is deliberately not mapped
//!
//! 256-colour and truecolor (`38;5;n`, `38;2;r;g;b`) fall back to the default
//! foreground. Mapping them would mean writing inline colours, which no theme
//! can remap and no contrast test can check. Their parameters are still skipped
//! correctly, so `38;5;196;1` remains bold. Backgrounds (40–49, 100–107) have no
//! slot in a run and are ignored for the same reason.
//!
//! Cursor movement, erase and every other non-SGR CSI, OSC (window titles,
//! hyperlinks), DCS/SOS/PM/APC strings and two-byte escapes are consumed and
//! never shown as text. This is a styler for a log, not a screen emulator.
//!
//! # Line breaks
//!
//! `\n`, `\r\n` and a lone `\r` each end exactly one line. A lone `\r` is how a
//! progress bar redraws itself; with no cursor to return, keeping each frame on
//! its own line loses nothing, where dropping the `\r` would run the frames
//! together into one unreadable line. The break happens on the `\r` itself, so a
//! CRLF split between writes cannot produce a blank line.
//!
//! # Other control characters
//!
//! Tab is text. Every other C0 control and DEL is dropped, since none of them
//! has a glyph. Bytes that are not valid UTF-8 decode to U+FFFD exactly as
//! `TextDecoder` does, so the JS twin can use the platform decoder.

// `no_std` on wasm for size; see the fc-diff crate root for the reasoning.
#![cfg_attr(all(target_arch = "wasm32", feature = "bare", not(test)), no_std)]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;

#[cfg(all(target_arch = "wasm32", feature = "bare", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(all(target_arch = "wasm32", feature = "bare", not(test)))]
#[global_allocator]
static ALLOC: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

/// One of the sixteen ANSI colour slots. Each maps to a `.fc-term-ansi-*` class.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnsiColor {
    /// SGR 30.
    Black,
    /// SGR 31.
    Red,
    /// SGR 32.
    Green,
    /// SGR 33.
    Yellow,
    /// SGR 34.
    Blue,
    /// SGR 35.
    Magenta,
    /// SGR 36.
    Cyan,
    /// SGR 37.
    White,
    /// SGR 90.
    BrightBlack,
    /// SGR 91.
    BrightRed,
    /// SGR 92.
    BrightGreen,
    /// SGR 93.
    BrightYellow,
    /// SGR 94.
    BrightBlue,
    /// SGR 95.
    BrightMagenta,
    /// SGR 96.
    BrightCyan,
    /// SGR 97.
    BrightWhite,
}

impl AnsiColor {
    /// Every colour, in wire order: a colour's index here is its code.
    pub const ALL: [Self; 16] = [
        Self::Black,
        Self::Red,
        Self::Green,
        Self::Yellow,
        Self::Blue,
        Self::Magenta,
        Self::Cyan,
        Self::White,
        Self::BrightBlack,
        Self::BrightRed,
        Self::BrightGreen,
        Self::BrightYellow,
        Self::BrightBlue,
        Self::BrightMagenta,
        Self::BrightCyan,
        Self::BrightWhite,
    ];

    /// The wire code, 0–15: normal colours first, then bright.
    pub const fn index(self) -> u8 {
        self as u8
    }

    /// The colour for a wire code, or `None` past 15.
    pub fn from_index(index: u8) -> Option<Self> {
        Self::ALL.get(index as usize).copied()
    }

    /// The slot name `ansi.ts` uses, which is also the token suffix.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Black => "black",
            Self::Red => "red",
            Self::Green => "green",
            Self::Yellow => "yellow",
            Self::Blue => "blue",
            Self::Magenta => "magenta",
            Self::Cyan => "cyan",
            Self::White => "white",
            Self::BrightBlack => "bright-black",
            Self::BrightRed => "bright-red",
            Self::BrightGreen => "bright-green",
            Self::BrightYellow => "bright-yellow",
            Self::BrightBlue => "bright-blue",
            Self::BrightMagenta => "bright-magenta",
            Self::BrightCyan => "bright-cyan",
            Self::BrightWhite => "bright-white",
        }
    }

    /// The class that applies this colour in `terminal.css`.
    pub const fn class_name(self) -> &'static str {
        match self {
            Self::Black => "fc-term-ansi-black",
            Self::Red => "fc-term-ansi-red",
            Self::Green => "fc-term-ansi-green",
            Self::Yellow => "fc-term-ansi-yellow",
            Self::Blue => "fc-term-ansi-blue",
            Self::Magenta => "fc-term-ansi-magenta",
            Self::Cyan => "fc-term-ansi-cyan",
            Self::White => "fc-term-ansi-white",
            Self::BrightBlack => "fc-term-ansi-bright-black",
            Self::BrightRed => "fc-term-ansi-bright-red",
            Self::BrightGreen => "fc-term-ansi-bright-green",
            Self::BrightYellow => "fc-term-ansi-bright-yellow",
            Self::BrightBlue => "fc-term-ansi-bright-blue",
            Self::BrightMagenta => "fc-term-ansi-bright-magenta",
            Self::BrightCyan => "fc-term-ansi-bright-cyan",
            Self::BrightWhite => "fc-term-ansi-bright-white",
        }
    }
}

/// A set of text attributes, as a bitmask whose bits are the wire encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Attributes(u8);

impl Attributes {
    /// SGR 1; cleared by 22.
    pub const BOLD: Self = Self(1);
    /// SGR 2; cleared by 22.
    pub const DIM: Self = Self(2);
    /// SGR 3; cleared by 23.
    pub const ITALIC: Self = Self(4);
    /// SGR 4; cleared by 24.
    pub const UNDERLINE: Self = Self(8);
    /// SGR 7; cleared by 27.
    pub const INVERSE: Self = Self(16);
    /// SGR 9; cleared by 29.
    pub const STRIKE: Self = Self(32);

    /// Each attribute with its name, in bit order. The name is also the
    /// `.fc-terminal__<name>` class suffix.
    pub const ALL: [(Self, &'static str); 6] = [
        (Self::BOLD, "bold"),
        (Self::DIM, "dim"),
        (Self::ITALIC, "italic"),
        (Self::UNDERLINE, "underline"),
        (Self::INVERSE, "inverse"),
        (Self::STRIKE, "strike"),
    ];

    /// No attributes.
    pub const fn empty() -> Self {
        Self(0)
    }

    /// The bitmask.
    pub const fn bits(self) -> u8 {
        self.0
    }

    /// From a bitmask, dropping bits that name no attribute.
    pub const fn from_bits_truncate(bits: u8) -> Self {
        Self(bits & 63)
    }

    /// True when no attribute is set.
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// True when every attribute in `other` is set.
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    /// Sets every attribute in `other`.
    pub fn insert(&mut self, other: Self) {
        self.0 |= other.0;
    }

    /// Clears every attribute in `other`.
    pub fn remove(&mut self, other: Self) {
        self.0 &= !other.0;
    }

    /// The names of the attributes set, in bit order.
    pub fn names(self) -> impl Iterator<Item = &'static str> {
        Self::ALL.into_iter().filter(move |(a, _)| self.contains(*a)).map(|(_, n)| n)
    }
}

impl core::ops::BitOr for Attributes {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

/// Text that shares one style. Never empty, and never contains a line break.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    /// The text, with every escape sequence and control character removed.
    pub text: String,
    /// The foreground, or `None` for the terminal's default.
    pub fg: Option<AnsiColor>,
    /// The attributes in effect.
    pub attributes: Attributes,
}

/// One line of output. Adjacent runs always differ in style.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Line {
    /// The runs, in order. Empty for a blank line.
    pub runs: Vec<Run>,
}

impl Line {
    /// The line's text without styling.
    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }
}

/// At most this many parameters of one CSI sequence are kept; the rest are
/// consumed and ignored. No SGR needs more, and an unbounded list would let one
/// malformed sequence grow memory without limit.
const MAX_PARAMS: usize = 32;
/// Parameter values saturate here, for the same reason.
const MAX_VALUE: u32 = 65_535;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    /// After ESC.
    Escape,
    /// After ESC and one or more intermediate bytes, such as `ESC ( B`.
    EscapeIntermediate,
    /// Inside `ESC [`.
    Csi,
    /// Inside OSC, DCS, SOS, PM or APC, which all end at ST; OSC may also end
    /// at BEL, and xterm accepts BEL for the others too.
    String,
    /// After ESC inside a string: `\` completes ST, anything else aborts it.
    StringEscape,
}

/// One CSI parameter: its value, and the first colon sub-parameter if any.
#[derive(Debug, Clone, Copy)]
struct Param {
    value: u32,
    sub: Option<u32>,
}

/// A streaming ANSI parser. See the crate docs for what it keeps and drops.
#[derive(Debug, Clone)]
pub struct Parser {
    state: State,
    params: Vec<Param>,
    value: u32,
    sub: Option<u32>,
    /// 0 outside a sub-parameter, 1 in the first, 2 in any later one.
    sub_depth: u8,
    /// A `<`, `=`, `>` or `?` parameter byte: a private sequence, never SGR.
    private: bool,
    /// An intermediate byte, as in `CSI 0 SP q`, which is not SGR either.
    intermediate: bool,
    fg: Option<AnsiColor>,
    attributes: Attributes,
    /// The last character was a `\r` that already ended a line, so a `\n`
    /// right after it is the second half of CRLF, not a second break.
    after_cr: bool,
    /// The start of a UTF-8 character whose remaining bytes are in a later chunk.
    pending: [u8; 4],
    pending_len: u8,
    lines: Vec<Line>,
    open: Line,
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}

impl Parser {
    /// A parser in the ground state with default style and no output.
    pub fn new() -> Self {
        Self {
            state: State::Ground,
            params: Vec::new(),
            value: 0,
            sub: None,
            sub_depth: 0,
            private: false,
            intermediate: false,
            fg: None,
            attributes: Attributes::empty(),
            after_cr: false,
            pending: [0; 4],
            pending_len: 0,
            lines: Vec::new(),
            open: Line::default(),
        }
    }

    /// Parses a chunk of text. A sequence may continue into the next chunk.
    pub fn push(&mut self, chunk: &str) {
        for c in chunk.chars() {
            self.step(c);
        }
    }

    /// Parses a chunk of UTF-8 bytes. A character split between chunks is
    /// reassembled; an invalid sequence becomes U+FFFD as `TextDecoder` would.
    pub fn push_bytes(&mut self, chunk: &[u8]) {
        if self.pending_len == 0 {
            self.decode(chunk);
        } else {
            let mut joined = Vec::with_capacity(self.pending_len as usize + chunk.len());
            joined.extend_from_slice(&self.pending[..self.pending_len as usize]);
            joined.extend_from_slice(chunk);
            self.pending_len = 0;
            self.decode(&joined);
        }
    }

    fn decode(&mut self, mut bytes: &[u8]) {
        loop {
            match core::str::from_utf8(bytes) {
                Ok(text) => return self.push(text),
                Err(error) => {
                    let (valid, rest) = bytes.split_at(error.valid_up_to());
                    // Re-validating the prefix is cheap and keeps this crate free
                    // of `unsafe`; it cannot fail.
                    if let Ok(text) = core::str::from_utf8(valid) {
                        self.push(text);
                    }
                    match error.error_len() {
                        Some(len) => {
                            self.step('\u{FFFD}');
                            bytes = &rest[len..];
                        }
                        None => {
                            // A valid prefix cut off by the end of the chunk: at
                            // most three bytes, kept for the next one.
                            self.pending[..rest.len()].copy_from_slice(rest);
                            self.pending_len = rest.len() as u8;
                            return;
                        }
                    }
                }
            }
        }
    }

    /// Ends the stream: an incomplete UTF-8 character becomes U+FFFD, an
    /// unterminated escape sequence is dropped, and the open line, if it has any
    /// text, becomes a completed line. Style carries over to later input.
    pub fn finish(&mut self) {
        if self.pending_len > 0 {
            self.pending_len = 0;
            self.step('\u{FFFD}');
        }
        self.state = State::Ground;
        self.after_cr = false;
        if !self.open.runs.is_empty() {
            self.end_line();
        }
    }

    /// Completed lines not yet taken.
    pub fn lines(&self) -> &[Line] {
        &self.lines
    }

    /// Removes and returns the completed lines.
    pub fn take_lines(&mut self) -> Vec<Line> {
        core::mem::take(&mut self.lines)
    }

    /// The line still being written, which may be empty.
    pub fn current(&self) -> &Line {
        &self.open
    }

    /// The foreground that text written now would get.
    pub fn fg(&self) -> Option<AnsiColor> {
        self.fg
    }

    /// The attributes that text written now would get.
    pub fn attributes(&self) -> Attributes {
        self.attributes
    }

    fn end_line(&mut self) {
        self.lines.push(core::mem::take(&mut self.open));
    }

    fn text(&mut self, c: char) {
        let (fg, attributes) = (self.fg, self.attributes);
        match self.open.runs.last_mut() {
            Some(run) if run.fg == fg && run.attributes == attributes => run.text.push(c),
            _ => {
                let mut text = String::new();
                text.push(c);
                self.open.runs.push(Run { text, fg, attributes });
            }
        }
    }

    fn step(&mut self, c: char) {
        match self.state {
            State::Ground => self.ground(c),
            State::Escape => self.escape(c),
            State::EscapeIntermediate => match c {
                '\u{20}'..='\u{2f}' => {}
                '\u{30}'..='\u{7e}' => self.state = State::Ground,
                _ => {
                    self.state = State::Ground;
                    self.ground(c);
                }
            },
            State::Csi => self.csi(c),
            State::String => match c {
                '\u{07}' => self.state = State::Ground,
                '\u{1b}' => self.state = State::StringEscape,
                _ => {}
            },
            State::StringEscape => {
                if c == '\\' {
                    self.state = State::Ground;
                } else {
                    // ESC inside a string that is not ST starts a new sequence,
                    // as xterm treats it, rather than vanishing into the string.
                    self.state = State::Escape;
                    self.escape(c);
                }
            }
        }
    }

    fn ground(&mut self, c: char) {
        let after_cr = core::mem::replace(&mut self.after_cr, false);
        match c {
            '\n' if after_cr => {}
            '\n' => self.end_line(),
            '\r' => {
                self.end_line();
                self.after_cr = true;
            }
            '\u{1b}' => self.state = State::Escape,
            '\t' => self.text(c),
            '\u{00}'..='\u{1f}' | '\u{7f}' => {}
            _ => self.text(c),
        }
    }

    fn escape(&mut self, c: char) {
        match c {
            '[' => {
                self.state = State::Csi;
                self.params.clear();
                self.value = 0;
                self.sub = None;
                self.sub_depth = 0;
                self.private = false;
                self.intermediate = false;
            }
            ']' | 'P' | 'X' | '^' | '_' => self.state = State::String,
            '\u{20}'..='\u{2f}' => self.state = State::EscapeIntermediate,
            '\u{30}'..='\u{7e}' => self.state = State::Ground,
            _ => {
                // Not an escape after all: the ESC is dropped and the character
                // is handled as if the ESC had never arrived.
                self.state = State::Ground;
                self.ground(c);
            }
        }
    }

    fn csi(&mut self, c: char) {
        match c {
            '0'..='9' => {
                let digit = c as u32 - '0' as u32;
                let grow = |v: u32| (v * 10 + digit).min(MAX_VALUE);
                match self.sub_depth {
                    0 => self.value = grow(self.value),
                    1 => self.sub = Some(grow(self.sub.unwrap_or(0))),
                    _ => {}
                }
            }
            ':' => {
                if self.sub_depth == 0 {
                    self.sub = Some(0);
                }
                self.sub_depth = (self.sub_depth + 1).min(2);
            }
            ';' => self.end_param(),
            '<'..='?' => self.private = true,
            '\u{20}'..='\u{2f}' => self.intermediate = true,
            '\u{40}'..='\u{7e}' => {
                self.end_param();
                self.state = State::Ground;
                if c == 'm' && !self.private && !self.intermediate {
                    self.sgr();
                }
            }
            _ => {
                // A control or non-ASCII character cannot be part of a CSI, so
                // the sequence was malformed: drop it and keep the character.
                self.state = State::Ground;
                self.ground(c);
            }
        }
    }

    fn end_param(&mut self) {
        if self.params.len() < MAX_PARAMS {
            self.params.push(Param { value: self.value, sub: self.sub });
        }
        self.value = 0;
        self.sub = None;
        self.sub_depth = 0;
    }

    fn sgr(&mut self) {
        let mut i = 0;
        while i < self.params.len() {
            let Param { value, sub } = self.params[i];
            i += 1;
            match value {
                0 => {
                    self.fg = None;
                    self.attributes = Attributes::empty();
                }
                1 => self.attributes.insert(Attributes::BOLD),
                2 => self.attributes.insert(Attributes::DIM),
                3 => self.attributes.insert(Attributes::ITALIC),
                // `4:0` is "no underline" in the colon form; `4:3` (curly) and
                // the other styles are all still an underline here.
                4 if sub == Some(0) => self.attributes.remove(Attributes::UNDERLINE),
                4 => self.attributes.insert(Attributes::UNDERLINE),
                7 => self.attributes.insert(Attributes::INVERSE),
                9 => self.attributes.insert(Attributes::STRIKE),
                22 => self.attributes.remove(Attributes::BOLD | Attributes::DIM),
                23 => self.attributes.remove(Attributes::ITALIC),
                24 => self.attributes.remove(Attributes::UNDERLINE),
                27 => self.attributes.remove(Attributes::INVERSE),
                29 => self.attributes.remove(Attributes::STRIKE),
                30..=37 => self.fg = AnsiColor::from_index((value - 30) as u8),
                39 => self.fg = None,
                90..=97 => self.fg = AnsiColor::from_index((value - 90 + 8) as u8),
                38 | 48 | 58 => {
                    if value == 38 {
                        self.fg = None;
                    }
                    // The colon form carries its colour inside the one parameter.
                    // The semicolon form spreads it over the following ones,
                    // which must be skipped or `38;5;1` would turn on bold.
                    if sub.is_none() {
                        match self.params.get(i).map(|p| p.value) {
                            Some(5) => i += 2,
                            Some(2) => i += 4,
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// Parses a complete string: push, then finish, then every line.
pub fn parse(input: &str) -> Vec<Line> {
    let mut parser = Parser::new();
    parser.push(input);
    parser.finish();
    parser.take_lines()
}

/* -------------------------------------------------------------------------- */
/* JavaScript boundary                                                        */
/* -------------------------------------------------------------------------- */

// Lines of runs would need js-sys to cross as objects, so a batch crosses as its
// text plus one flat Int32Array of five numbers per run:
//
//   [line, start, end, fg, attributes]
//
// `line` counts from the batch's first line, `start` and `end` are UTF-16
// offsets into the batch's text (the runs' text concatenated, no separators),
// `fg` is the colour's index or -1 for the default, and `attributes` is the
// bitmask. A blank line has no runs, which is why `take` returns a line count.

#[cfg(feature = "bindgen")]
use wasm_bindgen::prelude::*;

/// The parser as JavaScript sees it: `take` or `peek` stages a batch, and
/// `text` and `runs` read it.
#[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = AnsiParser))]
#[derive(Debug, Clone, Default)]
pub struct JsParser {
    parser: Parser,
    staged: Vec<Line>,
}

#[cfg_attr(feature = "bindgen", wasm_bindgen(js_class = AnsiParser))]
impl JsParser {
    /// A parser with default style and no output.
    #[cfg_attr(feature = "bindgen", wasm_bindgen(constructor))]
    pub fn js_new() -> JsParser {
        JsParser::default()
    }

    /// See [`Parser::push`].
    #[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = push))]
    pub fn js_push(&mut self, chunk: &str) {
        self.parser.push(chunk);
    }

    /// See [`Parser::push_bytes`].
    #[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = pushBytes))]
    pub fn js_push_bytes(&mut self, chunk: &[u8]) {
        self.parser.push_bytes(chunk);
    }

    /// See [`Parser::finish`].
    #[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = finish))]
    pub fn js_finish(&mut self) {
        self.parser.finish();
    }

    /// Stages the completed lines, removing them from the parser, and returns
    /// how many there are.
    #[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = take))]
    pub fn js_take(&mut self) -> u32 {
        self.staged = self.parser.take_lines();
        self.staged.len() as u32
    }

    /// Stages a copy of the open line, leaving it in the parser. Returns 1.
    #[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = peek))]
    pub fn js_peek(&mut self) -> u32 {
        self.staged.clear();
        self.staged.push(self.parser.current().clone());
        1
    }

    /// The staged batch's text.
    #[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = text))]
    pub fn js_text(&self) -> String {
        self.staged.iter().flat_map(|l| l.runs.iter()).map(|r| r.text.as_str()).collect()
    }

    /// The staged batch's runs, five numbers each; see the encoding above.
    #[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = runs))]
    pub fn js_runs(&self) -> Vec<i32> {
        let mut out = Vec::new();
        let mut offset = 0i32;
        for (line, l) in self.staged.iter().enumerate() {
            for run in &l.runs {
                let end = offset + run.text.chars().map(|c| c.len_utf16() as i32).sum::<i32>();
                out.extend_from_slice(&[
                    line as i32,
                    offset,
                    end,
                    run.fg.map_or(-1, |c| c.index() as i32),
                    run.attributes.bits() as i32,
                ]);
                offset = end;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::format;
    use alloc::string::ToString;
    use alloc::vec;

    const B: Attributes = Attributes::BOLD;

    /// Each line as (text, fg name, attribute bits) per run.
    fn runs(lines: &[Line]) -> Vec<Vec<(String, Option<&'static str>, u8)>> {
        lines
            .iter()
            .map(|l| l.runs.iter().map(|r| (r.text.clone(), r.fg.map(|c| c.name()), r.attributes.bits())).collect())
            .collect()
    }

    fn one(input: &str) -> Vec<(String, Option<&'static str>, u8)> {
        let lines = parse(input);
        assert_eq!(lines.len(), 1, "{input:?} -> {lines:?}");
        runs(&lines).remove(0)
    }

    fn run(text: &str, fg: Option<&'static str>, bits: u8) -> (String, Option<&'static str>, u8) {
        (text.to_string(), fg, bits)
    }

    #[test]
    fn plain_text_is_one_default_run() {
        assert_eq!(one("hello"), vec![run("hello", None, 0)]);
    }

    #[test]
    fn every_attribute_code_sets_its_bit() {
        for (code, bit) in [(1, 1), (2, 2), (3, 4), (4, 8), (7, 16), (9, 32)] {
            assert_eq!(one(&format!("\x1b[{code}mx")), vec![run("x", None, bit)], "SGR {code}");
        }
    }

    #[test]
    fn every_off_code_clears_its_attributes() {
        let all = "\x1b[1;2;3;4;7;9m";
        for (code, left) in [(22, 63 & !3), (23, 63 & !4), (24, 63 & !8), (27, 63 & !16), (29, 63 & !32)] {
            assert_eq!(one(&format!("{all}\x1b[{code}mx")), vec![run("x", None, left)], "SGR {code}");
        }
    }

    #[test]
    fn every_colour_code_maps_to_its_slot() {
        for n in 0..8u32 {
            let normal = AnsiColor::ALL[n as usize].name();
            let bright = AnsiColor::ALL[n as usize + 8].name();
            assert_eq!(one(&format!("\x1b[{}mx", 30 + n)), vec![run("x", Some(normal), 0)]);
            assert_eq!(one(&format!("\x1b[{}mx", 90 + n)), vec![run("x", Some(bright), 0)]);
        }
        assert_eq!(AnsiColor::BrightRed.class_name(), "fc-term-ansi-bright-red");
    }

    #[test]
    fn reset_and_39_clear() {
        assert_eq!(one("\x1b[1;31ma\x1b[0mb\x1b[mc"), vec![run("a", Some("red"), 1), run("bc", None, 0)]);
        assert_eq!(one("\x1b[1;31ma\x1b[39mb"), vec![run("a", Some("red"), 1), run("b", None, 1)]);
        // An empty parameter is 0, so `;1` resets and then sets bold.
        assert_eq!(one("\x1b[3m\x1b[;1mx"), vec![run("x", None, 1)]);
    }

    #[test]
    fn extended_colours_fall_back_and_skip_their_parameters() {
        assert_eq!(one("\x1b[31m\x1b[38;5;196;1mx"), vec![run("x", None, 1)]);
        assert_eq!(one("\x1b[31m\x1b[38;2;255;0;0;4mx"), vec![run("x", None, 8)]);
        // A background never touches the foreground, but its parameters are
        // skipped all the same: without that, `48;5;1` would set bold.
        assert_eq!(one("\x1b[32m\x1b[48;5;1mx"), vec![run("x", Some("green"), 0)]);
        assert_eq!(one("\x1b[48;2;1;2;3;3mx"), vec![run("x", None, 4)]);
        assert_eq!(one("\x1b[58;5;9mx"), vec![run("x", None, 0)]);
        // The colon form is one parameter, so the next one still applies.
        assert_eq!(one("\x1b[31m\x1b[38:5:196;1mx"), vec![run("x", None, 1)]);
        assert_eq!(one("\x1b[38:2::1:2:3;3mx"), vec![run("x", None, 4)]);
        // Truncated forms skip what is there and stop.
        assert_eq!(one("\x1b[38;5mx"), vec![run("x", None, 0)]);
        assert_eq!(one("\x1b[38;7mx"), vec![run("x", None, 16)]);
    }

    #[test]
    fn background_codes_are_ignored() {
        assert_eq!(one("\x1b[41;101;49;1mx"), vec![run("x", None, 1)]);
    }

    #[test]
    fn underline_sub_parameters() {
        assert_eq!(one("\x1b[4:3mx"), vec![run("x", None, 8)]);
        assert_eq!(one("\x1b[4m\x1b[4:0mx"), vec![run("x", None, 0)]);
    }

    #[test]
    fn non_sgr_csi_is_consumed() {
        for seq in ["\x1b[2J", "\x1b[1;1H", "\x1b[K", "\x1b[?25l", "\x1b[?1m", "\x1b[>4;2m", "\x1b[0 q", "\x1b[3 m"] {
            assert_eq!(one(&format!("\x1b[1ma{seq}b")), vec![run("ab", None, 1)], "{seq:?}");
        }
    }

    #[test]
    fn osc_is_consumed_with_either_terminator() {
        assert_eq!(one("a\x1b]0;title\x07b"), vec![run("ab", None, 0)]);
        assert_eq!(one("a\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\b"), vec![run("alinkb", None, 0)]);
        // DCS and friends end the same way.
        assert_eq!(one("a\x1bPq#0\x1b\\b\x1b_apc\x07c"), vec![run("abc", None, 0)]);
        // An ESC that is not ST aborts the string and starts its own sequence.
        assert_eq!(one("a\x1b]0;t\x1b[1mb"), vec![run("a", None, 0), run("b", None, 1)]);
    }

    #[test]
    fn other_escapes_are_consumed() {
        assert_eq!(one("a\x1b7b\x1b8c\x1bMd\x1b(Be\x1b#8f"), vec![run("abcdef", None, 0)]);
        // ESC before a character that cannot follow it is dropped alone.
        assert_eq!(one("a\x1b\u{e9}b"), vec![run("a\u{e9}b", None, 0)]);
        assert_eq!(one("a\x1b\x1b[1mb"), vec![run("a", None, 0), run("b", None, 1)]);
    }

    #[test]
    fn a_malformed_csi_keeps_the_character_that_ended_it() {
        assert_eq!(one("\x1b[1\u{e9}x"), vec![run("\u{e9}x", None, 0)]);
        assert_eq!(runs(&parse("\x1b[31\nx")), vec![vec![], vec![run("x", None, 0)]]);
    }

    #[test]
    fn line_breaks() {
        assert_eq!(runs(&parse("a\nb\r\nc\rd")), runs(&parse("a\nb\nc\nd")));
        assert_eq!(runs(&parse("a\r\r\nb")), vec![vec![run("a", None, 0)], vec![], vec![run("b", None, 0)]]);
        assert_eq!(runs(&parse("a\n\nb\n")), vec![vec![run("a", None, 0)], vec![], vec![run("b", None, 0)]]);
        assert!(parse("").is_empty());
        assert!(parse("\x1b[1m").is_empty());
        assert_eq!(parse("\n").len(), 1);
    }

    #[test]
    fn style_carries_across_lines() {
        assert_eq!(runs(&parse("\x1b[33ma\nb")), vec![vec![run("a", Some("yellow"), 0)], vec![run("b", Some("yellow"), 0)]]);
    }

    #[test]
    fn controls_other_than_tab_are_dropped() {
        assert_eq!(one("a\tb\x07c\x08d\x00e\x7ff"), vec![run("a\tbcdef", None, 0)]);
    }

    #[test]
    fn adjacent_runs_differ_and_none_is_empty() {
        let lines = parse("\x1b[1m\x1b[22ma\x1b[1m\x1b[22mb\x1b[31m\x1b[39mc\x1b[1m");
        assert_eq!(runs(&lines), vec![vec![run("abc", None, 0)]]);
    }

    #[test]
    fn parameters_saturate_and_are_capped() {
        assert_eq!(one("\x1b[99999999999999;1mx"), vec![run("x", None, 1)]);
        let many = "0;".repeat(40) + "1";
        // The 41st parameter is past the cap, so bold never applies.
        assert_eq!(one(&format!("\x1b[{many}mx")), vec![run("x", None, 0)]);
    }

    const SAMPLE: &str = "\x1b[1;32m✓\x1b[0m pass é😀\r\n\x1b]0;t\x07\x1b[38;5;9;3mi\x1b[23m\x1b[2K\x1b(B\x1b[91mred\x1b[39m\rnext\n\x1b]8;;u\x1b\\l\x1b]8;;\x1b\\\x1b[7;9mend";

    #[test]
    fn every_split_of_a_string_parses_the_same() {
        let whole = parse(SAMPLE);
        let cuts: Vec<usize> = SAMPLE.char_indices().map(|(i, _)| i).collect();
        for &a in &cuts {
            for &b in cuts.iter().filter(|&&b| b >= a) {
                let mut p = Parser::new();
                p.push(&SAMPLE[..a]);
                p.push(&SAMPLE[a..b]);
                p.push(&SAMPLE[b..]);
                p.finish();
                assert_eq!(p.take_lines(), whole, "split at {a}, {b}");
            }
        }
    }

    #[test]
    fn every_byte_split_parses_the_same() {
        let whole = parse(SAMPLE);
        let bytes = SAMPLE.as_bytes();
        for a in 0..=bytes.len() {
            for b in a..=bytes.len() {
                let mut p = Parser::new();
                p.push_bytes(&bytes[..a]);
                p.push_bytes(&bytes[a..b]);
                p.push_bytes(&bytes[b..]);
                p.finish();
                assert_eq!(p.take_lines(), whole, "split at {a}, {b}");
            }
        }
    }

    #[test]
    fn invalid_utf8_decodes_like_text_decoder() {
        let decode = |chunks: &[&[u8]]| {
            let mut p = Parser::new();
            for c in chunks {
                p.push_bytes(c);
            }
            p.finish();
            p.take_lines().iter().map(Line::text).collect::<Vec<_>>()
        };
        // A truncated four-byte prefix is one replacement, not two.
        assert_eq!(decode(&[b"a\xf0\x9f", b"b"]), vec!["a\u{FFFD}b"]);
        assert_eq!(decode(&[b"\xed\xa0\x80"]), vec!["\u{FFFD}\u{FFFD}\u{FFFD}"]);
        assert_eq!(decode(&[b"\xff", b"\xe2\x82"]), vec!["\u{FFFD}\u{FFFD}"]);
        assert_eq!(decode(&[b"\xef\xbb\xbfx"]), vec!["\u{FEFF}x"]);
    }

    #[test]
    fn take_lines_drains_and_current_is_the_open_line() {
        let mut p = Parser::new();
        p.push("one\ntw");
        assert_eq!(p.lines().len(), 1);
        assert_eq!(p.current().text(), "tw");
        assert_eq!(p.take_lines()[0].text(), "one");
        assert!(p.lines().is_empty());
        p.push("o\x1b[1");
        p.finish();
        assert_eq!(p.take_lines()[0].text(), "two");
        // finish drops the unterminated sequence; style set before it survives.
        p.push("\x1b[1mx");
        assert_eq!(p.attributes(), B);
        assert!(p.current().runs[0].attributes.contains(B));
    }

    #[test]
    fn attribute_names_follow_bit_order() {
        let names: Vec<_> = (Attributes::STRIKE | Attributes::BOLD | Attributes::DIM).names().collect();
        assert_eq!(names, vec!["bold", "dim", "strike"]);
        assert_eq!(Attributes::from_bits_truncate(255).bits(), 63);
    }

    #[test]
    fn js_boundary_encodes_runs_in_utf16() {
        let mut p = JsParser::js_new();
        p.js_push("\x1b[31m😀a\x1b[1mb\n\nc");
        assert_eq!(p.js_take(), 2);
        assert_eq!(p.js_text(), "😀ab");
        assert_eq!(p.js_runs(), vec![0, 0, 3, 1, 0, 0, 3, 4, 1, 1]);
        assert_eq!(p.js_peek(), 1);
        assert_eq!(p.js_text(), "c");
        assert_eq!(p.js_runs(), vec![0, 0, 1, 1, 1]);
        p.js_finish();
        assert_eq!(p.js_take(), 1);
        assert_eq!(p.js_take(), 0);
        assert!(p.js_runs().is_empty());
    }
}
