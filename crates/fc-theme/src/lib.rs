//! fc-theme — custom themes for the theme picker, in Rust.
//!
//! The picker's custom-theme editor validates what an author builds or
//! imports, reads and writes it as TOML, and turns a design into the custom
//! properties it sets. All of that was TypeScript only (`theme-picker.ts`,
//! `theme-toml.ts`, `theme-presets.ts`, `theme-migrations.ts`), so a Rust
//! consumer such as the Dioxus picker had no safe way to offer the editor: a
//! hand port would drift, and `tests/wasm.test.ts` exists to catch exactly that.
//! This crate is the twin, and that test holds it to the TypeScript's output,
//! error messages included.
//!
//! # What crosses the boundary
//!
//! JSON strings. A theme is a small tree of strings, and the input to
//! validation is *any* value an author or a file supplied, so the boundary is
//! a JSON value in and `{"ok": …}` or `{"error": "…"}` out. Nothing links
//! `js-sys`.
//!
//! # JavaScript semantics, deliberately
//!
//! The input is judged as JavaScript judges it: object keys in JavaScript's
//! order, numbers printed in messages as JavaScript prints them, `trim` with
//! JavaScript's whitespace. See [`json`]. Contrast is computed from a table of
//! the exact bits V8's `**` produces, so a ratio on its minimum cannot pass on
//! one path and fail on the other.

// `no_std` on wasm, for size rather than portability; see fc-git's crate root.
#![cfg_attr(all(target_arch = "wasm32", feature = "bare", not(test)), no_std)]

extern crate alloc;

#[cfg(all(target_arch = "wasm32", feature = "bare", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(all(target_arch = "wasm32", feature = "bare", not(test)))]
#[global_allocator]
static ALLOC: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

pub mod catalog;
pub mod design;
pub mod json;
pub mod semver;
pub mod toml;
pub mod validate;

pub use catalog::{Palette, Preset, PALETTES, PRESETS, SCHEMA_VERSION};
pub use design::{design_overrides, Design};
pub use json::Value;
pub use validate::{luminance, migrate_theme, validate_custom_theme, ColorPair, ContrastPair, CustomTheme, ThemeContract, ThemeError};

impl CustomTheme {
    /// The theme as the TOML `serializeThemeToml` writes, which `parse_theme`
    /// reads back.
    pub fn to_toml(&self) -> alloc::string::String {
        toml::serialize(&self.to_value())
    }
}

/// Reads a theme file: TOML, migrated to the current schema, validated. A file
/// with no `version` needs `theme_version`.
pub fn parse_theme(source: &str, theme_version: Option<&str>, contract: Option<&ThemeContract>) -> Result<CustomTheme, ThemeError> {
    migrate_theme(&toml::parse(source)?, theme_version, contract)
}

#[cfg(feature = "bindgen")]
mod boundary {
    use super::*;
    use alloc::string::String;
    use wasm_bindgen::prelude::*;

    fn wrap(result: Result<Value, ThemeError>) -> String {
        let mut o = json::Object::new();
        match result {
            Ok(v) => o.insert("ok", v),
            Err(e) => o.insert("error", Value::String(e.0)),
        }
        Value::Object(o).to_json()
    }

    fn input(text: &str) -> Result<Value, ThemeError> {
        json::parse(text).map_err(ThemeError)
    }

    fn contract(text: &str) -> Result<Option<ThemeContract>, ThemeError> {
        if text.is_empty() {
            Ok(None)
        } else {
            ThemeContract::from_json(text).map(Some)
        }
    }

    /// `validateCustomTheme(input, contract)`; `contract` is `""` for none.
    #[wasm_bindgen(js_name = validateCustomTheme)]
    pub fn validate_custom_theme_json(theme: &str, contract_json: &str) -> String {
        wrap((|| Ok(validate_custom_theme(&input(theme)?, contract(contract_json)?.as_ref())?.to_value()))())
    }

    /// `migrateTheme(input, {themeVersion, contract})`; `""` for either absent.
    #[wasm_bindgen(js_name = migrateTheme)]
    pub fn migrate_theme_json(theme: &str, theme_version: &str, contract_json: &str) -> String {
        let version = (!theme_version.is_empty()).then_some(theme_version);
        wrap((|| Ok(migrate_theme(&input(theme)?, version, contract(contract_json)?.as_ref())?.to_value()))())
    }

    #[wasm_bindgen(js_name = parseThemeToml)]
    pub fn parse_theme_toml(source: &str) -> String {
        wrap(toml::parse(source))
    }

    /// `serializeThemeToml(theme)`, from the theme as JSON.
    #[wasm_bindgen(js_name = serializeThemeToml)]
    pub fn serialize_theme_toml(theme: &str) -> String {
        wrap(input(theme).map(|t| Value::String(toml::serialize(&t))))
    }

    /// `designOverrides` as a JSON object, or `null` for a choice outside the schema.
    #[wasm_bindgen(js_name = designOverrides)]
    pub fn design_overrides_json(id: &str, shape: &str, depth: &str, surface: &str, type_: &str) -> String {
        match design_overrides(Design { id, shape, depth, surface, type_ }) {
            Some(props) => {
                let mut o = json::Object::new();
                for (k, v) in props {
                    o.insert(k, Value::String(v));
                }
                Value::Object(o).to_json()
            }
            None => "null".into(),
        }
    }

    /// `compareThemeVersions`: -1, 0 or 1, and 2 when either is not SemVer.
    #[wasm_bindgen(js_name = compareThemeVersions)]
    pub fn compare_theme_versions(a: &str, b: &str) -> i32 {
        semver::compare(a, b).map_or(2, |o| o as i32)
    }

    /// The presets, palettes and choices, for comparison with the TypeScript.
    #[wasm_bindgen(js_name = themeCatalog)]
    pub fn theme_catalog() -> String {
        catalog::catalog().to_json()
    }

    /// Relative luminance of `#rrggbb`, or -1.
    #[wasm_bindgen(js_name = relativeLuminance)]
    pub fn relative_luminance(hex: &str) -> f64 {
        luminance(hex).unwrap_or(-1.0)
    }
}

#[cfg(test)]
mod tests;
