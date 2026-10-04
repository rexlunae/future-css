//! fc-grid — grid, cell, and selection model for Office-like surfaces.
//!
//! # Why this is in Rust
//!
//! Rendering is not the expensive part of a large grid; the browser is good at
//! it, and virtualizing the DOM is a layout concern. The expensive part is the
//! arithmetic around it: which cells intersect a scroll viewport, how a selection
//! rectangle expands, how far a range extends past the last populated cell.
//! Those are pure integer computations that run per frame during scroll and per
//! keystroke during navigation -- exactly the tight loops where JS overhead
//! dominates.
//!
//! # What is deliberately absent
//!
//! **Formulas.** Spreadsheet formula evaluation is a dependency graph with cycle
//! detection, error propagation, and locale-dependent number formats -- tens of
//! thousands of lines with a large external dependency. Folding that in would
//! make this the largest module in the workspace and force every consumer of the
//! selection model to download it. It belongs in a separate crate and a separate
//! opt-in; see docs/WASM.md.
//!
//! **Rendering.** This crate never touches the DOM. It answers "what should be
//! visible"; the JS layer decides how.

use fc_core::FcError;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// A cell address. Row and column are zero-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CellRef {
    pub row: usize,
    pub col: usize,
}

impl CellRef {
    pub fn new(row: usize, col: usize) -> Self {
        Self { row, col }
    }
}

/// A rectangular selection, always stored normalized: `start` is the top-left
/// (row-major minimum) and `end` the bottom-right, whichever corner the user
/// dragged from.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellRange {
    pub start_row: usize,
    pub start_col: usize,
    pub end_row: usize,
    pub end_col: usize,
    /// Where the selection began, stored explicitly.
    ///
    /// Not derivable from the rectangle: normalization destroys it. Dragging
    /// down-and-right makes the anchor the top-left; dragging up-and-left makes
    /// it the bottom-right. Both are valid, and shift-arrow must extend from
    /// whichever one the user actually started at.
    #[serde(default)]
    anchor_row: usize,
    #[serde(default)]
    anchor_col: usize,
}

impl CellRange {
    /// Normalizes a possibly-inverted drag.
    ///
    /// Inversion is the normal case, not an error: dragging up-and-left from the
    /// anchor produces an inverted range by definition. Normalizing here means
    /// every downstream consumer can assume ordering.
    pub fn from_corners(a: CellRef, b: CellRef) -> Self {
        Self {
            start_row: a.row.min(b.row),
            start_col: a.col.min(b.col),
            end_row: a.row.max(b.row),
            end_col: a.col.max(b.col),
            // `a` is the drag origin, which is the anchor by definition.
            anchor_row: a.row,
            anchor_col: a.col,
        }
    }

    pub fn single(cell: CellRef) -> Self {
        Self {
            start_row: cell.row,
            start_col: cell.col,
            end_row: cell.row,
            end_col: cell.col,
            anchor_row: cell.row,
            anchor_col: cell.col,
        }
    }

    pub fn contains(&self, cell: CellRef) -> bool {
        cell.row >= self.start_row
            && cell.row <= self.end_row
            && cell.col >= self.start_col
            && cell.col <= self.end_col
    }

    pub fn row_count(&self) -> usize {
        self.end_row - self.start_row + 1
    }

    pub fn col_count(&self) -> usize {
        self.end_col - self.start_col + 1
    }

    /// Total cell count, saturating. WASM is a 32-bit platform, so a select-all
    /// on a large sheet can overflow `usize`; saturating is the honest answer
    /// because a number too large to count is not an actionable error.
    pub fn cell_count(&self) -> u64 {
        (self.row_count() as u64).saturating_mul(self.col_count() as u64)
    }


    /// A range with an explicit anchor, defaulting to the top-left corner.
    pub fn with_anchor(mut self, cell: CellRef) -> Self {
        self.anchor_row = cell.row;
        self.anchor_col = cell.col;
        self
    }

    /// The anchor cell.
    pub fn anchor(&self) -> CellRef {
        CellRef::new(self.anchor_row, self.anchor_col)
    }

    /// Extends to include `cell`, keeping the original anchor. This is
    /// shift-arrow behaviour: focus moves, the anchor does not.
    pub fn extend_to(&self, cell: CellRef) -> Self {
        Self::from_corners(self.anchor(), cell).with_anchor(self.anchor())
    }

    /// The cells, in row-major order.
    pub fn iter_cells(&self) -> Vec<CellRef> {
        // Preallocated: this runs per keystroke, and repeated growth of a large
        // vector is measurable in WASM, which has no generational GC to absorb it.
        let cap = self.cell_count().min(65_536) as usize;
        let mut out = Vec::with_capacity(cap);
        for row in self.start_row..=self.end_row {
            for col in self.start_col..=self.end_col {
                out.push(CellRef::new(row, col));
            }
        }
        out
    }
}

/// A scroll viewport in cell coordinates, with a render margin.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Viewport {
    pub first_row: usize,
    pub first_col: usize,
    pub rows: usize,
    pub cols: usize,
    /// Extra rows/cols rendered beyond the visible edge, to absorb scroll jitter.
    pub overscan: usize,
}

impl Viewport {
    /// The range of cells actually visible.
    pub fn visible_range(&self) -> CellRange {
        // Saturating so a viewport near the end of a huge sheet does not
        // overflow past the last row.
        CellRange::from_corners(
            CellRef::new(self.first_row, self.first_col),
            CellRef::new(
                self.first_row.saturating_add(self.rows.saturating_sub(1)),
                self.first_col.saturating_add(self.cols.saturating_sub(1)),
            ),
        )
    }

    /// The range to render, including overscan.
    pub fn render_range(&self) -> CellRange {
        let v = self.visible_range();
        CellRange::from_corners(
            CellRef::new(
                v.start_row.saturating_sub(self.overscan),
                v.start_col.saturating_sub(self.overscan),
            ),
            CellRef::new(
                v.end_row.saturating_add(self.overscan),
                v.end_col.saturating_add(self.overscan),
            ),
        )
    }

    /// The cell holding keyboard focus.
    pub fn active_cell(&self) -> CellRef {
        CellRef::new(self.first_row, self.first_col)
    }
}

/// A sparse grid of string cells.
///
/// Sparse because an Office-like document is mostly empty: a million-cell sheet
/// with 900k empty cells must not allocate a million `String`s.
#[wasm_bindgen]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Grid {
    cells: std::collections::HashMap<(usize, usize), String>,
}

impl Grid {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&mut self, cell: CellRef, value: String) {
        if value.is_empty() {
            // Storing an empty string would make "is this cell empty?" require a
            // value check, and every consumer would have to remember it.
            self.cells.remove(&(cell.row, cell.col));
        } else {
            self.cells.insert((cell.row, cell.col), value);
        }
    }

    pub fn get(&self, cell: CellRef) -> Option<&str> {
        self.cells.get(&(cell.row, cell.col)).map(String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    pub fn len(&self) -> usize {
        self.cells.len()
    }

    /// Number of populated cells inside a range.
    pub fn count_in(&self, range: CellRange) -> usize {
        self.cells
            .keys()
            .filter(|(r, c)| range.contains(CellRef::new(*r, *c)))
            .count()
    }

    /// Highest populated row + 1.
    pub fn used_rows(&self) -> usize {
        self.cells.keys().map(|(r, _)| r + 1).max().unwrap_or(0)
    }

    /// Highest populated column + 1.
    pub fn used_cols(&self) -> usize {
        self.cells.keys().map(|(_, c)| c + 1).max().unwrap_or(0)
    }

    /// Fills `count` rows below a cell with the same value.
    ///
    /// Auto-fill. Bounded by `max_rows` so a malformed argument cannot spin
    /// allocating millions of cells.
    pub fn fill_down(&mut self, from: CellRef, count: usize, max_rows: usize) -> Result<usize, FcError> {
        if count > max_rows {
            return Err(FcError::InvalidInput {
                message: format!("fill count {count} exceeds the {max_rows} row limit"),
            });
        }
        let Some(value) = self.get(from).map(str::to_string) else {
            return Err(FcError::InvalidInput {
                message: "fill source cell is empty".to_string(),
            });
        };
        for offset in 1..=count {
            self.set(CellRef::new(from.row + offset, from.col), value.clone());
        }
        Ok(count)
    }
}
// ---- JS bindings --------------------------------------------------------
//
// Ranges cross the boundary as flat `[startRow, startCol, endRow, endCol]`
// arrays rather than as objects. Flat arrays allocate less per crossing, and this
// runs once per keystroke in a large sheet.

fn range_to_js(r: CellRange) -> JsValue {
    let arr = js_sys::Array::new();
    arr.push(&JsValue::from_f64(r.start_row as f64));
    arr.push(&JsValue::from_f64(r.start_col as f64));
    arr.push(&JsValue::from_f64(r.end_row as f64));
    arr.push(&JsValue::from_f64(r.end_col as f64));
    arr.into()
}

#[wasm_bindgen]
impl CellRange {
    #[wasm_bindgen(js_name = fromCorners)]
    pub fn js_from_corners(r1: usize, c1: usize, r2: usize, c2: usize) -> CellRange {
        CellRange::from_corners(CellRef::new(r1, c1), CellRef::new(r2, c2))
    }

    #[wasm_bindgen(js_name = single)]
    pub fn js_single(row: usize, col: usize) -> CellRange {
        CellRange::single(CellRef::new(row, col))
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn js_to_array(&self) -> JsValue {
        range_to_js(*self)
    }

    #[wasm_bindgen(js_name = cellCount)]
    pub fn js_cell_count(&self) -> u64 {
        self.cell_count()
    }

    #[wasm_bindgen(js_name = contains)]
    pub fn js_contains(&self, row: usize, col: usize) -> bool {
        self.contains(CellRef::new(row, col))
    }

    /// `[[row, col], ...]` in row-major order.
    #[wasm_bindgen(js_name = cells)]
    pub fn js_cells(&self) -> Vec<JsValue> {
        self.iter_cells()
            .into_iter()
            .map(|c| {
                let pair = js_sys::Array::new();
                pair.push(&JsValue::from_f64(c.row as f64));
                pair.push(&JsValue::from_f64(c.col as f64));
                pair.into()
            })
            .collect()
    }
}

#[wasm_bindgen]
impl Viewport {
    #[wasm_bindgen(js_name = new)]
    #[allow(clippy::too_many_arguments)]
    pub fn js_new(
        first_row: usize,
        first_col: usize,
        rows: usize,
        cols: usize,
        overscan: usize,
    ) -> Viewport {
        Viewport { first_row, first_col, rows, cols, overscan }
    }

    #[wasm_bindgen(js_name = visibleRange)]
    pub fn js_visible_range(&self) -> JsValue {
        range_to_js(self.visible_range())
    }

    #[wasm_bindgen(js_name = renderRange)]
    pub fn js_render_range(&self) -> JsValue {
        range_to_js(self.render_range())
    }
}

#[wasm_bindgen]
impl Grid {
    #[wasm_bindgen(constructor)]
    pub fn js_new() -> Grid {
        Grid::new()
    }

    #[wasm_bindgen(js_name = set)]
    pub fn js_set(&mut self, row: usize, col: usize, value: String) {
        self.set(CellRef::new(row, col), value);
    }

    #[wasm_bindgen(js_name = get)]
    pub fn js_get(&self, row: usize, col: usize) -> Option<String> {
        self.get(CellRef::new(row, col)).map(str::to_string)
    }

    #[wasm_bindgen(js_name = cellCount)]
    pub fn js_len(&self) -> usize {
        self.len()
    }

    #[wasm_bindgen(js_name = usedRows)]
    pub fn js_used_rows(&self) -> usize {
        self.used_rows()
    }

    #[wasm_bindgen(js_name = usedCols)]
    pub fn js_used_cols(&self) -> usize {
        self.used_cols()
    }

    #[wasm_bindgen(js_name = fillDown)]
    pub fn js_fill_down(
        &mut self,
        row: usize,
        col: usize,
        count: usize,
        max_rows: usize,
    ) -> Result<usize, JsValue> {
        self.fill_down(CellRef::new(row, col), count, max_rows).map_err(Into::into)
    }

    /// `count` populated cells inside a range.
    #[wasm_bindgen(js_name = countIn)]
    pub fn js_count_in(&self, r1: usize, c1: usize, r2: usize, c2: usize) -> usize {
        self.count_in(CellRange::from_corners(CellRef::new(r1, c1), CellRef::new(r2, c2)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(row: usize, col: usize) -> CellRef {
        CellRef::new(row, col)
    }

    #[test]
    fn drag_is_normalized_regardless_of_direction() {
        // Dragging up-and-left is the normal case, not an error.
        let up_left = CellRange::from_corners(cell(5, 5), cell(1, 1));
        assert_eq!(
            (up_left.start_row, up_left.start_col, up_left.end_row, up_left.end_col),
            (1, 1, 5, 5)
        );
    }

    #[test]
    fn single_cell_range_counts_one() {
        let r = CellRange::single(cell(3, 3));
        assert_eq!(r.cell_count(), 1);
        assert_eq!(r.row_count(), 1);
        assert_eq!(r.col_count(), 1);
    }

    #[test]
    fn range_dimensions_are_inclusive() {
        // Rows 0..=4 is five rows, not four. Off-by-one here is the classic
        // spreadsheet bug where the last row is unreachable.
        let r = CellRange::from_corners(cell(0, 0), cell(4, 4));
        assert_eq!(r.row_count(), 5);
        assert_eq!(r.col_count(), 5);
        assert_eq!(r.cell_count(), 25);
    }

    #[test]
    fn contains_respects_bounds() {
        let r = CellRange::from_corners(cell(1, 1), cell(3, 3));
        assert!(r.contains(cell(1, 1)), "top-left corner is inside");
        assert!(r.contains(cell(3, 3)), "bottom-right corner is inside");
        assert!(!r.contains(cell(0, 1)), "above is outside");
        assert!(!r.contains(cell(4, 3)), "below is outside");
    }

    #[test]
    fn extending_keeps_the_anchor() {
        // shift-arrow: focus moves, the anchor does not.
        let base = CellRange::single(cell(5, 5));
        let extended = base.extend_to(cell(2, 8));
        assert_eq!(extended.anchor(), cell(5, 5), "anchor must not move");
        assert_eq!((extended.end_row, extended.end_col), (5, 8));
    }

    #[test]
    fn extending_upward_still_produces_an_ordered_range() {
        let extended = CellRange::single(cell(5, 5)).extend_to(cell(2, 2));
        assert_eq!((extended.start_row, extended.start_col), (2, 2));
        assert_eq!((extended.end_row, extended.end_col), (5, 5));
    }

    #[test]
    fn huge_range_does_not_overflow() {
        // WASM is 32-bit; u32::MAX squared must saturate, not wrap to a small
        // or negative-looking number.
        let huge = CellRange::from_corners(
            CellRef::new(0, 0),
            CellRef::new(usize::MAX - 1, usize::MAX - 1),
        );
        assert_eq!(huge.cell_count(), u64::MAX);
    }

    #[test]
    fn cells_enumerate_in_row_major_order() {
        let r = CellRange::from_corners(cell(0, 0), cell(1, 1));
        let cells = r.iter_cells();
        assert_eq!(cells.len(), 4);
        assert_eq!(cells[0], cell(0, 0));
        assert_eq!(cells[1], cell(0, 1));
        assert_eq!(cells[2], cell(1, 0));
        assert_eq!(cells[3], cell(1, 1));
    }

    #[test]
    fn viewport_visible_range_is_sized_correctly() {
        let vp = Viewport { first_row: 10, first_col: 5, rows: 20, cols: 4, overscan: 2 };
        let v = vp.visible_range();
        assert_eq!((v.start_row, v.end_row), (10, 29), "20 rows inclusive");
        assert_eq!((v.start_col, v.end_col), (5, 8), "4 cols inclusive");
    }

    #[test]
    fn viewport_overscan_expands_but_clamps_at_zero() {
        let vp = Viewport { first_row: 1, first_col: 1, rows: 10, cols: 10, overscan: 5 };
        // Subtracting 5 from row 1 must not wrap to a huge usize.
        assert_eq!(vp.render_range().start_row, 0);
    }

    #[test]
    fn zero_sized_viewport_does_not_underflow() {
        // rows: 0 would make `rows - 1` wrap without saturating_sub.
        let vp = Viewport { first_row: 5, first_col: 5, rows: 0, cols: 0, overscan: 0 };
        let v = vp.visible_range();
        assert_eq!(v.end_row, 5);
        assert_eq!(v.end_col, 5);
    }

    #[test]
    fn sparse_grid_stores_only_populated_cells() {
        let mut g = Grid::new();
        assert!(g.is_empty());
        g.set(cell(1000, 1000), "x".into());
        assert_eq!(g.len(), 1, "one cell must not imply a million allocations");
        assert_eq!(g.used_rows(), 1001);
        assert_eq!(g.used_cols(), 1001);
    }

    #[test]
    fn setting_an_empty_value_removes_the_cell() {
        let mut g = Grid::new();
        g.set(cell(0, 0), "x".into());
        g.set(cell(0, 0), String::new());
        assert!(g.is_empty(), "an empty cell must not be stored");
        assert_eq!(g.get(cell(0, 0)), None);
    }

    #[test]
    fn count_in_counts_only_cells_inside_the_range() {
        let mut g = Grid::new();
        g.set(cell(0, 0), "a".into());
        g.set(cell(1, 1), "b".into());
        g.set(cell(9, 9), "c".into());
        assert_eq!(g.count_in(CellRange::from_corners(cell(0, 0), cell(1, 1))), 2);
        assert_eq!(g.count_in(CellRange::from_corners(cell(0, 0), cell(4, 4))), 2);
        assert_eq!(g.count_in(CellRange::from_corners(cell(5, 5), cell(6, 6))), 0);
    }

    #[test]
    fn fill_down_copies_the_source_value() {
        let mut g = Grid::new();
        g.set(cell(0, 0), "seed".into());
        assert_eq!(g.fill_down(cell(0, 0), 3, 100).unwrap(), 3);
        assert_eq!(g.get(cell(1, 0)), Some("seed"));
        assert_eq!(g.get(cell(3, 0)), Some("seed"));
        assert_eq!(g.get(cell(4, 0)), None, "must not overshoot the requested count");
    }

    #[test]
    fn fill_down_from_an_empty_cell_is_an_error() {
        let mut g = Grid::new();
        assert_eq!(
            g.fill_down(cell(0, 0), 5, 100).unwrap_err().kind(),
            "invalidInput"
        );
    }

    #[test]
    fn fill_down_is_bounded() {
        // A malformed count must not spin allocating millions of cells.
        let mut g = Grid::new();
        g.set(cell(0, 0), "x".into());
        assert_eq!(g.fill_down(cell(0, 0), 10_000_000, 1000).unwrap_err().kind(), "invalidInput");
    }
}
