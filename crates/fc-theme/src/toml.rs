//! `parseThemeToml` and `serializeThemeToml`, from `theme-toml.ts`.
//!
//! Not a TOML parser: the theme schema needs single-line strings, one integer
//! and named colour tables, and anything else is refused with its line number
//! rather than half-understood. Each line is matched the way the TypeScript's
//! regexes match it; the comments name the regex a branch stands for.

use crate::json::{is_js_whitespace, js_trim, quote, Object, Value};
use crate::validate::ThemeError;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// What a JavaScript regex `.` refuses to match (`\n` never reaches a line).
fn is_line_terminator(c: char) -> bool {
    matches!(c, '\r' | '\u{2028}' | '\u{2029}')
}

/// `\s*(?:#.*)?$`: optional whitespace, then the end or a comment.
fn ends_cleanly(rest: &str) -> bool {
    let rest = rest.trim_start_matches(is_js_whitespace);
    rest.is_empty() || (rest.starts_with('#') && !rest.chars().any(is_line_terminator))
}

/// `[a-z][a-z0-9-]*` at the start of `s`: its length in bytes, or 0.
fn ident(s: &str) -> usize {
    let b = s.as_bytes();
    if b.first().is_some_and(u8::is_ascii_lowercase) {
        1 + b[1..].iter().take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || **c == b'-').count()
    } else {
        0
    }
}

/// `^\[(theme|colors\.([a-z][a-z0-9-]*|"[a-z][a-z0-9-]*"))\]` and the tail:
/// the table's written name and, for a colour table, its role.
fn table(line: &str) -> Option<(&str, Option<&str>)> {
    let rest = line.strip_prefix('[')?;
    let (name, role, after) = if let Some(after) = rest.strip_prefix("theme") {
        (&rest[..5], None, after)
    } else {
        let r = rest.strip_prefix("colors.")?;
        let (len, role) = if let Some(q) = r.strip_prefix('"') {
            let n = ident(q);
            if n == 0 || q.as_bytes().get(n) != Some(&b'"') {
                return None;
            }
            (n + 2, &q[..n])
        } else {
            let n = ident(r);
            if n == 0 {
                return None;
            }
            (n, &r[..n])
        };
        (&rest[..7 + len], Some(role), &r[len..])
    };
    let after = after.strip_prefix(']')?;
    ends_cleanly(after).then_some((name, role))
}

/// `^schema-version\s*=\s*(0|[1-9][0-9]*)` and the tail: the digits.
fn schema_version(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("schema-version")?.trim_start_matches(is_js_whitespace);
    let rest = rest.strip_prefix('=')?.trim_start_matches(is_js_whitespace);
    let n = rest.bytes().take_while(u8::is_ascii_digit).count();
    // `0` is complete on its own, so `01` matches nothing at all.
    let n = if rest.starts_with('0') { 1 } else { n };
    if n == 0 || rest.as_bytes().get(n).is_some_and(u8::is_ascii_digit) {
        return None;
    }
    ends_cleanly(&rest[n..]).then_some(&rest[..n])
}

/// `^([a-z][a-z0-9-]*)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')` and the tail.
fn entry(line: &str) -> Option<(&str, &str)> {
    let n = ident(line);
    if n == 0 {
        return None;
    }
    let (key, rest) = line.split_at(n);
    let rest = rest.trim_start_matches(is_js_whitespace).strip_prefix('=')?;
    let rest = rest.trim_start_matches(is_js_whitespace);
    let mut chars = rest.char_indices();
    let end = match chars.next()? {
        (_, '\'') => 1 + rest[1..].find('\'')? + 1,
        (_, '"') => loop {
            match chars.next()? {
                (i, '"') => break i + 1,
                // An escape takes the next character, whatever it is, except
                // one `.` will not match.
                (_, '\\') => {
                    if is_line_terminator(chars.next()?.1) {
                        return None;
                    }
                }
                _ => {}
            }
        },
        _ => return None,
    };
    ends_cleanly(&rest[end..]).then_some((key, &rest[..end]))
}

/// The value of a basic string, escapes resolved. TOML's escapes only, and
/// `\u`/`\U` must name a Unicode scalar value, so no lone surrogate gets in.
fn basic_string(body: &str) -> Result<String, &'static str> {
    let mut out = String::new();
    let mut chars = body.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                let e = chars.next().ok_or("invalid quoted string")?;
                let digits = match e {
                    '"' | '\\' => {
                        out.push(e);
                        continue;
                    }
                    'b' => {
                        out.push('\u{8}');
                        continue;
                    }
                    't' => {
                        out.push('\t');
                        continue;
                    }
                    'n' => {
                        out.push('\n');
                        continue;
                    }
                    'f' => {
                        out.push('\u{c}');
                        continue;
                    }
                    'r' => {
                        out.push('\r');
                        continue;
                    }
                    'u' => 4,
                    'U' => 8,
                    _ => return Err("unsupported string escape"),
                };
                let mut point = 0u32;
                for _ in 0..digits {
                    let d = chars.next().and_then(|d| d.to_digit(16)).ok_or("invalid quoted string")?;
                    point = point * 16 + d;
                }
                out.push(char::from_u32(point).ok_or("invalid Unicode escape")?);
            }
            c if (c as u32) < 0x20 && c != '\t' => return Err("invalid quoted string"),
            c => out.push(c),
        }
    }
    Ok(out)
}

enum Target {
    Theme,
    Color(String),
}

/// `parseThemeToml`: the TOML as a plain value, for `migrate_theme` to judge.
pub fn parse(source: &str) -> Result<Value, ThemeError> {
    if source.len() > 65536 {
        return Err(ThemeError("Theme TOML exceeds 64 KiB".into()));
    }
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let mut result = Object::new();
    let mut colors = Object::new();
    let mut has_colors = false;
    let mut tables: Vec<&str> = Vec::new();
    let mut target = Target::Theme;
    for (index, raw) in source.split('\n').enumerate() {
        let fail = |message: &str| -> Result<Value, ThemeError> { Err(ThemeError(format!("Theme TOML line {}: {message}", index + 1))) };
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        let line = js_trim(raw);
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            let Some((name, role)) = table(line) else { return fail("expected [theme] or [colors.role-name]") };
            if tables.contains(&name) {
                return fail("duplicate table");
            }
            tables.push(name);
            match role {
                None => target = Target::Theme,
                Some(role) => {
                    if colors.contains_key(role) {
                        return fail("duplicate color table");
                    }
                    colors.insert(role, Value::Object(Object::new()));
                    // The object is filled in at the end; inserting now keeps
                    // `colors` where JavaScript first assigns it.
                    result.insert("colors", Value::Null);
                    has_colors = true;
                    target = Target::Color(role.into());
                }
            }
            continue;
        }
        if let Some(digits) = schema_version(line) {
            if !matches!(target, Target::Theme) {
                return fail("schema-version belongs in the theme table");
            }
            if result.contains_key("schemaVersion") {
                return fail("duplicate schema-version");
            }
            result.insert("schemaVersion", Value::Number(digits.parse::<f64>().unwrap_or(f64::INFINITY)));
            continue;
        }
        let Some((key, literal)) = entry(line) else {
            return fail("expected key = \"string\"; arrays, dates and multiline strings are not theme settings");
        };
        let object = match &target {
            Target::Theme => &mut result,
            Target::Color(role) => match colors.get_mut(role) {
                Some(Value::Object(o)) => o,
                // Every colour target is inserted as an object before use.
                _ => continue,
            },
        };
        if object.contains_key(key) {
            return fail(&format!("duplicate key {key}"));
        }
        let body = &literal[1..literal.len() - 1];
        let value = if literal.starts_with('\'') {
            body.to_string()
        } else {
            match basic_string(body) {
                Ok(v) => v,
                Err(message) => return fail(message),
            }
        };
        object.insert(key, Value::String(value));
    }
    if has_colors {
        result.insert("colors", Value::Object(colors));
    }
    Ok(Value::Object(result))
}

/// UTF-16 code unit order, which is what a JavaScript `<` on strings compares.
fn utf16_cmp(a: &str, b: &str) -> core::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn json_or_undefined(value: Option<&Value>) -> String {
    value.map_or_else(|| "undefined".into(), Value::to_json)
}

/// `serializeThemeToml`: only the schema's fields, never arbitrary keys.
pub fn serialize(theme: &Value) -> String {
    let empty = Object::new();
    let t = theme.as_object().unwrap_or(&empty);
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("schema-version = {}", t.get("schemaVersion").map_or_else(|| "undefined".into(), Value::to_js_string)));
    for key in ["version", "id", "name", "description", "base", "shape", "depth", "surface", "type", "palette"] {
        if let Some(value) = t.get(key) {
            lines.push(format!("{key} = {}", value.to_json()));
        }
    }
    if let Some(Value::Object(colors)) = t.get("colors") {
        let mut entries = colors.entries();
        entries.sort_unstable_by(|(a, _), (b, _)| utf16_cmp(a, b));
        for (role, pair) in entries {
            let pair = pair.as_object();
            let mut name = String::new();
            quote(role, &mut name);
            lines.push(String::new());
            lines.push(format!("[colors.{name}]"));
            lines.push(format!("light = {}", json_or_undefined(pair.and_then(|p| p.get("light")))));
            lines.push(format!("dark = {}", json_or_undefined(pair.and_then(|p| p.get("dark")))));
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}
