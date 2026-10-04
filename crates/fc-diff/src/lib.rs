//! fc-diff — line diffing, Myers' O(ND) algorithm.
//!
//! # Why this is in Rust and what that buys
//!
//! A diff is the one place in this system where the cost is superlinear in the
//! input. Myers is O(ND) rather than the O(N*M) a dynamic-programming table
//! would need, but on a 20,000-line file that is still ~400M comparisons in
//! JavaScript's worst case. In Rust the same walk is memory-safe, allocation-free
//! on the hot path, and roughly an order of magnitude faster — which is what
//! makes live diffing while a user types viable at all.
//!
//! # The invariants, and why they are the whole contract
//!
//! A diff that is subtly wrong is worse than no diff: a reviewer cannot tell a
//! missing line from a mis-attributed one. Two properties are therefore asserted
//! on every test case rather than described:
//!
//!   1. **Reconstruction.** Dropping the `Add` lines reproduces the original;
//!      dropping the `Remove` lines reproduces the revision. This single property
//!      catches every possible backtracking off-by-one at once.
//!   2. **Text preservation.** No line's text is altered, only its attribution.
//!
//! # Line numbers are 1-based
//!
//! What a human reads, and what `git blame` prints. The algorithm works in
//! 0-based indices internally; the conversion is part of the public contract.
//! `None` means the line does not exist on that side, and callers must render
//! nothing rather than 0 — inventing a line number is how a reviewer is misled
//! about where a change landed.

use std::cmp::min;

/// How a line relates to the other side of the diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffKind {
    /// Present in both inputs, unchanged.
    Equal,
    /// Present only in the revision.
    Add,
    /// Present only in the original.
    Remove,
}

impl DiffKind {
    /// The wire encoding: a single character, so the JS side can rebuild the
    /// label without a table lookup.
    pub fn as_str(self) -> &'static str {
        match self {
            DiffKind::Equal => "equal",
            DiffKind::Add => "add",
            DiffKind::Remove => "remove",
        }
    }
}

/// One line of output. `old_line`/`new_line` are 1-based, or `None` when the
/// line does not exist on that side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: DiffKind,
    pub text: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

/// Counts for a diff header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiffStats {
    pub added: u32,
    pub removed: u32,
    pub identical: bool,
}

/// One step of the greedy walk, before backtracking recovers the edit script.
#[derive(Debug, Clone, Copy)]
struct Step {
    kind: DiffKind,
    a_index: usize,
    b_index: usize,
}

/// Split text into lines, without a phantom trailing empty line.
///
/// An empty input has *no* lines, not one empty line. Treating it as one makes
/// "created a file" render as "emptied an existing file", which is a
/// materially different (and wrong) story to a reviewer.
pub fn split_lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.strip_suffix('\n').unwrap_or(&normalized);
    trimmed.split('\n').map(str::to_string).collect()
}

/// Compute a line diff between two texts.
pub fn diff_lines(before: &str, after: &str) -> Vec<DiffLine> {
    let a = split_lines(before);
    let b = split_lines(after);

    let steps = myers(&a, &b);

    // Attach 1-based line numbers as the steps are emitted, so a removed line
    // reports only its old number and an added line only its new one.
    let mut out = Vec::with_capacity(steps.len());
    let mut old_no: u32 = 1;
    let mut new_no: u32 = 1;
    for step in steps {
        let (old_line, new_line) = match step.kind {
            DiffKind::Equal => {
                let pair = (Some(old_no), Some(new_no));
                old_no += 1;
                new_no += 1;
                pair
            }
            DiffKind::Remove => {
                let pair = (Some(old_no), None);
                old_no += 1;
                pair
            }
            DiffKind::Add => {
                let pair = (None, Some(new_no));
                new_no += 1;
                pair
            }
        };
        out.push(DiffLine {
            kind: step.kind,
            text: step_text(&a, &b, &step).to_string(),
            old_line,
            new_line,
        });
    }
    out
}

fn step_text<'a>(a: &'a [String], b: &'a [String], step: &Step) -> &'a str {
    match step.kind {
        DiffKind::Equal | DiffKind::Remove => a[step.a_index].as_str(),
        DiffKind::Add => b[step.b_index].as_str(),
    }
}

/// Counts for a diff header.
pub fn diff_stats(lines: &[DiffLine]) -> DiffStats {
    let mut added = 0;
    let mut removed = 0;
    for line in lines {
        match line.kind {
            DiffKind::Add => added += 1,
            DiffKind::Remove => removed += 1,
            DiffKind::Equal => {}
        }
    }
    DiffStats {
        added,
        removed,
        identical: added == 0 && removed == 0,
    }
}

/// Myers' greedy walk.
///
/// `v[k]` holds, for each diagonal `k`, the furthest `x` reached. Each step
/// extends the walk down `k` (a deletion) or up (an insertion) and takes
/// whichever reaches further — the greedy choice that makes this O(ND) rather
/// than O(N*M). The per-step trace is what `backtrack` needs to recover the
/// edit script.
fn myers(a: &[String], b: &[String]) -> Vec<Step> {
    let n = a.len();
    let m = b.len();
    if n == 0 {
        return (0..m)
            .map(|j| Step { kind: DiffKind::Add, a_index: 0, b_index: j })
            .collect();
    }
    if m == 0 {
        return (0..n)
            .map(|i| Step { kind: DiffKind::Remove, a_index: i, b_index: 0 })
            .collect();
    }

    let max = n + m;
    let offset = max as i32;
    // Indexed by diagonal k, stored at k + offset so negative k is a valid index.
    let mut v: Vec<i32> = vec![0i32; 2 * max + 1];
    let mut trace: Vec<Vec<i32>> = Vec::with_capacity(min(max, 4096));

    for d in 0..=max as i32 {
        trace.push(v.clone());
        let mut k = -d;
        while k <= d {
            let idx = (k + offset) as usize;
            let down = (k + 1 + offset) as usize;
            let right = (k - 1 + offset) as usize;
            let mut x = if k == -d || (k != d && v[right] < v[down]) {
                v[down]
            } else {
                v[right] + 1
            };
            let mut y = x - k;
            while (x as usize) < n && (y as usize) < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[idx] = x;
            if x as usize >= n && y as usize >= m {
                /*
                 * The endpoint must come from the live `v`, not from `trace[d]`.
                 *
                 * `trace[d]` was pushed *before* this step ran, so it holds the
                 * state after step d-1. Reading the start position from it walks
                 * the path back from the wrong place: equal lines get
                 * mis-attributed to inserts and deletes, and the reconstruction
                 * invariant fails silently. This was a real bug in the JS twin.
                 */
                return backtrack(&trace, d, offset, x, y);
            }
            k += 2;
        }
    }
    // Unreachable: d == n + m always reaches the corner, and both degenerate
    // cases are handled by the guards above.
    Vec::new()
}

/// Walk the recorded trace backwards to recover the edit script.
///
/// A diagonal step can cover several equal lines, so the inner loop walks back
/// along the diagonal first and only then attributes the single remaining step
/// to an insert or delete. Getting that order wrong is what drops unchanged
/// lines from the output.
fn backtrack(trace: &[Vec<i32>], d: i32, offset: i32, end_x: i32, end_y: i32) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut x = end_x;
    let mut y = end_y;

    /*
     * Mirrors the JS twin step for step, because a divergence here is the worst
     * bug this system can have: users get correct results on one path and wrong
     * results on the other with no way to tell.
     *
     * Two details are load-bearing and were wrong in the first Rust draft:
     *   - the state read is `trace[step]`, not `trace[step - 1]`;
     *   - the coordinates are decremented when the step is pushed, so `x`/`y`
     *     always describe the next position to compare, not the last consumed.
     * Getting the second wrong duplicates the boundary step, which showed up as
     * a spurious leading `add` and shifted every line number after it.
     */
    for step in (1..=d).rev() {
        let v = &trace[step as usize];
        let k = x - y;
        // Which diagonal the previous step came from: k+1 means an insertion
        // (the walk moved down in b), k-1 a deletion. `k == -step` has only one
        // predecessor, so it short-circuits.
        let prev_k = if k == -step
            || (k != step && v[(k - 1 + offset) as usize] < v[(k + 1 + offset) as usize])
        {
            k + 1
        } else {
            k - 1
        };
        let prev_x = v[(prev_k + offset) as usize];
        let prev_y = prev_x - prev_k;

        // Every diagonal position between prev and current is an equal line.
        while x > prev_x && y > prev_y {
            steps.push(Step {
                kind: DiffKind::Equal,
                a_index: (x - 1) as usize,
                b_index: (y - 1) as usize,
            });
            x -= 1;
            y -= 1;
        }
        if x == prev_x {
            steps.push(Step { kind: DiffKind::Add, a_index: x as usize, b_index: (y - 1) as usize });
            y -= 1;
        } else {
            steps.push(Step {
                kind: DiffKind::Remove,
                a_index: (x - 1) as usize,
                b_index: y as usize,
            });
            x -= 1;
        }
    }

    // Anything left at the origin is an equal line.
    while x > 0 && y > 0 {
        steps.push(Step {
            kind: DiffKind::Equal,
            a_index: (x - 1) as usize,
            b_index: (y - 1) as usize,
        });
        x -= 1;
        y -= 1;
    }

    steps.reverse();
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The invariant that makes a diff trustworthy, and the reason the JS twin
    /// carries the same test: dropping the added lines must reproduce the
    /// original, and dropping the removed lines must reproduce the revision.
    /// This one property catches every possible backtracking off-by-one.
    fn reconstruct(lines: &[DiffLine]) -> (String, String) {
        let before = lines
            .iter()
            .filter(|l| l.kind != DiffKind::Add)
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let after = lines
            .iter()
            .filter(|l| l.kind != DiffKind::Remove)
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        (before, after)
    }

    fn cases() -> Vec<(&'static str, &'static str, &'static str)> {
        vec![
            ("single change", "a\nb\nc", "a\nx\nc"),
            ("from empty", "", "new"),
            ("to empty", "gone", ""),
            ("both empty", "", ""),
            ("identical", "same", "same"),
            ("middle edit", "a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nX\nY\ne\nf\ng\nh"),
            ("reversed", "1\n2\n3\n4\n5", "5\n4\n3\n2\n1"),
            ("blank lines removed", "a\n\n\nb", "a\nb"),
            ("duplicated", "x", "x\nx\nx"),
            ("full replace", "l1\nl2", "totally\ndifferent\ncontent\nhere"),
        ]
    }

    #[test]
    fn reconstructs_both_sides() {
        for (name, before, after) in cases() {
            let lines = diff_lines(before, after);
            let (rebuilt_before, rebuilt_after) = reconstruct(&lines);
            assert_eq!(rebuilt_before, split_lines(before).join("\n"), "{name}: before");
            assert_eq!(rebuilt_after, split_lines(after).join("\n"), "{name}: after");
        }
    }

    #[test]
    fn empty_input_is_not_one_empty_line() {
        // "" .split('\n') is [""], so an empty file used to diff as a removal --
        // making "created a file" render as "emptied an existing one".
        assert!(split_lines("").is_empty());
        let stats = diff_stats(&diff_lines("", "new"));
        assert_eq!(stats.added, 1);
        assert_eq!(stats.removed, 0);
    }

    #[test]
    fn trailing_newline_is_a_terminator() {
        assert_eq!(split_lines("a\n").len(), 1);
    }

    #[test]
    fn normalizes_crlf() {
        let lines = diff_lines("a\r\nb", "a\r\nc");
        assert!(!lines.iter().any(|l| l.text.contains('\r')));
        assert_eq!(
            lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(","),
            "a,b,c"
        );
    }

    #[test]
    fn reports_accurate_counts() {
        let stats = diff_stats(&diff_lines("a\nb\nc", "a\nc\nd\ne"));
        assert_eq!(stats.added, 2);
        assert_eq!(stats.removed, 1);
        assert!(!stats.identical);
        assert!(diff_stats(&diff_lines("a", "a")).identical);
    }

    #[test]
    fn line_numbers_are_one_based_and_absent_on_the_missing_side() {
        let lines = diff_lines("a", "a\nb");
        let added = lines.iter().find(|l| l.kind == DiffKind::Add).unwrap();
        assert_eq!(added.old_line, None, "never invent a number for a line that was never there");
        assert_eq!(added.new_line, Some(2));
    }

    #[test]
    fn handles_a_large_file_with_a_small_edit() {
        // The reason for Myers over a DP table: O(ND), not O(N*M) in time and
        // memory. A 20k-line file with one changed line must stay fast.
        let big: String = (0..20_000).map(|i| format!("line {i}\n")).collect();
        let edited = big.replacen("line 10000", "line 10000 CHANGED", 1);
        let stats = diff_stats(&diff_lines(&big, &edited));
        assert_eq!(stats.added, 1);
        assert_eq!(stats.removed, 1);
    }
}
