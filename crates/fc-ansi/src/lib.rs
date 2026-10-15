//! fc-ansi — ANSI SGR sequences into the terminal's styled runs.
//!
//! The terminal component renders lines of runs, each one of the sixteen
//! `fc-term-ansi-*` colours plus bold, dim, italic, underline, inverse and
//! strike. Program output carries that styling as escape sequences. This crate
//! turns one into the other, and `src/js/ansi.ts` does the same in JavaScript;
//! `tests/wasm.test.ts` holds the two to identical output.
//!
//! # Streaming
//!
//! Output arrives in writes that split anywhere: inside an escape sequence,
//! between a `\r` and its `\n`, inside a UTF-8 character. [`Parser`] keeps all of
//! that state between calls, so a chunk boundary never changes the result.
//!
//! # What is deliberately not mapped
//!
//! 256-colour and truecolor (`38;5;n`, `38;2;r;g;b`) fall back to the default
//! foreground. Mapping them would mean writing inline colours, which no theme
//! can remap and no contrast test can check. Backgrounds (40–49, 100–107) are
//! ignored for the same reason. Cursor movement and every other non-SGR control
//! sequence, OSC and the other string sequences are consumed, never shown.
//!
//! A bare `\r` starts its line over, which is what progress bars rely on. Full
//! cursor addressing would need a screen model, and this is a log.
//!
//! # Offsets are UTF-16 code units
//!
//! Run boundaries cross the JavaScript boundary as UTF-16 offsets into the
//! line's text, matching every other crate here.

// `no_std` on wasm, for size rather than portability; see fc-git's crate root.
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

#[cfg(feature = "bindgen")]
use wasm_bindgen::prelude::*;

/// One of the sixteen terminal colours, in SGR order: 30–37, then 90–97.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Color {
    Black,
    Red,
    Green,
    Yellow,
    Blue,
    Magenta,
    Cyan,
    White,
    BrightBlack,
    BrightRed,
    BrightGreen,
    BrightYellow,
    BrightBlue,
    BrightMagenta,
    BrightCyan,
    BrightWhite,
}

const COLORS: [Color; 16] = [
    Color::Black,
    Color::Red,
    Color::Green,
    Color::Yellow,
    Color::Blue,
    Color::Magenta,
    Color::Cyan,
    Color::White,
    Color::BrightBlack,
    Color::BrightRed,
    Color::BrightGreen,
    Color::BrightYellow,
    Color::BrightBlue,
    Color::BrightMagenta,
    Color::BrightCyan,
    Color::BrightWhite,
];

impl Color {
    /// The colour at `index`, 0–15 in SGR order.
    pub fn from_index(index: u8) -> Option<Self> {
        COLORS.get(index as usize).copied()
    }

    /// 0–15 in SGR order; the number that crosses the WASM boundary.
    pub fn index(self) -> u8 {
        self as u8
    }

    /// The name the JS twin uses, such as `bright-red`.
    pub fn name(self) -> &'static str {
        CLASSES[self as usize].trim_start_matches("fc-term-ansi-")
    }

    /// The class the terminal stylesheet colours, such as `fc-term-ansi-bright-red`.
    pub fn class_name(self) -> &'static str {
        CLASSES[self as usize]
    }
}

const CLASSES: [&str; 16] = [
    "fc-term-ansi-black",
    "fc-term-ansi-red",
    "fc-term-ansi-green",
    "fc-term-ansi-yellow",
    "fc-term-ansi-blue",
    "fc-term-ansi-magenta",
    "fc-term-ansi-cyan",
    "fc-term-ansi-white",
    "fc-term-ansi-bright-black",
    "fc-term-ansi-bright-red",
    "fc-term-ansi-bright-green",
    "fc-term-ansi-bright-yellow",
    "fc-term-ansi-bright-blue",
    "fc-term-ansi-bright-magenta",
    "fc-term-ansi-bright-cyan",
    "fc-term-ansi-bright-white",
];

/// A set of text attributes. The bits are the wire format, shared with ansi.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Attributes(u8);

impl Attributes {
    pub const BOLD: Self = Self(1);
    pub const DIM: Self = Self(2);
    pub const ITALIC: Self = Self(4);
    pub const UNDERLINE: Self = Self(8);
    pub const INVERSE: Self = Self(16);
    pub const STRIKE: Self = Self(32);

    const ALL: [(Self, &'static str, &'static str); 6] = [
        (Self::BOLD, "bold", "fc-terminal__bold"),
        (Self::DIM, "dim", "fc-terminal__dim"),
        (Self::ITALIC, "italic", "fc-terminal__italic"),
        (Self::UNDERLINE, "underline", "fc-terminal__underline"),
        (Self::INVERSE, "inverse", "fc-terminal__inverse"),
        (Self::STRIKE, "strike", "fc-terminal__strike"),
    ];

    pub const fn empty() -> Self {
        Self(0)
    }

    pub const fn bits(self) -> u8 {
        self.0
    }

    /// Unknown bits are dropped rather than kept, so no value can name a class
    /// the stylesheet does not have.
    pub const fn from_bits(bits: u8) -> Self {
        Self(bits & 63)
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    pub fn insert(&mut self, other: Self) {
        self.0 |= other.0;
    }

    pub fn remove(&mut self, other: Self) {
        self.0 &= !other.0;
    }

    /// Attribute names in a fixed order (bold, dim, italic, underline, inverse, strike).
    pub fn names(self) -> impl Iterator<Item = &'static str> {
        Self::ALL.into_iter().filter(move |(a, _, _)| self.contains(*a)).map(|(_, n, _)| n)
    }

    /// The terminal's modifier classes for these attributes, in the same order.
    pub fn class_names(self) -> impl Iterator<Item = &'static str> {
        Self::ALL.into_iter().filter(move |(a, _, _)| self.contains(*a)).map(|(_, _, c)| c)
    }
}

/// The styling a run carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Style {
    pub fg: Option<Color>,
    pub attributes: Attributes,
}

/// Text in one style. Adjacent runs on a line never share a style.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    pub text: String,
    pub fg: Option<Color>,
    pub attributes: Attributes,
}

impl Run {
    pub fn style(&self) -> Style {
        Style { fg: self.fg, attributes: self.attributes }
    }
}

/// One output line, without its line ending. An empty line has no runs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Line {
    pub runs: Vec<Run>,
}

impl Line {
    /// The line's plain text.
    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }

    fn push(&mut self, c: char, style: Style) {
        match self.runs.last_mut() {
            Some(run) if run.style() == style => run.text.push(c),
            _ => {
                let mut text = String::new();
                text.push(c);
                self.runs.push(Run { text, fg: style.fg, attributes: style.attributes });
            }
        }
    }
}

/// Where the parser is inside an escape sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    /// After ESC.
    Escape,
    /// After ESC and one or more intermediate bytes; a final byte ends it.
    EscapeIntermediate,
    /// After ESC `[`.
    Csi,
    /// Inside OSC, DCS, SOS, PM or APC: everything up to BEL or ST is dropped.
    Str,
    /// After ESC inside a string sequence: `\` ends it, anything else aborts it.
    StrEscape,
}

/// The longest CSI parameter string kept. Real SGR sequences are a few dozen
/// bytes; this only stops a stream that never sends a final byte from growing
/// a buffer without bound. A longer sequence is consumed and ignored.
const MAX_PARAMS: usize = 256;

/// A streaming SGR parser. Feed it output with [`push`](Self::push) or
/// [`push_bytes`](Self::push_bytes); collect finished lines with
/// [`take_lines`](Self::take_lines).
#[derive(Debug, Clone)]
pub struct Parser {
    state: State,
    style: Style,
    params: String,
    /// The CSI has an intermediate byte, or a malformed parameter, or ran past
    /// `MAX_PARAMS`: it is still consumed, but never applied.
    ignore: bool,
    intermediate: bool,
    /// A `\r` whose meaning depends on the next character: `\r\n` is one line
    /// ending, a bare `\r` starts the line over.
    cr: bool,
    line: Line,
    done: Vec<Line>,
    /// The incomplete tail of a UTF-8 character split between byte chunks.
    carry: Vec<u8>,
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}

impl Parser {
    pub fn new() -> Self {
        Self {
            state: State::Ground,
            style: Style::default(),
            params: String::new(),
            ignore: false,
            intermediate: false,
            cr: false,
            line: Line::default(),
            done: Vec::new(),
            carry: Vec::new(),
        }
    }

    /// Feeds a chunk of text.
    pub fn push(&mut self, chunk: &str) {
        self.flush_carry();
        for c in chunk.chars() {
            self.feed(c);
        }
    }

    /// Feeds a chunk of UTF-8 bytes. A character split across chunks is held
    /// until it completes; invalid bytes become U+FFFD, one per maximal invalid
    /// subpart, which is what `TextDecoder` does.
    pub fn push_bytes(&mut self, chunk: &[u8]) {
        if self.carry.is_empty() {
            self.decode(chunk);
        } else {
            let mut joined = core::mem::take(&mut self.carry);
            joined.extend_from_slice(chunk);
            self.decode(&joined);
        }
    }

    fn decode(&mut self, mut input: &[u8]) {
        loop {
            match core::str::from_utf8(input) {
                Ok(text) => return self.feed_str(text),
                Err(error) => {
                    let (valid, rest) = input.split_at(error.valid_up_to());
                    // `valid_up_to` is the length of a valid prefix by definition.
                    self.feed_str(core::str::from_utf8(valid).unwrap_or_default());
                    match error.error_len() {
                        Some(len) => {
                            self.feed('\u{FFFD}');
                            input = &rest[len..];
                        }
                        None => {
                            self.carry = rest.to_vec();
                            return;
                        }
                    }
                }
            }
        }
    }

    /// Lines finished since the last call, oldest first.
    pub fn take_lines(&mut self) -> Vec<Line> {
        core::mem::take(&mut self.done)
    }

    /// The line still being written, which has no line ending yet.
    pub fn pending(&self) -> &Line {
        &self.line
    }

    /// The style the next text will take.
    pub fn style(&self) -> Style {
        self.style
    }

    /// Forgets everything: lines, style, and any partial sequence.
    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// An incomplete character followed by text is an invalid one, as when a
    /// decoder is flushed.
    fn flush_carry(&mut self) {
        if !self.carry.is_empty() {
            self.carry.clear();
            self.feed('\u{FFFD}');
        }
    }

    fn feed_str(&mut self, text: &str) {
        for c in text.chars() {
            self.feed(c);
        }
    }

    fn feed(&mut self, c: char) {
        match self.state {
            State::Ground => self.ground(c),
            State::Escape => match c {
                '[' => {
                    self.state = State::Csi;
                    self.params.clear();
                    self.ignore = false;
                    self.intermediate = false;
                }
                ']' | 'P' | 'X' | '^' | '_' => self.state = State::Str,
                '\x1b' => {}
                '\x20'..='\x2f' => self.state = State::EscapeIntermediate,
                '\x30'..='\x7e' => self.state = State::Ground,
                // Not a sequence after all; the character is ordinary input.
                _ => {
                    self.state = State::Ground;
                    self.ground(c);
                }
            },
            State::EscapeIntermediate => match c {
                '\x20'..='\x2f' => {}
                '\x30'..='\x7e' => self.state = State::Ground,
                '\x1b' => self.state = State::Escape,
                _ => {
                    self.state = State::Ground;
                    self.ground(c);
                }
            },
            State::Csi => match c {
                '\x30'..='\x3f' => {
                    // A parameter after an intermediate is malformed.
                    if self.intermediate || self.params.len() >= MAX_PARAMS {
                        self.ignore = true;
                    } else {
                        self.params.push(c);
                    }
                }
                '\x20'..='\x2f' => self.intermediate = true,
                '\x40'..='\x7e' => {
                    self.state = State::Ground;
                    if c == 'm' && !self.ignore && !self.intermediate {
                        self.sgr();
                    }
                }
                '\x1b' => self.state = State::Escape,
                // A control or non-ASCII character cannot be part of a CSI: the
                // sequence is abandoned and the character handled as input.
                _ => {
                    self.state = State::Ground;
                    self.ground(c);
                }
            },
            State::Str => match c {
                '\x07' => self.state = State::Ground,
                '\x1b' => self.state = State::StrEscape,
                _ => {}
            },
            State::StrEscape => {
                if c == '\\' {
                    self.state = State::Ground;
                } else {
                    // ESC aborts the string and begins a new sequence.
                    self.state = State::Escape;
                    self.feed(c);
                }
            }
        }
    }

    fn ground(&mut self, c: char) {
        if self.cr {
            self.cr = false;
            if c == '\n' {
                self.end_line();
                return;
            }
            self.line.runs.clear();
        }
        match c {
            '\n' => self.end_line(),
            '\r' => self.cr = true,
            '\x1b' => self.state = State::Escape,
            '\t' => self.line.push(c, self.style),
            // C0 and C1 controls and DEL: a bell or a backspace is not text.
            '\0'..='\x1f' | '\x7f'..='\u{9f}' => {}
            _ => self.line.push(c, self.style),
        }
    }

    fn end_line(&mut self) {
        self.done.push(core::mem::take(&mut self.line));
    }

    fn sgr(&mut self) {
        // A private marker (`ESC[?…m`, `ESC[>…m`) is some other terminal's
        // extension, not SGR.
        if self.params.starts_with(['<', '=', '>', '?']) {
            return;
        }
        let params = core::mem::take(&mut self.params);
        let parts: Vec<&str> = params.split(';').collect();
        let mut i = 0;
        while i < parts.len() {
            let part = parts[i];
            i += 1;
            let mut fields = part.split(':');
            let code = number(fields.next().unwrap_or(""));
            let colon = part.contains(':');
            let attrs = &mut self.style.attributes;
            match code {
                Some(0) => self.style = Style::default(),
                Some(1) => attrs.insert(Attributes::BOLD),
                Some(2) => attrs.insert(Attributes::DIM),
                Some(3) => attrs.insert(Attributes::ITALIC),
                // `4:0` is "no underline"; `4:3` is a curly one, which is still one.
                Some(4) => {
                    if colon && number(fields.next().unwrap_or("")) == Some(0) {
                        attrs.remove(Attributes::UNDERLINE);
                    } else {
                        attrs.insert(Attributes::UNDERLINE);
                    }
                }
                Some(7) => attrs.insert(Attributes::INVERSE),
                Some(9) => attrs.insert(Attributes::STRIKE),
                Some(22) => {
                    attrs.remove(Attributes::BOLD);
                    attrs.remove(Attributes::DIM);
                }
                Some(23) => attrs.remove(Attributes::ITALIC),
                Some(24) => attrs.remove(Attributes::UNDERLINE),
                Some(27) => attrs.remove(Attributes::INVERSE),
                Some(29) => attrs.remove(Attributes::STRIKE),
                Some(n @ 30..=37) => self.style.fg = Color::from_index((n - 30) as u8),
                Some(39) => self.style.fg = None,
                Some(n @ 90..=97) => self.style.fg = Color::from_index((n - 90 + 8) as u8),
                // Extended colours. The semicolon form spreads its arguments over
                // the following parameters, which must be skipped, not read as
                // codes of their own: `38;5;1` is not "bold, then red".
                Some(n @ (38 | 48 | 58)) => {
                    if !colon {
                        match parts.get(i).map(|p| number(p)) {
                            Some(Some(5)) => i += 2,
                            Some(Some(2)) => i += 4,
                            _ => {}
                        }
                    }
                    if n == 38 {
                        self.style.fg = None;
                    }
                }
                _ => {}
            }
        }
    }
}

/// A decimal SGR parameter. Empty means 0; anything but digits is no number.
/// Saturates rather than wrapping, so a huge value is never read as a small one.
fn number(text: &str) -> Option<u32> {
    let mut value: u32 = 0;
    for b in text.bytes() {
        if !b.is_ascii_digit() {
            return None;
        }
        value = value.saturating_mul(10).saturating_add((b - b'0') as u32);
    }
    Some(value)
}

/// Every line of a complete text, including a last line with no line ending.
pub fn parse(text: &str) -> Vec<Line> {
    let mut parser = Parser::new();
    parser.push(text);
    let mut lines = parser.take_lines();
    if !parser.pending().runs.is_empty() {
        lines.push(parser.pending().clone());
    }
    lines
}

/// A line's runs as `(end, colour, attributes)` triples: `end` is a UTF-16
/// offset into the line's text, `colour` is 0–15 or -1 for the default.
pub fn wire_runs(line: &Line) -> Vec<i32> {
    let mut out = Vec::with_capacity(line.runs.len() * 3);
    let mut end = 0i32;
    for run in &line.runs {
        end += run.text.encode_utf16().count() as i32;
        out.push(end);
        out.push(run.fg.map_or(-1, |c| c.index() as i32));
        out.push(run.attributes.bits() as i32);
    }
    out
}

/// The parser across the JavaScript boundary. Lines are taken in a batch and
/// then read one at a time, so each crossing is a string or a flat array.
#[cfg(feature = "bindgen")]
#[wasm_bindgen(js_name = AnsiParser)]
pub struct AnsiParser {
    parser: Parser,
    taken: Vec<Line>,
}

#[cfg(feature = "bindgen")]
#[wasm_bindgen(js_class = AnsiParser)]
impl AnsiParser {
    #[wasm_bindgen(constructor)]
    pub fn new() -> AnsiParser {
        AnsiParser { parser: Parser::new(), taken: Vec::new() }
    }

    pub fn push(&mut self, chunk: &str) {
        self.parser.push(chunk);
    }

    #[wasm_bindgen(js_name = pushBytes)]
    pub fn push_bytes(&mut self, chunk: &[u8]) {
        self.parser.push_bytes(chunk);
    }

    /// Moves the finished lines into the read buffer, replacing what was there,
    /// and returns how many there are.
    #[wasm_bindgen(js_name = takeLines)]
    pub fn take_lines(&mut self) -> u32 {
        self.taken = self.parser.take_lines();
        self.taken.len() as u32
    }

    #[wasm_bindgen(js_name = lineText)]
    pub fn line_text(&self, index: u32) -> String {
        self.taken.get(index as usize).map(Line::text).unwrap_or_default()
    }

    #[wasm_bindgen(js_name = lineRuns)]
    pub fn line_runs(&self, index: u32) -> Vec<i32> {
        self.taken.get(index as usize).map(wire_runs).unwrap_or_default()
    }

    #[wasm_bindgen(js_name = pendingText)]
    pub fn pending_text(&self) -> String {
        self.parser.pending().text()
    }

    #[wasm_bindgen(js_name = pendingRuns)]
    pub fn pending_runs(&self) -> Vec<i32> {
        wire_runs(self.parser.pending())
    }

    pub fn reset(&mut self) {
        self.parser.reset();
        self.taken.clear();
    }
}

#[cfg(feature = "bindgen")]
impl Default for AnsiParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn run(text: &str, fg: Option<Color>, bits: u8) -> Run {
        Run { text: text.into(), fg, attributes: Attributes::from_bits(bits) }
    }

    fn line(runs: Vec<Run>) -> Line {
        Line { runs }
    }

    #[test]
    fn plain_text_is_one_run_per_line() {
        assert_eq!(parse("a\nb"), vec![line(vec![run("a", None, 0)]), line(vec![run("b", None, 0)])]);
        assert_eq!(parse(""), vec![]);
        assert_eq!(parse("\n"), vec![line(vec![])]);
    }

    #[test]
    fn colours_and_attributes() {
        let lines = parse("\x1b[31mred\x1b[1;92mbold\x1b[0m plain");
        assert_eq!(
            lines,
            vec![line(vec![
                run("red", Some(Color::Red), 0),
                run("bold", Some(Color::BrightGreen), 1),
                run(" plain", None, 0),
            ])]
        );
    }

    #[test]
    fn off_codes_clear_only_their_attribute() {
        let lines = parse("\x1b[1;2;3;4;7;9mx\x1b[22my\x1b[23;24mz\x1b[27;29mw\x1b[31m\x1b[39mv");
        assert_eq!(
            lines[0].runs,
            vec![run("x", None, 63), run("y", None, 60), run("z", None, 48), run("wv", None, 0)]
        );
    }

    #[test]
    fn empty_sgr_is_a_reset() {
        assert_eq!(parse("\x1b[1mA\x1b[mB")[0].runs, vec![run("A", None, 1), run("B", None, 0)]);
    }

    #[test]
    fn extended_colours_fall_back_and_skip_their_arguments() {
        // `38;5;1` must not be read as "38, then 5, then bold".
        let lines = parse("\x1b[31;38;5;1mA\x1b[31;38;2;1;2;3;4mB\x1b[31;38:5:1mC\x1b[48;5;1;3mD");
        assert_eq!(
            lines[0].runs,
            vec![run("A", None, 0), run("BC", None, 8), run("D", None, 12)]
        );
    }

    #[test]
    fn underline_subparameters() {
        assert_eq!(parse("\x1b[4:3mA\x1b[4:0mB")[0].runs, vec![run("A", None, 8), run("B", None, 0)]);
    }

    #[test]
    fn other_sequences_are_consumed() {
        let text = "a\x1b[2Kb\x1b]0;title\x07c\x1b]8;;http://x\x1b\\d\x1b(Be\x1b7f\x1b[?25lg\x1b[>1mh";
        assert_eq!(parse(text)[0].text(), "abcdefgh");
        assert_eq!(parse(text)[0].runs.len(), 1);
    }

    #[test]
    fn controls_are_dropped_but_tabs_kept() {
        assert_eq!(parse("a\x07\x08\tb\x7f\u{85}c")[0].text(), "a\tbc");
    }

    #[test]
    fn carriage_return_starts_the_line_over() {
        assert_eq!(parse("10%\r50%\r\ndone")[0].text(), "50%");
        assert_eq!(parse("a\r\nb").len(), 2);
    }

    #[test]
    fn style_carries_across_lines() {
        let lines = parse("\x1b[31ma\nb");
        assert_eq!(lines[1].runs, vec![run("b", Some(Color::Red), 0)]);
    }

    #[test]
    fn a_split_anywhere_gives_the_same_lines() {
        let text = "\x1b[1;31merr\x1b[0m: x\r\ny\x1b]0;t\x1b\\z\r10%\rok\n";
        let whole = {
            let mut p = Parser::new();
            p.push(text);
            (p.take_lines(), p.pending().clone())
        };
        let chars: Vec<char> = text.chars().collect();
        for cut in 0..=chars.len() {
            let (a, b): (String, String) = (chars[..cut].iter().collect(), chars[cut..].iter().collect());
            let mut p = Parser::new();
            p.push(&a);
            let mut lines = p.take_lines();
            p.push(&b);
            lines.extend(p.take_lines());
            assert_eq!((lines, p.pending().clone()), whole, "cut at {cut}");
        }
    }

    #[test]
    fn bytes_split_inside_a_character() {
        let bytes = "é\x1b[32m日本".as_bytes();
        for cut in 0..=bytes.len() {
            let mut p = Parser::new();
            p.push_bytes(&bytes[..cut]);
            p.push_bytes(&bytes[cut..]);
            assert_eq!(p.pending().runs, vec![run("é", None, 0), run("日本", Some(Color::Green), 0)]);
        }
    }

    #[test]
    fn invalid_bytes_become_replacement_characters() {
        let mut p = Parser::new();
        p.push_bytes(b"a\xffb\xe6\x97c\xe6");
        p.push("d");
        assert_eq!(p.pending().text(), "a\u{FFFD}b\u{FFFD}c\u{FFFD}d");
    }

    #[test]
    fn an_unterminated_sequence_stays_bounded() {
        let mut p = Parser::new();
        p.push("\x1b[");
        for _ in 0..10_000 {
            p.push("1;");
        }
        assert!(p.params.len() <= MAX_PARAMS);
        p.push("31mx");
        assert_eq!(p.pending().runs, vec![run("x", None, 0)]);
    }

    #[test]
    fn huge_parameters_saturate() {
        assert_eq!(number("99999999999"), Some(u32::MAX));
        assert_eq!(parse("\x1b[4294967327mx")[0].runs, vec![run("x", None, 0)]);
    }

    #[test]
    fn names_and_classes() {
        assert_eq!(Color::BrightRed.class_name(), "fc-term-ansi-bright-red");
        assert_eq!(Color::BrightRed.name(), "bright-red");
        let attrs = Attributes::from_bits(1 | 32);
        assert_eq!(attrs.class_names().collect::<Vec<_>>(), vec!["fc-terminal__bold", "fc-terminal__strike"]);
        assert_eq!(attrs.names().collect::<Vec<_>>(), vec!["bold", "strike"]);
    }

    #[test]
    fn wire_runs_use_utf16_offsets() {
        let lines = parse("😀a\x1b[31mb");
        assert_eq!(wire_runs(&lines[0]), vec![3, -1, 0, 4, 1, 0]);
    }
}
