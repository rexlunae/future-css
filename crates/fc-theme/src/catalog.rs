//! The stock designs and palettes, mirroring `src/js/theme-presets.ts` and the
//! choices in `src/js/theme-schema.ts`. tests/wasm.test.ts compares the two
//! catalogs whole, so an entry added on one side only fails the build.

use crate::json::{Object, Value};
use alloc::vec::Vec;

/// The schema version this crate validates; `THEME_SCHEMA_VERSION`.
pub const SCHEMA_VERSION: u32 = 1;

/// A stock design.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Preset {
    pub version: &'static str,
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub palette: &'static str,
    pub shape: &'static str,
    pub depth: &'static str,
    pub surface: &'static str,
    /// `type` in the schema, which is a Rust keyword.
    pub type_: &'static str,
}

/// A stock palette. `hue` is `None` for the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    pub id: &'static str,
    pub name: &'static str,
    pub hue: Option<u16>,
}

pub const PRESETS: &[Preset] = &[
    Preset { version: "1.2.0", id: "future", name: "Future", description: "Balanced corners, quiet surfaces and soft elevation.", palette: "default", shape: "balanced", depth: "soft", surface: "neutral", type_: "system" },
    Preset { version: "1.2.0", id: "clarity", name: "Clarity", description: "Crisp edges, flat surfaces and outlined actions.", palette: "default", shape: "crisp", depth: "flat", surface: "outline", type_: "system" },
    Preset { version: "1.2.0", id: "helix", name: "Helix", description: "Charcoal chrome, mint actions and violet feature surfaces.", palette: "helix", shape: "crisp", depth: "soft", surface: "helix", type_: "system" },
    Preset { version: "1.2.0", id: "forest", name: "Forest", description: "Organic curves, green accents and calm surfaces.", palette: "forest", shape: "organic", depth: "soft", surface: "tinted", type_: "system" },
    Preset { version: "1.2.0", id: "editorial", name: "Editorial", description: "Serif reading, restrained corners and ink-like controls.", palette: "ink", shape: "crisp", depth: "flat", surface: "outline", type_: "serif" },
    Preset { version: "1.2.0", id: "graphite", name: "Graphite", description: "Monochrome surfaces with distinct, structured edges.", palette: "ink", shape: "balanced", depth: "edge", surface: "neutral", type_: "system" },
    Preset { version: "1.2.0", id: "ocean", name: "Ocean", description: "Cool teal, rounded panels and a tinted header.", palette: "teal", shape: "round", depth: "soft", surface: "tinted", type_: "system" },
    Preset { version: "1.2.0", id: "ember", name: "Ember", description: "Warm accents, substantial elevation and squared panels.", palette: "ember", shape: "balanced", depth: "lifted", surface: "tinted", type_: "system" },
    Preset { version: "1.2.0", id: "blueprint", name: "Blueprint", description: "Square geometry, blue accents and precise outlines.", palette: "blue", shape: "square", depth: "edge", surface: "outline", type_: "system" },
    Preset { version: "1.2.0", id: "bloom", name: "Bloom", description: "Playful curves, rose accents and floating colored panels.", palette: "rose", shape: "organic", depth: "lifted", surface: "tinted", type_: "system" },
    Preset { version: "1.0.0", id: "aurora", name: "Aurora", description: "Violet ribbons, luminous curves and floating surfaces.", palette: "violet", shape: "round", depth: "lifted", surface: "tinted", type_: "system" },
    Preset { version: "1.0.1", id: "candy", name: "Candy", description: "Rose candy stripes, pillowy panels and playful elevation.", palette: "rose", shape: "organic", depth: "soft", surface: "tinted", type_: "system" },
    Preset { version: "1.0.0", id: "solar", name: "Solar", description: "Amber sunshine, square panels and decisive offset shadows.", palette: "amber", shape: "square", depth: "edge", surface: "tinted", type_: "system" },
    Preset { version: "1.0.0", id: "nocturne", name: "Nocturne", description: "Ink chrome, violet spotlights and elegant serif reading.", palette: "violet", shape: "crisp", depth: "lifted", surface: "helix", type_: "serif" },
    Preset { version: "1.0.1", id: "arcade", name: "Arcade", description: "Green scanlines, square geometry and terminal-inspired type.", palette: "forest", shape: "square", depth: "edge", surface: "tinted", type_: "system" },
    Preset { version: "1.0.0", id: "parchment", name: "Parchment", description: "Warm ruled paper, serif type and quiet outlined controls.", palette: "amber", shape: "crisp", depth: "flat", surface: "outline", type_: "serif" },
    Preset { version: "1.0.0", id: "bubble", name: "Bubble", description: "Teal bubbles, generous curves and buoyant layered shadows.", palette: "teal", shape: "organic", depth: "lifted", surface: "tinted", type_: "system" },
    Preset { version: "1.0.0", id: "garnet", name: "Garnet", description: "Rose jewel facets, crisp serif panels and charcoal chrome.", palette: "rose", shape: "crisp", depth: "soft", surface: "helix", type_: "serif" },
    Preset { version: "1.0.0", id: "origami", name: "Origami", description: "Blue folded ribbons, angular outlines and paper shadows.", palette: "blue", shape: "square", depth: "soft", surface: "outline", type_: "system" },
    Preset { version: "1.0.0", id: "sundown", name: "Sundown", description: "Ember horizons, rounded reading panels and long soft shadows.", palette: "ember", shape: "round", depth: "lifted", surface: "tinted", type_: "serif" },
    Preset { version: "1.0.0", id: "pride", name: "Pride", description: "Rainbow ribbons, joyful rounded panels and clear violet actions.", palette: "violet", shape: "round", depth: "soft", surface: "tinted", type_: "system" },
];

pub const PALETTES: &[Palette] = &[
    Palette { id: "default", name: "Future blue", hue: None },
    Palette { id: "blue", name: "Blueprint blue", hue: Some(255) },
    Palette { id: "violet", name: "Violet", hue: Some(300) },
    Palette { id: "forest", name: "Forest", hue: Some(150) },
    Palette { id: "ink", name: "Ink", hue: Some(0) },
    Palette { id: "teal", name: "Ocean teal", hue: Some(190) },
    Palette { id: "ember", name: "Ember", hue: Some(45) },
    Palette { id: "rose", name: "Rose", hue: Some(350) },
    Palette { id: "amber", name: "Amber", hue: Some(85) },
    Palette { id: "helix", name: "Helix violet & mint", hue: Some(280) },
];

pub const SHAPES: &[&str] = &["balanced", "crisp", "round", "organic", "square"];
pub const DEPTHS: &[&str] = &["flat", "soft", "lifted", "edge"];
pub const SURFACES: &[&str] = &["neutral", "outline", "tinted", "helix"];
pub const TYPES: &[&str] = &["system", "serif"];

/// Each bounded choice and its allowed values, in the schema's key order.
pub const CHOICES: &[(&str, &[&str])] = &[("shape", SHAPES), ("depth", DEPTHS), ("surface", SURFACES), ("type", TYPES)];

pub fn preset(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

pub fn palette(id: &str) -> Option<&'static Palette> {
    PALETTES.iter().find(|p| p.id == id)
}

fn strings(values: &[&str]) -> Value {
    Value::Array(values.iter().map(|v| Value::String((*v).into())).collect())
}

/// The whole catalog as `{presets, palettes, choices}`, for the parity test.
pub fn catalog() -> Value {
    let presets: Vec<Value> = PRESETS
        .iter()
        .map(|p| {
            let mut o = Object::new();
            o.insert("schemaVersion", Value::Number(SCHEMA_VERSION as f64));
            for (k, v) in [
                ("version", p.version),
                ("id", p.id),
                ("name", p.name),
                ("description", p.description),
                ("palette", p.palette),
                ("shape", p.shape),
                ("depth", p.depth),
                ("surface", p.surface),
                ("type", p.type_),
            ] {
                o.insert(k, Value::String(v.into()));
            }
            Value::Object(o)
        })
        .collect();
    let palettes: Vec<Value> = PALETTES
        .iter()
        .map(|p| {
            let mut o = Object::new();
            o.insert("id", Value::String(p.id.into()));
            o.insert("name", Value::String(p.name.into()));
            o.insert("hue", p.hue.map_or(Value::Null, |h| Value::Number(h as f64)));
            Value::Object(o)
        })
        .collect();
    let mut choices = Object::new();
    for (key, values) in CHOICES {
        choices.insert(*key, strings(values));
    }
    let mut out = Object::new();
    out.insert("presets", Value::Array(presets));
    out.insert("palettes", Value::Array(palettes));
    out.insert("choices", Value::Object(choices));
    Value::Object(out)
}
