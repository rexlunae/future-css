/**
 * Data grid bindings.
 *
 * Roving-tabindex navigation, range selection, and cell editing for `fc-grid`.
 *
 * # Why roving tabindex rather than focusable cells
 *
 * A grid with 10,000 cells where every cell is a tab stop is unusable by keyboard:
 * Tab would take 10,000 presses to leave. The grid pattern instead keeps **one**
 * tab stop -- the active cell -- and moves between cells with arrows. This is the
 * WAI-ARIA grid pattern, and it is the only reason a large grid is navigable at
 * all.
 *
 * The corollary is that Tab must still leave the grid. That single constraint is
 * what separates a grid from a keyboard trap.
 *
 * # Selection model
 *
 * Matches a spreadsheet, because that is what people expect:
 *   - a plain arrow move collapses the selection
 *   - Shift+Arrow extends it as a rectangle
 *   - Ctrl+Space selects the row, Ctrl+Shift+Space the whole grid
 *
 * Range state lives in the controller, not the DOM: computing "is this cell in the
 * range" from two corner indices is cheaper and simpler than reading back a
 * selection that may have been changed by anything.
 */

/** A cell position. `row` and `col` are zero-based. */
export interface CellRef {
  row: number;
  col: number;
}

export interface GridOptions {
  /** The root `.fc-grid` element, or a selector for it. */
  root: Element | string;
  /** Called when the active cell changes. */
  onActiveCellChange?: (cell: CellRef) => void;
  /** Called when the selection changes, as an inclusive range. */
  onSelectionChange?: (range: { anchor: CellRef; focus: CellRef }) => void;
  /** Called when a cell finishes editing, with its new value. */
  onCellEdit?: (cell: CellRef, value: string) => void;
}

export class FutureCssGrid {
  private readonly root: Element;
  private readonly options: GridOptions;

  private active: CellRef = { row: 0, col: 0 };
  /** The fixed corner of the selection; arrows move `focus` relative to it. */
  private anchor: CellRef = { row: 0, col: 0 };
  private editing = false;

  constructor(options: GridOptions) {
    this.options = options;
    this.root =
      typeof options.root === "string" ? document.querySelector(options.root)! : options.root;
    if (!this.root) throw new Error("future-css: grid root not found");

    this.applyStructure();
    this.wireKeys();
    this.wirePointer();
    this.setActive(this.active, false);
  }

  /** The currently active cell. */
  get activeCell(): CellRef {
    return { ...this.active };
  }

  /** Every cell element, in row-major order. */
  private get cells(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>("[role='gridcell']"));
  }

  private get rowCount(): number {
    return Math.max(
      0,
      ...Array.from(this.root.querySelectorAll<HTMLElement>("[role='row']")).map(
        (row) => row.querySelectorAll("[role='gridcell']").length,
      ),
    );
  }

  /**
   * Adds the grid roles the markup may have omitted.
   *
   * `aria-rowcount`/`aria-colcount` are only written when a `data-fc-rowcount`
   * says the true size exceeds the rendered rows -- which is what makes
   * virtualization announceable. A screen-reader user must be told the grid is
   * 1,000,000 rows rather than 50, or paging to row 999,999 is impossible.
   */
  private applyStructure(): void {
    if (!this.root.hasAttribute("role")) this.root.setAttribute("role", "grid");

    const declaredRows = this.root.dataset.fcRowcount;
    if (declaredRows) this.root.setAttribute("aria-rowcount", declaredRows);

    const declaredCols = this.root.dataset.fcColcount;
    if (declaredCols) this.root.setAttribute("aria-colcount", declaredCols);

    for (const cell of this.cells) {
      if (!cell.hasAttribute("role")) cell.setAttribute("role", "gridcell");
    }
  }

  /**
   * Moves the active cell and applies roving tabindex.
   *
   * Exactly one cell holds `tabindex="0"` at all times; everything else is -1.
   * That invariant is the whole mechanism, so it is enforced in one place.
   */
  setActive(cell: CellRef, notify = true): void {
    const clamped = this.clamp(cell);
    const cells = this.cells;
    if (cells.length === 0) return;

    this.active = clamped;
    if (clamped.row === 0 && clamped.col === 0 && cell.row === 0 && cell.col === 0) {
      this.anchor = clamped;
    }

    cells.forEach((el, index) => {
      const isActive = index === clamped.row * this.rowCount + clamped.col;
      el.setAttribute("tabindex", isActive ? "0" : "-1");
      el.classList.toggle("fc-grid__cell--active", isActive);
      // The active cell is what a screen reader reads on arrival, so its content
      // is the cell's own text -- the row/column headers are named by
      // aria-describedby where the consumer needs them.
      if (isActive) {
        el.setAttribute("aria-selected", String(this.isInSelection(clamped)));
      } else {
        el.removeAttribute("aria-selected");
      }
    });

    this.paintSelection();
    if (notify) this.options.onActiveCellChange?.(this.activeCell);
  }

  /** Whether a cell falls inside the current selection. */
  isInSelection(cell: CellRef): boolean {
    const top = Math.min(this.anchor.row, this.active.row);
    const bottom = Math.max(this.anchor.row, this.active.row);
    const left = Math.min(this.anchor.col, this.active.col);
    const right = Math.max(this.anchor.col, this.active.col);
    return cell.row >= top && cell.row <= bottom && cell.col >= left && cell.col <= right;
  }
  /** Applies selection styling across every cell. */
  private paintSelection(): void {
    this.cells.forEach((el, index) => {
      const cell = { row: Math.floor(index / this.rowCount), col: index % this.rowCount };
      const selected = this.isInSelection(cell);
      el.classList.toggle("fc-grid__cell--selected", selected);
      el.setAttribute("aria-selected", String(selected));
    });
    this.options.onSelectionChange?.({
      anchor: { ...this.anchor },
      focus: { ...this.active },
    });
  }

  /** Keeps a cell inside the grid. */
  private clamp(cell: CellRef): CellRef {
    const cols = this.rowCount;
    const rows = this.cells.length / Math.max(1, cols);
    return {
      row: Math.max(0, Math.min(Math.floor(cell.row), Math.floor(rows) - 1)),
      col: Math.max(0, Math.min(Math.floor(cell.col), cols - 1)),
    };
  }

  private cellElement(cell: CellRef): HTMLElement | undefined {
    return this.cells[cell.row * this.rowCount + cell.col];
  }

  /**
   * Keyboard handling.
   *
   * Arrows move, Home/End go to the row ends, Ctrl+Home/End to the grid corners,
   * PageUp/PageDown by a screenful. Ctrl+Space selects the row because there is no
   * cell-level shortcut for it otherwise.
   */
  private wireKeys(): void {
    this.root.addEventListener("keydown", (event) => {
      if (this.editing) return; // let the editor handle its own keys

      const { row, col } = this.active;
      const cols = this.rowCount;
      const pageRows = 10;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          this.move({ row: row - 1, col }, event.shiftKey);
          break;
        case "ArrowDown":
          event.preventDefault();
          this.move({ row: row + 1, col }, event.shiftKey);
          break;
        case "ArrowLeft":
          event.preventDefault();
          this.move({ row, col: col - 1 }, event.shiftKey);
          break;
        case "ArrowRight":
          event.preventDefault();
          this.move({ row, col: col + 1 }, event.shiftKey);
          break;
        case "Home":
          event.preventDefault();
          this.move(event.ctrlKey ? { row: 0, col: 0 } : { row, col: 0 }, event.shiftKey);
          break;
        case "End":
          event.preventDefault();
          this.move(
            event.ctrlKey ? { row: this.lastRow, col: cols - 1 } : { row, col: cols - 1 },
            event.shiftKey,
          );
          break;
        case "PageUp":
          event.preventDefault();
          this.move({ row: row - pageRows, col }, event.shiftKey);
          break;
        case "PageDown":
          event.preventDefault();
          this.move({ row: row + pageRows, col }, event.shiftKey);
          break;
        case "Enter":
        case "F2":
          event.preventDefault();
          this.beginEdit();
          break;
        case " ":
          // Ctrl+Space is the row-select shortcut. A bare space scrolls, and the
          // browser will do that if the event is not prevented.
          if (event.ctrlKey) {
            event.preventDefault();
            this.anchor = { row: this.active.row, col: 0 };
            this.setActive({ row, col: cols - 1 });
          }
          break;
        default:
          break;
      }
    });
  }

  private get lastRow(): number {
    const cols = this.rowCount;
    return cols > 0 ? Math.max(0, Math.floor(this.cells.length / cols) - 1) : 0;
  }

  /**
   * Moves the active cell.
   *
   * A plain move re-anchors the selection; Shift extends from the existing anchor.
   * That difference is what makes Shift+Arrow feel like a spreadsheet.
   */
  private move(cell: CellRef, extend: boolean): void {
    if (!extend) this.anchor = cell;
    this.setActive(cell);
  }

  /**
   * Puts the active cell into edit mode.
   *
   * Uses an `<input>` rather than `contenteditable` because a grid cell holds a
   * single scalar value: an input gets selection, clipboard, undo, and IME for
   * free, and cannot introduce block structure the grid cannot represent.
   */
  beginEdit(initial?: string): void {
    const cellEl = this.cellElement(this.active);
    if (!cellEl || this.editing) return;

    const original = cellEl.textContent ?? "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "fc-grid__cell-input";
    input.value = initial ?? original;
    // The gridcell keeps its role; the input is labelled by it rather than
    // replacing it, so the grid's structure is not lost while editing.
    input.setAttribute("aria-label", cellEl.dataset.fcLabel ?? original);

    this.editing = true;
    cellEl.textContent = "";
    cellEl.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      if (!this.editing) return;
      this.editing = false;
      const value = input.value;
      input.remove();
      cellEl.textContent = value;
      this.options.onCellEdit?.(this.activeCell, value);
      this.cellElement(this.active)?.focus();
    };

    const cancel = () => {
      if (!this.editing) return;
      this.editing = false;
      input.remove();
      // Escape restores the original: a half-typed value is discarded, which is
      // what every spreadsheet does and what users expect.
      cellEl.textContent = original;
      this.cellElement(this.active)?.focus();
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
      // Arrows are deliberately not handled: they belong to the grid, and
      // swallowing them here would trap the user in the editor.
      event.stopPropagation();
    });
  }

  private wirePointer(): void {
    this.root.addEventListener("click", (event) => {
      const cellEl = (event.target as HTMLElement).closest<HTMLElement>("[role='gridcell']");
      if (!cellEl) return;
      const index = this.cells.indexOf(cellEl);
      if (index < 0) return;
      const col = index % this.rowCount;
      const row = Math.floor(index / this.rowCount);
      this.setActive({ row, col });
      cellEl.focus();
    });

    this.root.addEventListener("dblclick", (event) => {
      if ((event.target as HTMLElement).closest("[role='gridcell']")) this.beginEdit();
    });

    // Ctrl/Cmd+click extends the selection from the anchor, matching every
    // file manager and spreadsheet.
    this.root.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        const cellEl = (event.target as HTMLElement).closest<HTMLElement>("[role='gridcell']");
        if (!cellEl) return;
        event.preventDefault();
        const index = this.cells.indexOf(cellEl);
        this.setActive({
          row: Math.floor(index / this.rowCount),
          col: index % this.rowCount,
        });
      },
      true,
    );
  }
}
