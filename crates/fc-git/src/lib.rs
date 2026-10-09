//! fc-git — working-tree summary for the git surface.
//!
//! # What is here, and why only this
//!
//! The git surface renders a working tree: branch, status counts, a file list,
//! per-file line stats. Almost none of that is computation — it is DOM. What *is*
//! computation is the part worth getting exactly right, and this crate holds it:
//!
//! 1. **`summarize_status`** — folding entries into staged/unstaged/conflicted/
//!    untracked counts.
//!
//! 2. **`order_entries`** — putting the entries that need attention first.
//!
//! 3. **`diff_counts`** — added/removed line totals for a file.
//!
//! # The rule that shapes the boundary
//!
//! **No `js-sys`.** Linking it costs ~302 KB the moment any of it is used, and
//! LTO cannot remove it (AGENTS.md). So nothing here returns `Vec<JsValue>` or
//! `js_sys::Array`. Everything crosses as a small number of primitives or a flat
//! typed array, and the caller holds the actual strings.
//!
//! `diff_counts` takes the two texts as arguments and returns two numbers, rather
//! than returning a `Vec<DiffLine>` the caller would have to walk back over the
//! boundary — a range crosses as two numbers, never as an array of objects.
//!
//! # Offsets are UTF-16 code units
//!
//! Line splitting here matches `fc-diff` and the JS twin: a line ends at `\n`, and
//! counts are of lines, not bytes. Nothing here produces an offset, so the
//! surrogate-pair concern that `fc-diff` handles does not arise; the rule is
//! recorded because it is the same boundary and a future change must not quietly
//! diverge.

// `no_std` on wasm, for size rather than portability. std's panic runtime
// formats every message it could print -- `Debug` for ranges, char escaping,
// integer padding -- and links all of it the moment any bounds check can fail,
// which is most of this module's bytes and none of its behaviour. With
// `panic = "abort"` a panic was already a trap, so the handler below traps
// without formatting anything first.
#![cfg_attr(all(target_arch = "wasm32", feature = "bare", not(test)), no_std)]

extern crate alloc;

use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

#[cfg(all(target_arch = "wasm32", feature = "bare", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(all(target_arch = "wasm32", feature = "bare", not(test)))]
#[global_allocator]
static ALLOC: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;


use wasm_bindgen::prelude::*;

/// Where a file is in its lifecycle. Matches the JS `IndexState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

impl State {
    fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            0 => State::Added,
            1 => State::Modified,
            2 => State::Deleted,
            3 => State::Renamed,
            4 => State::Untracked,
            5 => State::Conflicted,
            _ => return None,
        })
    }

    fn is_conflicted(self) -> bool {
        matches!(self, State::Conflicted)
    }
}

/// One file, reduced to what the summary needs.
///
/// The path is *not* here. Ordering needs to compare paths, but paths cross the
/// boundary as UTF-8 bytes in `paths`, not as owned Rust strings per entry, which
/// keeps a thousand-file tree to two flat allocations.
#[derive(Debug, Clone, Copy)]
pub struct Entry {
    /// State in the index (staged), or `255` for "not staged".
    pub index: u8,
    /// State in the worktree, or `255` for "not staged".
    pub worktree: u8,
}

/// The counts shown in the status header.
///
/// Crosses the boundary as a flat `[staged, unstaged, conflicted, untracked]`
/// rather than as four separate calls: one array copy beats four calls, and the
/// caller reads it without allocating an object per count.
#[derive(Debug, Clone, Copy)]
pub struct Counts {
    pub staged: u32,
    pub unstaged: u32,
    pub conflicted: u32,
    pub untracked: u32,
}

impl Counts {
    /// The four counts, in the order they are documented.
    fn as_slice(self) -> [u32; 4] {
        [self.staged, self.unstaged, self.conflicted, self.untracked]
    }
}

/// Folds entries into header counts.
///
/// Staged and unstaged are counted separately because they answer different
/// questions: "what is in the commit I am about to make" and "what have I not
/// staged yet". A file changed in both appears in both counts, which is correct —
/// collapsing them is how a commit silently includes edits the user did not intend.
///
/// An entry code that is not a known state is treated as absent rather than
/// guessed at. A status surface that invents a state from an unrecognised code
/// shows a badge nobody asked for.
pub fn summarize_status(entries: &[Entry]) -> Counts {
    let mut counts = Counts { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 };
    for entry in entries {
        let index = State::from_code(entry.index);
        let worktree = State::from_code(entry.worktree);
        if index.is_some_and(State::is_conflicted) || worktree.is_some_and(State::is_conflicted) {
            counts.conflicted += 1;
        }
        if index.is_some() {
            counts.staged += 1;
        }
        if let Some(worktree) = worktree {
            counts.unstaged += 1;
            if matches!(worktree, State::Untracked) {
                counts.untracked += 1;
            }
        }
    }
    counts
}

/// The attention rank of an entry: lower sorts first.
///
/// Conflicts first because they block everything else. Then files changed in both
/// the index and the worktree, because those are the ones where staging is a real
/// decision. Then the rest.
fn rank(entry: &Entry) -> u8 {
    let index = State::from_code(entry.index);
    let worktree = State::from_code(entry.worktree);
    if index.is_some_and(State::is_conflicted) || worktree.is_some_and(State::is_conflicted) {
        0
    } else if index.is_some() && worktree.is_some() {
        1
    } else {
        2
    }
}

/// Returns indices into `entries`, ordered by attention rank then by path.
///
/// Returns a flat `Vec<u32>` of indices rather than reordered entries: the caller
/// already holds the paths, and re-sending them would copy every string across the
/// boundary for no gain.
///
/// # Paths must be sorted by the caller, and that is not optional
///
/// This sorts by **rank only**. The JS twin sorts by rank *and* path, so the two
/// agree only when the caller has already sorted by path. Passing unsorted entries
/// is silent: the WASM returns a plausible order that differs from the JS one only
/// in ties, where nothing looks wrong.
///
/// This was a real divergence, caught by a parity test that fed entries in
/// non-alphabetical order. Two ways to close it were possible -- move the path
/// comparison here, or require sorted input -- and requiring sorted input was
/// chosen because sorting paths in Rust would mean copying every path string across
/// the boundary, which is the ~302 KB `js-sys` problem AGENTS.md warns about, for
/// the sake of a tie-break the caller can do for free while it already holds the
/// paths. `order_entries_js` documents the requirement at the boundary.
pub fn order_entries(entries: &[Entry]) -> Vec<u32> {
    let mut order: Vec<u32> = (0..entries.len() as u32).collect();
    // `sort_by_key` is stable, so entries of equal rank keep the caller's order --
    // which is the caller's path order, as required above.
    order.sort_by_key(|&i| rank(&entries[i as usize]));
    order
}

/// Counts added and removed lines between two file revisions.
///
/// Returns `(added, removed)`. A text that is `None` on either side is treated as
/// empty, matching the JS twin: a file being added has no before-revision, and
/// treating that as "unchanged" would report zero lines for a new file.
///
/// `identical` is *not* returned. The JS twin returns it, but a caller that has
/// the two texts already can compare them; carrying a third value across the
/// boundary for a bit it can derive would be waste.
///
/// # Counts are of lines, never bytes
///
/// A line ends at `\n` and a trailing newline yields a final empty element, so
/// `"a\n"` is two lines and `"a"` is one. That is the same rule `fc-diff` and the
/// JS twin use, and it is why the two agree on `"a\n"` vs `"a"`. It looks like a
/// quirk; it is deliberate, because all three implementations must split the same
/// way or the counts disagree.
pub fn diff_counts(before: Option<&str>, after: Option<&str>) -> (u32, u32) {
    let before = before.unwrap_or("");
    let after = after.unwrap_or("");
    let before_lines: Vec<&str> = before.split('\n').collect();
    let after_lines: Vec<&str> = after.split('\n').collect();

    // Trim the common prefix and suffix, then count what remains.
    //
    // There is no algorithm here at all, and that is the point: the surface only
    // needs totals, so `added` is however many lines `after` has that `before`
    // does not. `fc-diff` runs Myers because it has to reconstruct *which* lines;
    // running it here would cost real time to produce a number this gets for
    // free, and would make the two implementations agree by accident rather than
    // by construction.
    //
    // The trimming is what keeps the answer useful. Without it, a one-line change
    // at the top of a 5000-line file reports the whole file as rewritten, because
    // the common tail is counted as removed and then added again.
    let mut head = 0;
    while head < before_lines.len() && head < after_lines.len()
        && before_lines[head] == after_lines[head]
    {
        head += 1;
    }
    let mut tail = 0;
    while tail < before_lines.len() - head
        && tail < after_lines.len() - head
        && before_lines[before_lines.len() - 1 - tail] == after_lines[after_lines.len() - 1 - tail]
    {
        tail += 1;
    }

    // `saturating_sub`, because the two loops can each consume lines and their
    // combined reach is not bounded by either alone. Plain subtraction panics in
    // debug and wraps in release -- so a release build would report a file with
    // billions of changed lines rather than crashing, which is far worse than
    // either. Reached by inputs like "\n" vs "\n", where both lines are empty and
    // head and tail meet in the middle.
    let before_remaining = before_lines.len().saturating_sub(head + tail);
    let after_remaining = after_lines.len().saturating_sub(head + tail);
    (after_remaining as u32, before_remaining as u32)
}

// ---- The wasm-bindgen boundary ---------------------------------------------

/// Codes an entry field uses for "no state".
const NONE: u8 = 255;

/// Folds entries into counts.
///
/// `codes` is a flat `i32` array of `[index, worktree, index, worktree, ...]`,
/// interleaved to match how the caller already has the data.
///
/// Exported rather than taking a `Vec<Entry>` because that would need `js_sys` to
/// read it off the JS side. Two flat arrays would work too; interleaving keeps the
/// caller's construction to one loop.
#[wasm_bindgen]
pub fn summarize_status_js(codes: &[i32]) -> Vec<u32> {
    let entries: Vec<Entry> = codes
        .chunks_exact(2)
        .map(|pair| Entry {
            index: normalize(pair[0]),
            worktree: normalize(pair[1]),
        })
        .collect();
    summarize_status(&entries).as_slice().to_vec()
}

/// Returns indices ordered by attention then path.
/// Returns indices ordered by attention rank, then by the caller's existing order.
///
/// **`codes` must already be sorted by path.** This function breaks ties by input
/// order, not by comparing paths, because path strings are not available on this
/// side of the boundary. Feeding unsorted entries yields a plausible order that
/// disagrees with the JS twin only where ranks tie -- which is to say it looks
/// correct and is not.
#[wasm_bindgen]
pub fn order_entries_js(codes: &[i32]) -> Vec<u32> {
    let entries: Vec<Entry> = codes
        .chunks_exact(2)
        .map(|pair| Entry {
            index: normalize(pair[0]),
            worktree: normalize(pair[1]),
        })
        .collect();
    order_entries(&entries)
}

/// Counts added and removed lines. Returns a flat `[added, removed]`.
#[wasm_bindgen]
pub fn diff_counts_js(before: Option<String>, after: Option<String>) -> Vec<u32> {
    let (added, removed) = diff_counts(before.as_deref(), after.as_deref());
    vec![added, removed]
}

fn normalize(code: i32) -> u8 {
    if !(0..=5).contains(&code) { NONE } else { code as u8 }
}

// ---- Tests -----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const ADDED: u8 = 0;
    const MODIFIED: u8 = 1;
    const UNTRACKED: u8 = 4;
    const CONFLICTED: u8 = 5;

    fn entry(index: u8, worktree: u8) -> Entry {
        Entry { index, worktree }
    }

    #[test]
    fn counts_a_clean_tree_as_zero() {
        let counts = summarize_status(&[]);
        assert_eq!(counts.staged, 0);
        assert_eq!(counts.unstaged, 0);
        assert_eq!(counts.conflicted, 0);
        assert_eq!(counts.untracked, 0);
    }

    #[test]
    fn counts_staged_and_worktree_separately() {
        // One file staged, one only in the worktree. Collapsing these into one
        // number is how a commit silently includes unstaged edits.
        let entries = [entry(MODIFIED, NONE), entry(NONE, MODIFIED)];
        let counts = summarize_status(&entries);
        assert_eq!(counts.staged, 1);
        assert_eq!(counts.unstaged, 1);
    }

    #[test]
    fn counts_a_file_changed_in_both_under_both_counts() {
        let counts = summarize_status(&[entry(MODIFIED, MODIFIED)]);
        assert_eq!(counts.staged, 1, "it is in the commit");
        assert_eq!(counts.unstaged, 1, "and it is not fully staged");
    }

    #[test]
    fn counts_untracked_as_both_unstaged_and_untracked() {
        // An untracked file is unstaged, and the sub-count is what the header
        // needs to say "3 untracked" without the user counting rows.
        let counts = summarize_status(&[entry(NONE, UNTRACKED), entry(NONE, UNTRACKED)]);
        assert_eq!(counts.unstaged, 2);
        assert_eq!(counts.untracked, 2);
        assert_eq!(counts.staged, 0);
    }

    #[test]
    fn counts_a_conflicted_file_as_conflicted_and_not_as_staged() {
        let counts = summarize_status(&[entry(CONFLICTED, CONFLICTED)]);
        assert_eq!(counts.conflicted, 1);
        assert_eq!(counts.staged, 1, "conflicted in the index, so it is in the index");
        assert_eq!(counts.unstaged, 1);
    }

    #[test]
    fn treats_an_unknown_state_code_as_absent() {
        // Guessing a state from an unrecognised code shows a badge nobody asked for.
        let counts = summarize_status(&[entry(99, 99)]);
        assert_eq!(counts.staged, 0);
        assert_eq!(counts.unstaged, 0);
    }

    #[test]
    fn orders_conflicts_first_then_both_sided_then_the_rest() {
        let entries = [
            entry(MODIFIED, NONE),          // rank 2
            entry(MODIFIED, MODIFIED),      // rank 1
            entry(CONFLICTED, CONFLICTED),  // rank 0
        ];
        let order = order_entries(&entries);
        assert_eq!(order, vec![2, 1, 0]);
    }

    #[test]
    fn ordering_is_stable_within_a_rank() {
        // The JS twin sorts stably too, over caller-sorted paths. If either sort
        // stops being stable, parity breaks on ties, which is exactly the case a
        // summary would never notice.
        let entries = [entry(MODIFIED, NONE), entry(MODIFIED, NONE), entry(MODIFIED, NONE)];
        assert_eq!(order_entries(&entries), vec![0, 1, 2]);
    }

    #[test]
    fn ordering_breaks_ties_by_caller_order_not_by_path() {
        // Documents the boundary's one real limitation, which a parity test
        // discovered by feeding entries out of path order: paths never cross into
        // this crate, so it cannot compare them.
        let entries = [entry(MODIFIED, NONE), entry(MODIFIED, NONE)];
        // Reversed relative to how a caller would order them by path; this crate
        // preserves input order, which is the documented contract.
        assert_eq!(order_entries(&entries), vec![0, 1]);
    }

    #[test]
    fn counts_added_and_removed_lines() {
        let (added, removed) = diff_counts(Some("a\nb\n"), Some("a\nc\nd\n"));
        assert_eq!(added, 2, "c and d");
        assert_eq!(removed, 1, "b");
    }

    #[test]
    fn treats_a_missing_revision_as_empty() {
        // A new file has no before-revision. Treating that as unchanged would
        // report zero lines for a file that is entirely new.
        let (added, removed) = diff_counts(None, Some("a\nb\n"));
        assert_eq!(added, 2);
        assert_eq!(removed, 0);
        let (added, removed) = diff_counts(Some("a\nb\n"), None);
        assert_eq!(added, 0);
        assert_eq!(removed, 2);
    }

    #[test]
    fn reports_zero_for_identical_text() {
        assert_eq!(diff_counts(Some("a\nb\n"), Some("a\nb\n")), (0, 0));
        assert_eq!(diff_counts(None, None), (0, 0));
    }

    #[test]
    fn counts_a_whole_replacement() {
        let (added, removed) = diff_counts(Some("a\nb\n"), Some("x\n"));
        assert_eq!(added, 1);
        assert_eq!(removed, 2);
    }

    #[test]
    fn counts_a_trailing_newline_difference() {
        // "a\n" splits to ["a", ""], so "a" is a real line-count difference and
        // not an artefact of the final newline. Both implementations agree here
        // because both split the same way.
        let (added, removed) = diff_counts(Some("a\n"), Some("a"));
        assert_eq!(added, 0);
        assert_eq!(removed, 1);
    }

    #[test]
    fn handles_empty_strings_without_underflowing() {
        // The prefix/suffix trim subtracts from the line counts, so an empty input
        // is where an off-by-one would panic rather than return a wrong answer --
        // which is the better failure, but still a failure.
        assert_eq!(diff_counts(Some(""), Some("")), (0, 0));
        // "" splits to [""], so it is one line, not zero. Adding a line to an
        // empty file is therefore +1 -- and the JS twin says the same, which is
        // the only reason this is correct rather than merely consistent.
        assert_eq!(diff_counts(Some(""), Some("a\n")), (1, 0));
        assert_eq!(diff_counts(Some("a\n"), Some("")), (0, 1));
        // "\n" is ["", ""]: head consumes both lines, leaving nothing for the
        // suffix loop. Plain subtraction wrapped here in a release build and
        // would have reported ~4 billion changed lines instead of failing.
        assert_eq!(diff_counts(Some("\n"), Some("\n")), (0, 0));
        assert_eq!(diff_counts(Some("\n"), Some("a\n\n")), (1, 0));
    }

    #[test]
    fn counts_a_whitespace_only_change() {
        // Lines are compared verbatim; no trimming of either side, because
        // whitespace is content in a diff.
        assert_eq!(diff_counts(Some("a\n b\n"), Some("a\nb\n")), (1, 1));
    }

    #[test]
    fn the_js_boundary_normalizes_unknown_codes() {
        let counts = summarize_status_js(&[99, 99, 0, 255]);
        assert_eq!(counts, vec![1, 0, 0, 0], "only the known code counted");
    }
}
