//! A JSON value with JavaScript's semantics, where they show.
//!
//! Three places do. Object keys iterate in JavaScript's order (array-index keys
//! first, ascending, then insertion order), which decides which invalid colour
//! role an error names first. A duplicate key replaces the value but keeps the
//! first position, as `JSON.parse` does. And numbers and values print the way
//! a template literal prints them, because error messages interpolate them.

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::fmt::Write;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Object),
}

/// An insertion-ordered object.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Object(Vec<(String, Value)>);

impl Object {
    pub fn new() -> Self {
        Self(Vec::new())
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut Value> {
        self.0.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Replaces in place, keeping the key's position, or appends.
    pub fn insert(&mut self, key: impl Into<String>, value: Value) {
        let key = key.into();
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key, value)),
        }
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Entries in the order `Object.entries` gives them.
    pub fn entries(&self) -> Vec<(&str, &Value)> {
        let mut index: Vec<(u32, &str, &Value)> = Vec::new();
        let mut rest: Vec<(&str, &Value)> = Vec::new();
        for (k, v) in &self.0 {
            match array_index(k) {
                Some(n) => index.push((n, k, v)),
                None => rest.push((k, v)),
            }
        }
        index.sort_unstable_by_key(|(n, _, _)| *n);
        index.into_iter().map(|(_, k, v)| (k, v)).chain(rest).collect()
    }
}

/// A key JavaScript orders as an array index: a canonical integer below 2^32 - 1.
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|n| *n != u32::MAX)
}

impl Value {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&Object> {
        match self {
            Value::Object(o) => Some(o),
            _ => None,
        }
    }

    /// `String(value)`, as a template literal interpolates it.
    pub fn to_js_string(&self) -> String {
        match self {
            Value::Null => "null".into(),
            Value::Bool(b) => b.to_string(),
            Value::Number(n) => js_number(*n),
            Value::String(s) => s.clone(),
            Value::Array(items) => {
                let mut out = String::new();
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    // `Array.prototype.join` writes nothing for null.
                    if !matches!(item, Value::Null) {
                        out.push_str(&item.to_js_string());
                    }
                }
                out
            }
            Value::Object(_) => "[object Object]".into(),
        }
    }

    /// `JSON.stringify(value)`.
    pub fn to_json(&self) -> String {
        let mut out = String::new();
        write_json(self, &mut out);
        out
    }
}

fn write_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) if n.is_finite() => out.push_str(&js_number(*n)),
        Value::Number(_) => out.push_str("null"),
        Value::String(s) => quote(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Value::Object(object) => {
            out.push('{');
            for (i, (k, v)) in object.entries().into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                quote(k, out);
                out.push(':');
                write_json(v, out);
            }
            out.push('}');
        }
    }
}

/// `JSON.stringify` for a string.
pub fn quote(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `Number.prototype.toString()`: the shortest round-tripping digits, laid out
/// by ECMAScript's rules rather than Rust's (`1e+21`, not `1000000000000000000000`).
pub fn js_number(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n == 0.0 {
        return "0".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    let mut sci = String::new();
    // `{:e}` with no precision is the shortest representation, `d.ddde±x`.
    let _ = write!(sci, "{:e}", if n < 0.0 { -n } else { n });
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let point = exponent.parse::<i32>().unwrap_or(0) + 1;
    let mut out = String::new();
    if n < 0.0 {
        out.push('-');
    }
    if k <= point && point <= 21 {
        out.push_str(&digits);
        for _ in 0..point - k {
            out.push('0');
        }
    } else if 0 < point && point <= 21 {
        out.push_str(&digits[..point as usize]);
        out.push('.');
        out.push_str(&digits[point as usize..]);
    } else if -6 < point && point <= 0 {
        out.push_str("0.");
        for _ in 0..-point {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let e = point - 1;
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, if e < 0 { -e } else { e });
    }
    out
}

/// What `String.prototype.trim` removes: ECMAScript WhiteSpace and
/// LineTerminator. Not `char::is_whitespace`, which adds U+0085 and drops U+FEFF.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}'
            | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// Nesting deeper than any theme needs; it bounds recursion on hostile input.
const MAX_DEPTH: usize = 128;

/// `JSON.parse`. A lone surrogate escape becomes U+FFFD, which is what a
/// JavaScript string holding one turns into on its way to WASM anyway.
pub fn parse(text: &str) -> Result<Value, String> {
    let mut p = Parser { bytes: text.as_bytes(), text, at: 0 };
    p.skip_ws();
    let value = p.value(0)?;
    p.skip_ws();
    if p.at != p.bytes.len() {
        return Err(p.error());
    }
    Ok(value)
}

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn error(&self) -> String {
        let mut s = String::from("Invalid JSON at ");
        let _ = write!(s, "{}", self.at);
        s
    }

    fn skip_ws(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.bytes.get(self.at) {
            self.at += 1;
        }
    }

    fn eat(&mut self, literal: &str) -> bool {
        if self.text[self.at..].starts_with(literal) {
            self.at += literal.len();
            true
        } else {
            false
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > MAX_DEPTH {
            return Err(self.error());
        }
        match self.bytes.get(self.at) {
            Some(b'{') => {
                self.at += 1;
                let mut object = Object::new();
                self.skip_ws();
                if self.eat("}") {
                    return Ok(Value::Object(object));
                }
                loop {
                    self.skip_ws();
                    let key = self.string()?;
                    self.skip_ws();
                    if !self.eat(":") {
                        return Err(self.error());
                    }
                    self.skip_ws();
                    let value = self.value(depth + 1)?;
                    object.insert(key, value);
                    self.skip_ws();
                    if self.eat("}") {
                        return Ok(Value::Object(object));
                    }
                    if !self.eat(",") {
                        return Err(self.error());
                    }
                }
            }
            Some(b'[') => {
                self.at += 1;
                let mut items = Vec::new();
                self.skip_ws();
                if self.eat("]") {
                    return Ok(Value::Array(items));
                }
                loop {
                    self.skip_ws();
                    items.push(self.value(depth + 1)?);
                    self.skip_ws();
                    if self.eat("]") {
                        return Ok(Value::Array(items));
                    }
                    if !self.eat(",") {
                        return Err(self.error());
                    }
                }
            }
            Some(b'"') => Ok(Value::String(self.string()?)),
            Some(b't') if self.eat("true") => Ok(Value::Bool(true)),
            Some(b'f') if self.eat("false") => Ok(Value::Bool(false)),
            Some(b'n') if self.eat("null") => Ok(Value::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(self.error()),
        }
    }

    fn number(&mut self) -> Result<Value, String> {
        let start = self.at;
        let digits = |p: &mut Self| {
            let from = p.at;
            while let Some(b'0'..=b'9') = p.bytes.get(p.at) {
                p.at += 1;
            }
            p.at - from
        };
        if self.bytes.get(self.at) == Some(&b'-') {
            self.at += 1;
        }
        let int_start = self.at;
        let n = digits(self);
        if n == 0 || (n > 1 && self.bytes[int_start] == b'0') {
            return Err(self.error());
        }
        if self.bytes.get(self.at) == Some(&b'.') {
            self.at += 1;
            if digits(self) == 0 {
                return Err(self.error());
            }
        }
        if let Some(b'e' | b'E') = self.bytes.get(self.at) {
            self.at += 1;
            if let Some(b'+' | b'-') = self.bytes.get(self.at) {
                self.at += 1;
            }
            if digits(self) == 0 {
                return Err(self.error());
            }
        }
        // Rust's float parsing is correctly rounded, as `JSON.parse` is; a
        // too-large exponent gives infinity in both.
        self.text[start..self.at].parse::<f64>().map(Value::Number).map_err(|_| self.error())
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let s = self.text.get(self.at..self.at + 4).ok_or_else(|| self.error())?;
        if !s.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(self.error());
        }
        self.at += 4;
        u32::from_str_radix(s, 16).map_err(|_| self.error())
    }

    fn string(&mut self) -> Result<String, String> {
        if !self.eat("\"") {
            return Err(self.error());
        }
        let mut out = String::new();
        loop {
            let rest = &self.text[self.at..];
            let c = rest.chars().next().ok_or_else(|| self.error())?;
            self.at += c.len_utf8();
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = self.bytes.get(self.at).copied().ok_or_else(|| self.error())?;
                    self.at += 1;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let unit = self.hex4()?;
                            let point = if (0xd800..0xdc00).contains(&unit) && self.text[self.at..].starts_with("\\u") {
                                let save = self.at;
                                self.at += 2;
                                let low = self.hex4()?;
                                if (0xdc00..0xe000).contains(&low) {
                                    0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00)
                                } else {
                                    self.at = save;
                                    unit
                                }
                            } else {
                                unit
                            };
                            out.push(char::from_u32(point).unwrap_or('\u{FFFD}'));
                        }
                        _ => return Err(self.error()),
                    }
                }
                c if (c as u32) < 0x20 => return Err(self.error()),
                c => out.push(c),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_like_javascript() {
        for (n, s) in [
            (1.0, "1"),
            (4.5, "4.5"),
            (-0.0, "0"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (123.456, "123.456"),
            (2.5e300, "2.5e+300"),
            (-3.0, "-3"),
        ] {
            assert_eq!(js_number(n), s);
        }
    }

    #[test]
    fn keys_iterate_in_javascript_order() {
        let value = parse(r#"{"b":1,"2":2,"a":3,"1":4,"01":5,"b":6}"#).unwrap();
        let keys: Vec<_> = value.as_object().unwrap().entries().into_iter().map(|(k, _)| k.to_string()).collect();
        assert_eq!(keys, ["1", "2", "b", "a", "01"]);
        assert_eq!(value.as_object().unwrap().get("b"), Some(&Value::Number(6.0)));
    }

    #[test]
    fn surrogate_escapes() {
        assert_eq!(parse(r#""\ud83d\ude00""#).unwrap(), Value::String("😀".into()));
        assert_eq!(parse(r#""\ud800x""#).unwrap(), Value::String("\u{FFFD}x".into()));
    }

    #[test]
    fn rejects_what_json_parse_rejects() {
        for bad in ["", "01", "1.", "[1,]", "{\"a\":1,}", "\"\t\"", "tru", "\"\\x\""] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn stringify_matches_json_stringify() {
        let v = parse(r#"{"a":[1,null,"x\u0001\n\"\\"],"b":true}"#).unwrap();
        assert_eq!(v.to_json(), r#"{"a":[1,null,"x\u0001\n\"\\"],"b":true}"#);
        assert_eq!(parse("[1,[2,null],{}]").unwrap().to_js_string(), "1,2,,[object Object]");
    }
}
