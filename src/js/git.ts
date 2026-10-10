/**
 * Git surface bindings.
 *
 * Renders a working tree: branch, status counts, a file list, and per-file diff
 * summaries.
 *
 * # This does not run Git
 *
 * Nothing here shells out, and nothing here parses `git status` output. The
 * surface is a *view* over data the application already has -- from libgit2, from
 * a language binding, or from a fixture. That is a deliberate boundary:
 *
 * - Spawning a process per render is not something a UI layer should be doing, and
 *   it breaks outright in the browser.
 * - Parsing porcelain output is a spec-following exercise whose failure mode is a
 *   plausible-looking wrong answer.
 *
 * So the model here takes plain status entries and does the part that *is* worth
 * doing carefully: grouping, counting, ordering, and deriving the per-file
 * summary.
 *
 * # What is pure computation
 *
 * Everything except the DOM. `summarizeStatus` folds entries into counts and
 * `fileSummary` derives a line stat from two texts. Both are pure functions over
 * data, which is exactly the shape the Rust/WASM layer is meant to hold -- see
 * `crates/fc-git`. The JS here is the always-available fallback.
 */

/** One file's index state, as porcelain reports it. */
export type IndexState =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

/** One file, with the two states that matter separately. */
export interface StatusEntry {
  /** Repo-relative path. */
  path: string;
  /** State in the index (staged). Absent when the file is only in the worktree. */
  index?: IndexState;
  /** State in the worktree. Absent when the file is only staged. */
  worktree?: IndexState;
  /** Former path, for a rename. */
  from?: string;
  /** The file's contents, when available. Used for the line stat. */
  before?: string;
  after?: string;
}

/** Counts shown in the status header. */
export interface StatusCounts {
  staged: number;
  unstaged: number;
  conflicted: number;
  untracked: number;
}

/** Per-file line stat. */
export interface FileSummary {
  added: number;
  removed: number;
}

export interface GitSurfaceOptions {
  /** The `.fc-git` root. */
  root: Element | string;
  /** Branch name, or null when the repository has no commits yet. */
  branch: string | null;
  /** The working tree as the application knows it. */
  entries?: readonly StatusEntry[];
  /** Called when a file is selected. */
  onSelect?: (path: string) => void;
  /** Called when the stage-toggle button is pressed. */
  onStage?: (path: string) => void;
}

/**
 * Folds status entries into header counts.
 *
 * Staged and unstaged are counted separately because they answer different
 * questions: "what is in the commit I am about to make" and "what have I not
 * staged yet". A file changed in both appears in both counts, which is correct --
 * collapsing them into one number is how a commit accidentally includes edits the
 * user did not intend.
 */
export function summarizeStatus(
  entries: readonly StatusEntry[],
): StatusCounts {
  let staged = 0;
  let unstaged = 0;
  let conflicted = 0;
  let untracked = 0;
  for (const entry of entries) {
    if (entry.index === "conflicted" || entry.worktree === "conflicted") {
      conflicted++;
    }
    if (entry.index) staged++;
    if (entry.worktree) {
      unstaged++;
      if (entry.worktree === "untracked") untracked++;
    }
  }
  return { staged, unstaged, conflicted, untracked };
}

/**
 * Counts added and removed lines between two file revisions.
 *
 * The JS twin of `fc_diff::diff_counts`, and deliberately *not* built on
 * `diffStats`/`diffLines`. Those run Myers and produce a hunk-by-hunk answer; this
 * only needs totals, and the trim-then-count version is what the Rust crate does.
 * Deriving it from the Myers result would be correct but would make the two
 * implementations agree by accident rather than by construction.
 *
 * A missing revision is treated as empty, so a newly added file reports its whole
 * line count as added rather than as zero.
 */
export function diffCounts(before: string | undefined, after: string | undefined): FileSummary {
  const a = (before ?? "").split("\n");
  const b = (after ?? "").split("\n");

  // Trim the common prefix and suffix first. Not only cheaper: it is what makes a
  // small edit in a large file count as small instead of as a whole-file change.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  return { added: b.length - head - tail, removed: a.length - head - tail };
}

/**
 * Derives a per-file line stat.
 *
 * Returns undefined when the file's contents are not available, which is a
 * different claim from "zero changed lines". Rendering `+0 -0` for a file whose
 * contents were never loaded tells the reader the file is unchanged, which it is
 * not.
 */
export function fileSummary(entry: StatusEntry): FileSummary | undefined {
  if (entry.after === undefined && entry.before === undefined) return undefined;
  return diffCounts(entry.before, entry.after);
}

/**
 * Orders entries so the ones needing attention come first.
 *
 * Conflicts first, because they block everything else. Then files changed in both
 * the index and the worktree, because those are the ones where staging is a real
 * decision. Then the rest alphabetically, so the list does not reshuffle as
 * counts change while the user reads it.
 */
export function orderEntries(entries: readonly StatusEntry[]): StatusEntry[] {
  const rank = (e: StatusEntry): number => {
    if (e.index === "conflicted" || e.worktree === "conflicted") return 0;
    if (e.index && e.worktree) return 1;
    return 2;
  };
  return [...entries].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    return byRank !== 0 ? byRank : a.path.localeCompare(b.path);
  });
}

export class FutureCssGitSurface {
  private readonly root: HTMLElement;
  private readonly branch: string | null;
  private readonly entries: readonly StatusEntry[];
  private readonly onSelect?: (path: string) => void;
  private readonly onStage?: (path: string) => void;

  private selected: string | null = null;

  constructor(options: GitSurfaceOptions) {
    this.root = resolve(options.root, "git surface root");
    this.branch = options.branch;
    this.entries = options.entries ?? [];
    this.onSelect = options.onSelect;
    this.onStage = options.onStage;

    this.root.dataset.fcBranch = this.branch ?? "";
    this.render();
    // The surface is ready before it calls anything out, for the same reason the
    // context strip is: a constructor that fires a consumer callback before it
    // returns can fail the caller's own setup.
    if (this.entries.length > 0) this.select(this.entries[0].path, { silent: true });
  }

  /** The resolved counts. */
  get counts(): StatusCounts {
    return summarizeStatus(this.entries);
  }

  /** The currently selected path, or null. */
  get selectedPath(): string | null {
    return this.selected;
  }

  /** Selects a file. Ignores a path that is not in the surface. */
  select(path: string, options: { silent?: boolean } = {}): void {
    if (!this.entries.some((e) => e.path === path)) return;
    this.selected = path;
    this.renderSelection();
    if (!options.silent) this.onSelect?.(path);
  }

  // ---- Rendering -----------------------------------------------------------

  private render(): void {
    this.renderBranch();
    this.renderCounts();
    this.renderList();
  }

  /**
   * The branch name.
   *
   * A repository with no commits has a branch and no history, so "Initial commit"
   * rather than an empty header -- which would read as a rendering failure rather
   * than as a repository state.
   */
  private renderBranch(): void {
    const el = this.root.querySelector<HTMLElement>(".fc-git__branch");
    if (!el) return;
    el.textContent = this.branch ?? "Initial commit";
    this.root.dataset.fcBranchState = this.branch ? "named" : "unborn";
  }

  private renderCounts(): void {
    const { staged, unstaged, conflicted, untracked } = this.counts;
    // Absent counts are omitted rather than shown as zero: "0 staged" is a claim
    // about the index, and it is noise on a clean tree.
    const parts: string[] = [];
    if (conflicted) parts.push(`${conflicted} conflicted`);
    if (staged) parts.push(`${staged} staged`);
    if (unstaged) parts.push(`${unstaged} not staged`);
    if (untracked) parts.push(`${untracked} untracked`);
    if (parts.length === 0) parts.push("Working tree clean");

    const el = this.root.querySelector<HTMLElement>(".fc-git__summary");
    if (el) {
      el.textContent = parts.join(" · ");
      // The counts are also declared on the root, so a reader does not have to
      // parse the sentence above to find them.
      this.root.dataset.fcStaged = String(staged);
      this.root.dataset.fcUnstaged = String(unstaged);
      this.root.dataset.fcConflicted = String(conflicted);
      this.root.dataset.fcUntracked = String(untracked);
    }
  }

  private renderList(): void {
    const list = this.root.querySelector<HTMLElement>(".fc-git__files");
    if (!list) return;
    list.replaceChildren();
    list.setAttribute("role", this.entries.length ? "grid" : "group");

    const ordered = orderEntries(this.entries);
    if (ordered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "fc-git__empty";
      empty.textContent = "No changes";
      list.append(empty);
      this.root.dataset.fcEmpty = "true";
      return;
    }
    delete this.root.dataset.fcEmpty;

    for (const entry of ordered) list.append(this.renderRow(entry));
    this.renderSelection();
  }

  private renderRow(entry: StatusEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "fc-git__row";
    row.dataset.fcPath = entry.path;
    row.dataset.fcSelected = "false";
    row.setAttribute("role", "row");
    row.setAttribute("aria-selected", "false");
    row.tabIndex = 0;

    // The path is split so the directory can be de-emphasised and truncated at a
    // boundary, which keeps the filename readable in a deeply nested path.
    const dir = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/") + 1) : "";
    const base = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    const name = document.createElement("span");
    name.className = "fc-git__file-name";
    name.setAttribute("role", "gridcell");
    if (dir) {
      const prefix = document.createElement("span");
      prefix.className = "fc-git__file-dir";
      prefix.textContent = dir;
      name.append(prefix);
    }
    name.append(document.createTextNode(base));

    row.append(name, this.renderStages(entry), this.renderStat(entry));

    // Both interactions are keyboard-reachable, not mouse-only. Roving tabindex
    // keeps the list a single tab stop.
    row.addEventListener("click", () => this.select(entry.path));
    row.addEventListener("keydown", (event) => {
      // Nested buttons retain their native keyboard activation.
      if (event.target !== row) return;
      const rows = [...row.parentElement!.querySelectorAll<HTMLElement>(".fc-git__row")];
      const index = rows.indexOf(row);
      const next = event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1)
        : event.key === "ArrowUp" ? Math.max(index - 1, 0)
        : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
      if (next >= 0) {
        event.preventDefault();
        this.select(rows[next].dataset.fcPath!);
        rows[next].focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.select(entry.path);
      }
    });
    return row;
  }

  /** The staged/unstaged badges for one file. */
  private renderStages(entry: StatusEntry): HTMLElement {
    const host = document.createElement("span");
    host.className = "fc-git__stages";
    host.setAttribute("role", "gridcell");

    const conflicted = entry.index === "conflicted" || entry.worktree === "conflicted";
    // Declared once on the row *and* once here, because "conflicted" describes the
    // file as a whole while "staged" describes a side of it. A file conflicted in
    // both places would otherwise be indistinguishable from one conflicted in one.
    if (entry.index) host.append(stageBadge("index", entry.index, conflicted));
    if (entry.worktree) host.append(stageBadge("worktree", entry.worktree, conflicted));

    // Absent rather than empty when nothing is staged, so a file with only
    // worktree changes does not carry an empty box where a badge would be.
    if (!entry.index && !conflicted) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fc-git__stage-button";
      button.textContent = "Stage";
      button.setAttribute("aria-label", `Stage ${entry.path}`);
      button.dataset.fcStagePath = entry.path;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.onStage?.(entry.path);
      });
      host.append(button);
    }
    return host;
  }

  private renderStat(entry: StatusEntry): HTMLElement {
    const stat = document.createElement("span");
    stat.className = "fc-git__stat";
    stat.setAttribute("role", "gridcell");
    const summary = fileSummary(entry);
    // No contents means no claim -- see `fileSummary`.
    if (!summary) {
      stat.hidden = true;
      return stat;
    }
    if (summary.added === 0 && summary.removed === 0) {
      stat.hidden = true;
      return stat;
    }
    const add = document.createElement("span");
    add.className = "fc-git__stat-add";
    add.textContent = `+${summary.added}`;
    const remove = document.createElement("span");
    remove.className = "fc-git__stat-remove";
    remove.textContent = `−${summary.removed}`;
    stat.append(add, remove);
    // Tabular figures: the column must not shift as counts change.
    return stat;
  }

  /** Marks the selected row, keeping it a single tab stop. */
  private renderSelection(): void {
    for (const row of this.root.querySelectorAll<HTMLElement>(".fc-git__row")) {
      const on = row.dataset.fcPath === this.selected;
      row.dataset.fcSelected = String(on);
      row.setAttribute("aria-selected", String(on));
      // The selected row is the only tab stop; otherwise Tab walks the whole list.
      row.tabIndex = on ? 0 : -1;
    }
  }
}

function stageBadge(side: "index" | "worktree", state: string, conflicted: boolean): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "fc-git__badge";
  const resolved = conflicted ? "conflicted" : state;
  badge.dataset.fcStage = side;
  badge.dataset.fcState = resolved;
  // The forced-colors glyph. Set as an attribute rather than as CSS `content` so
  // the character lives with the data instead of being scattered across the
  // stylesheet, and so a reader of the DOM can see the marker too.
  badge.dataset.fcGlyph = GLYPHS[resolved] ?? "";
  badge.textContent = state;
  // The position is in the class name, but a screen reader needs the side too:
  // "Modified" alone does not say whether it is staged.
  badge.title = conflicted
    ? `conflicted (${side === "index" ? "staged" : "not staged"})`
    : `${state} (${side === "index" ? "staged" : "not staged"})`;
  return badge;
}

/**
 * A leading glyph per state, used only under forced colors.
 *
 * The badge colour is discarded there, so without a non-colour signal every state
 * would read as the same outlined word. Each glyph is distinct, and it is
 * generated text rather than paint, so the OS cannot strip it.
 */
const GLYPHS: Record<string, string> = {
  added: "+",
  modified: "~",
  deleted: "\u2212",
  renamed: ">",
  untracked: "?",
  conflicted: "!",
};

function resolve(target: Element | string, what: string): HTMLElement {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`future-css: ${what} not found: ${String(target)}`);
  return el;
}
