//! `designOverrides` from `theme-presets.ts`: the custom properties a design
//! sets on the page, in the order the TypeScript writes them.

use crate::catalog;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// What a design is computed from. A custom theme passes its base's `id` with
/// its own choices; see [`CustomTheme::design`](crate::CustomTheme::design).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Design<'a> {
    pub id: &'a str,
    pub shape: &'a str,
    pub depth: &'a str,
    pub surface: &'a str,
    pub type_: &'a str,
}

impl From<&'static catalog::Preset> for Design<'static> {
    fn from(p: &'static catalog::Preset) -> Self {
        Design { id: p.id, shape: p.shape, depth: p.depth, surface: p.surface, type_: p.type_ }
    }
}

/// Property assignments where a repeated name replaces the value in place,
/// as assigning to a JavaScript object does.
struct Props(Vec<(String, String)>);

impl Props {
    fn set(&mut self, name: &str, value: impl Into<String>) {
        let value = value.into();
        match self.0.iter_mut().find(|(n, _)| n == name) {
            Some(slot) => slot.1 = value,
            None => self.0.push((name.to_string(), value)),
        }
    }
}

fn corners(shape: &str) -> Option<[&'static str; 5]> {
    Some(match shape {
        "balanced" => ["0.375rem", "0.5rem", "0.75rem", "1rem", "1.5rem"],
        "crisp" => ["0.125rem", "0.25rem", "0.375rem", "0.5rem", "0.75rem"],
        "round" => ["0.625rem", "0.875rem", "1.125rem", "1.5rem", "2rem"],
        "organic" => ["0.75rem", "1rem", "1.5rem", "2rem", "2.5rem"],
        "square" => ["0", "0", "0", "0", "0"],
        _ => return None,
    })
}

fn depths(depth: &str) -> Option<[&'static str; 3]> {
    Some(match depth {
        "flat" => ["none", "none", "none"],
        "soft" => ["raised", "overlay", "modal"],
        "lifted" => ["floating", "modal", "dialog"],
        "edge" => ["edge", "edge", "edge"],
        _ => return None,
    })
}

const SANS: &str = "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, \"Noto Sans\", sans-serif";
const SERIF: &str = "ui-serif, Georgia, \"Noto Serif\", serif";
const TINTED_IMAGE: &str = "linear-gradient(135deg in srgb-linear, var(--fc-color-accent-bg), var(--fc-color-accent-bg-active))";

/// The decoration a stock design adds on top of its choices.
fn recipe(id: &str) -> Vec<(&'static str, String)> {
    let canvas = "var(--fc-color-bg-canvas)";
    let subtle = "var(--fc-color-bg-subtle)";
    let accent = "var(--fc-color-accent-bg)";
    let active = "var(--fc-color-accent-bg-active)";
    let quiet = format!("color-mix(in srgb-linear, {accent} 82%, {active})");
    let halo = format!("0 1px 1px {active}, 0 0 4px {active}, 0 0 8px {active}");
    match id {
        "aurora" => alloc::vec![("--fc-theme-feature-image", format!("repeating-linear-gradient(125deg in srgb-linear, {accent} 0 12%, {active} 24%, {accent} 36%)"))],
        "candy" => alloc::vec![
            ("--fc-theme-canvas-image", format!("repeating-linear-gradient(135deg in srgb-linear, {canvas} 0 24px, color-mix(in srgb-linear, {canvas} 85%, {subtle}) 24px 48px)")),
            ("--fc-theme-feature-image", format!("repeating-linear-gradient(135deg in srgb-linear, {accent} 0 20px, {quiet} 20px 40px)")),
            ("--fc-theme-feature-text-shadow", halo),
        ],
        "solar" => alloc::vec![
            ("--fc-shadow-raised", "6px 6px 0 var(--fc-color-border-interactive)".into()),
            ("--fc-shadow-overlay", "8px 8px 0 var(--fc-color-border-interactive)".into()),
            ("--fc-theme-feature-image", format!("radial-gradient(circle at 85% 20% in srgb-linear, {active} 0 20%, {accent} 21%)")),
        ],
        "nocturne" => alloc::vec![
            ("--fc-theme-feature-image", format!("radial-gradient(ellipse at 20% 10% in srgb-linear, {accent}, {active})")),
            ("--fc-card-bg", "var(--fc-color-bg-subtle)".into()),
        ],
        "arcade" => alloc::vec![
            ("--fc-font-family-sans", "ui-monospace, \"SFMono-Regular\", Consolas, \"Liberation Mono\", monospace".into()),
            ("--fc-theme-feature-image", format!("repeating-linear-gradient(0deg in srgb-linear, {accent} 0 5px, {quiet} 5px 6px)")),
            ("--fc-shadow-raised", "4px 4px 0 var(--fc-color-border-interactive)".into()),
            ("--fc-theme-feature-text-shadow", halo),
        ],
        "parchment" => alloc::vec![
            ("--fc-theme-canvas-image", format!("repeating-linear-gradient(0deg in srgb-linear, {canvas} 0 31px, {subtle} 31px 32px)")),
            ("--fc-card-bg", "var(--fc-color-bg-subtle)".into()),
            ("--fc-theme-feature-bg", "var(--fc-color-selected-bg)".into()),
        ],
        "bubble" => alloc::vec![
            ("--fc-theme-canvas-image", format!("radial-gradient(circle at 10% 15% in srgb-linear, {subtle} 0 15%, {canvas} 45%)")),
            ("--fc-theme-feature-image", format!("radial-gradient(circle at 80% 20% in srgb-linear, {active} 0 15%, {accent} 16% 35%, {active} 36% 38%, {accent} 39%)")),
        ],
        "garnet" => alloc::vec![("--fc-theme-feature-image", format!("conic-gradient(from 45deg at 70% 30% in srgb-linear, {accent}, {active}, {accent}, {active}, {accent})"))],
        "origami" => alloc::vec![
            ("--fc-shadow-raised", "3px 5px 0 var(--fc-color-border-subtle)".into()),
            ("--fc-theme-feature-bg", accent.into()),
            ("--fc-theme-feature-fg", "var(--fc-color-text-on-accent)".into()),
            ("--fc-theme-feature-image", format!("linear-gradient(150deg in srgb-linear, {accent} 0 65%, {active} 65%)")),
        ],
        "sundown" => alloc::vec![
            ("--fc-theme-feature-image", format!("linear-gradient(0deg in srgb-linear, {active} 0 20%, {accent} 20% 45%, {active} 45% 48%, {accent} 48%)")),
            ("--fc-card-bg", "var(--fc-color-bg-surface)".into()),
            ("--fc-shadow-raised", "var(--fc-elevation-dialog)".into()),
        ],
        "pride" => {
            let names = ["red", "orange", "yellow", "green", "blue", "violet"];
            let stops: Vec<String> = names
                .iter()
                .enumerate()
                .map(|(i, name)| {
                    let (from, to) = (i as f64 * 100.0 / 6.0, (i + 1) as f64 * 100.0 / 6.0);
                    format!("var(--fc-color-pride-{name}) {}% {}%", crate::json::js_number(from), crate::json::js_number(to))
                })
                .collect();
            alloc::vec![
                ("--fc-theme-feature-image", format!("linear-gradient(120deg in srgb-linear, {})", stops.join(", "))),
                ("--fc-theme-feature-text-shadow", halo),
            ]
        }
        _ => Vec::new(),
    }
}

/// `designOverrides`. `None` when a choice is not one the schema allows.
pub fn design_overrides(design: Design<'_>) -> Option<Vec<(String, String)>> {
    let corners = corners(design.shape)?;
    let depths = depths(design.depth)?;
    let mut v = Props(Vec::new());
    v.set("--fc-theme-canvas-image", "none");
    v.set("--fc-theme-feature-text-shadow", "none");
    // Structured designs use an outline; softer designs let color and elevation
    // define their surfaces without imposing a heavy stroke on every component.
    let outlined = design.depth == "edge" || design.id == "clarity";
    let border = format!("var(--fc-border-width-{})", if outlined { "thick" } else { "thin" });
    v.set("--fc-border-width-control", border.clone());
    v.set("--fc-border-width-surface", border);
    for (key, value) in ["sm", "md", "lg", "xl", "2xl"].iter().zip(corners) {
        v.set(&format!("--fc-radius-{key}"), value);
    }
    for (key, value) in ["raised", "overlay", "modal"].iter().zip(depths) {
        v.set(&format!("--fc-shadow-{key}"), if value == "none" { "none".into() } else { format!("var(--fc-elevation-{value})") });
    }
    v.set("--fc-font-family-sans", if design.type_ == "serif" { SERIF } else { SANS });
    let tinted = design.surface == "tinted";
    let panel = format!("var(--fc-color-{})", if tinted { "selected-bg" } else { "bg-surface" });
    v.set("--fc-card-bg", panel.clone());
    v.set("--fc-masthead-bg", panel.clone());
    v.set("--fc-composer-bg", panel);
    v.set("--fc-card-shadow", "var(--fc-shadow-raised)");
    for (name, value) in [
        ("--fc-masthead-fg", "var(--fc-color-text-default)"),
        ("--fc-masthead-muted", "var(--fc-color-text-muted)"),
        ("--fc-masthead-disabled-fg", "var(--fc-color-disabled-fg)"),
        ("--fc-masthead-interaction-bg", "var(--fc-color-bg-subtle)"),
        ("--fc-masthead-focus", "var(--fc-color-focus-ring)"),
        ("--fc-nav-selected-bg", "var(--fc-color-accent-bg-subtle)"),
        ("--fc-nav-selected-fg", "var(--fc-color-accent-text)"),
    ] {
        v.set(name, value);
    }
    let outline = design.surface == "outline";
    let primary = if outline {
        [("bg", "bg-surface"), ("fg", "text-default"), ("border", "border-interactive")]
    } else {
        [("bg", "accent-bg"), ("fg", "text-on-accent"), ("border", "accent-border")]
    };
    for (slot, role) in primary {
        v.set(&format!("--fc-btn-primary-{slot}"), format!("var(--fc-color-{role})"));
    }
    v.set("--fc-btn-primary-bg-hover", format!("var(--fc-color-{})", if outline { "bg-subtle" } else { "accent-bg-hover" }));
    v.set("--fc-btn-primary-bg-active", format!("var(--fc-color-{})", if outline { "bg-subtle" } else { "accent-bg-active" }));
    v.set("--fc-theme-feature-bg", "var(--fc-color-bg-surface)");
    v.set("--fc-theme-feature-fg", "var(--fc-color-text-default)");
    v.set("--fc-theme-feature-image", "none");
    v.set("--fc-card-border", format!("var(--fc-color-border-{})", if outlined { "interactive" } else { "subtle" }));
    v.set("--fc-card-border-style", if design.id == "blueprint" { "dashed" } else { "solid" });
    if tinted {
        v.set("--fc-theme-feature-bg", "var(--fc-color-accent-bg)");
        v.set("--fc-theme-feature-fg", "var(--fc-color-text-on-accent)");
        v.set("--fc-theme-feature-image", TINTED_IMAGE);
    }
    if design.surface == "helix" {
        for (name, value) in [
            ("--fc-masthead-bg", "var(--fc-color-bg-inverse)"),
            ("--fc-masthead-fg", "var(--fc-color-text-inverse)"),
            ("--fc-masthead-muted", "var(--fc-color-text-inverse-muted)"),
            ("--fc-masthead-interaction-bg", "var(--fc-color-bg-inverse)"),
            ("--fc-masthead-focus", "var(--fc-color-text-inverse)"),
            ("--fc-masthead-disabled-fg", "var(--fc-color-text-inverse-muted)"),
            ("--fc-nav-selected-bg", "var(--fc-color-accent-bg)"),
            ("--fc-nav-selected-fg", "var(--fc-color-text-on-accent)"),
            ("--fc-btn-primary-bg", "var(--fc-color-selected-bg)"),
            ("--fc-btn-primary-bg-hover", "var(--fc-color-selected-bg)"),
            ("--fc-btn-primary-bg-active", "var(--fc-color-selected-bg)"),
            ("--fc-btn-primary-fg", "var(--fc-color-selected-fg)"),
            ("--fc-theme-feature-bg", "var(--fc-color-accent-bg)"),
            ("--fc-theme-feature-fg", "var(--fc-color-text-on-accent)"),
            ("--fc-theme-feature-image", TINTED_IMAGE),
        ] {
            v.set(name, value);
        }
    }
    // Custom controls take precedence over the starting design's decoration.
    let stock = catalog::preset(design.id);
    for (name, value) in recipe(design.id) {
        if let Some(stock) = stock {
            let dropped = (name.starts_with("--fc-shadow-") && design.depth != stock.depth)
                || (name == "--fc-font-family-sans" && design.type_ != stock.type_)
                || (name.starts_with("--fc-theme-feature-") && design.surface != stock.surface)
                || (name == "--fc-card-bg" && design.surface != stock.surface);
            if dropped {
                continue;
            }
        }
        v.set(name, value);
    }
    Some(v.0)
}
