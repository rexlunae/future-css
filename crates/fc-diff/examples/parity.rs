//! Emits diffs as JSON so `tests/wasm.test.ts` can compare against the JS twin.
//!
//! Exists because a divergence between the two implementations is the worst bug
//! this system can have: a user gets correct results on one path and wrong
//! results on the other, with no signal telling them which they saw.

use fc_diff::{diff_lines, diff_stats};

fn main() {
    let mut args = std::env::args().skip(1);
    let before = args.next().unwrap_or_default();
    let after = args.next().unwrap_or_default();

    let lines = diff_lines(&before, &after);
    let stats = diff_stats(&lines);

    // Hand-rolled JSON: serde would pull `serde-wasm-bindgen` into a crate whose
    // whole point is having no dependencies, and the shape is fixed anyway.
    print!("{{\"added\":{},\"removed\":{},\"identical\":{},\"lines\":[", stats.added, stats.removed, stats.identical);
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            print!(",");
        }
        print!(
            "{{\"kind\":{},\"text\":{},\"oldLine\":{},\"newLine\":{}}}",
            json_str(line.kind.as_str()),
            json_str(&line.text),
            line.old_line.map(|n| n.to_string()).unwrap_or_else(|| "null".into()),
            line.new_line.map(|n| n.to_string()).unwrap_or_else(|| "null".into()),
        );
    }
    println!("]}}");
}

fn json_str(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
