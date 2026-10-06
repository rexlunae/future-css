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
//!
//! # The boundary is primitives only
//!
//! This crate used to take `Vec<JsValue>` items through `serde-wasm-bindgen`
//! and return an item object. That linked `js-sys`, which made a menu's
//! traversal logic a 414 KB download (AGENTS.md). Nothing a menu decides needs
//! an object to cross: the JS layer already owns the DOM items, so it only
//! needs an index back. Items cross as parallel arrays (labels plus a 0/1
//! focusable flag), and every answer is an index or a small `[index, flag]`
//! pair. The crate depends on `wasm-bindgen` alone -- not even `fc-core`,
//! whose error conversion is what pulls `js-sys` in.

use wasm_bindgen::prelude::*;

/// What kind of item this is. Separators carry no interaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Normal,
    Checkbox,
    Separator,
    /// Renders a submenu. Nesting is one level deep; deeper is a navigation
    /// problem, not a menu problem.
    Submenu,
}

/// One menu entry.
#[derive(Debug, Clone)]
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

/// Why a menu could not be built. One variant today; an enum so a second
/// failure mode is not a breaking change to every caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuError {
    /// A menu with nothing in it cannot be navigated, so it is a caller bug.
    Empty,
}

/// A menu: an ordered list of items plus the navigation state over them.
#[derive(Debug, Clone, Default)]
pub struct Menu {
    items: Vec<MenuItem>,
    /// Index of the focused item, or `None` before the menu receives focus.
    active: Option<usize>,
    /// Recently typed characters, for typeahead.
    typeahead: String,
}

impl Menu {
    pub fn new(items: Vec<MenuItem>) -> Result<Self, MenuError> {
        if items.is_empty() {
            return Err(MenuError::Empty);
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
        // With nothing active, start just outside the list in the direction of
        // travel, so the first ArrowDown lands on the first item and the first
        // ArrowUp on the last. Starting at position 0 skipped the first item.
        let current_pos = self
            .active
            .and_then(|a| focusable.iter().position(|f| *f == a))
            .map(|p| p as isize)
            .unwrap_or(if delta > 0 { -1 } else { 0 });
        let len = focusable.len() as isize;
        // rem_euclid keeps a large negative delta correct, which a naive
        // `+ len` does not.
        let next = (current_pos + delta).rem_euclid(len);
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
        self.search(&query.to_lowercase(), |label| label.to_lowercase())
    }

    /// `typeahead` for a caller that has already lowercased the query and every
    /// label. The boundary uses this one.
    ///
    /// Unicode case folding is ~17 KB of tables in a wasm module -- measured, a
    /// third of this crate -- while `toLowerCase` costs JavaScript nothing. So the
    /// binding folds once when it builds the item list, and the tables are never
    /// reachable from an export.
    pub fn typeahead_folded(&mut self, query: &str) -> bool {
        self.search(query, |label| label.to_string())
    }

    /// The query is folded per keystroke, before the repeating rule, so typing
    /// "A" then "a" cycles exactly as "a" then "a" does. Generic over `fold` so
    /// the folded path does not link the case tables at all.
    fn search(&mut self, query: &str, fold: impl Fn(&str) -> String) -> bool {
        let first = match query.chars().next() {
            Some(c) => c,
            None => return false,
        };
        // Repeating a single character cycles through items starting with it,
        // rather than searching for a doubled letter that matches nothing.
        let repeating = self.typeahead.chars().all(|c| c == first);
        if repeating {
            self.typeahead.clear();
        }
        self.typeahead.push_str(query);

        let start = self.active.map(|a| a + 1).unwrap_or(0);
        for step in 0..self.items.len() {
            let idx = (start + step) % self.items.len();
            let item = &self.items[idx];
            if item.is_focusable() && fold(&item.label).starts_with(self.typeahead.as_str()) {
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

    /// Restores view state the JS layer held between stateless boundary calls.
    ///
    /// An out-of-range `active` is dropped rather than trusted: the DOM can lose
    /// an item between keystrokes, and an index past the end would make the
    /// next move panic on a `focusable` lookup that cannot succeed.
    pub fn adopt_state(&mut self, active: Option<usize>, typeahead: String) {
        self.active = active.filter(|a| *a < self.items.len());
        self.typeahead = typeahead;
    }
}

// ---------------------------------------------------------------------------
// wasm-bindgen boundary
// ---------------------------------------------------------------------------
//
// Stateless entry points over flat primitives, the `fc-select` pattern. A menu
// crosses as parallel arrays:
//
//   labels[i]     the item's visible text, for typeahead
//   focusable[i]  1 when arrows and typeahead may land on it, else 0
//   active        the focused index, or -1 for none
//
// Separators and disabled items both cross as focusable 0. The model only ever
// asks "may focus land here", and the binding already knows which DOM node is
// which, so carrying the kind across would be bytes nobody reads.

/// Builds a model from the boundary arrays, or `None` for an empty menu.
fn model_with(labels: &[String], focusable: &[i32]) -> Option<Menu> {
    let n = labels.len().max(focusable.len());
    let items = (0..n)
        .map(|i| MenuItem {
            id: String::new(),
            label: labels.get(i).cloned().unwrap_or_default(),
            kind: ItemKind::Normal,
            disabled: focusable.get(i).copied().unwrap_or(0) != 1,
            checked: false,
            shortcut: None,
        })
        .collect();
    Menu::new(items).ok()
}

fn index_out(active: Option<usize>) -> i32 {
    active.map(|i| i as i32).unwrap_or(-1)
}

fn index_in(active: i32) -> Option<usize> {
    (active >= 0).then_some(active as usize)
}

/// The focused index after an arrow press, or -1 when nothing is focusable.
#[wasm_bindgen(js_name = menuMove)]
pub fn js_menu_move(focusable: Vec<i32>, active: i32, delta: i32) -> i32 {
    let Some(mut menu) = model_with(&[], &focusable) else { return -1 };
    menu.adopt_state(index_in(active), String::new());
    menu.move_by(delta as isize);
    index_out(menu.active_index())
}

/// The first focusable index, for open and Home. -1 when there is none.
#[wasm_bindgen(js_name = menuFocusFirst)]
pub fn js_menu_focus_first(focusable: Vec<i32>) -> i32 {
    let Some(mut menu) = model_with(&[], &focusable) else { return -1 };
    menu.focus_first();
    index_out(menu.active_index())
}

/// The last focusable index, for End. -1 when there is none.
#[wasm_bindgen(js_name = menuFocusLast)]
pub fn js_menu_focus_last(focusable: Vec<i32>) -> i32 {
    let Some(mut menu) = model_with(&[], &focusable) else { return -1 };
    menu.focus_last();
    index_out(menu.active_index())
}

/// `[active, matched]` after a typeahead keystroke. `matched` is 0 when nothing
/// matched; the caller clears its buffer copy when it is.
///
/// `labels`, `buffer`, and `query` must already be lowercased (see
/// `Menu::typeahead_folded`). The buffer crosses in as a string and the
/// repeating-character rule runs in the model, so JS never reimplements the
/// match. The timeout that expires the buffer stays in JS: it is a clock, not
/// computation.
#[wasm_bindgen(js_name = menuTypeahead)]
pub fn js_menu_typeahead(labels: Vec<String>, focusable: Vec<i32>, active: i32, buffer: String, query: String) -> Vec<i32> {
    let Some(mut menu) = model_with(&labels, &focusable) else { return vec![-1, 0] };
    menu.adopt_state(index_in(active), buffer);
    let matched = menu.typeahead_folded(&query);
    vec![index_out(menu.active_index()), i32::from(matched)]
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
    fn a_shifted_repeat_still_cycles() {
        // Holding Shift must not turn a cycle into a search for "Aa".
        let mut m = Menu::new(vec![item("a1", "Apple"), item("a2", "Apricot")]).unwrap();
        assert!(m.typeahead("A"));
        assert!(m.typeahead("a"));
        assert_eq!(m.active_id(), Some("a2"));
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

    // ---- boundary ------------------------------------------------------

    fn strings(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn boundary_move_skips_unfocusable_and_wraps() {
        // cut, copy, separator, paste(disabled), delete
        let f = vec![1, 1, 0, 0, 1];
        assert_eq!(js_menu_move(f.clone(), 1, 1), 4);
        assert_eq!(js_menu_move(f.clone(), 4, 1), 0);
        assert_eq!(js_menu_move(f, 0, -1), 4);
    }

    #[test]
    fn boundary_empty_and_all_disabled_answer_minus_one() {
        assert_eq!(js_menu_move(vec![], 0, 1), -1);
        assert_eq!(js_menu_focus_first(vec![0, 0]), -1);
        assert_eq!(js_menu_focus_last(vec![]), -1);
        assert_eq!(js_menu_typeahead(vec![], vec![], -1, String::new(), "a".into()), vec![-1, 0]);
    }

    #[test]
    fn boundary_out_of_range_active_is_treated_as_none() {
        // The DOM shrank between keystrokes. Moving must not panic.
        assert_eq!(js_menu_move(vec![1, 1], 9, 1), 0);
    }

    #[test]
    fn first_arrow_from_nothing_lands_on_the_nearest_end() {
        // cut, copy, separator, paste(disabled), delete
        let f = vec![1, 1, 0, 0, 1];
        assert_eq!(js_menu_move(f.clone(), -1, 1), 0, "ArrowDown starts at the top");
        assert_eq!(js_menu_move(f, -1, -1), 4, "ArrowUp starts at the bottom");
    }

    #[test]
    fn boundary_typeahead_continues_the_buffer() {
        let labels = strings(&["apple", "apricot", "banana"]);
        let f = vec![1, 1, 1];
        assert_eq!(js_menu_typeahead(labels.clone(), f.clone(), -1, String::new(), "a".into()), vec![0, 1]);
        // "a" then "p" then "r": the buffer "ap" plus "r" finds Apricot.
        assert_eq!(js_menu_typeahead(labels.clone(), f.clone(), 0, "ap".into(), "r".into()), vec![1, 1]);
        assert_eq!(js_menu_typeahead(labels, f, 1, String::new(), "z".into()), vec![1, 0]);
    }
}
