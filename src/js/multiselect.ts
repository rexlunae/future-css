export interface MultiselectOptions {
  root: HTMLDetailsElement | string;
  onChange?: (values: string[]) => void;
  formatSummary?: (count: number) => string;
}
/** Native checkboxes keep form submission and selection available without JS.
 * Enhancement adds filtering, a summary and a machine-readable snapshot. */
export class FutureCssMultiselect {
  private root: HTMLDetailsElement;
  private abort = new AbortController();
  private onChange?: (values: string[]) => void;
  private formatSummary: (count: number) => string;
  private seq = 0;
  private disposed = false;
  constructor(options: MultiselectOptions) {
    const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
    if (!(root instanceof HTMLDetailsElement)) throw new Error('future-css: multiselect requires a details element');
    this.root = root; this.onChange = options.onChange;
    this.formatSummary = options.formatSummary ?? (count => count ? `${count} selected` : 'None selected');
    const boxes = this.boxes();
    if (new Set(boxes.map(box => box.value)).size !== boxes.length) throw new Error('future-css: multiselect values must be unique');
    root.dataset.fcKind = 'multiselect'; root.dataset.fcId = root.id || crypto.randomUUID();
    const signal = this.abort.signal;
    root.addEventListener('click', event => {
      const box = (event.target as Element).closest<HTMLInputElement>('input[type="checkbox"]');
      if (box?.getAttribute('aria-disabled') === 'true') event.preventDefault();
    }, {signal, capture: true});
    root.addEventListener('change', event => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') this.sync(true);
    }, {signal});
    root.querySelector<HTMLInputElement>('[data-fc-filter]')?.addEventListener('input', event => this.filter((event.target as HTMLInputElement).value), {signal});
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root.open) {
        event.preventDefault(); root.open = false; root.querySelector('summary')?.focus();
      }
    }, {signal});
    root.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-fc-selection-action]');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      if (button.dataset.fcSelectionAction === 'clear') {
        for (const box of this.boxes()) if (!this.disabled(box)) box.checked = false;
      } else if (button.dataset.fcSelectionAction === 'all') {
        for (const box of this.boxes()) if (!this.disabled(box) && !box.closest<HTMLElement>('.fc-multiselect__option')?.hidden) box.checked = true;
      } else return;
      this.sync(true);
    }, {signal});
    // The filter may sit outside the form's reset scope, so restore its default
    // explicitly; the visible query and the filtered options must never disagree.
    root.closest('form')?.addEventListener('reset', () => queueMicrotask(() => {
      if (this.disposed) return;
      const query = root.querySelector<HTMLInputElement>('[data-fc-filter]');
      if (query) query.value = query.defaultValue;
      this.filter(query?.value ?? ''); this.sync(false);
    }), {signal});
    this.filter(root.querySelector<HTMLInputElement>('[data-fc-filter]')?.value ?? '');
    this.sync(false);
  }
  private boxes(): HTMLInputElement[] { return [...this.root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]; }
  private disabled(box: HTMLInputElement): boolean { return box.matches(':disabled') || box.getAttribute('aria-disabled') === 'true'; }
  get values(): string[] { return this.boxes().filter(box => box.checked).map(box => box.value); }
  setValues(values: readonly string[]): void {
    if (this.disposed) throw new Error('future-css: multiselect is destroyed');
    const boxes = this.boxes();
    for (const value of values) if (!boxes.some(box => box.value === value)) throw new Error(`future-css: unknown selection ${value}`);
    for (const box of boxes) if (this.disabled(box) && box.checked !== values.includes(box.value)) throw new Error('future-css: unavailable selection cannot change');
    for (const box of boxes) box.checked = values.includes(box.value);
    this.sync(true);
  }
  filter(query: string): void {
    const needle = query.trim().toLocaleLowerCase(); let count = 0;
    for (const option of this.root.querySelectorAll<HTMLElement>('.fc-multiselect__option')) {
      option.hidden = !option.textContent?.toLocaleLowerCase().includes(needle); if (!option.hidden) count++;
    }
    const empty = this.root.querySelector<HTMLElement>('[data-fc-empty]'); if (empty) empty.hidden = count !== 0;
  }
  private sync(notify: boolean): void {
    const values = this.values;
    for (const box of this.boxes()) {
      box.closest<HTMLElement>('.fc-multiselect__option')?.setAttribute('data-fc-selected', String(box.checked));
    }
    const summary = this.root.querySelector<HTMLElement>('[data-fc-selection-summary]');
    if (summary) summary.textContent = this.formatSummary(values.length);
    this.root.dataset.fcValues = JSON.stringify(values); this.root.dataset.fcCount = String(values.length);
    this.root.dataset.fcSeq = String(++this.seq); this.root.dataset.fcTs = new Date().toISOString(); this.root.dataset.fcState = 'complete';
    if (notify) this.onChange?.([...values]);
  }
  destroy(): void {
    this.disposed = true; this.abort.abort(); this.filter('');
  }
}
