# Platforms

"Multi-platform" here means the same design system rendering correctly across browsers,
embedded webviews, native wrappers, email clients, and print. Each has different
constraints, and the honest approach is to document what works and what does not.

---

## Browser support

The system targets evergreen browsers plus the most recent two versions of the major
mobile browsers. There is no Internet Explorer support and no polyfill layer.

### Feature requirements

| Feature | Used for | Without it |
| --- | --- | --- |
| `light-dark()` | Theme switching | `@supports` fallback to `prefers-color-scheme` |
| Cascade layers | The whole precedence model | Unlayered fallback bundle |
| `:where()` | Zero-specificity base layer | Higher specificity in base |
| Logical properties | RTL correctness | **Broken RTL** -- no acceptable fallback |
| `color-scheme` | Native controls, scrollbars, default theme | Manual UA widget styling |
| `:focus-visible` | Focus ring precision | `:focus` (shows the ring for mouse too) |
| `text-wrap: pretty` | Orphan control | Normal wrapping |
| `line-clamp` | Multi-line truncation | Text shows in full (acceptable) |
| `oklch()` | Perceptual ramps | Compiled to hex at build time |
| `prefers-reduced-motion` | Motion control | Motion runs (a genuine accessibility failure) |

### Progressive enhancement strategy

Two decisions worth stating:

**Logical properties have no fallback, and that is deliberate.** A physical fallback
would be a separate RTL stylesheet, which is the maintenance burden this system exists to
eliminate. Browsers without logical properties (IE, old Safari) are out of scope.

**`prefers-reduced-motion` also has no fallback.** There is no reasonable degradation:
a browser that cannot detect the preference will run motion for users who asked for none.
This is treated as a support requirement, not a nice-to-have.

---

## Embedded webviews

Webviews are where most "it works in a browser" assumptions break.

### iOS WebKit (WKWebView)

The engine is Safari's, but the environment is not.

- **Dynamic viewport units.** `100vh` includes the area under the home indicator. Use
  `100dvh`, with a `100vh` fallback declared first.
- **Safe areas.** Full-bleed layouts must respect `env(safe-area-inset-*)`:

```css
.fc-container {
  padding-inline: max(var(--fc-space-4), env(safe-area-inset-inline-start));
  padding-block-end: max(var(--fc-space-4), env(safe-area-inset-bottom));
}
```

- **Form zoom.** iOS zooms into an input when its computed font size is under 16px. Never
  set a form control below `1rem`. This is a hard constraint, not a preference.
- **`-webkit-tap-highlight-color`.** The default gray flash on tap is undesirable on
  colored buttons; set it to `transparent` and provide a real `:active` state.
- **`user-select`.** Set `none` on buttons and controls, but never on body text.
- **Scroll momentum.** `-webkit-overflow-scrolling: touch` is no longer needed.

### Android WebView

- **Font inflation.** Android may inflate text in a webview with no minimum font size.
  Set `text-size-adjust: 100%` on `html` to prevent it.
- **Font boosting** on older versions inflates text on wide viewports. Same mitigation.
- **Back button.** Hardware back should close the topmost surface, not navigate away.
  This is a host-application concern, but the system's dialog component must not swallow
  the event.
- **Dynamic color.** Android 12+ derives wallpaper colors. Test with `dynamic-range-limit`
  and be aware system surfaces may contrast differently than the system asks for.

### Testing

A webview build is a separate test surface from a browser build. Any component with a
fixed viewport assumption must be tested in both.

---

## Native wrappers

Electron, Tauri, Capacitor, React Native Web.

- **System font stacks work correctly** -- this is one of the main arguments for not
  shipping a webfont. The native OS font is already there.
- **Theme propagation.** Set `color-scheme` in the native layer too, so native chrome
  matches the web content. A dark app with a light native titlebar looks broken.
- **Reduced motion.** Desktop OS settings must be honored in the webview; the CSS media
  query does this automatically on macOS and Windows.
- **High contrast.** Windows High Contrast affects the whole process, and
  `forced-colors: active` works as it does in a browser.

---

## Email

Email is the hardest target and deserves honesty rather than optimism.

### Supported

- Tokens, the cascade layers (in clients that support them), the base element styles
- Colors, typography, spacing, borders
- Dark mode in clients that support `prefers-color-scheme` (Apple Mail, Outlook.com)
- `light-dark()` in clients that have shipped it

### Not supported

| Feature | Reason |
| --- | --- |
| Cascade layers | Unsupported in most clients |
| CSS custom properties | Unsupported in several, including older Outlook |
| Flexbox | Partial, and buggy in older Outlook |
| Grid | Essentially unsupported |
| Logical properties | Unsupported |
| Custom fonts | Blocked or unreliable |
| `prefers-reduced-motion` | Unsupported |
| Forced colors | Not applicable |

### Strategy

Email gets a **separate, hand-authored build** from the same tokens. Not the same CSS
with fallbacks -- a deliberately constrained stylesheet using tables for layout, physical
properties, and inline styles, generated from the same token definitions.

That last part matters: email must not be hand-maintained, because hand-maintained styles
drift from the token source within months. It should be generated, like everything else.

**Current status: not started.** Recorded as a Phase 5 scope item in the plan. The system
should not claim email support until this exists.

---

## Print

Print is where a web stylesheet most often turns out to be unusable.

### Rules

```css
@media print {
  /* Hide interface chrome, not content */
  .fc-nav, .fc-sidebar, .fc-btn { display: none; }

  /* Force real black on white; a printer cannot render a dark scheme */
  :root { color-scheme: light; }

  /* Print the URL for links, since a printed page cannot be clicked */
  a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 0.8em;
    color: #555;
  }

  /* Prevent content splitting across pages */
  h1, h2, h3 { break-after: avoid; }
  figure, table, pre { break-inside: avoid; }
}
```

**Links and URLs.** `break-inside: avoid` on tables, figures, and preformatted blocks
prevents the most jarring print artifacts. Adding `::after { content: attr(href) }` to
links is not optional in a printed document.

**A dark scheme in print wastes ink and looks wrong.** The print stylesheet forces light,
which is a legitimate case where overriding the user's stated preference is correct, since
the output medium is physically incapable of displaying it.

---

## Testing matrix

| Platform | Minimum target | Automated | Manual |
| --- | --- | --- | --- |
| Chrome, Edge, Firefox, Safari (desktop) | Current, plus 2 previous major | Yes | Yes |
| Safari iOS, Chrome Android | Current, plus 2 previous major | Yes | Yes |
| iOS WKWebView | iOS 16+ | No | Yes |
| Android WebView | Android 10+ | No | Yes |
| Electron / Tauri | Current Chromium and WebKit | No | Yes |
| Windows High Contrast | Current | No | Yes |
| Email | Outlook 2019+, Apple Mail, Gmail web | No | Yes |
| Print | Chrome and Safari print preview | No | Yes |

**Automated** means Playwright, across engines and viewports, with a horizontal-overflow
assertion at 320px.

**Manual** means a person, at least once per release for each component or system-wide
change. Accessibility testing in particular cannot be automated away; automated checks
catch perhaps 30-40% of real issues.
