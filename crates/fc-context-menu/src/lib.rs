//! fc-context-menu — menu model and keyboard navigation.
//!
//! # What belongs in Rust and what does not
//!
//! A context menu has two halves and only one of them belongs here.
//!
//! **Geometry stays in the browser.** Where the menu opens, whether it fits, when
//! it flips above the anchor, and how it tracks a scrolling ancestor all depend
//! on layout the WASM module cannot observe. Reimplementing that in Rust would
//! mean keeping a second, always-stale copy of the browser's geometry. The JS
//! layer computes a position and hands this crate the resulting item list.
//!
//! **Traversal stays in Rust.** Roving tabindex, typeahead, wrap-around, and
//! disabled-item skipping are pure logic over an array, and they are exactly the
//! rules assistive-technology users depend on being right. Getting them subtly
//! wrong in JS produces a menu that looks fine and fails WCAG 2.1.1.
//!
//! # The disabled-item rule
//!
//! Disabled items are skipped by arrow navigation and never receive focus. This
//! is the WAI-ARIA menu pattern, enforced here so the JS layer cannot get it
//! wrong by forgetting a filter.

use fc_core::FcError;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// What kind of item this is. Separators carry no interaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Normal,
    Checkbox,
    Separator,
    /// Renders a submenu. Nesting is one level deep; deeper is a navigation
    /// problem, not a menu problem.
    Submenu,
}

/// One menu entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuItem {
    pub id: String,
    pub label: String,
    pub kind: ItemKind,
    pub disabled: bool,
    /// Whether a checkbox item is currently checked.
    pub checked: bool,
    /// Shortcut text shown right-aligned, e.g. "Cmd+S".
    pub shortcut: Option<String>,
}

impl MenuItem {
    fn is_focusable(&self) -> bool {
        !self.disabled && self.kind != ItemKind::Separator
    }
}

/// A menu: an ordered list of items plus the navigation state over them.
#[wasm_bindgen]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Menu {
    items: Vec<MenuItem>,
    /// Index of the focused item, or `None` before the menu receives focus.
    active: Option<usize>,
    /// Recently typed characters, for typeahead.
    typeahead: String,
}

impl Menu {
    pub fn new(items: Vec<MenuItem>) -> Result<Self, FcError> {
        if items.is_empty() {
            return Err(FcError::InvalidInput {
                message: "a menu needs at least one item".to_string(),
            });
        }
        Ok(Self { items, active: None, typeahead: String::new() })
    }

    pub fn items(&self) -> &[MenuItem] {
        &self.items
    }

    pub fn active_index(&self) -> Option<usize> {
        self.active
    }

    /// Indices that arrow navigation may land on.
    fn focusable_indices(&self) -> Vec<usize> {
        (0..self.items.len())
            .filter(|i| self.items[*i].is_focusable())
            .collect()
    }

    /// Moves the active item, wrapping at both ends and skipping separators and
    /// disabled items.
    ///
    /// Wrapping makes a long menu fast to traverse with arrows; skipping stops
    /// focus landing on a divider, which a screen reader would otherwise
    /// announce as an item.
    pub fn move_by(&mut self, delta: isize) {
        let focusable = self.focusable_indices();
        if focusable.is_empty() {
            self.active = None;
            return;
        }
        let current_pos = self
            .active
            .and_then(|a| focusable.iter().position(|f| *f == a))
            .unwrap_or(0);
        let len = focusable.len() as isize;
        // rem_euclid keeps a large negative delta correct, which a naive
        // `+ len` does not.
        let next = (current_pos as isize + delta).rem_euclid(len);
        self.active = Some(focusable[next as usize]);
    }

    /// Moves to the first item. Called on open so the menu always has a defined
    /// starting point for both arrows and typeahead.
    pub fn focus_first(&mut self) {
        self.active = self.focusable_indices().first().copied();
    }

    /// Moves to the last item, for the End key.
    pub fn focus_last(&mut self) {
        self.active = self.focusable_indices().last().copied();
    }

    /// Jumps typeahead to the next item whose label starts with `query`, wrapping
    /// and continuing from the current position when the same character is typed
    /// repeatedly -- the behaviour every native menu has and most hand-rolled
    /// ones miss.
    pub fn typeahead(&mut self, query: &str) -> bool {
        let first = match query.chars().next() {
            Some(c) => c,
            None => return false,
        };
        // Repeating a single character cycles through items starting with it,
        // rather than searching for a doubled letter that matches nothing.
        let repeating = self.typeahead.chars().all(|c| c == first);
        self.typeahead = if repeating {
            query.to_string()
        } else {
            format!("{}{query}", self.typeahead)
        };

        let needle = self.typeahead.to_lowercase();
        let start = self.active.map(|a| a + 1).unwrap_or(0);
        for step in 0..self.items.len() {
            let idx = (start + step) % self.items.len();
            let item = &self.items[idx];
            if item.is_focusable() && item.label.to_lowercase().starts_with(&needle) {
                self.active = Some(idx);
                return true;
            }
        }
        // A search that matches nothing must not leave its prefix behind: the
        // next keystroke would be appended to a dead buffer and could never
        // match, so the user would be stuck typing into a menu that ignores
        // them. Dropping the buffer lets the next character start fresh.
        self.typeahead.clear();
        false
    }

    /// Clears the typeahead buffer. Called on any navigation other than typing,
    /// so a later "b" is not appended to a stale prefix.
    pub fn reset_typeahead(&mut self) {
        self.typeahead.clear();
    }

    /// The focused item's id, which is what the JS layer activates.
    pub fn active_id(&self) -> Option<&str> {
        self.active.and_then(|i| self.items.get(i)).map(|i| i.id.as_str())
    }
}

#[wasm_bindgen]
impl Menu {
    /// Builds a menu from plain objects. Returns a JS error for an empty or
    /// malformed list rather than constructing an unusable menu.
    #[wasm_bindgen(constructor)]
    pub fn js_from_items(items: Vec<JsValue>) -> Result<Menu, JsValue> {
        let parsed: Vec<MenuItem> = items
            .iter()
            .map(|v| serde_wasm_bindgen::from_value(v.clone()))
            .collect::<Result<_, _>>()
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Menu::new(parsed).map_err(|e| JsValue::from(e))
    }

    #[wasm_bindgen(js_name = moveBy)]
    pub fn js_move_by(&mut self, delta: i32) {
        self.move_by(delta as isize);
        self.reset_typeahead();
    }

    #[wasm_bindgen(js_name = focusFirst)]
    pub fn js_focus_first(&mut self) {
        self.focus_first();
        self.reset_typeahead();
    }

    #[wasm_bindgen(js_name = focusLast)]
    pub fn js_focus_last(&mut self) {
        self.focus_last();
        self.reset_typeahead();
    }

    #[wasm_bindgen(js_name = typeahead)]
    pub fn js_typeahead(&mut self, query: &str) -> bool {
        self.typeahead(query)
    }

    #[wasm_bindgen(js_name = activeIndex)]
    pub fn js_active_index(&self) -> Option<usize> {
        self.active
    }

    #[wasm_bindgen(js_name = activeId)]
    pub fn js_active_id(&self) -> Option<String> {
        self.active_id().map(str::to_string)
    }

    /// The item to activate, or `undefined` when nothing is focused.
    #[wasm_bindgen(js_name = activeItem)]
    pub fn js_active_item(&self) -> Option<JsValue> {
        self.active
            .and_then(|i| self.items.get(i))
            .and_then(|item| serde_wasm_bindgen::to_value(item).ok())
    }

    /// Indices arrow navigation may reach. Exposed so a test can assert the skip
    /// logic directly rather than inferring it from focus movement.
    #[wasm_bindgen(js_name = focusableIndices)]
    pub fn js_focusable_indices(&self) -> Vec<usize> {
        self.focusable_indices()
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, label: &str) -> MenuItem {
        MenuItem {
            id: id.into(),
            label: label.into(),
            kind: ItemKind::Normal,
            disabled: false,
            checked: false,
            shortcut: None,
        }
    }

    fn separator() -> MenuItem {
        MenuItem { kind: ItemKind::Separator, ..item("sep", "---") }
    }

    fn disabled(id: &str, label: &str) -> MenuItem {
        MenuItem { disabled: true, ..item(id, label) }
    }

    fn menu() -> Menu {
        Menu::new(vec![
            item("cut", "Cut"),
            item("copy", "Copy"),
            separator(),
            disabled("paste", "Paste"),
            item("delete", "Delete"),
        ])
        .unwrap()
    }

    #[test]
    fn empty_menu_is_rejected() {
        // A menu with nothing in it cannot be navigated, so it is a caller bug.
        assert!(Menu::new(vec![]).is_err());
    }

    #[test]
    fn separators_and_disabled_items_are_skipped() {
        assert_eq!(menu().focusable_indices(), vec![0, 1, 4]);
    }

    #[test]
    fn arrows_advance_across_a_separator_and_a_disabled_item() {
        // Indices: 0=cut, 1=copy, 2=separator, 3=paste(disabled), 4=delete.
        let mut m = menu();
        m.focus_first();
        assert_eq!(m.active_id(), Some("cut"));
        m.move_by(1);
        assert_eq!(m.active_id(), Some("copy"));
        // The next focusable item is index 4: the separator and the disabled
        // item in between are both skipped, in one keypress.
        m.move_by(1);
        assert_eq!(m.active_id(), Some("delete"));
    }

    #[test]
    fn arrows_wrap_at_both_ends() {
        let mut m = menu();
        m.focus_last();
        assert_eq!(m.active_id(), Some("delete"));
        m.move_by(1);
        assert_eq!(m.active_id(), Some("cut"), "wraps forward to the top");
        m.move_by(-1);
        assert_eq!(m.active_id(), Some("delete"), "wraps backward to the bottom");
    }

    #[test]
    fn a_large_backward_delta_still_lands_in_range() {
        // rem_euclid rather than `+ len`: a delta larger than the menu must not
        // panic or produce a negative index.
        let mut m = menu();
        m.focus_first();
        m.move_by(-7);
        assert!(m.active_id().is_some());
    }

    #[test]
    fn menu_of_only_disabled_items_has_no_focus() {
        let m = Menu::new(vec![disabled("a", "A"), disabled("b", "B")]).unwrap();
        assert!(m.focusable_indices().is_empty());
    }

    #[test]
    fn typeahead_finds_by_prefix() {
        let mut m = menu();
        assert!(m.typeahead("de"));
        assert_eq!(m.active_id(), Some("delete"));
    }

    #[test]
    fn typeahead_is_case_insensitive() {
        let mut m = menu();
        assert!(m.typeahead("D"));
        assert_eq!(m.active_id(), Some("delete"));
    }

    #[test]
    fn repeated_typeahead_char_cycles_through_matches() {
        let mut m = Menu::new(vec![
            item("a1", "Apple"),
            item("a2", "Apricot"),
            item("b", "Banana"),
        ])
        .unwrap();
        assert!(m.typeahead("a"));
        assert_eq!(m.active_id(), Some("a1"));
        assert!(m.typeahead("a"), "repeating must cycle, not search for 'aa'");
        assert_eq!(m.active_id(), Some("a2"));
        assert!(m.typeahead("a"), "and wrap back");
        assert_eq!(m.active_id(), Some("a1"));
    }

    #[test]
    fn typeahead_never_lands_on_a_separator() {
        // Separators are excluded from the searchable set, so matching their
        // label finds nothing at all. This is stronger than merely "does not
        // land on it": a separator is never a possible result.
        let mut m =
            Menu::new(vec![item("x", "Xylophone"), separator(), item("y", "Yak")]).unwrap();
        assert!(!m.typeahead("-"), "a separator must not be reachable by search");
        assert_ne!(m.active_id(), Some("sep"));
        assert!(m.typeahead("y"));
        assert_eq!(m.active_id(), Some("y"));
    }

    #[test]
    fn typeahead_skips_disabled_matches() {
        let mut m = Menu::new(vec![disabled("p", "Paste"), item("p2", "Paste Special")]).unwrap();
        assert!(m.typeahead("p"));
        assert_eq!(m.active_id(), Some("p2"));
    }

    #[test]
    fn no_match_leaves_focus_where_it_was() {
        let mut m = menu();
        m.focus_first();
        assert!(!m.typeahead("zzz"));
        assert_eq!(m.active_id(), Some("cut"), "a failed search must not lose focus");
    }

    #[test]
    fn reset_typeahead_prevents_prefix_run_together() {
        let mut m = Menu::new(vec![item("ab", "AB"), item("bc", "BC")]).unwrap();
        m.typeahead("a");
        m.reset_typeahead();
        // Without the reset this would search for "ab" and skip the BC item.
        assert!(m.typeahead("b"));
        assert_eq!(m.active_id(), Some("bc"));
    }
}
