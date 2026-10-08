/**
 * Date picker binding: renders an `fc-datepicker` month and gives it the
 * WAI-ARIA date grid keyboard contract.
 *
 * The calendar is for browsing dates. Anyone who knows the date types it
 * faster into a native `<input type="date">`, which is also the no-script
 * path, so pages should offer that input and open this beside it rather than
 * replace it.
 *
 * Keyboard, on the focused day:
 *   - Left/Right: previous/next day (swapped in RTL, where the week runs
 *     right to left). Up/Down: same day last/next week.
 *   - Home/End: first/last day of the week. PageUp/PageDown: same day in the
 *     previous/next month; with Shift, the previous/next year.
 *   - Enter/Space: select (the day is a real button).
 *
 * Dates cross the API as ISO `YYYY-MM-DD` strings and are computed in UTC, so
 * no daylight-saving shift can turn midnight into the previous day. Names,
 * weekday headers and the first day of the week come from `Intl`, so a
 * locale gets its own calendar layout with no tables shipped here.
 */

export interface DatePickerOptions {
  /** Selected date, `YYYY-MM-DD`. */
  value?: string | null;
  /** Earliest and latest selectable dates, `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  /** BCP 47 locale for names and the week layout. Defaults to the document's. */
  locale?: string;
  /** 0 = Sunday … 6 = Saturday. Defaults to the locale's. */
  firstDayOfWeek?: number;
  /** Today's date, `YYYY-MM-DD`. Defaults to the local date; injectable for tests. */
  today?: string;
  /** Extra unavailable dates (weekends, holidays). */
  isDisabled?: (iso: string) => boolean;
  /** Called after the user selects a date. */
  onChange?: (iso: string) => void;
  /** Accessible names for the month buttons. */
  labels?: { previous?: string; next?: string };
}

const DAY = 86_400_000;
let uid = 0;

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * `Date.UTC` with the year taken literally. `Date.UTC` reads years 0 to 99
 * as 1900 to 1999, which would move an ISO `0099-12-31` nineteen centuries;
 * `setUTCFullYear` does not, and still rolls months and days over.
 */
function utc(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date.getTime();
}

function fromIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return utc(y, m - 1, d);
}

function localToday(): string {
  const now = new Date();
  return toIso(utc(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** The same day of the month `delta` months away, clamped to that month's length. */
export function addMonths(iso: string, delta: number): string {
  const date = new Date(fromIso(iso));
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + delta;
  const last = new Date(utc(y, m + 1, 0)).getUTCDate();
  return toIso(utc(y, m, Math.min(date.getUTCDate(), last)));
}

/** The locale's first day of the week, 0 = Sunday, where `Intl` reports one. */
export function localeFirstDay(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    // weekInfo counts 1 = Monday … 7 = Sunday.
    if (info) return info.firstDay % 7;
  } catch {
    // An unknown tag falls through to the default.
  }
  return 0;
}

export class FutureCssDatePicker {
  private readonly root: HTMLElement;
  private readonly options: DatePickerOptions;
  private readonly locale: string;
  private readonly firstDay: number;
  private readonly today: string;
  private selected: string | null;
  /** The day holding the roving tab stop; it decides which month is shown. */
  private focusDate: string;
  private readonly titleId = `fc-datepicker-title-${++uid}`;

  constructor(root: HTMLElement, options: DatePickerOptions = {}) {
    this.root = root;
    this.options = options;
    this.locale = options.locale ?? (document.documentElement.lang || navigator.language || "en");
    this.firstDay = options.firstDayOfWeek ?? localeFirstDay(this.locale);
    this.today = options.today ?? localToday();
    this.selected = options.value ?? null;
    this.focusDate = this.clamp(this.selected ?? this.today);

    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("keydown", this.onKeyDown);
    this.render();
  }

  /** The selected date, or null. */
  get value(): string | null {
    return this.selected;
  }

  /** Sets the selection without calling `onChange`, and shows its month. */
  set value(iso: string | null) {
    this.selected = iso;
    if (iso) this.focusDate = iso;
    // Rendering replaces the day buttons, so a keyboard user mid-grid would
    // be left focused on nothing; focus follows to the new day only then, so
    // an update from elsewhere in the form never steals it.
    const hadFocus = this.root.contains(document.activeElement);
    this.render();
    if (hadFocus) this.focus();
  }

  /** Moves the roving focus to the selected or focused day. */
  focus(): void {
    this.dayButton(this.focusDate)?.focus();
  }

  destroy(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("keydown", this.onKeyDown);
  }

  private isUnavailable(iso: string): boolean {
    const { min, max, isDisabled } = this.options;
    return (min !== undefined && iso < min) || (max !== undefined && iso > max) || !!isDisabled?.(iso);
  }

  private clamp(iso: string): string {
    const { min, max } = this.options;
    if (min !== undefined && iso < min) return min;
    if (max !== undefined && iso > max) return max;
    return iso;
  }

  private dayButton(iso: string): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(`.fc-datepicker__day[data-fc-date="${iso}"]`);
  }

  private render(): void {
    const focus = new Date(fromIso(this.focusDate));
    const year = focus.getUTCFullYear();
    const month = focus.getUTCMonth();
    const first = utc(year, month, 1);
    const days = new Date(utc(year, month + 1, 0)).getUTCDate();
    const lead = (new Date(first).getUTCDay() - this.firstDay + 7) % 7;
    const inUtc = { timeZone: "UTC" } as const;

    const title = new Intl.DateTimeFormat(this.locale, { ...inUtc, month: "long", year: "numeric" }).format(first);
    const narrow = new Intl.DateTimeFormat(this.locale, { ...inUtc, weekday: "narrow" });
    const long = new Intl.DateTimeFormat(this.locale, { ...inUtc, weekday: "long" });
    const full = new Intl.DateTimeFormat(this.locale, { ...inUtc, dateStyle: "full" });
    const numeric = new Intl.DateTimeFormat(this.locale, { ...inUtc, day: "numeric" });

    const doc = this.root.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      return node;
    };

    const header = el("div", "fc-datepicker__header");
    const monthButton = (dir: "prev" | "next", label: string, disabled: boolean) => {
      const b = el("button", "fc-btn fc-btn--ghost fc-btn--icon fc-btn--sm");
      b.type = "button";
      b.dataset.fcDatepicker = dir;
      b.setAttribute("aria-label", label);
      if (disabled) b.setAttribute("aria-disabled", "true");
      // Drawn with logical borders, so it points along the reading direction
      // in RTL with no script deciding which glyph to use.
      const g = el("span", `fc-datepicker__chevron fc-datepicker__chevron--${dir}`);
      g.setAttribute("aria-hidden", "true");
      b.append(g);
      return b;
    };
    const { min, max, labels } = this.options;
    const prevDisabled = min !== undefined && toIso(first - DAY) < min;
    const nextDisabled = max !== undefined && toIso(utc(year, month + 1, 1)) > max;
    const heading = el("h2", "fc-datepicker__title");
    heading.id = this.titleId;
    // Announces the new month when the buttons or PageUp/PageDown change it.
    heading.setAttribute("aria-live", "polite");
    heading.textContent = title;
    header.append(
      monthButton("prev", labels?.previous ?? "Previous month", prevDisabled),
      heading,
      monthButton("next", labels?.next ?? "Next month", nextDisabled),
    );

    const grid = el("table", "fc-datepicker__grid");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-labelledby", this.titleId);
    const head = el("thead");
    const headRow = el("tr");
    for (let i = 0; i < 7; i += 1) {
      // 2026-01-04 was a Sunday; offsetting from it gives each weekday's name.
      const sample = utc(2026, 0, 4 + ((this.firstDay + i) % 7));
      const th = el("th", "fc-datepicker__weekday");
      th.scope = "col";
      th.abbr = long.format(sample);
      th.textContent = narrow.format(sample);
      headRow.append(th);
    }
    head.append(headRow);

    const body = el("tbody");
    let row = el("tr");
    // Padding cells carry the cell class so they share its spacing and rules.
    for (let i = 0; i < lead; i += 1) row.append(el("td", "fc-datepicker__cell"));
    for (let d = 1; d <= days; d += 1) {
      const ms = utc(year, month, d);
      const iso = toIso(ms);
      const cell = el("td", "fc-datepicker__cell");
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-selected", String(iso === this.selected));
      const day = el("button", "fc-datepicker__day");
      day.type = "button";
      day.dataset.fcDate = iso;
      day.tabIndex = iso === this.focusDate ? 0 : -1;
      day.setAttribute("aria-label", full.format(ms));
      day.textContent = numeric.format(ms);
      if (iso === this.today) day.setAttribute("aria-current", "date");
      if (this.isUnavailable(iso)) day.setAttribute("aria-disabled", "true");
      cell.append(day);
      row.append(cell);
      if (row.children.length === 7) {
        body.append(row);
        row = el("tr");
      }
    }
    if (row.children.length > 0) {
      while (row.children.length < 7) row.append(el("td", "fc-datepicker__cell"));
      body.append(row);
    }
    grid.append(head, body);

    this.root.replaceChildren(header, grid);
    // Mirrors the selection for machine readers, per the dual-audience contract.
    if (this.selected) this.root.dataset.fcValue = this.selected;
    else delete this.root.dataset.fcValue;
  }

  /** Moves the roving focus, re-rendering when the date is in another month. */
  private moveTo(iso: string): void {
    const target = this.clamp(iso);
    const sameMonth = target.slice(0, 7) === this.focusDate.slice(0, 7);
    this.focusDate = target;
    if (sameMonth) {
      for (const b of this.root.querySelectorAll<HTMLButtonElement>(".fc-datepicker__day")) {
        b.tabIndex = b.dataset.fcDate === target ? 0 : -1;
      }
    } else {
      this.render();
    }
    this.dayButton(target)?.focus();
  }

  private select(iso: string): void {
    if (this.isUnavailable(iso)) return;
    this.selected = iso;
    this.focusDate = iso;
    for (const cell of this.root.querySelectorAll<HTMLElement>(".fc-datepicker__cell")) {
      const day = cell.querySelector<HTMLElement>(".fc-datepicker__day");
      if (day) cell.setAttribute("aria-selected", String(day.dataset.fcDate === iso));
    }
    this.root.dataset.fcValue = iso;
    this.options.onChange?.(iso);
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>("[data-fc-datepicker]");
    if (nav) {
      if (nav.getAttribute("aria-disabled") === "true") return;
      // Keeps focus on the month button, so repeated presses keep paging; the
      // live title announces each month.
      this.focusDate = this.clamp(addMonths(this.focusDate, nav.dataset.fcDatepicker === "next" ? 1 : -1));
      this.render();
      this.root.querySelector<HTMLElement>(`[data-fc-datepicker="${nav.dataset.fcDatepicker}"]`)?.focus();
      return;
    }
    const day = target.closest<HTMLElement>(".fc-datepicker__day");
    if (day?.dataset.fcDate) this.select(day.dataset.fcDate);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const day = (event.target as HTMLElement).closest<HTMLElement>(".fc-datepicker__day");
    if (!day?.dataset.fcDate) return;
    const current = day.dataset.fcDate;
    const ms = fromIso(current);
    const rtl = getComputedStyle(this.root).direction === "rtl";
    const weekday = (new Date(ms).getUTCDay() - this.firstDay + 7) % 7;

    let next: string;
    switch (event.key) {
      case "ArrowRight": next = toIso(ms + (rtl ? -DAY : DAY)); break;
      case "ArrowLeft": next = toIso(ms + (rtl ? DAY : -DAY)); break;
      case "ArrowDown": next = toIso(ms + 7 * DAY); break;
      case "ArrowUp": next = toIso(ms - 7 * DAY); break;
      case "Home": next = toIso(ms - weekday * DAY); break;
      case "End": next = toIso(ms + (6 - weekday) * DAY); break;
      case "PageDown": next = addMonths(current, event.shiftKey ? 12 : 1); break;
      case "PageUp": next = addMonths(current, event.shiftKey ? -12 : -1); break;
      default: return;
    }
    event.preventDefault();
    this.moveTo(next);
  };
}

/** Renders and binds a date picker on `root`. */
export function bindDatePicker(root: HTMLElement, options: DatePickerOptions = {}): FutureCssDatePicker {
  return new FutureCssDatePicker(root, options);
}
