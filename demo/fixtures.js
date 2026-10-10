/**
 * Fills the fixtures that are rendered by a module rather than written as
 * markup -- code, diff, and the git surface -- with the same modules the
 * package exports, so the fixture shows what a consumer actually gets.
 *
 * The date picker is rendered by its binding, with a fixed "today" so the
 * fixture looks the same every day.
 *
 * Also sets `indeterminate`, which is a property with no attribute form.
 */

import { renderHighlighted } from "/src/js/highlight.js";
import { diffLines, diffStats } from "/src/js/diff.js";
import { FutureCssGitSurface } from "/src/js/git.js";
import { bindDatePicker } from "/src/js/datepicker.js";
import { bindSplitters } from "/src/js/splitter.js";

const SAMPLES = {
  typescript: `// A line long enough to wrap at 320px, which is the point of the wrapping mode.
export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}`,
  css: `.fc-btn:hover { background-color: var(--fc-color-accent-bg-hover); /* a long line that scrolls instead of wrapping */ }`,
};

for (const block of document.querySelectorAll("[data-fx-code]")) {
  const lang = block.dataset.fxCode;
  const source = SAMPLES[lang];
  block.querySelector(".fc-code__source")?.replaceChildren(...renderHighlighted(source, lang).childNodes);
  const gutter = block.querySelector(".fc-code__gutter");
  gutter?.replaceChildren(
    ...source.split("\n").map((_, i) => {
      const s = document.createElement("span");
      s.textContent = String(i + 1);
      return s;
    }),
  );
}

const BEFORE = "const a = 1;\nconst b = 2;\nexport { a, b };\n";
const AFTER = "const a = 1;\nconst c = 3;\nexport { a, c }; // a long trailing comment that forces the scrolling mode to scroll\n";

// Live, so the fixture page doubles as a place to try the drag and the keys.
bindSplitters(document);

for (const root of document.querySelectorAll("[data-fx-datepicker]")) {
  bindDatePicker(root, {
    today: "2026-10-08",
    value: root.dataset.fxValue || null,
    min: root.dataset.fxMin || undefined,
    locale: "en-US",
    // Weekends unavailable in the constrained example, to show the state.
    isDisabled: root.dataset.fxMin ? (iso) => [0, 6].includes(new Date(iso).getUTCDay()) : undefined,
  });
}

for (const root of document.querySelectorAll("[data-fx-diff]")) {
  const lines = diffLines(BEFORE, AFTER);
  const stats = diffStats(lines);
  root.querySelector(".fc-diff__bar")?.replaceChildren(
    ...[["added", `+${stats.added}`], ["removed", `−${stats.removed}`]].map(([kind, text]) => {
      const s = document.createElement("span");
      s.className = `fc-diff__stat fc-diff__stat--${kind}`;
      s.textContent = text;
      return s;
    }),
  );
  root.querySelector(".fc-diff__body")?.replaceChildren(
    ...lines.map((line) => {
      const row = document.createElement("div");
      row.className = "fc-diff__line";
      if (line.kind !== "equal") {
        row.dataset.fcDiff = line.kind;
        row.setAttribute("aria-label", `${line.kind === "add" ? "Added" : "Removed"}: ${line.text}`);
      }
      const marker = document.createElement("span");
      marker.className = "fc-diff__marker";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " ";
      const oldNum = document.createElement("span");
      oldNum.className = "fc-diff__num";
      oldNum.setAttribute("aria-hidden", "true");
      oldNum.textContent = line.oldLine ?? "";
      const newNum = oldNum.cloneNode();
      newNum.textContent = line.newLine ?? "";
      const content = document.createElement("span");
      content.className = "fc-diff__content";
      content.textContent = line.text;
      row.append(marker, oldNum, newNum, content);
      return row;
    }),
  );
}

// Every index and worktree state the surface draws, in one tree.
const TREE = [
  { path: "src/js/git.ts", index: "modified", worktree: "modified", before: "a\nb\nc\n", after: "a\nc\nd\nd\n" },
  { path: "crates/fc-git/src/lib.rs", worktree: "untracked", after: "one\ntwo\n" },
  { path: "src/js/merge.ts", index: "conflicted", worktree: "conflicted" },
  { path: "README.md", index: "added" },
  { path: "src/old-name.ts", index: "deleted" },
  { path: "src/new-name.ts", index: "renamed" },
  { path: "a/very/deeply/nested/directory/path/that/has/to/truncate/somewhere/file.ts", worktree: "modified" },
];

new FutureCssGitSurface({ root: "#fx-git-tree", branch: "feat/a-branch-name-long-enough-to-truncate", entries: TREE });
new FutureCssGitSurface({ root: "#fx-git-clean", branch: "main", entries: [] });
new FutureCssGitSurface({ root: "#fx-git-unborn", branch: null, entries: TREE.slice(0, 2) });

for (const input of document.querySelectorAll(".fx-indeterminate")) input.indeterminate = true;

document.documentElement.dataset.fxReady = "true";
