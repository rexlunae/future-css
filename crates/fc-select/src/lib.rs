//! fc-select — option-list model and typeahead for a value-selecting listbox.
//!
//! # Why this is a component and not a menu
//!
//! The navigation model here is deliberately close to `fc-context-menu` — same
//! wrapping, same typeahead buffer — because duplicating that logic would let two
//! subtly different keybindings drift. But three things make a select a different
//! problem, and getting them wrong is how real listboxes become unusable:
//!
//! 1. **A select has a committed value.** A menu fires an action; a select
//!    *changes state that persists*. So the model tracks both a committed value
//!    and a merely-highlighted one, and Escape restores the first from the second.
//!    Without that, dismissing a listbox silently discards the user's choice.
//!
//! 2. **Disabled options are skipped by arrows but still announced.** Moving past
//!    a disabled option is correct, but `typeahead` must not select it, because
//!    a search that lands on an unavailable option is a dead end.
//!
//! 3. **A search that matches nothing must not wedge the buffer.** If the
//!    prefix is kept, the next keystroke is appended to a string that can never
//!    match and the control silently ignores the user forever. Same rule as the
//!    menu, for the same reason.
//!
//! # What does NOT live here
//!
//! Focus, `aria-activedescendant`, the popover, and every DOM question. Those are
//! the browser's, and AGENTS.md is explicit that a WASM module never touches the
//! DOM. This crate answers "which option is active" and nothing else.

use wasm_bindgen::prelude::*;

/// One option in the list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Option_ {
    /// Stable value, carried back on commit. Not the label.
    pub value: String,
    /// Visible text.
    pub label: String,
    /// Group heading this option belongs under, or `None` for ungrouped.
    pub group: Option<String>,
    /// Unavailable. Skipped by arrows, never selected by typeahead.
    pub disabled: bool,
}

impl Option_ {
    pub fn new(value: &str, label: &str) -> Self {
        Self {
            value: value.to_string(),
            label: label.to_string(),
            group: None,
            disabled: false,
        }
    }

    pub fn disabled(mut self) -> Self {
        self.disabled = true;
        self
    }

    pub fn in_group(mut self, group: &str) -> Self {
        self.group = Some(group.to_string());
        self
    }

    fn selectable(&self) -> bool {
        !self.disabled
    }
}

/// The option list plus its navigation state.
#[derive(Debug, Clone, Default)]
pub struct Select {
    options: Vec<Option_>,
    /// Index of the highlighted option, or `None` before the list is opened.
    active: Option<usize>,
    /// The value that was in effect when the list opened.
    ///
    /// This is the whole difference from a menu, and it is why Escape can be
    /// made correct: restoring is a copy, not a re-derivation.
    committed: Option<String>,
    /// Recently typed characters, for typeahead.
    typeahead: String,
    /// Indices surviving the current filter query.
    ///
    /// Kept as indices rather than a parallel `Vec<Option_>` so a filter can
    /// never desynchronise from the underlying options.
    visible: Vec<usize>,
}

impl Select {
    pub fn new(options: Vec<Option_>) -> Self {
        let visible = (0..options.len()).collect();
        Self {
            options,
            active: None,
            committed: None,
            typeahead: String::new(),
            visible,
        }
    }

    pub fn options(&self) -> &[Option_] {
        &self.options
    }

    /// Indices currently visible, in order. The JS layer walks these.
    pub fn visible(&self) -> &[usize] {
        &self.visible
    }

    pub fn active(&self) -> Option<usize> {
        self.active
    }

    pub fn committed(&self) -> Option<&str> {
        self.committed.as_deref()
    }

    /// Adopts externally held view state between stateless WASM calls.
    ///
    /// The JS binding owns the filter result, the highlight, and the typeahead
    /// buffer between keystrokes; the stateless boundary functions rebuild a
    /// model per call, so they need one entry to hand that state back in before
    /// computing. `active` outside the option list is dropped rather than
    /// trusted: the caller's copy may predate a list change.
    pub fn adopt_state(&mut self, visible: Vec<usize>, active: Option<usize>, typeahead: String) {
        // Clamp rather than trust: a caller copy may predate a list change, and
        // an out-of-range index would panic two frames later, far from the
        // mistake. The boundary functions clamp too; this is the same rule at
        // the model level.
        self.visible = visible.into_iter().filter(|&i| i < self.options.len()).collect();
        self.active = active.filter(|&a| a < self.options.len());
        self.typeahead = typeahead;
    }

    /// True when a filter is hiding options.
    pub fn filtered(&self) -> bool {
        self.visible.len() != self.options.len()
    }

    /// Opens the list, highlighting `value` when it is still visible.
    ///
    /// Opening on the committed value rather than the first option is what makes
    /// re-opening an unchanged control feel like nothing happened.
    pub fn open(&mut self, value: Option<&str>) {
        self.committed = value.map(str::to_string);
        self.active = self
            .visible
            .iter()
            .copied()
            .find(|i| self.options[*i].value == value.unwrap_or(""))
            .or_else(|| {
                // Mirror the JS twin: the fallback is the first *selectable*
                // visible option. `visible.first()` can be unavailable, and a
                // highlight on an unavailable option means Enter does nothing.
                self.visible
                    .iter()
                    .copied()
                    .find(|&i| self.options[i].selectable())
            });
        self.typeahead.clear();
    }

    /// Closes, discarding the highlight and keeping the committed value.
    ///
    /// `commit` is false for Escape: the highlight is dropped and the previously
    /// committed value stands.
    pub fn close(&mut self, commit: bool) {
        if commit {
            if let Some(index) = self.active {
                let option = &self.options[index];
                if option.selectable() {
                    self.committed = Some(option.value.clone());
                }
            }
        }
        self.active = None;
        self.typeahead.clear();
    }

    /// Moves the highlight by `delta`, wrapping.
    ///
    /// Disabled options are stepped over. A list where ArrowDown stalls on a
    /// disabled option reads as a broken control.
    pub fn move_by(&mut self, delta: isize) {
        if self.visible.is_empty() {
            return;
        }
        let len = self.visible.len() as isize;
        // Seed from the option's *position in visible*, never its raw index.
        // `visible` is a filtered list, so raw index 4 may sit at position 0 or
        // be absent entirely -- and `(4 + step) % len` then walks the wrong
        // list. This is the same bug the JS twin hit and fixed; `typeahead`
        // below carries the longer explanation. With no filter the two coincide,
        // which is exactly why the parity suite needs filtered cases too.
        let current = match self.active {
            Some(a) => self
                .visible
                .iter()
                .position(|&i| i == a)
                .map(|p| p as isize)
                .unwrap_or(if delta > 0 { -1 } else { 0 }),
            None => if delta > 0 { -1 } else { 0 },
        };
        // Walk in the requested direction until a selectable option turns up.
        // Bounded by `len` so an all-disabled list terminates instead of looping.
        for step in 1..=len {
            let next = (current + delta * step).rem_euclid(len);
            let index = self.visible[next as usize];
            if self.options[index].selectable() {
                self.active = Some(index);
                return;
            }
        }
    }

    pub fn focus_first(&mut self) {
        if let Some(index) = self.visible.iter().copied().find(|i| self.options[*i].selectable()) {
            self.active = Some(index);
        }
    }

    pub fn focus_last(&mut self) {
        if let Some(index) = self
            .visible
            .iter()
            .rev()
            .copied()
            .find(|i| self.options[*i].selectable())
        {
            self.active = Some(index);
        }
    }

    /// Hides options whose label does not contain `query`, case-insensitively.
    ///
    /// Contains rather than starts-with: a model listbox is searched by substring
    /// ("sonnet" matching "claude-3-5-sonnet") where a menu's typeahead is a
    /// prefix match. They are different operations and share the name.
    ///
    /// An empty query restores everything, so clearing the field is not a
    /// separate code path on the JS side.
    pub fn filter(&mut self, query: &str) {
        let needle = query.trim().to_lowercase();
        self.visible = if needle.is_empty() {
            (0..self.options.len()).collect()
        } else {
            self.options
                .iter()
                .enumerate()
                .filter(|(_, o)| o.label.to_lowercase().contains(&needle) || o.value.to_lowercase().contains(&needle))
                .map(|(i, _)| i)
                .collect()
        };
        // Keep the highlight on something that still exists, or fall back to the
        // first match. Leaving it on a hidden option would make ArrowDown start
        // from somewhere invisible.
        if self.active.map(|a| !self.visible.contains(&a)).unwrap_or(false) {
            self.active = self.visible.iter().copied().find(|i| self.options[*i].selectable());
        }
    }

    /// Clears the typeahead buffer. Call on any navigation other than typing.
    pub fn reset_typeahead(&mut self) {
        self.typeahead.clear();
    }

    /// Moves the highlight to the next option matching the typed prefix.
    ///
    /// Repeating one character cycles through options starting with it rather
    /// than searching for a doubled letter, and a search matching nothing clears
    /// the buffer so the next keystroke starts fresh instead of extending a
    /// prefix that can never match.
    pub fn typeahead(&mut self, query: &str) -> bool {
        let first = match query.chars().next() {
            Some(c) => c,
            None => return false,
        };
        let repeating = self.typeahead.chars().all(|c| c == first);
        self.typeahead = if repeating {
            query.to_string()
        } else {
            format!("{}{query}", self.typeahead)
        };

        let needle = self.typeahead.to_lowercase();
        /*
         * Search starts *after* the active option, so repeating a character
         * cycles forward rather than sticking on the first match.
         *
         * The position is found in `visible`, not derived from the option index:
         * `visible` is a filtered list, so index 3 may be absent or mean
         * something else entirely once a filter is applied. Using the raw option
         * index as a position into `visible` walks the wrong list, which is
         * invisible until a filter is active and then silently skips options.
         */
        let len = self.visible.len();
        let start = self
            .active
            .and_then(|a| self.visible.iter().position(|i| *i == a))
            .map(|p| p + 1)
            .unwrap_or(0);
        for step in 0..len {
            let index = self.visible[(start + step) % len];
            let option = &self.options[index];
            // Disabled options are skipped, not selected: a search that lands on
            // an unavailable option is a dead end the user cannot escape by
            // typing.
            if option.selectable() && option.label.to_lowercase().starts_with(&needle) {
                self.active = Some(index);
                return true;
            }
        }
        self.typeahead.clear();
        false
    }
}

// ---------------------------------------------------------------------------
// wasm-bindgen boundary
// ---------------------------------------------------------------------------
//
// Flat primitives only, for the same reason `fc-diff` is: `js-sys` costs ~302 KB
// the moment it is linked, and every other module in the workspace pays that for
// object returns they did not need.
//
// An option list crosses as three parallel arrays plus a count:
//
//   values[i]   the option's stable value at position i
//   labels[i]   its visible text
//   active      its index, or -1 when nothing is highlighted
//
// `groups[i]` is a group heading or "" for an ungrouped option, so the JS layer
// can render headings without a second lookup table. Disabled options cross as
// a 0/1 array rather than being filtered out: the binding reports *which*
// options are unavailable, and dropping them would lose the fact that they exist.


#[wasm_bindgen(js_name = selectOpen)]
pub fn js_select_open(values: Vec<String>, labels: Vec<String>, groups: Vec<String>, disabled: Vec<i32>, current: String) -> i32 {
    let n = values.len().min(labels.len());
    let options: Vec<Option_> = (0..n)
        .map(|i| {
            let mut o = Option_::new(&values[i], &labels[i]);
            if let Some(g) = groups.get(i) {
                if !g.is_empty() {
                    o = o.in_group(g);
                }
            }
            if disabled.get(i).copied().unwrap_or(0) == 1 {
                o = o.disabled();
            }
            o
        })
        .collect();
    if options.is_empty() {
        return -1;
    }
    let mut model = Select::new(options);
    model.open(if current.is_empty() { None } else { Some(&current) });
    model.active().map(|i| i as i32).unwrap_or(-1)
}

/// Index of the option whose value is `value`, or -1.
#[wasm_bindgen(js_name = selectIndexOf)]
pub fn js_select_index_of(values: Vec<String>, value: String) -> i32 {
    values
        .iter()
        .position(|v| *v == value)
        .map(|i| i as i32)
        .unwrap_or(-1)
}

/// Label at `index`, or "" when out of range.
#[wasm_bindgen(js_name = selectLabelAt)]
pub fn js_select_label_at(labels: Vec<String>, index: i32) -> String {
    if index < 0 {
        return String::new();
    }
    labels.get(index as usize).cloned().unwrap_or_default()
}

/// Indices surviving a `contains` filter, case-insensitive.
///
/// Matches `Select::filter` exactly, including the empty-query case restoring
/// everything, so the JS layer never implements a second search.
#[wasm_bindgen(js_name = selectFilter)]
pub fn js_select_filter(labels: Vec<String>, values: Vec<String>, query: String) -> Vec<i32> {
    let options: Vec<Option_> = labels
        .iter()
        .enumerate()
        .map(|(i, l)| Option_::new(values.get(i).map(String::as_str).unwrap_or(""), l))
        .collect();
    let mut model = Select::new(options);
    model.filter(&query);
    model.visible().iter().map(|i| *i as i32).collect()
}

/// `[active, committedIndex]` after a move. -1 for "none".
///
/// One call rather than two so a JS caller cannot observe an intermediate state
/// where the highlight has moved but the committed value has not.
#[wasm_bindgen(js_name = selectMove)]
pub fn js_select_move(values: Vec<String>, labels: Vec<String>, disabled: Vec<i32>, committed: String, delta: i32) -> Vec<i32> {
    let mut select = model_with(&values, &labels, &disabled);
    if select.options().is_empty() {
        return vec![-1, -1];
    }
    let committed_index = if committed.is_empty() {
        -1
    } else {
        values.iter().position(|v| *v == committed).map(|i| i as i32).unwrap_or(-1)
    };
    select.open(if committed.is_empty() { None } else { Some(&committed) });
    select.move_by(delta as isize);
    vec![select.active().map(|i| i as i32).unwrap_or(-1), committed_index]
}

/// `[active, matched]` after a typeahead keystroke. `matched` is 0 when nothing
/// matched, so the caller knows whether to clear the buffer.
#[wasm_bindgen(js_name = selectTypeahead)]
pub fn js_select_typeahead(values: Vec<String>, labels: Vec<String>, disabled: Vec<i32>, committed: String, query: String) -> Vec<i32> {
    let mut select = model_with(&values, &labels, &disabled);
    if select.options().is_empty() {
        return vec![-1, 0];
    }
    select.open(if committed.is_empty() { None } else { Some(&committed) });
    let matched = select.typeahead(&query);
    vec![select.active().map(|i| i as i32).unwrap_or(-1), i32::from(matched)]
}

/// Next active index after a move seeded from the *current* highlight and the
/// *visible* set. -1 for none.
///
/// `selectMove` re-opens on the committed value, which is right for the first
/// arrow of an interaction and wrong for the second: consecutive arrows must
/// continue from wherever the highlight is now. `visible` crosses explicitly so
/// a filtered list steers the walk the same way it does in the JS twin -- which
/// is also what makes filtered moves parity-testable at all; before this entry
/// existed, the boundary could not express one, and that was a blind spot.
#[wasm_bindgen(js_name = selectMoveFrom)]
pub fn js_select_move_from(values: Vec<String>, labels: Vec<String>, disabled: Vec<i32>, visible: Vec<i32>, active: i32, delta: i32) -> i32 {
    let mut select = model_with(&values, &labels, &disabled);
    if select.options().is_empty() {
        return -1;
    }
    let vis: Vec<usize> = visible
        .iter()
        .copied()
        .filter(|i| (*i as usize) < values.len())
        .map(|i| i as usize)
        .collect();
    select.adopt_state(vis, (active >= 0).then_some(active as usize), String::new());
    select.move_by(delta as isize);
    select.active().map(|i| i as i32).unwrap_or(-1)
}

/// `[active, matched]` after a typeahead keystroke seeded from the current
/// highlight, the visible set, and the buffer. `matched` is 0 when nothing
/// matched; the caller clears its buffer copy when it is.
///
/// The buffer crosses as a plain string and the repeating-character rule runs
/// inside the model, so the JS side never reimplements the match. The 600ms
/// window stays in JS: it is a clock, and clocks are not computation this
/// module should own.
#[wasm_bindgen(js_name = selectTypeaheadFrom)]
pub fn js_select_typeahead_from(values: Vec<String>, labels: Vec<String>, disabled: Vec<i32>, visible: Vec<i32>, active: i32, buffer: String, query: String) -> Vec<i32> {
    let mut select = model_with(&values, &labels, &disabled);
    if select.options().is_empty() {
        return vec![-1, 0];
    }
    let vis: Vec<usize> = visible
        .iter()
        .copied()
        .filter(|i| (*i as usize) < values.len())
        .map(|i| i as usize)
        .collect();
    select.adopt_state(vis, (active >= 0).then_some(active as usize), buffer);
    let matched = select.typeahead(&query);
    vec![select.active().map(|i| i as i32).unwrap_or(-1), i32::from(matched)]
}

/// Builds a model, honouring the disabled flags.
///
/// `disabled` is a parameter rather than being left empty on purpose: without it
/// the navigation functions cannot skip an unavailable option, which is silent
/// -- the call returns a plausible index and nothing looks wrong until someone
/// tries to pick the option they were just moved onto.
fn model_with(values: &[String], labels: &[String], disabled: &[i32]) -> Select {
    Select::new(
        values
            .iter()
            .zip(labels.iter())
            .enumerate()
            .map(|(i, (v, l))| {
                let option = Option_::new(v, l);
                if disabled.get(i).copied().unwrap_or(0) == 1 {
                    option.disabled()
                } else {
                    option
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Select {
        Select::new(vec![
            Option_::new("opus-5", "Claude Opus 5").in_group("Anthropic"),
            Option_::new("sonnet-5", "Claude Sonnet 5").in_group("Anthropic"),
            Option_::new("gpt-5", "GPT-5").in_group("OpenAI"),
            Option_::new("o3", "o3").in_group("OpenAI"),
            Option_::new("llama", "Llama 4 (local)").in_group("Local").disabled(),
        ])
    }

    fn labels(select: &Select) -> Vec<&str> {
        select.visible().iter().map(|i| select.options()[*i].label.as_str()).collect()
    }

    #[test]
    fn arrow_movement_wraps_in_both_directions() {
        let mut s = sample();
        s.open(None);
        // Opens on the first option, so two moves down lands on the third.
        s.move_by(1);
        s.move_by(1);
        assert_eq!(s.active().map(|i| s.options()[i].label.as_str()), Some("GPT-5"));
        // Past the end wraps to the start.
        s.move_by(1);
        s.move_by(1);
        assert_eq!(s.active().map(|i| s.options()[i].label.as_str()), Some("Claude Opus 5"));
        // And backwards from the start wraps to the end.
        s.move_by(-1);
        assert_eq!(s.active().map(|i| s.options()[i].label.as_str()), Some("o3"));
    }

    #[test]
    fn arrow_movement_steps_over_disabled_options() {
        // The disabled option is last, so stepping *up* from the first option has
        // to pass through it and land on the last selectable one.
        let mut s = sample();
        s.open(None);
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("opus-5"));
        s.move_by(-1);
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("o3"),
            "must skip the disabled Llama rather than stopping on it");
    }

    // Six selectable options, so visible sets like [0, 2, 5] are expressible
    // without a disabled entry muddying the move expectations.
    fn sample6() -> Select {
        Select::new(
            ["a", "b", "c", "d", "e", "f"]
                .iter()
                .enumerate()
                .map(|(i, v)| Option_::new(v, &format!("Option {}", v.to_uppercase())))
                .collect(),
        )
    }

    #[test]
    fn move_by_seeds_from_position_in_visible_not_raw_index() {
        // Filtered to [0, 2, 5], active on raw index 2 -- visible position 1.
        // Moving down must land on visible position 2, raw index 5. Seeding
        // from the raw index gives (2+1) % 3 = 0 and lands on raw index 0
        // instead: a silent skip that only exists when a filter is active.
        let mut s = sample6();
        s.adopt_state(vec![0, 2, 5], Some(2), String::new());
        s.move_by(1);
        assert_eq!(s.active(), Some(5), "must continue from the position in visible");
    }

    #[test]
    fn move_by_from_absent_active_falls_back_like_the_js_twin() {
        // Active 4 is hidden by the visible set. The JS twin treats that as
        // "start from nothing": down lands on the first visible option, not on
        // (4+1) % 3, which is whatever raw index happens to sit there.
        let mut s = sample6();
        s.adopt_state(vec![0, 2, 5], Some(4), String::new());
        s.move_by(1);
        assert_eq!(s.active(), Some(0));
        s.adopt_state(vec![0, 2, 5], Some(4), String::new());
        s.move_by(-1);
        assert_eq!(s.active(), Some(5), "up from nothing lands on the last visible");
    }

    #[test]
    fn move_by_from_nothing_starts_at_the_edge_of_visible() {
        let mut s = sample6();
        s.adopt_state(vec![2, 4], None, String::new());
        s.move_by(1);
        assert_eq!(s.active(), Some(2));
        s.adopt_state(vec![2, 4], None, String::new());
        s.move_by(-1);
        assert_eq!(s.active(), Some(4));
    }

    #[test]
    fn move_by_wraps_within_the_visible_set() {
        let mut s = sample6();
        s.adopt_state(vec![0, 2, 5], Some(5), String::new());
        s.move_by(1);
        assert_eq!(s.active(), Some(0), "past the last visible wraps to the first");
        s.adopt_state(vec![0, 2, 5], Some(0), String::new());
        s.move_by(-1);
        assert_eq!(s.active(), Some(5));
    }

    #[test]
    fn adopt_state_clamps_a_visible_set_that_predates_a_list_change() {
        // Index 5 does not exist in a five-option list. A stale caller copy
        // must be dropped, not panicked on two frames away from the mistake.
        let mut s = sample();
        s.adopt_state(vec![0, 1, 5], Some(1), String::new());
        assert_eq!(s.visible(), &[0, 1]);
        s.move_by(1);
        assert_eq!(s.active(), Some(0), "wrap over the clamped set, no panic");
    }

    #[test]
    fn adopt_state_drops_an_out_of_range_highlight() {
        // A stale caller copy predating a list change must never be trusted;
        // move_by would otherwise seed from an index that means nothing.
        let mut s = sample();
        s.adopt_state(vec![0, 1], Some(99), String::new());
        assert_eq!(s.active(), None);
        s.move_by(1);
        assert_eq!(s.active(), Some(0), "moves from nothing after a dropped highlight");
    }

    #[test]
    fn arrow_movement_terminates_when_every_option_is_disabled() {
        // The reason move_by is bounded by the list length: an unbounded scan for a
        // selectable option would loop forever here and hang the module.
        //
        // This test used to assert that opening highlights the first option
        // even when it is unavailable. That was the disabled-blind fallback the
        // JS twin never shared -- its `open` picks the first *selectable*
        // visible option, which on an all-disabled list is nothing. Highlighting
        // an option Enter cannot commit reads as a broken control, so the model
        // now agrees with the twin: open highlights nothing, moves terminate.
        let mut s = Select::new(vec![
            Option_::new("a", "A").disabled(),
            Option_::new("b", "B").disabled(),
        ]);
        s.open(None);
        assert_eq!(s.active(), None, "nothing committable, nothing highlighted");
        s.move_by(1);
        s.move_by(-1);
        assert_eq!(s.active(), None, "moves terminate instead of selecting the unavailable");
    }

    #[test]
    fn escape_restores_the_committed_value_and_discards_the_highlight() {
        // The whole reason `committed` exists. Without it, Escape silently keeps
        // whatever the user last highlighted.
        let mut s = sample();
        s.open(Some("gpt-5"));
        s.move_by(1);
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("o3"));
        s.close(false);
        assert_eq!(s.committed(), Some("gpt-5"), "Escape must not keep the highlight");
        assert_eq!(s.active(), None, "closing must clear the highlight");
    }

    #[test]
    fn commit_takes_the_highlighted_option() {
        let mut s = sample();
        s.open(Some("gpt-5"));
        s.move_by(1);
        s.close(true);
        assert_eq!(s.committed(), Some("o3"));
    }

    #[test]
    fn committing_a_disabled_option_does_not_change_the_value() {
        let mut s = sample();
        s.open(Some("gpt-5"));
        s.active = Some(4); // the disabled one, reached directly
        s.close(true);
        assert_eq!(s.committed(), Some("gpt-5"), "a disabled option must not be committed");
    }

    #[test]
    fn reopening_highlights_the_committed_value_not_the_first_option() {
        // Re-opening an unchanged control must not move the highlight, or the
        // control appears to reset itself.
        let mut s = sample();
        s.open(Some("o3"));
        s.close(true);
        // Bound before the call: `open` takes `&mut self`, so holding the
        // borrow returned by `committed` across it will not compile.
        let current = s.committed().map(str::to_string);
        s.open(current.as_deref());
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("o3"));
    }

    #[test]
    fn reopening_after_the_value_vanished_falls_back_to_the_first_option() {
        // A model list can change under a control that held a stale value.
        let mut s = sample();
        s.open(Some("a-model-that-no-longer-exists"));
        assert_eq!(s.active().map(|i| s.options()[i].label.as_str()), Some("Claude Opus 5"));
    }

    #[test]
    fn filter_matches_substrings_case_insensitively() {
        // A model listbox is searched by substring; a menu's typeahead is a prefix
        // match. Different operations that share a name.
        let mut s = sample();
        s.filter("sonnet");
        assert_eq!(labels(&s), vec!["Claude Sonnet 5"]);
        s.filter("GPT");
        assert_eq!(labels(&s), vec!["GPT-5"]);
        s.filter("local");
        assert_eq!(labels(&s), vec!["Llama 4 (local)"], "disabled options stay visible");
    }

    #[test]
    fn an_empty_query_restores_every_option() {
        // So clearing the field is not a separate path on the JS side.
        let mut s = sample();
        s.filter("gpt");
        assert!(s.filtered());
        s.filter("");
        assert_eq!(s.visible().len(), s.options().len());
        assert!(!s.filtered());
    }

    #[test]
    fn filtering_keeps_the_highlight_visible_or_moves_it_to_a_match() {
        // Leaving the highlight on a hidden option makes ArrowDown start from
        // somewhere the user cannot see.
        let mut s = sample();
        s.open(Some("gpt-5"));
        s.filter("opus");
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("opus-5"));
    }

    #[test]
    fn typeahead_matches_a_prefix_not_a_substring() {
        // Typeahead is a *prefix* match; substring search is what `filter` is for.
        // The sample labels all begin with their vendor ("Claude…", "GPT-5",
        // "o3", "Llama…"), so "s" must NOT match "Claude Sonnet 5" -- a typeahead
        // that skipped to a substring hit would jump somewhere surprising.
        let mut s = sample();
        s.open(None);
        assert!(!s.typeahead("s"), "no label starts with 's'");

        // "L" is a real prefix, but only on the *disabled* option, so typeahead
        // must not select it. This is the same rule as the disabled-option
        // typeahead test seen from the prefix side.
        assert!(!s.typeahead("L"), "the only L option is disabled");

        assert!(s.typeahead("G"), "'G' is a real prefix (GPT-5)");
    }

    #[test]
    fn typeahead_cycles_on_a_repeated_character() {
        let mut s = Select::new(vec![
            Option_::new("one", "Sonnet"),
            Option_::new("two", "Sonnet 5"),
            Option_::new("three", "GPT-5"),
        ]);
        s.open(None);
        // `open` highlights the first option, and typeahead searches *after* the
        // active one so repeating cycles forward. So the first "S" lands on the
        // second match -- which is the cycling behaviour, not a bug.
        assert!(s.typeahead("S"));
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("two"));
        // Repeating again wraps back around to the first match, rather than
        // searching for "SS" which would match nothing.
        assert!(s.typeahead("S"));
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("one"));
    }

    #[test]
    fn typeahead_accumulates_distinct_characters_into_one_query() {
        let mut s = Select::new(vec![
            Option_::new("one", "Sonnet"),
            Option_::new("two", "GPT-5"),
        ]);
        s.open(None);
        assert!(s.typeahead("S"));
        assert!(s.typeahead("o"), "'o' extends 'S' rather than replacing it");
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("one"));
    }

    #[test]
    fn typeahead_never_selects_a_disabled_option() {
        // "L" would otherwise match "Llama 4 (local)", which is unavailable, and
        // the user would be stuck on an option they cannot choose.
        let mut s = sample();
        s.open(None);
        assert!(!s.typeahead("L"));
        assert_ne!(s.active().map(|i| s.options()[i].value.as_str()), Some("llama"));
    }

    #[test]
    fn a_failed_search_clears_the_buffer_so_the_next_keystroke_works() {
        // Without this the next character is appended to a prefix that can never
        // match and the control silently ignores the user forever.
        let mut s = sample();
        s.open(None);
        assert!(!s.typeahead("z"));
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("opus-5"),
            "a failed search leaves the highlight where it was");
        // "g" must still work, proving the buffer did not retain "z".
        assert!(s.typeahead("g"), "buffer must not wedge");
    }

    #[test]
    fn navigation_resets_the_typeahead_buffer() {
        // A later "b" must not be appended to a stale prefix.
        let mut s = sample();
        s.open(None);
        s.typeahead("s");
        s.reset_typeahead();
        s.typeahead("g");
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("gpt-5"));
    }

    #[test]
    fn home_and_end_land_on_selectable_options() {
        let mut s = sample();
        s.open(None);
        s.focus_last();
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("o3"),
            "End must skip the disabled final option");
        s.focus_first();
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("opus-5"));
    }

    #[test]
    fn an_empty_list_is_inert_rather_than_panicking() {
        let mut s = Select::new(vec![]);
        s.open(None);
        s.move_by(1);
        s.move_by(-1);
        s.focus_first();
        s.focus_last();
        assert!(!s.typeahead("a"));
        s.filter("anything");
        s.close(true);
        assert_eq!(s.committed(), None);
    }
}

#[cfg(test)]
mod prefix_probe {
    use super::*;
    /// Typeahead is a *prefix* match, so it needs a label that actually starts
    /// with the character typed. The sample set has none starting with "s".
    #[test]
    fn prefix_matching_finds_a_label_that_starts_with_the_needle() {
        let mut s = Select::new(vec![
            Option_::new("a", "alpha"),
            Option_::new("b", "bravo"),
            Option_::new("c", "charlie"),
        ]);
        s.open(None);
        assert!(s.typeahead("c"), "a real prefix must match");
        assert_eq!(s.active().map(|i| s.options()[i].value.as_str()), Some("c"));
        assert!(!s.typeahead("zz"), "a prefix that matches nothing must not match");
    }

    /// Contains-matching, by contrast, is what `filter` is for. The distinction
    /// is load-bearing: a model listbox filters by substring, a menu typeaheads
    /// by prefix.
    #[test]
    fn filter_finds_a_substring_that_prefix_matching_would_miss() {
        let mut s = Select::new(vec![Option_::new("x", "Claude Sonnet 5")]);
        assert!(!s.typeahead("s"), "no prefix match");
        s.filter("sonnet");
        assert_eq!(s.visible().len(), 1, "but a substring match");
    }
}
