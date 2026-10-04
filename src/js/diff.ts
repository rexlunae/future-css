/**
 * Line diff for the `fc-diff` component.
 *
 * A Myers diff over lines, producing the three-way classification a reviewer
 * actually reads: unchanged, added, removed. No dependencies, no WASM.
 *
 * # Why not WASM
 *
 * `docs/PLAN.md` reserves the Rust layer for work that pays for the boundary
 * cost, and a diff does not. The bottleneck in a real diff viewer is rendering
 * and layout, not the comparison -- and this library's own rule is that WASM
 * never touches the DOM, so the expensive part would stay in JavaScript anyway.
 *
 * # The algorithm
 *
 * Myers' O(ND) greedy algorithm, where D is the number of differences. Its
 * appeal is the bound: for the common case of a small edit to a large file it is
 * near-linear, whereas the naive dynamic-programming matrix is O(N*M) in time
 * *and memory*. A 5,000-line file with a five-line change allocates a
 * 25-million-cell table under DP and nothing under Myers.
 *
 * # Offsets
 *
 * Line numbers are 1-based -- what a human reads and what `git blame` prints.
 * Internally the algorithm uses 0-based indices into the line array.
 */

/** How a line relates to the two versions. */
export type DiffKind = "equal" | "add" | "remove";

/** One line of diff output. */
export interface DiffLine {
  kind: DiffKind;
  /** The line's text, without its trailing newline. */
  text: string;
  /** 1-based line number in the original; null when the line is new. */
  oldLine: number | null;
  /** 1-based line number in the revision; null when the line was removed. */
  newLine: number | null;
}

/** Split text into lines, without a phantom trailing empty line. */
export function splitLines(text: string): string[] {
  // An empty input has *no* lines, not one empty line. `''.split('\n')` returns
  // `['']`, which made `diffLines('', 'new')` report a phantom removal alongside
  // the real addition -- so an empty file looked like it had been emptied.
  if (text === "") return [];
  // A trailing newline is a terminator, not an empty final line. Rendering it
  // as a row is the classic off-by-one that makes a diff report one line too many.
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}

/** Stats for the diff header. */
export interface DiffStats {
  added: number;
  removed: number;
  /** True when the two inputs are identical after line splitting. */
  identical: boolean;
}

/**
 * Compute a line diff.
 *
 * Trims the common prefix and suffix before running Myers. That is not only an
 * optimization: it is what makes the result *readable*. Without trimming the
 * result is still correct, but the backtracking that recovers the edit script
 * has a much wider search, which scatters small edits across a large file
 * instead of showing one contiguous hunk.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  // Common suffix, never overlapping the prefix.
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) {
    out.push({ kind: "equal", text: a[i]!, oldLine: i + 1, newLine: i + 1 });
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  for (const step of myers(midA, midB)) {
    if (step.kind === "equal") {
      out.push({
        kind: "equal",
        text: midA[step.aIndex]!,
        oldLine: start + step.aIndex + 1,
        newLine: start + step.bIndex + 1,
      });
    } else if (step.kind === "remove") {
      out.push({
        kind: "remove",
        text: midA[step.aIndex]!,
        oldLine: start + step.aIndex + 1,
        newLine: null,
      });
    } else {
      out.push({
        kind: "add",
        text: midB[step.bIndex]!,
        oldLine: null,
        newLine: start + step.bIndex + 1,
      });
    }
  }

  for (let i = 0; i < a.length - endA; i++) {
    out.push({
      kind: "equal",
      text: a[endA + i]!,
      oldLine: endA + i + 1,
      newLine: endB + i + 1,
    });
  }
  return out;
}

/** One step of an edit script, before it is mapped back to line numbers. */
interface Step {
  kind: DiffKind;
  aIndex: number;
  bIndex: number;
}
/**
 * Myers' greedy O(ND) diff.
 *
 * `v` holds, for each diagonal `k`, the furthest x reached. On each step the
 * walk extends `k` down (a deletion) or up (an insertion) and takes whichever
 * reaches further -- the greedy choice that makes this O(ND).
 */
function myers(a: readonly string[], b: readonly string[]): Step[] {
  const n = a.length;
  const m = b.length;
  // Nothing on one side: every line is purely added or removed.
  if (n === 0) return b.map((_, j) => ({ kind: "add" as const, aIndex: 0, bIndex: j }));
  if (m === 0) return a.map((_, i) => ({ kind: "remove" as const, aIndex: i, bIndex: 0 }));

  const max = n + m;
  const offset = max;
  // Indexed by diagonal k, stored at k + offset so negative k is a valid index.
  const v = new Int32Array(2 * max + 1);
  // The trace of v per step, needed to walk the path back afterwards.
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      // Came from k+1 means an insertion (we moved down in b); from k-1 a
      // deletion. `k === -d` has only one predecessor, so it short-circuits.
      if (k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)) {
        x = v[k + 1 + offset]!;
      } else {
        x = v[k - 1 + offset]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        /*
         * The endpoint must come from the live `v`, not from `trace[d]`.
         *
         * `trace[d]` was pushed *before* this step ran, so it holds the state
         * after step d-1. Reading the start position from it walks the path back
         * from the wrong place: equal lines get mis-attributed to inserts and
         * deletes, and the reconstruction invariant silently fails. Passing the
         * final x/y explicitly is what keeps the two consistent.
         */
        return backtrack(trace, d, offset, x, y);
      }
    }
  }
  // Unreachable: d === n + m always reaches the corner, and both degenerate
  // cases are handled by the guards above.
  return [];
}

/**
 * Walk the recorded trace backwards to recover the edit script.
 *
 * Standard Myers backtracking. The subtlety is that a diagonal step can cover
 * several equal lines, so the inner `while` walks back along the diagonal first
 * and only then attributes the single remaining step to an insert or delete.
 */
function backtrack(
  trace: Int32Array[],
  d: number,
  offset: number,
  endX: number,
  endY: number,
): Step[] {
  const steps: Step[] = [];
  let x = endX;
  let y = endY;

  for (let step = d; step > 0; step--) {
    const v = trace[step]!;
    const k = x - y;
    let prevK: number;
    if (k === -step || (k !== step && v[k - 1 + offset]! < v[k + 1 + offset]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK + offset]!;
    const prevY = prevX - prevK;

    // Every diagonal position between prev and current is an equal line.
    while (x > prevX && y > prevY) {
      steps.push({ kind: "equal", aIndex: x - 1, bIndex: y - 1 });
      x--;
      y--;
    }
    if (x === prevX) {
      steps.push({ kind: "add", aIndex: x, bIndex: y - 1 });
      y--;
    } else {
      steps.push({ kind: "remove", aIndex: x - 1, bIndex: y });
      x--;
    }
  }

  // Anything left at the origin is an equal line.
  while (x > 0 && y > 0) {
    steps.push({ kind: "equal", aIndex: x - 1, bIndex: y - 1 });
    x--;
    y--;
  }

  steps.reverse();
  return steps;
}

/** Count added and removed lines. */
export function diffStats(lines: readonly DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added++;
    else if (line.kind === "remove") removed++;
  }
  return { added, removed, identical: added === 0 && removed === 0 };
}