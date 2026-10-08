/**
 * Carousel binding: previous and next buttons for an `fc-carousel`.
 *
 * The track already scrolls by touch, trackpad and keyboard with no script.
 * This adds the buttons a mouse user without a horizontal wheel needs, and
 * keeps them honest: each is `aria-disabled` at its end of the track, so it
 * never looks pressable while doing nothing.
 *
 * Paging moves by most of the visible width rather than by one item, so a
 * multi-item row turns a page at a time and the last visible item becomes the
 * first, keeping the reader's place.
 */

const PAGE = 0.85;

function edges(track: HTMLElement): { atStart: boolean; atEnd: boolean } {
  // scrollLeft runs negative in RTL, from 0 at the start towards the end.
  const offset = Math.abs(track.scrollLeft);
  const max = track.scrollWidth - track.clientWidth;
  return { atStart: offset <= 1, atEnd: offset >= max - 1 };
}

/**
 * Binds one carousel. Returns a function that removes the listeners; the
 * controls stay visible, since they still reflect the last state.
 */
export function bindCarousel(carousel: HTMLElement): () => void {
  const track = carousel.querySelector<HTMLElement>(".fc-carousel__track");
  const controls = carousel.querySelector<HTMLElement>(".fc-carousel__controls");
  if (!track) throw new Error("future-css: carousel has no .fc-carousel__track");
  const prev = carousel.querySelector<HTMLElement>("[data-fc-carousel='prev']");
  const next = carousel.querySelector<HTMLElement>("[data-fc-carousel='next']");

  const sync = (): void => {
    const { atStart, atEnd } = edges(track);
    prev?.setAttribute("aria-disabled", String(atStart));
    next?.setAttribute("aria-disabled", String(atEnd));
  };

  const page = (direction: 1 | -1): void => {
    const rtl = getComputedStyle(track).direction === "rtl";
    // `left` is physical; in RTL the inline-forward direction is negative.
    track.scrollBy({ left: direction * track.clientWidth * PAGE * (rtl ? -1 : 1) });
  };

  const onClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-fc-carousel]");
    if (!button || !carousel.contains(button) || button.getAttribute("aria-disabled") === "true") return;
    page(button.dataset.fcCarousel === "next" ? 1 : -1);
  };

  carousel.addEventListener("click", onClick);
  track.addEventListener("scroll", sync, { passive: true });
  // A resize can change whether there is anywhere to scroll at all.
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
  observer?.observe(track);

  controls?.removeAttribute("hidden");
  sync();

  return () => {
    carousel.removeEventListener("click", onClick);
    track.removeEventListener("scroll", sync);
    observer?.disconnect();
  };
}

/** Binds every `.fc-carousel` under `root`. */
export function bindCarousels(root: ParentNode = document): Array<() => void> {
  return [...root.querySelectorAll<HTMLElement>(".fc-carousel")].map(bindCarousel);
}
