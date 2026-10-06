/**
 * Data table bindings.
 *
 * Wires the `.fc-table__sort` buttons in an `fc-table` header: activating one
 * sorts by that column, moves `aria-sort` to its header, and reorders the body
 * rows. `aria-sort` is the only state, so the arrow, the emphasis, and what a
 * screen reader announces cannot disagree.
 *
 * # Things that are easy to get wrong
 *
 * **Only one header carries `aria-sort`.** APG sortable tables mark the sorted
 * column and leave the rest unmarked; `aria-sort="none"` on every other header
 * makes some screen readers announce "not sorted" on each one.
 *
 * **Numbers sort as numbers, and text sorts by the reader's language.** A
 * column of "9, 10, 100" must not come out "10, 100, 9", and "Ångström" sorts
 * differently in Swedish than in English. Values are compared numerically when
 * both parse, otherwise with `Intl.Collator` in the table's own `lang`.
 *
 * **What is shown is not always what sorts.** "3 min ago" or "12.5 KB" sort
 * wrong as text. A cell's `data-fc-sort-value` overrides its text for sorting,
 * which also gives a machine reader the raw value.
 *
 * **Sorting is stable.** Rows that compare equal keep their previous order, so
 * sorting by status after sorting by name groups each status alphabetically.
 *
 * With `mode: "manual"` the binding only moves `aria-sort` and reports the
 * request through `onSort`, for tables whose rows come from a server.
 */

export type SortDirection = "ascending" | "descending";

export interface TableOptions {
  /** "client" reorders the rows; "manual" only updates aria-sort and calls onSort. */
  mode?: "client" | "manual";
  /** Called after a sort with the column index and direction. */
  onSort?: (column: number, direction: SortDirection) => void;
}

/** The instance `bindTables` created for each table, which alone may clear its marker. */
const markerOwner = new WeakMap<HTMLTableElement, FutureCssTable>();

export class FutureCssTable {
  private readonly table: HTMLTableElement;
  private readonly options: TableOptions;
  private readonly onClick = (event: MouseEvent) => this.handleClick(event);

  constructor(root: HTMLTableElement | HTMLElement | string, options: TableOptions = {}) {
    const el = typeof root === "string" ? document.querySelector<HTMLElement>(root) : root;
    if (!el) throw new Error(`FutureCssTable: no element for ${String(root)}`);
    const table = el instanceof HTMLTableElement ? el : el.querySelector("table");
    if (!table) throw new Error("FutureCssTable: no <table> at or inside the root");
    this.table = table;
    this.options = options;
    this.table.tHead?.addEventListener("click", this.onClick);
  }

  /** The header cells of the last header row, which own the sort buttons. */
  get headers(): HTMLTableCellElement[] {
    const rows = this.table.tHead?.rows;
    const row = rows?.[rows.length - 1];
    return row ? [...row.cells] : [];
  }

  /** The sorted column and its direction, or null when unsorted. */
  get sorted(): { column: number; direction: SortDirection } | null {
    const column = this.headers.findIndex((th) => th.hasAttribute("aria-sort"));
    if (column === -1) return null;
    const value = this.headers[column]!.getAttribute("aria-sort");
    if (value !== "ascending" && value !== "descending") return null;
    return { column, direction: value };
  }

  /**
   * Sorts by a column. With no direction, a column already sorted ascending
   * flips to descending; anything else starts ascending.
   */
  sort(column: number, direction?: SortDirection): void {
    const headers = this.headers;
    const target = headers[column];
    if (!target) return;
    const current = this.sorted;
    const dir: SortDirection =
      direction ?? (current?.column === column && current.direction === "ascending" ? "descending" : "ascending");

    for (const th of headers) {
      if (th === target) th.setAttribute("aria-sort", dir);
      else th.removeAttribute("aria-sort");
    }

    if (this.options.mode !== "manual") this.reorder(target.cellIndex, dir);
    this.options.onSort?.(column, dir);
  }

  /**
   * Removes listeners, and releases the bound marker if `bindTables` gave it to
   * this instance, so the table can be bound again. Safe to call twice: a stale
   * instance never clears the marker of a newer binding. Rows stay in their
   * last sorted order.
   */
  destroy(): void {
    this.table.tHead?.removeEventListener("click", this.onClick);
    if (markerOwner.get(this.table) === this) {
      markerOwner.delete(this.table);
      // A host may have handed the element to another binding since; its
      // marker is not ours to remove.
      if (this.table.getAttribute("data-fc-bound") === "table") this.table.removeAttribute("data-fc-bound");
    }
  }

  private reorder(cellIndex: number, direction: SortDirection): void {
    const collator = new Intl.Collator(this.lang(), { numeric: true, sensitivity: "base" });
    const sign = direction === "ascending" ? 1 : -1;
    // Moving a node blurs whatever is focused inside it, which would drop a
    // keyboard user who sorted from a row control (or a script that sorted
    // while they were in one). Focus is restored once the rows are in place.
    const active = this.table.ownerDocument.activeElement as HTMLElement | null;
    const restore = active && active !== this.table.ownerDocument.body && this.table.contains(active) ? active : null;
    for (const body of this.table.tBodies) {
      const rows = [...body.rows];
      // A body that holds only the "no rows" cell has nothing to order.
      if (rows.length < 2) continue;
      const keyed = rows.map((row) => ({ row, key: sortKey(row.cells[cellIndex]) }));
      keyed.sort((a, b) => sign * compare(a.key, b.key, collator));
      // Only rows out of place are moved. Moving keeps the existing nodes, so
      // listeners and any binding state on a row survive the reorder.
      keyed.forEach(({ row }, i) => {
        if (body.rows[i] !== row) body.insertBefore(row, body.rows[i] ?? null);
      });
    }
    if (restore?.isConnected && this.table.ownerDocument.activeElement !== restore) {
      restore.focus({ preventScroll: true });
    }
  }

  private lang(): string | undefined {
    return this.table.closest<HTMLElement>("[lang]")?.lang || undefined;
  }

  private handleClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLElement>(".fc-table__sort");
    if (!button || button.getAttribute("aria-disabled") === "true" || (button as HTMLButtonElement).disabled) return;
    const th = button.closest("th");
    if (!th) return;
    const column = this.headers.indexOf(th as HTMLTableCellElement);
    if (column !== -1) this.sort(column);
  }
}

/** A cell's sort value: its data-fc-sort-value, else its trimmed text. */
function sortKey(cell: HTMLTableCellElement | undefined): string {
  if (!cell) return "";
  return (cell.dataset.fcSortValue ?? cell.textContent ?? "").trim();
}

function asNumber(value: string): number | null {
  if (value === "") return null;
  // Strip grouping so "12,480" sorts as twelve thousand. A comma decimal
  // separator would be misread, which is what data-fc-sort-value is for.
  const n = Number(value.replace(/[,\s  ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Two numbers compare numerically; anything else by collation. */
function compare(a: string, b: string, collator: Intl.Collator): number {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return collator.compare(a, b);
}

/** Binds every `.fc-table` under `root` that is not already bound. */
export function bindTables(root: ParentNode = document, options: TableOptions = {}): FutureCssTable[] {
  const bound: FutureCssTable[] = [];
  for (const el of root.querySelectorAll<HTMLTableElement>("table.fc-table:not([data-fc-bound])")) {
    el.setAttribute("data-fc-bound", "table");
    const table = new FutureCssTable(el, options);
    markerOwner.set(el, table);
    bound.push(table);
  }
  return bound;
}
