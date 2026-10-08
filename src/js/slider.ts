/**
 * Slider bindings.
 *
 * `fc-slider` is a native `<input type="range">`, which already has the whole
 * keyboard contract and announces its value. This adds the two things the
 * platform does not draw:
 *
 * 1. **The filled track.** WebKit and Blink have no pseudo-element for the
 *    part of the track before the thumb, so CSS reads `--fc-slider-pct` and the
 *    binding keeps it current. Firefox draws it natively and ignores the value.
 * 2. **The visible value.** An `<output for="…">` beside the input is updated
 *    as it moves. The output is not a live region: the input announces its own
 *    value, and a second announcement on every step would flood the reader.
 *
 * One listener at the root handles every slider, including ones added later.
 */

/** The fraction of the range the value covers, as a CSS percentage. */
export function sliderPercent(input: HTMLInputElement): string {
  const min = input.min === "" ? 0 : Number(input.min);
  const max = input.max === "" ? 100 : Number(input.max);
  const span = max - min;
  // A degenerate range (min == max) is drawn empty rather than dividing by zero.
  const pct = span > 0 ? ((Number(input.value) - min) / span) * 100 : 0;
  return `${Math.min(100, Math.max(0, pct))}%`;
}

/** Updates one slider's fill and any `<output>` that names it. */
export function syncSlider(input: HTMLInputElement): void {
  input.style.setProperty("--fc-slider-pct", sliderPercent(input));
  if (!input.id) return;
  const root = input.getRootNode() as Document | ShadowRoot;
  for (const output of root.querySelectorAll<HTMLOutputElement>("output")) {
    if (output.htmlFor.contains(input.id)) output.value = input.value;
  }
}

/**
 * Syncs every `.fc-slider__input` under `root` and keeps them synced. Returns
 * a function that removes the listener.
 */
export function bindSliders(root: Document | HTMLElement = document): () => void {
  for (const input of root.querySelectorAll<HTMLInputElement>(".fc-slider__input")) syncSlider(input);

  const onInput = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains("fc-slider__input")) syncSlider(target);
  };
  root.addEventListener("input", onInput);
  return () => root.removeEventListener("input", onInput);
}
