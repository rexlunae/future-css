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
| `light-dark()` | Theme switching | Unsupported; no legacy fallback bundle |
| Cascade layers | The whole precedence model | Unsupported; no unlayered bundle |
| `:where()` | Zero-specificity base layer | Unsupported |
| Logical properties | RTL correctness | **Broken RTL** -- no acceptable fallback |
| `color-scheme` | Native controls, scrollbars, default theme | Manual UA widget styling |
| `:focus-visible` | Focus ring precision | Unsupported; supported browsers provide this |
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

`dist/email.css` is a generated, light-only foundation: `.fc-email`,
`.fc-email-surface`, `.fc-email-link`, and `.fc-email-muted`. It has no custom properties,
layers, or `light-dark()`. Inline the generated declarations through your email pipeline;
use email-safe HTML tables for layout. This does not make the interactive web components
email components. Outlook, Gmail and Apple Mail validation remains a manual release task.

---

## Print

Print is where a web stylesheet most often turns out to be unusable.

Import `future-css/print` last. It forces the light scheme on the root and themed
subtrees for print, and exposes opt-in helpers:

- `.fc-print-hide` removes application chrome.
- `.fc-print-content` removes shadows, overflow clipping and measure limits.
- `.fc-print-keep` avoids a page break within an element.
- `.fc-print-break` starts a new page.
- `.fc-print-link` appends a link's URL and allows long URLs to wrap.

The application chooses what to hide: a button can contain useful status, and a sidebar
can be a document's table of contents. Do not apply `fc-print-keep` to a block longer than
a page. Inspect the actual print preview before distributing a document.

## Native and Figma exports

The token build emits `FutureCssTokens.swift` and `FutureCssTokens.kt`: typed string
constants with separate `_light` / `_dark` values. Map hex colors to native color types
and CSS dimensions to the host's unit scale. These are value exports, not native UI
components; font shorthand and shadows need host-specific interpretation.

`figma-variables.json` contains named COLOR / STRING variables, descriptions and
light/dark mode values. COLOR channels are normalized RGBA derived from the same hex
values. A Figma importer must create the collection/mode IDs and map these mode names;
this file is not a REST mutation request or an automatically installed Figma library.
Shadows remain in the native/JSON export, since a Figma color variable cannot hold one.

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
