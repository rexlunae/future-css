//! Behaviour tests. Parity with the TypeScript lives in tests/wasm.test.ts;
//! these pin what the crate promises a Rust consumer.

use super::*;
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

fn theme(extra: &str) -> Value {
    let sep = if extra.is_empty() { "" } else { "," };
    json::parse(&alloc::format!(
        r#"{{"schemaVersion":1,"version":"1.0.0","id":"mine","name":"Mine","description":"A theme.","base":"editorial"{sep}{extra}}}"#
    ))
    .unwrap()
}

fn contract() -> ThemeContract {
    ThemeContract::from_json(
        r##"{"pairs":[{"fg":"text","bg":"bg","min":4.5}],
            "colors":{"text":{"light":"#111111","dark":"#eeeeee"},"bg":{"light":"#ffffff","dark":"#000000"}},
            "palettes":{"ink":{"text":{"light":"#222222","dark":"#dddddd"},"bg":{"light":"#ffffff","dark":"#000000"}}}}"##,
    )
    .unwrap()
}

fn error(input: &Value, contract: Option<&ThemeContract>) -> String {
    validate_custom_theme(input, contract).unwrap_err().0
}

#[test]
fn accepts_a_minimal_theme() {
    let t = validate_custom_theme(&theme(""), None).unwrap();
    assert_eq!((t.id.as_str(), t.base.as_str(), t.shape), ("mine", "editorial", None));
}

#[test]
fn refuses_in_the_typescript_order() {
    assert_eq!(error(&json::parse("[]").unwrap(), None), "Expected a theme object");
    assert_eq!(
        error(&json::parse(r#"{"schemaVersion":[1,2]}"#).unwrap(), None),
        "Unsupported theme schema 1,2; expected 1. Migrate before installation."
    );
    assert_eq!(
        error(&json::parse(r#"{"schemaVersion":null}"#).unwrap(), None),
        "Unsupported theme schema unversioned; expected 1. Migrate before installation."
    );
    assert_eq!(error(&theme(r#""version":"1.0""#), None), "Theme version must be SemVer (for example 1.0.0)");
    assert_eq!(error(&theme(r#""id":"future""#), None), "Custom theme needs a unique id");
    assert_eq!(error(&theme(r#""name":"  ""#), None), "Invalid name");
    assert_eq!(error(&theme(r#""base":"nope""#), None), "Unknown base theme");
    assert_eq!(error(&theme(r#""shape":"999rem""#), None), "Invalid shape");
    assert_eq!(error(&theme(r#""palette":"nope""#), None), "Unknown palette");
    assert_eq!(error(&theme(r#""padding":"0""#), None), "Unknown theme setting; arbitrary CSS is not supported");
    // Colours are judged before unknown keys, as in the TypeScript.
    assert_eq!(
        error(&theme(r#""padding":"0","colors":{}"#), None),
        "A library theme contract is required for custom colors"
    );
}

#[test]
fn checks_custom_colours_as_a_whole_palette() {
    let c = contract();
    let ok = validate_custom_theme(&theme(r##""colors":{"text":{"light":"#000000","dark":"#ffffff"}}"##), Some(&c)).unwrap();
    // The base is editorial, whose palette is ink: the untouched role comes from it.
    assert_eq!(ok.colors.unwrap(), vec![
        ("text".into(), ColorPair { light: "#000000".into(), dark: "#ffffff".into() }),
        ("bg".into(), ColorPair { light: "#ffffff".into(), dark: "#000000".into() }),
    ]);
    assert_eq!(error(&theme(r##""colors":{"text":{"light":"#eeeeee","dark":"#ffffff"}}"##), Some(&c)), "light: text on bg needs 4.5:1");
    assert_eq!(error(&theme(r##""colors":{"bogus":{"light":"#000000","dark":"#ffffff"}}"##), Some(&c)), "Unknown or invalid color role: bogus");
    assert_eq!(error(&theme(r##""colors":{"text":{"light":"#000","dark":"#ffffff"}}"##), Some(&c)), "Custom colors must be six-digit sRGB hex values");
    assert_eq!(error(&theme(r##""colors":{"text":{"light":"#000000","dark":"#ffffff","x":1}}"##), Some(&c)), "Unknown color setting");
    assert_eq!(error(&theme(r#""colors":null"#), Some(&c)), "Invalid colors");
}

#[test]
fn migrates_an_unversioned_schema() {
    let old = json::parse(r#"{"id":"mine","name":"Mine","description":"A theme.","base":"future"}"#).unwrap();
    assert_eq!(migrate_theme(&old, None, None).unwrap_err().0, "Unversioned themes require an explicit themeVersion");
    let t = migrate_theme(&old, Some("2.0.0"), None).unwrap();
    assert_eq!((t.schema_version, t.version.as_str()), (1, "2.0.0"));
    let future = json::parse(r#"{"schemaVersion":2}"#).unwrap();
    assert_eq!(migrate_theme(&future, None, None).unwrap_err().0, "Unsupported schema version; no migration path");
}

#[test]
fn toml_round_trips() {
    let c = contract();
    let t = validate_custom_theme(&theme(r##""shape":"round","colors":{"text":{"light":"#000000","dark":"#ffffff"}}"##), Some(&c)).unwrap();
    let text = t.to_toml();
    assert!(text.starts_with("schema-version = 1\nversion = \"1.0.0\"\n"));
    assert!(text.contains("\n[colors.\"bg\"]\nlight = \"#ffffff\"\n"));
    assert_eq!(parse_theme(&text, None, Some(&c)).unwrap(), t);
}

#[test]
fn toml_refuses_what_it_does_not_model() {
    let line = |s: &str| toml::parse(s).unwrap_err().0;
    assert_eq!(line("[themes]"), "Theme TOML line 1: expected [theme] or [colors.role-name]");
    assert_eq!(line("[theme]\n[theme]"), "Theme TOML line 2: duplicate table");
    assert_eq!(line("[colors.a]\n[colors.\"a\"]"), "Theme TOML line 2: duplicate color table");
    assert_eq!(line("[colors.a]\nschema-version = 1"), "Theme TOML line 2: schema-version belongs in the theme table");
    assert_eq!(line("x = [1]"), "Theme TOML line 1: expected key = \"string\"; arrays, dates and multiline strings are not theme settings");
    assert_eq!(line("x = \"a\"\nx = 'b'"), "Theme TOML line 2: duplicate key x");
    assert_eq!(line(r#"x = "\x""#), "Theme TOML line 1: unsupported string escape");
    assert_eq!(line(r#"x = "\uD800""#), "Theme TOML line 1: invalid Unicode escape");
    assert_eq!(line(r#"x = "\u12""#), "Theme TOML line 1: invalid quoted string");
}

#[test]
fn toml_escapes() {
    let v = toml::parse("name = \"C:\\\\x \\U0001F600 \\u00e9\\t\" # comment\r\nid = 'raw \\n'").unwrap();
    let o = v.as_object().unwrap();
    assert_eq!(o.get("name").and_then(Value::as_str), Some("C:\\x 😀 é\t"));
    assert_eq!(o.get("id").and_then(Value::as_str), Some("raw \\n"));
}

#[test]
fn every_preset_has_distinct_overrides() {
    let all: Vec<_> = PRESETS.iter().map(|p| design_overrides(p.into()).unwrap()).collect();
    for (i, a) in all.iter().enumerate() {
        for b in &all[i + 1..] {
            assert_ne!(a, b);
        }
    }
    assert!(design_overrides(Design { id: "future", shape: "blob", depth: "soft", surface: "neutral", type_: "system" }).is_none());
}

#[test]
fn a_custom_choice_drops_the_base_decoration_it_contradicts() {
    let arcade = catalog::preset("arcade").unwrap();
    let serif = design_overrides(Design { type_: "serif", ..arcade.into() }).unwrap();
    let font = serif.iter().find(|(k, _)| k == "--fc-font-family-sans").unwrap();
    assert!(font.1.starts_with("ui-serif"));
}

#[test]
fn luminance_matches_wcag() {
    assert_eq!(luminance("#ffffff"), Some(1.0));
    assert_eq!(luminance("#000000"), Some(0.0));
    assert_eq!(luminance("#00000"), None);
}
