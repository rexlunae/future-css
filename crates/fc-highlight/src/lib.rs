//! fc-highlight — syntax highlighting, the Rust twin of `src/js/highlight.ts`.
//!
//! # Why there is no regex engine here
//!
//! The JS tokenizer is one combined regex per language, scanned left to right,
//! so a token can never begin inside another. Its patterns lean on lookahead and
//! lookbehind, which the `regex` crate does not have; an engine that does would
//! outweigh the rest of this module several times over. So each alternative is a
//! small matcher that returns the end the JS engine would choose, backtracking
//! included, and the scan loop reproduces `matchAll`: at each position the first
//! alternative that matches wins, and plain text between tokens is `fg`.
//!
//! Where a matcher looks simpler than its pattern, the comment says why the
//! pattern's backtracking cannot change the result. The parity test in
//! `tests/wasm.test.ts` checks every claim against the JS on samples and on
//! generated input, because a divergence between the two is the worst bug this
//! system can have.
//!
//! # The character classes are JavaScript's
//!
//! The patterns use the `u` flag without `i`, so `\w`, `\d` and `\b` are ASCII,
//! while `\s` is Unicode whitespace and `.` excludes all four line terminators.
//! Positions are code points, as they are for a `u` regex.

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

/// A syntax role. Every one maps to a `--fc-code-<role>` token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// Plain text.
    Fg,
    /// A comment.
    Comment,
    /// A keyword.
    Keyword,
    /// A string literal.
    String,
    /// A number.
    Number,
    /// A function name.
    Function,
    /// A type name.
    Type,
    /// An operator.
    Operator,
    /// Punctuation.
    Punctuation,
    /// A property or field.
    Property,
    /// A constant such as `true`.
    Constant,
    /// A markup tag.
    Tag,
    /// A markup attribute.
    Attribute,
    /// A regular expression.
    Regexp,
    /// A heading in prose formats.
    Heading,
    /// A link.
    Link,
    /// Something invalid.
    Invalid,
}

impl Role {
    /// Every role, in wire order: a role's index here is its code.
    pub const ALL: [Self; 17] = [
        Self::Fg,
        Self::Comment,
        Self::Keyword,
        Self::String,
        Self::Number,
        Self::Function,
        Self::Type,
        Self::Operator,
        Self::Punctuation,
        Self::Property,
        Self::Constant,
        Self::Tag,
        Self::Attribute,
        Self::Regexp,
        Self::Heading,
        Self::Link,
        Self::Invalid,
    ];

    /// The name `highlight.ts` uses, which is also the class suffix.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fg => "fg",
            Self::Comment => "comment",
            Self::Keyword => "keyword",
            Self::String => "string",
            Self::Number => "number",
            Self::Function => "function",
            Self::Type => "type",
            Self::Operator => "operator",
            Self::Punctuation => "punctuation",
            Self::Property => "property",
            Self::Constant => "constant",
            Self::Tag => "tag",
            Self::Attribute => "attribute",
            Self::Regexp => "regexp",
            Self::Heading => "heading",
            Self::Link => "link",
            Self::Invalid => "invalid",
        }
    }

    /// The wire code: this role's index in [`Role::ALL`].
    pub const fn code(self) -> u8 {
        self as u8
    }
}

/// A language with a tokenizer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    /// JavaScript.
    JavaScript,
    /// TypeScript, which shares JavaScript's grammar.
    TypeScript,
    /// JSON.
    Json,
    /// CSS.
    Css,
    /// Rust.
    Rust,
    /// HTML and XML.
    Html,
    /// Markdown.
    Markdown,
}

impl Language {
    /// Every language, in the order `languageNames` lists them.
    pub const ALL: [Self; 7] = [
        Self::JavaScript,
        Self::TypeScript,
        Self::Json,
        Self::Css,
        Self::Rust,
        Self::Html,
        Self::Markdown,
    ];

    /// Its canonical name.
    pub const fn name(self) -> &'static str {
        match self {
            Self::JavaScript => "javascript",
            Self::TypeScript => "typescript",
            Self::Json => "json",
            Self::Css => "css",
            Self::Rust => "rust",
            Self::Html => "html",
            Self::Markdown => "markdown",
        }
    }

    /// Resolve a name or alias, as `resolveLanguage` does: trimmed and
    /// case-insensitive, and `None` rather than an error for anything unknown,
    /// so a typo in `data-fc-lang` shows plain text instead of losing the code.
    pub fn resolve(name: &str) -> Option<Self> {
        // Every name is ASCII, so only lowercasing that lands in ASCII matters:
        // the ASCII letters, and the Kelvin sign, which JS's `toLowerCase` folds
        // to `k` (as in "marKdown"). Full `to_lowercase` would link Unicode's
        // case tables, a third of this module, to decide nothing else.
        let key: String = name
            .trim_matches(is_space)
            .chars()
            .map(|c| if c == '\u{212A}' { 'k' } else { c.to_ascii_lowercase() })
            .collect();
        if let Some(language) = Self::ALL.into_iter().find(|l| l.name() == key) {
            return Some(language);
        }
        Some(match key.as_str() {
            "js" | "jsx" | "mjs" | "cjs" => Self::JavaScript,
            "ts" | "tsx" | "mts" => Self::TypeScript,
            "rs" => Self::Rust,
            "md" | "mdx" => Self::Markdown,
            "htm" | "xml" | "svg" | "vue" => Self::Html,
            _ => return None,
        })
    }

    const fn grammar(self) -> &'static [(Role, Matcher)] {
        match self {
            Self::JavaScript | Self::TypeScript => JS,
            Self::Json => JSON,
            Self::Css => CSS,
            Self::Rust => RUST,
            Self::Html => HTML,
            Self::Markdown => MARKDOWN,
        }
    }
}

/// One run of text sharing a role. Spans are contiguous and non-overlapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span<'a> {
    /// Its role.
    pub role: Role,
    /// Its text, borrowed from the source.
    pub text: &'a str,
}

/// Tokenize `source` into contiguous, non-overlapping spans.
///
/// The spans always concatenate back to exactly `source`. An unsupported
/// language is one `fg` span holding the whole source, even when it is empty,
/// because that is what the JS returns.
pub fn highlight<'a>(source: &'a str, language: &str) -> Vec<Span<'a>> {
    let Some(language) = Language::resolve(language) else {
        return alloc::vec![Span { role: Role::Fg, text: source }];
    };
    let text = Text::new(source);
    let grammar = language.grammar();
    let mut spans = Spans { out: Vec::new() };
    let mut cursor = 0;
    let mut at = 0;
    while at < text.len() {
        let found = grammar
            .iter()
            .find_map(|&(role, matcher)| matcher(&text, at).map(|end| (role, end)));
        match found {
            Some((role, end)) => {
                spans.push(Role::Fg, cursor, at);
                spans.push(role, at, end);
                cursor = end;
                at = end;
            }
            None => at += 1,
        }
    }
    spans.push(Role::Fg, cursor, text.len());
    spans
        .out
        .into_iter()
        .map(|(role, start, end)| Span { role, text: text.slice(start, end) })
        .collect()
}

/// The output as code-point ranges, coalescing adjacent runs of one role as
/// the JS `push` does and dropping empty ones.
struct Spans {
    out: Vec<(Role, usize, usize)>,
}

impl Spans {
    fn push(&mut self, role: Role, start: usize, end: usize) {
        if start >= end {
            return;
        }
        match self.out.last_mut() {
            Some(last) if last.0 == role => last.2 = end,
            _ => self.out.push((role, start, end)),
        }
    }
}

/// The source as code points, which is what a `u` regex walks.
struct Text<'a> {
    src: &'a str,
    chars: Vec<char>,
    /// Byte offset of each code point, plus the length at the end.
    bytes: Vec<usize>,
}

impl<'a> Text<'a> {
    fn new(src: &'a str) -> Self {
        let mut chars = Vec::with_capacity(src.len());
        let mut bytes = Vec::with_capacity(src.len() + 1);
        for (offset, ch) in src.char_indices() {
            chars.push(ch);
            bytes.push(offset);
        }
        bytes.push(src.len());
        Self { src, chars, bytes }
    }

    fn len(&self) -> usize {
        self.chars.len()
    }

    fn at(&self, i: usize) -> Option<char> {
        self.chars.get(i).copied()
    }

    fn is(&self, i: usize, f: impl Fn(char) -> bool) -> bool {
        self.at(i).is_some_and(f)
    }

    fn byte(&self, i: usize) -> usize {
        self.bytes.get(i).copied().unwrap_or(self.src.len())
    }

    fn slice(&self, start: usize, end: usize) -> &'a str {
        self.src.get(self.byte(start)..self.byte(end)).unwrap_or("")
    }

    fn starts(&self, i: usize, lit: &str) -> bool {
        self.src.get(self.byte(i)..).is_some_and(|rest| rest.starts_with(lit))
    }

    /// The end of the run of characters matching `f` that starts at `i`.
    fn run(&self, i: usize, f: impl Fn(char) -> bool) -> usize {
        let mut end = i;
        while self.at(end).is_some_and(&f) {
            end += 1;
        }
        end
    }

    /// `\b`: a word character on exactly one side.
    fn boundary(&self, i: usize) -> bool {
        let before = i > 0 && self.is(i - 1, is_word);
        before != self.is(i, is_word)
    }

    /// `^` with the `m` flag: the start, or just after a line terminator.
    fn line_start(&self, i: usize) -> bool {
        i == 0 || self.is(i - 1, is_line_terminator)
    }

    /// The first occurrence of `lit` at or after `from`, as the index past it.
    /// What a lazy `[\s\S]*?` followed by a literal finds.
    ///
    /// A plain scan rather than `str::find`: the literals are three ASCII
    /// characters, and the two-way searcher behind `find` cost more bytes than
    /// every grammar's comment rule together.
    fn through(&self, from: usize, lit: &str) -> Option<usize> {
        (from..self.len()).find(|&i| self.starts(i, lit)).map(|i| i + lit.len())
    }
}

type Matcher = fn(&Text, usize) -> Option<usize>;

/* -------------------------------------------------------------------------- */
/* Character classes                                                          */
/* -------------------------------------------------------------------------- */

/// Membership in a set of ASCII characters. `str::contains` would do, but for a
/// char it builds a substring searcher, which was the largest function in the
/// module.
fn in_set(set: &str, c: char) -> bool {
    c.is_ascii() && set.as_bytes().contains(&(c as u8))
}

/// `\w` under the `u` flag without `i`: ASCII only.
fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_digit(c: char) -> bool {
    c.is_ascii_digit()
}

/// `\s`: ECMAScript WhiteSpace plus LineTerminator, which is wider than ASCII.
fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n'
            | '\u{0B}'
            | '\u{0C}'
            | '\r'
            | ' '
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// What `.` refuses to match.
fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `[\w$]`, the tail of a JS identifier.
fn is_ident(c: char) -> bool {
    is_word(c) || c == '$'
}

/// `[A-Za-z_$]`.
fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

/// A single character from `set`.
fn one_of(t: &Text, i: usize, set: &str) -> Option<usize> {
    t.is(i, |c| in_set(set, c)).then_some(i + 1)
}

/// `[set]+`.
fn run_of(t: &Text, i: usize, set: &str) -> Option<usize> {
    let end = t.run(i, |c| in_set(set, c));
    (end > i).then_some(end)
}

/// `\b(?:a|b|c)\b` for words made only of word characters.
///
/// With `\b` on both sides, an alternative can only match if it is the entire
/// run of word characters starting here, so the alternation's order (and the
/// longest-first sort the JS applies) cannot change which one wins.
fn keyword(t: &Text, i: usize, words: &[&str]) -> Option<usize> {
    if !t.boundary(i) || !t.is(i, is_word) {
        return None;
    }
    let end = t.run(i, is_word);
    words.contains(&t.slice(i, end)).then_some(end)
}

/// `/\*[\s\S]*?\*/`.
fn block_comment(t: &Text, i: usize) -> Option<usize> {
    if !t.starts(i, "/*") {
        return None;
    }
    t.through(i + 2, "*/")
}

/// `//[^\n]*` or a block comment.
fn c_comment(t: &Text, i: usize) -> Option<usize> {
    if t.starts(i, "//") {
        return Some(t.run(i + 2, |c| c != '\n'));
    }
    block_comment(t, i)
}

/// `q(?:[^q\\]|\\.)*q`, with `\n` excluded from the plain class unless
/// `newlines` is set.
///
/// The repetition cannot backtrack to an earlier close: a quote is only ever
/// consumed inside an escape, never at the start of an iteration, so the first
/// unescaped quote is the only place the pattern can end.
fn quoted(t: &Text, i: usize, q: char, newlines: bool) -> Option<usize> {
    if t.at(i) != Some(q) {
        return None;
    }
    let mut at = i + 1;
    loop {
        match t.at(at)? {
            c if c == q => return Some(at + 1),
            '\\' => {
                // `\\.`: an escape cannot swallow a line terminator.
                if t.is(at + 1, |c| !is_line_terminator(c)) {
                    at += 2;
                } else {
                    return None;
                }
            }
            '\n' if !newlines => return None,
            _ => at += 1,
        }
    }
}

/// `"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`.
fn c_string(t: &Text, i: usize) -> Option<usize> {
    quoted(t, i, '"', false).or_else(|| quoted(t, i, '\'', false))
}

/// `\s*` then one of `set`, as a lookahead.
fn followed_by(t: &Text, i: usize, set: &str) -> bool {
    t.is(t.run(i, is_space), &|c| in_set(set, c))
}

/// `\b[A-Za-z_$][\w$]*(?=\s*[set])`, a call.
///
/// Only the longest identifier can match: a shorter one is followed by an
/// identifier character, which the lookahead rejects.
fn call(t: &Text, i: usize, set: &str) -> Option<usize> {
    if !t.boundary(i) || !t.is(i, is_ident_start) {
        return None;
    }
    let end = t.run(i + 1, is_ident);
    followed_by(t, end, set).then_some(end)
}

/// `\b[A-Z]` then `tail*` then `\b`, backtracking to the last boundary.
fn capitalised(t: &Text, i: usize, tail: fn(char) -> bool) -> Option<usize> {
    if !t.boundary(i) || !t.is(i, |c| c.is_ascii_uppercase()) {
        return None;
    }
    let max = t.run(i + 1, tail);
    (i + 1..=max).rev().find(|&end| t.boundary(end))
}

/// `\d[\d_]*` (or `\d+`) then an optional `\.\d+`, each candidate end handed to
/// `rest` in the order the regex would try it. Shorter integer parts are tried
/// too, because a suffix can make the longest one fail.
fn decimal(t: &Text, i: usize, underscores: bool, rest: &dyn Fn(usize) -> Option<usize>) -> Option<usize> {
    if !t.is(i, is_digit) {
        return None;
    }
    let max = t.run(i + 1, |c| is_digit(c) || (underscores && c == '_'));
    for int in (i + 1..=max).rev() {
        if t.at(int) == Some('.') && t.is(int + 1, is_digit) {
            let frac = t.run(int + 1, is_digit);
            for end in (int + 2..=frac).rev() {
                if let Some(found) = rest(end) {
                    return Some(found);
                }
            }
        }
        if let Some(found) = rest(int) {
            return Some(found);
        }
    }
    None
}

/// `(?:[eE][+-]?\d+)?` then `tail`, longest first.
fn exponent(t: &Text, i: usize, tail: &dyn Fn(usize) -> Option<usize>) -> Option<usize> {
    if t.is(i, |c| c == 'e' || c == 'E') {
        let mut starts = [None, Some(i + 1)];
        if t.is(i + 1, |c| c == '+' || c == '-') {
            starts[0] = Some(i + 2);
        }
        for start in starts.into_iter().flatten() {
            if t.is(start, is_digit) {
                let max = t.run(start, is_digit);
                for end in (start + 1..=max).rev() {
                    if let Some(found) = tail(end) {
                        return Some(found);
                    }
                }
            }
        }
    }
    tail(i)
}

/// `0` + one of `marks` + `digits+`, then `tail`, trying shorter digit runs as
/// the regex would when the tail fails after the longest.
fn prefixed(t: &Text, i: usize, marks: &str, digits: fn(char) -> bool, tail: &dyn Fn(usize) -> Option<usize>) -> Option<usize> {
    if t.at(i) != Some('0') || !t.is(i + 1, |c| in_set(marks, c)) {
        return None;
    }
    let max = t.run(i + 2, digits);
    (i + 3..=max).rev().find_map(tail)
}

fn is_hex_digit(c: char) -> bool {
    c.is_ascii_hexdigit() || c == '_'
}

/* -------------------------------------------------------------------------- */
/* JavaScript and TypeScript                                                  */
/* -------------------------------------------------------------------------- */

const JS_KEYWORDS: &[&str] = &[
    "instanceof", "implements", "interface", "extends", "satisfies", "readonly",
    "override", "protected", "namespace", "abstract", "declare", "continue",
    "function", "return", "default", "switch", "break", "delete", "typeof",
    "static", "public", "private", "yield", "async", "await", "const", "class",
    "enum", "from", "import", "export", "throw", "catch", "final", "while",
    "true", "null", "keyof", "void", "case", "else", "for", "let", "new", "try",
    "var", "do", "if", "in", "of", "is", "as", "fn", "type", "def", "end", "use",
];

const JS: &[(Role, Matcher)] = &[
    (Role::Comment, c_comment),
    (Role::String, c_string),
    (Role::String, |t, i| quoted(t, i, '`', true)),
    (Role::Regexp, js_regexp),
    (Role::Number, js_number),
    (Role::Keyword, |t, i| keyword(t, i, JS_KEYWORDS)),
    (Role::Constant, |t, i| keyword(t, i, &["true", "false", "null", "undefined", "NaN", "Infinity"])),
    (Role::Function, |t, i| call(t, i, "(<")),
    (Role::Type, |t, i| capitalised(t, i, is_ident)),
    (Role::Property, |t, i| (i > 0 && t.at(i - 1) == Some('.') && t.is(i, is_ident_start)).then(|| t.run(i + 1, is_ident))),
    (Role::Punctuation, |t, i| one_of(t, i, "{}()[];,.")),
    (Role::Operator, |t, i| run_of(t, i, "+-*/%=<>!&|^~?:")),
];

/// `(?<=\bword\s)` at `i`.
fn after_word(t: &Text, i: usize, word: &str) -> bool {
    let n = word.len() + 1;
    i >= n && t.boundary(i - n) && t.slice(i - n, i - 1) == word && t.is(i - 1, is_space)
}

/// A regexp, only where a value can begin: after an operator or opening
/// punctuation, after `return`, `case` or `typeof`, or at the very start.
///
/// No step backtracks into a different answer: whitespace and the body's
/// characters are never `/`, a class that does not close leaves a `[` no other
/// branch accepts, and an escape is the only way past a backslash.
fn js_regexp(t: &Text, i: usize) -> Option<usize> {
    let value_position = i == 0
        || t.is(i.wrapping_sub(1), |c| in_set("=(,:[!&|?{};", c))
        || after_word(t, i, "return")
        || after_word(t, i, "case")
        || after_word(t, i, "typeof");
    if !value_position {
        return None;
    }
    let open = t.run(i, is_space);
    if t.at(open) != Some('/') {
        return None;
    }
    let mut at = open + 1;
    loop {
        match t.at(at) {
            None | Some('/' | '\n') => break,
            Some('\\') => {
                if !t.is(at + 1, |c| !is_line_terminator(c)) {
                    break;
                }
                at += 2;
            }
            Some('[') => match regexp_class(t, at) {
                Some(end) => at = end,
                None => break,
            },
            Some(_) => at += 1,
        }
    }
    if at == open + 1 || t.at(at) != Some('/') {
        return None;
    }
    Some(t.run(at + 1, |c| in_set("gimsuy", c)))
}

/// `\[(?:[^\]\\\n]|\\.)*\]`.
fn regexp_class(t: &Text, i: usize) -> Option<usize> {
    let mut at = i + 1;
    loop {
        match t.at(at)? {
            ']' => return Some(at + 1),
            '\n' => return None,
            '\\' => {
                if !t.is(at + 1, |c| !is_line_terminator(c)) {
                    return None;
                }
                at += 2;
            }
            _ => at += 1,
        }
    }
}

/// `\b(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)n?\b`.
fn js_number(t: &Text, i: usize) -> Option<usize> {
    if !t.boundary(i) {
        return None;
    }
    let tail = |end: usize| {
        if t.at(end) == Some('n') && t.boundary(end + 1) {
            Some(end + 1)
        } else {
            t.boundary(end).then_some(end)
        }
    };
    prefixed(t, i, "xXbBoO", is_hex_digit, &tail).or_else(|| decimal(t, i, true, &|end| exponent(t, end, &tail)))
}

/* -------------------------------------------------------------------------- */
/* JSON                                                                       */
/* -------------------------------------------------------------------------- */

const JSON: &[(Role, Matcher)] = &[
    (Role::Property, |t, i| quoted(t, i, '"', true).filter(|&end| followed_by(t, end, ":"))),
    (Role::String, |t, i| quoted(t, i, '"', true)),
    (Role::Number, json_number),
    (Role::Constant, |t, i| keyword(t, i, &["true", "false", "null"])),
    (Role::Punctuation, |t, i| one_of(t, i, "{}[],:")),
    (Role::Operator, |t, i| one_of(t, i, "-+*/")),
];

/// `-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`. Without the sign the match would
/// have to start at `-`, which is not a digit, so only one start is possible.
fn json_number(t: &Text, i: usize) -> Option<usize> {
    let start = if t.at(i) == Some('-') { i + 1 } else { i };
    if !t.boundary(start) {
        return None;
    }
    let tail = |end: usize| t.boundary(end).then_some(end);
    decimal(t, start, false, &|end| exponent(t, end, &tail))
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                        */
/* -------------------------------------------------------------------------- */

const CSS_FUNCTIONS: &[&str] = &[
    "calc", "var", "url", "clamp", "min", "max", "rgb", "rgba", "hsl", "hsla", "oklch", "linear-gradient",
];
const CSS_KEYWORDS: &[&str] = &[
    "important", "inherit", "initial", "unset", "revert", "auto", "none", "solid", "dashed", "dotted",
    "block", "flex", "grid", "inline", "absolute", "relative", "fixed", "sticky",
];
const CSS_UNITS: &[&str] = &["px", "rem", "em", "%", "vh", "vw", "s", "ms", "fr", "deg", "ch", "ex"];

const CSS: &[(Role, Matcher)] = &[
    (Role::Comment, block_comment),
    (Role::String, c_string),
    (Role::Keyword, |t, i| (t.at(i) == Some('@')).then(|| t.run(i + 1, is_css_word)).filter(|&end| end > i + 1)),
    (Role::Property, css_property),
    (Role::Function, css_function),
    (Role::Number, css_number),
    (Role::Constant, |t, i| keyword(t, i, CSS_KEYWORDS)),
    (Role::Tag, css_selector),
    (Role::Punctuation, |t, i| one_of(t, i, "{}();,:")),
    (Role::Operator, |t, i| one_of(t, i, ">+~*=^$|")),
];

/// `[-\w]`.
fn is_css_word(c: char) -> bool {
    is_word(c) || c == '-'
}

/// `(?<=[{;])\s*[-\w]+(?=\s*:)`. Neither run can give characters back usefully:
/// a shorter one leaves the next character inside the run, which the following
/// step rejects.
fn css_property(t: &Text, i: usize) -> Option<usize> {
    if i == 0 || !t.is(i - 1, |c| c == '{' || c == ';') {
        return None;
    }
    let name = t.run(i, is_space);
    let end = t.run(name, is_css_word);
    (end > name && followed_by(t, end, ":")).then_some(end)
}

/// `\b(?:calc|...|linear-gradient)\b(?=\s*\()`, in the pattern's order, since
/// `rgb` is tried before `rgba` and gives way only when `\b` fails after it.
fn css_function(t: &Text, i: usize) -> Option<usize> {
    if !t.boundary(i) {
        return None;
    }
    CSS_FUNCTIONS.iter().find_map(|name| {
        let end = i + name.len();
        (t.starts(i, name) && t.boundary(end) && followed_by(t, end, "(")).then_some(end)
    })
}

/// `\b\d*\.?\d+(?:px|rem|...)?\b`.
///
/// Of all the places the regex can end `\d+`, only the end of a digit run can
/// succeed: anywhere earlier the next character is a digit, so no unit starts
/// there and `\b` cannot hold between two digits. That leaves two candidates,
/// tried in the regex's order: through a fraction, then the integer alone.
fn css_number(t: &Text, i: usize) -> Option<usize> {
    if !t.boundary(i) {
        return None;
    }
    let tail = |end: usize| {
        CSS_UNITS
            .iter()
            .find_map(|unit| {
                let after = end + unit.len();
                (t.starts(end, unit) && t.boundary(after)).then_some(after)
            })
            .or_else(|| t.boundary(end).then_some(end))
    };
    let int = t.run(i, is_digit);
    if t.at(int) == Some('.') && t.is(int + 1, is_digit) {
        if let Some(end) = tail(t.run(int + 1, is_digit)) {
            return Some(end);
        }
    }
    if int > i {
        return tail(int);
    }
    None
}

/// `[.#]?[-\w]+(?=[^{}]*\{)`: an identifier that opens a block later on.
fn css_selector(t: &Text, i: usize) -> Option<usize> {
    let start = if t.is(i, |c| c == '.' || c == '#') { i + 1 } else { i };
    let end = t.run(start, is_css_word);
    if end == start {
        return None;
    }
    let brace = t.run(end, |c| c != '{' && c != '}');
    (t.at(brace) == Some('{')).then_some(end)
}

/* -------------------------------------------------------------------------- */
/* Rust                                                                       */
/* -------------------------------------------------------------------------- */

const RUST_KEYWORDS: &[&str] = &[
    "macro_rules", "struct", "static", "trait", "union", "where", "while", "unsafe", "super", "return",
    "const", "enum", "extern", "impl", "async", "await", "break", "continue", "crate", "false", "fn", "for",
    "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "self", "Self", "type", "true", "use", "in",
    "if", "as", "dyn",
];

const RUST: &[(Role, Matcher)] = &[
    (Role::Comment, c_comment),
    (Role::String, rust_string),
    (Role::String, rust_char),
    (Role::Type, rust_lifetime),
    (Role::Attribute, rust_attribute),
    (Role::Number, rust_number),
    (Role::Keyword, |t, i| keyword(t, i, RUST_KEYWORDS)),
    (Role::Constant, |t, i| keyword(t, i, &["Some", "None", "Ok", "Err"])),
    (Role::Function, |t, i| call(t, i, "(!<")),
    (Role::Type, |t, i| capitalised(t, i, is_word)),
    (Role::Punctuation, |t, i| one_of(t, i, "{}()[];,.:")),
    (Role::Operator, |t, i| run_of(t, i, "+-*/%=<>!&|^~?@")),
];

/// `r?#*"(?:[^"\\]|\\.)*"#*|"(?:[^"\\\n]|\\.)*"`.
fn rust_string(t: &Text, i: usize) -> Option<usize> {
    let hashes = if t.at(i) == Some('r') { i + 1 } else { i };
    let open = t.run(hashes, |c| c == '#');
    if let Some(close) = quoted(t, open, '"', true) {
        return Some(t.run(close, |c| c == '#'));
    }
    quoted(t, i, '"', false)
}

/// `'(?:[^'\\\n]|\\.)'`: exactly one character, as a Rust char is.
fn rust_char(t: &Text, i: usize) -> Option<usize> {
    if t.at(i) != Some('\'') {
        return None;
    }
    let close = match t.at(i + 1)? {
        '\\' => t.is(i + 2, |c| !is_line_terminator(c)).then_some(i + 3)?,
        '\'' | '\n' => return None,
        _ => i + 2,
    };
    (t.at(close) == Some('\'')).then_some(close + 1)
}

/// `'(?:static|_|[A-Za-z_]\w*)(?![\w'\\])`. The first two alternatives are
/// cases of the third with the same lookahead, so the longest identifier
/// decides.
fn rust_lifetime(t: &Text, i: usize) -> Option<usize> {
    if t.at(i) != Some('\'') || !t.is(i + 1, |c| c.is_ascii_alphabetic() || c == '_') {
        return None;
    }
    let end = t.run(i + 2, is_word);
    (!t.is(end, |c| is_word(c) || c == '\'' || c == '\\')).then_some(end)
}

/// `#!?\[[^\]]*\]`.
fn rust_attribute(t: &Text, i: usize) -> Option<usize> {
    if t.at(i) != Some('#') {
        return None;
    }
    let open = if t.at(i + 1) == Some('!') { i + 2 } else { i + 1 };
    if t.at(open) != Some('[') {
        return None;
    }
    let close = t.run(open + 1, |c| c != ']');
    (t.at(close) == Some(']')).then_some(close + 1)
}

/// `\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d+)?
/// (?:[iuf](?:8|16|32|64|128|size))?)\b`.
fn rust_number(t: &Text, i: usize) -> Option<usize> {
    if !t.boundary(i) {
        return None;
    }
    let tail = |end: usize| {
        if t.is(end, |c| in_set("iuf", c)) {
            let suffix = ["8", "16", "32", "64", "128", "size"].iter().find_map(|width| {
                let after = end + 1 + width.len();
                (t.starts(end + 1, width) && t.boundary(after)).then_some(after)
            });
            if suffix.is_some() {
                return suffix;
            }
        }
        t.boundary(end).then_some(end)
    };
    // The suffix belongs to the decimal alternative alone, so a prefixed
    // literal ends at `\b` and `0xFFi32` is not a number at all.
    let bare = |end: usize| t.boundary(end).then_some(end);
    prefixed(t, i, "xX", is_hex_digit, &bare)
        .or_else(|| prefixed(t, i, "bB", |c| c == '0' || c == '1' || c == '_', &bare))
        .or_else(|| prefixed(t, i, "oO", |c| ('0'..='7').contains(&c) || c == '_', &bare))
        .or_else(|| decimal(t, i, true, &tail))
}

/* -------------------------------------------------------------------------- */
/* HTML                                                                       */
/* -------------------------------------------------------------------------- */

const HTML: &[(Role, Matcher)] = &[
    (Role::Comment, |t, i| {
        if t.starts(i, "<!--") {
            t.through(i + 4, "-->")
        } else if t.starts(i, "<![CDATA[") {
            t.through(i + 9, "]]>")
        } else {
            None
        }
    }),
    (Role::Keyword, |t, i| {
        if !t.starts(i, "<!DOCTYPE") {
            return None;
        }
        let close = t.run(i + 9, |c| c != '>');
        (t.at(close) == Some('>')).then_some(close + 1)
    }),
    (Role::Tag, |t, i| (t.at(i) == Some('<')).then(|| if t.at(i + 1) == Some('/') { i + 2 } else { i + 1 })),
    (Role::Tag, html_tag_name),
    (Role::Attribute, html_attribute),
    (Role::String, |t, i| {
        let q = t.at(i).filter(|&c| c == '"' || c == '\'')?;
        let close = t.run(i + 1, |c| c != q);
        (t.at(close) == Some(q)).then_some(close + 1)
    }),
    (Role::Operator, |t, i| one_of(t, i, "=")),
    (Role::Punctuation, |t, i| one_of(t, i, ">")),
];

fn is_name(c: char) -> bool {
    is_word(c) || c == ':' || c == '-'
}

/// `[A-Za-z][\w:-]*(?![\w:.-]|\s*=)`. Possessive in effect: a shorter name is
/// followed by a name character, which the lookahead rejects.
fn html_tag_name(t: &Text, i: usize) -> Option<usize> {
    if !t.is(i, |c| c.is_ascii_alphabetic()) {
        return None;
    }
    let end = t.run(i + 1, is_name);
    let rejected = t.is(end, |c| is_name(c) || c == '.') || followed_by(t, end, "=");
    (!rejected).then_some(end)
}

/// `[A-Za-z_:@][\w:.-]*(?=\s*=)`.
fn html_attribute(t: &Text, i: usize) -> Option<usize> {
    if !t.is(i, |c| c.is_ascii_alphabetic() || in_set("_:@", c)) {
        return None;
    }
    let end = t.run(i + 1, |c| is_name(c) || c == '.');
    followed_by(t, end, "=").then_some(end)
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

const MARKDOWN: &[(Role, Matcher)] = &[
    (Role::Heading, |t, i| (t.line_start(i) && t.at(i) == Some('#')).then(|| to_line_end(t, i))),
    (Role::String, |t, i| {
        (t.line_start(i) && (t.starts(i, "```") || t.starts(i, "~~~"))).then(|| to_line_end(t, i))
    }),
    (Role::String, |t, i| delimited(t, i, "`", '`')),
    (Role::Link, markdown_link),
    (Role::Keyword, |t, i| delimited(t, i, "**", '*').or_else(|| delimited(t, i, "__", '_'))),
    (Role::Type, |t, i| delimited(t, i, "*", '*').or_else(|| delimited(t, i, "_", '_'))),
    (Role::Comment, |t, i| {
        if !t.line_start(i) {
            return None;
        }
        let indent = t.run(i, is_space);
        (indent - i >= 4).then(|| to_line_end(t, indent))
    }),
    (Role::Operator, markdown_list_marker),
];

fn to_line_end(t: &Text, i: usize) -> usize {
    t.run(i, |c| c != '\n')
}

/// `fence[^fence\n]+fence`, for a fence made of `mark`. A shorter body would be
/// followed by a body character, never the fence.
fn delimited(t: &Text, i: usize, fence: &str, mark: char) -> Option<usize> {
    if !t.starts(i, fence) {
        return None;
    }
    let open = i + fence.len();
    let close = t.run(open, |c| c != mark && c != '\n');
    (close > open && t.starts(close, fence)).then_some(close + fence.len())
}

/// `!?(?:\[[^\]\n]*\])\([^)\n]*\)|<[^ >\n@]+@[^ >\n]+>`.
fn markdown_link(t: &Text, i: usize) -> Option<usize> {
    let open = if t.at(i) == Some('!') { i + 1 } else { i };
    if t.at(open) == Some('[') {
        let label = t.run(open + 1, |c| c != ']' && c != '\n');
        if t.at(label) == Some(']') && t.at(label + 1) == Some('(') {
            let target = t.run(label + 2, |c| c != ')' && c != '\n');
            if t.at(target) == Some(')') {
                return Some(target + 1);
            }
        }
    }
    if t.at(i) != Some('<') {
        return None;
    }
    let user = t.run(i + 1, |c| !in_set(" >\n@", c));
    if user == i + 1 || t.at(user) != Some('@') {
        return None;
    }
    let host = t.run(user + 1, |c| !in_set(" >\n", c));
    (host > user + 1 && t.at(host) == Some('>')).then_some(host + 1)
}

/// `^\s*(?:[-*+]|\d+\.)\s`. A shorter indent leaves whitespace where the marker
/// must be, so only the full indent can match.
fn markdown_list_marker(t: &Text, i: usize) -> Option<usize> {
    if !t.line_start(i) {
        return None;
    }
    let at = t.run(i, is_space);
    let marker = match t.at(at)? {
        '-' | '*' | '+' => at + 1,
        c if is_digit(c) => {
            let digits = t.run(at, is_digit);
            (t.at(digits) == Some('.')).then_some(digits + 1)?
        }
        _ => return None,
    };
    t.is(marker, is_space).then_some(marker + 1)
}

/* -------------------------------------------------------------------------- */
/* JavaScript boundary                                                        */
/* -------------------------------------------------------------------------- */

// Spans cross as one flat array rather than objects, which would need js-sys.
// Ends are UTF-16 offsets, as every offset at this boundary is, so the JS side
// slices the source it already holds instead of receiving each span's text.

#[cfg(feature = "bindgen")]
use wasm_bindgen::prelude::*;

/// Each span as a pair: its end, in UTF-16 code units from the start of the
/// source, then its role as an index in `Role::ALL`. One call, so a consumer
/// tokenizes once rather than once per array.
#[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = highlightSpans))]
pub fn js_highlight_spans(source: &str, language: &str) -> Vec<u32> {
    let mut end = 0u32;
    let mut out = Vec::new();
    for span in highlight(source, language) {
        end += span.text.chars().map(|c| c.len_utf16() as u32).sum::<u32>();
        out.push(end);
        out.push(u32::from(span.role.code()));
    }
    out
}

/// The canonical name for a language or alias, or `""` when none matches.
#[cfg_attr(feature = "bindgen", wasm_bindgen(js_name = resolveLanguage))]
pub fn js_resolve_language(name: &str) -> String {
    Language::resolve(name).map(|l| String::from(l.name())).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roles(source: &str, language: &str) -> Vec<(&'static str, String)> {
        highlight(source, language).iter().map(|s| (s.role.as_str(), String::from(s.text))).collect()
    }

    fn has(source: &str, language: &str, role: &str, text: &str) -> bool {
        roles(source, language).iter().any(|(r, t)| *r == role && t == text)
    }

    #[test]
    fn reconstructs_every_language() {
        let source = "fn main() { let x = 'a'; /* é */ \"s\" } // 😀\n# h\n<a href=\"x\">";
        for language in Language::ALL {
            let text: String = highlight(source, language.name()).iter().map(|s| s.text).collect();
            assert_eq!(text, source, "{}", language.name());
        }
    }

    #[test]
    fn coalesces_and_never_emits_empty_spans() {
        let spans = highlight("a  b", "rust");
        assert!(spans.iter().all(|s| !s.text.is_empty()));
        assert!(spans.windows(2).all(|w| w[0].role != w[1].role));
    }

    #[test]
    fn unknown_language_is_one_plain_span_even_when_empty() {
        assert_eq!(highlight("", "cobol"), alloc::vec![Span { role: Role::Fg, text: "" }]);
        assert!(highlight("", "rust").is_empty());
        assert_eq!(Language::resolve("toString"), None);
    }

    #[test]
    fn resolves_aliases() {
        assert_eq!(Language::resolve(" RS "), Some(Language::Rust));
        assert_eq!(Language::resolve("tsx"), Some(Language::TypeScript));
        assert_eq!(Language::resolve("svg"), Some(Language::Html));
        assert_eq!(Language::resolve("mar\u{212A}down"), Some(Language::Markdown));
    }

    #[test]
    fn rust_lifetimes_chars_and_macros() {
        let src = "fn f<'a>(x: &'a str) -> char { println!(\"{}\", 'b'); 0xFFi32 }";
        assert!(has(src, "rust", "type", "'a"));
        assert!(has(src, "rust", "string", "'b'"));
        assert!(has(src, "rust", "function", "println"));
        assert!(!has(src, "rust", "number", "0xFFi32"));
        assert!(has("1u8 ", "rust", "number", "1u8"));
        // The JS pattern does not pair a raw string's hashes, so an inner quote
        // closes it. Matching that is the point; improving it is a change to both.
        assert!(has("r#\"a\"b\"#", "rust", "string", "r#\"a\""));
        assert!(has("#[derive(Debug)]", "rust", "attribute", "#[derive(Debug)]"));
    }

    #[test]
    fn js_division_is_not_a_regexp() {
        assert!(!roles("const d = a / b / c;", "js").iter().any(|(r, _)| *r == "regexp"));
        assert!(has("const re = /ab+c/g;", "js", "regexp", " /ab+c/g"));
        assert!(has("return /x/", "js", "regexp", "/x/"));
    }

    #[test]
    fn css_rgb_gives_way_to_rgba() {
        assert!(has("a{color:rgba(0,0,0)}", "css", "function", "rgba"));
        assert!(has("a{width:50% }", "css", "number", "50"));
    }

    #[test]
    fn markdown_blocks_match_on_every_line() {
        let src = "# One\n\n## Two\n- item";
        assert!(has(src, "markdown", "heading", "## Two"));
        assert!(has(src, "markdown", "operator", "- "));
    }

    #[test]
    fn wire_ends_are_utf16() {
        let spans = js_highlight_spans("😀 x", "rust");
        assert_eq!(spans.iter().step_by(2).last(), Some(&4));
        assert_eq!(js_resolve_language("JSX"), "javascript");
        assert_eq!(js_resolve_language("nope"), "");
    }
}
