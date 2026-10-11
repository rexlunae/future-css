/**
 * The built-in icon set.
 *
 * Every icon is one SVG path on a 24-unit grid, drawn as a 2-unit stroke with
 * round caps and joins and no fill. One path per icon is a constraint chosen
 * for the consumers, not the artist: the set crosses into other languages
 * (`dist/icons.json` feeds the Dioxus library) and into a `<symbol>` sprite,
 * and a single `d` string is the one shape every one of them can carry without
 * a schema.
 *
 * Stroke rather than fill, because a stroke icon takes `currentColor` and so
 * inherits the text colour of whatever it sits in -- a danger button, a
 * disabled one, forced colours -- with no per-state rule. The `.fc-icon` class
 * in `icon.css` sets the stroke, so an icon rendered before the stylesheet
 * loads is still drawn by the presentation attributes `iconMarkup` writes.
 *
 * Icons are decorative by default. An icon is almost always next to text or
 * inside a control that already has a name, and a second name would be read
 * twice. An icon-only button carries its name on the button (`aria-label`),
 * not on the icon, so it is announced as a button with a name rather than as
 * an image inside an unnamed button.
 *
 * `mirror` marks an icon whose meaning is a direction along the line of text.
 * `.fc-icon--mirror` flips it in right-to-left text, so "back" still points
 * backwards. Icons whose direction is physical (play, upload) or rotational
 * (refresh) are not marked: a play triangle points the way time runs on a
 * media control in every script.
 *
 * The paths are original to this project. No external icon font or CDN is
 * involved; the set is plain data and can be vendored with the stylesheet.
 */

export interface IconDefinition {
  /** The path data, in a `0 0 24 24` viewBox. */
  readonly d: string;
  /** True when the icon points along the inline axis and flips in RTL. */
  readonly mirror?: boolean;
}

/** The coordinate space every path is drawn in. */
export const ICON_VIEWBOX = "0 0 24 24";

/** The stroke width the paths are drawn for, in viewBox units. */
export const ICON_STROKE_WIDTH = 2;

/** A circle as two arcs, so a circle can share a path with other strokes. */
const circle = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0-${2 * r}z`;

/*
 * A dot is a disc of radius 1 under a 2-unit stroke, which renders 2 units
 * wider than a zero-length round-capped segment and stays visible at 1em.
 */
const dot = (cx: number, cy: number) => circle(cx, cy, 1);

export const ICONS = {
  // ---- Actions ----------------------------------------------------------
  copy: { d: "M11 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" },
  check: { d: "M5 12.5l4.5 4.5L19 7.5" },
  close: { d: "M6 6l12 12M18 6L6 18" },
  plus: { d: "M12 5v14M5 12h14" },
  minus: { d: "M5 12h14" },
  search: { d: `${circle(11, 11, 6.5)}M15.6 15.6L20 20` },
  edit: { d: "M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16zM13.5 6.5l4 4" },
  trash: { d: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" },
  download: { d: "M12 4v11M7 10l5 5 5-5M5 20h14" },
  upload: { d: "M12 16V5M7 10l5-5 5 5M5 20h14" },
  share: { d: `${circle(18, 5, 2.5)}${circle(6, 12, 2.5)}${circle(18, 19, 2.5)}M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5` },
  link: { d: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" },
  "external-link": { d: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5", mirror: true },
  refresh: { d: "M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" },
  undo: { d: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3", mirror: true },
  redo: { d: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3", mirror: true },
  filter: { d: "M3 5h18l-7 8v6l-4 2v-8z" },
  settings: { d: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4" },
  maximize: { d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" },
  minimize: { d: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" },

  // ---- Navigation -------------------------------------------------------
  menu: { d: "M4 6h16M4 12h16M4 18h16" },
  "more-horizontal": { d: `${dot(5, 12)}${dot(12, 12)}${dot(19, 12)}` },
  "more-vertical": { d: `${dot(12, 5)}${dot(12, 12)}${dot(12, 19)}` },
  "chevron-up": { d: "M6 15l6-6 6 6" },
  "chevron-down": { d: "M6 9l6 6 6-6" },
  "chevron-start": { d: "M15 6l-6 6 6 6", mirror: true },
  "chevron-end": { d: "M9 6l6 6-6 6", mirror: true },
  "arrow-up": { d: "M12 19V5M6 11l6-6 6 6" },
  "arrow-down": { d: "M12 5v14M6 13l6 6 6-6" },
  "arrow-start": { d: "M19 12H5M11 6l-6 6 6 6", mirror: true },
  "arrow-end": { d: "M5 12h14M13 6l6 6-6 6", mirror: true },
  home: { d: "M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" },
  sidebar: { d: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 4v16", mirror: true },

  // ---- Status -----------------------------------------------------------
  info: { d: `${circle(12, 12, 9)}M12 11v5M12 8h.01` },
  success: { d: `${circle(12, 12, 9)}M8 12.5l2.5 2.5L16 9.5` },
  warning: { d: "M10.3 4.2L2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" },
  error: { d: `${circle(12, 12, 9)}M12 7.5v5M12 16h.01` },
  help: { d: `${circle(12, 12, 9)}M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01` },
  lock: { d: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4" },
  eye: { d: `M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z${circle(12, 12, 3)}` },
  "eye-off": { d: "M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" },
  bell: { d: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" },
  star: { d: "M12 3L14.5 9.1L21 9.6L16 13.8L17.6 20.2L12 16.7L6.4 20.2L8 13.8L3 9.6L9.5 9.1z" },
  clock: { d: `${circle(12, 12, 9)}M12 7v5l3 2` },

  // ---- Conversation -----------------------------------------------------
  send: { d: "M21 3L10 14M21 3l-7 18-4-7-7-4z", mirror: true },
  stop: { d: "M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" },
  play: { d: "M7 4.5v15l12-7.5z" },
  pause: { d: "M8 5v14M16 5v14" },
  mic: { d: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" },
  attach: { d: "M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7" },
  "thumbs-up": { d: "M7 11v10M7 11l4-8a2 2 0 0 1 2.5 2v4h5.3a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17.4 21H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" },
  "thumbs-down": { d: "M7 13V3M7 13l4 8a2 2 0 0 0 2.5-2v-4h5.3a2 2 0 0 0 2-2.4l-1.4-6A2 2 0 0 0 17.4 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1z" },
  sparkles: { d: "M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8zM19 15v5M16.5 17.5h5" },
  user: { d: `${circle(12, 8, 4)}M4 20a8 6 0 0 1 16 0` },
  mail: { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6" },

  // ---- Objects ----------------------------------------------------------
  file: { d: "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5" },
  folder: { d: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" },
  image: { d: `M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z${circle(9, 9.5, 1.5)}M20 15l-5-5L5 20` },
  code: { d: "M9 7l-5 5 5 5M15 7l5 5-5 5" },
  terminal: { d: "M4 6l6 6-6 6M12 18h8" },
  "git-branch": { d: `M6 3v12${circle(18, 6, 3)}${circle(6, 18, 3)}M18 9a9 9 0 0 1-9 9` },
  calendar: { d: "M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4" },
  bookmark: { d: "M6 3h12v18l-6-4-6 4z" },
  globe: { d: `${circle(12, 12, 9)}M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z` },
  sun: { d: `${circle(12, 12, 4)}M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4` },
  moon: { d: "M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z" },
} as const satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;

/** Every icon name, in declaration order. */
export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

/** True when `name` is in the set. Use it on names that arrive as data. */
export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

export interface IconOptions {
  /**
   * Makes the icon an image with this name. Leave it unset for an icon beside
   * text or inside a named control; see the module comment.
   */
  readonly label?: string;
  /** `"sm"` or `"lg"`; the default follows the surrounding font size. */
  readonly size?: "sm" | "lg";
}

function definition(name: string): IconDefinition {
  // Throws rather than rendering nothing: an empty icon in an icon-only button
  // is an invisible control, and the bug is far easier to find at the call.
  if (!isIconName(name)) throw new RangeError(`future-css: unknown icon "${name}"`);
  return ICONS[name];
}

function classes(def: IconDefinition, options: IconOptions): string {
  let value = "fc-icon";
  if (options.size) value += ` fc-icon--${options.size}`;
  if (def.mirror) value += " fc-icon--mirror";
  return value;
}

/*
 * Presentation attributes as well as the class, so the icon draws correctly
 * when the stylesheet has not loaded (an email, a server-rendered first paint).
 * The class wins once it applies, because author CSS outranks presentation
 * attributes.
 */
const PRESENTATION =
  `viewBox="${ICON_VIEWBOX}" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE_WIDTH}" ` +
  `stroke-linecap="round" stroke-linejoin="round"`;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function a11yAttributes(options: IconOptions): string {
  return options.label === undefined
    ? `aria-hidden="true" focusable="false"`
    : `role="img" aria-label="${escapeAttribute(options.label)}"`;
}

/** The icon as an SVG string, for templates and server rendering. */
export function iconMarkup(name: IconName, options: IconOptions = {}): string {
  const def = definition(name);
  return `<svg class="${classes(def, options)}" ${PRESENTATION} ${a11yAttributes(options)}>` +
    `<path d="${def.d}"/></svg>`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The icon as an element, for code that builds DOM directly. */
export function createIcon(name: IconName, options: IconOptions = {}, doc: Document = document): SVGSVGElement {
  const def = definition(name);
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", classes(def, options));
  svg.setAttribute("viewBox", ICON_VIEWBOX);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(ICON_STROKE_WIDTH));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (options.label === undefined) {
    svg.setAttribute("aria-hidden", "true");
    // Old Edge and IE made every inline SVG a tab stop; harmless elsewhere.
    svg.setAttribute("focusable", "false");
  } else {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", options.label);
  }
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", def.d);
  svg.append(path);
  return svg;
}

/**
 * Every icon as a `<symbol id="fc-icon-NAME">` in one hidden SVG, published as
 * `dist/icons.svg`. A page that inlines it once draws an icon with
 * `<svg class="fc-icon"><use href="#fc-icon-copy"/></svg>`.
 */
export function iconSprite(): string {
  const symbols = ICON_NAMES.map((name) =>
    `<symbol id="fc-icon-${name}" viewBox="${ICON_VIEWBOX}"><path d="${ICONS[name].d}"/></symbol>`);
  return `<svg xmlns="${SVG_NS}" aria-hidden="true" style="display:none">\n${symbols.join("\n")}\n</svg>\n`;
}
