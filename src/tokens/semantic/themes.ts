/** Named themes preserve the complete semantic contrast contract. */
import { semanticColors, type SchemeColors } from './color.ts';
import { relativeLuminance } from '../color-utils.ts';

const remap = (transform: (color: SchemeColors[string]['light']) => SchemeColors[string]['light']): SchemeColors =>
  Object.fromEntries(Object.entries(semanticColors).map(([name, pair]) => [name, {
    light: transform(pair.light), dark: transform(pair.dark),
  }]));

// Each existing contrast edge has a light and a dark endpoint. Keeping those
// endpoints while removing intermediate tones strengthens contrast without
// losing the intentional inversion of solid controls and their labels.
export const highContrast = remap(color => ({ l: relativeLuminance(color) > 0.18 ? 1 : 0, c: 0, h: 0 }));

// Change the accent ramp only: status and syntax hues still convey the same
// meaning. Lower chroma keeps the alternate hue within the checked sRGB gamut.
highContrast['border-strong']!.dark = { l: 1, c: 0, h: 0 };
highContrast['bg-thumb']!.dark = { l: 0, c: 0, h: 0 };

// Rounding to black and white turns the selected surface into the ordinary
// surface, so a selected row, list item or open FAB would look unselected. A
// selection needs a third tone: grey enough to read as a fill against the
// surface (3:1, WCAG 1.4.11) while the text on it keeps 4.5:1. In OKLCH an
// achromatic l is the cube root of relative luminance, so these sit at
// luminance 0.25 (light) and 0.14 (dark), inside both bounds.
highContrast['selected-bg'] = { light: { l: 0.63, c: 0, h: 0 }, dark: { l: 0.52, c: 0, h: 0 } };

export const forest: SchemeColors = Object.fromEntries(Object.entries(semanticColors).map(([name, pair]) => [name,
  /^(accent-|selected-|focus-ring$)/.test(name) ? {
    light: { ...pair.light, h: 150, c: pair.light.c * 0.45 },
    dark: { ...pair.dark, h: 150, c: pair.dark.c * 0.45 },
  } : pair,
]));

export const themeSets = { 'high-contrast': highContrast, forest } as const;

import { themePalettes } from '../../js/theme-presets.ts';
/** Hue remapping preserves luminance endpoints; every result is still checked. */
export const paletteSets: Record<string,SchemeColors> = Object.fromEntries(themePalettes.map(palette=>[palette.id,
  Object.fromEntries(Object.entries(semanticColors).map(([name,pair])=>[name,
    palette.hue !== null && /^(accent-|selected-|focus-ring$)/.test(name) ? {
      light:{...pair.light,h:palette.hue,c:palette.id==='ink'?0:pair.light.c*0.35},
      dark:{...pair.dark,h:palette.hue,c:palette.id==='ink'?0:pair.dark.c*0.35},
    }:pair,
  ])),
]));

// Tinted neutral surfaces carry the palette through the whole workspace while
// retaining each role's luminance endpoint and its declared contrast edges.
for (const palette of themePalettes) {
  if (palette.hue === null || palette.id === 'ink') continue;
  const colors = paletteSets[palette.id]!;
  for (const role of ['bg-canvas','bg-surface','bg-raised','bg-overlay','bg-sunken','bg-subtle','bg-muted']) {
    const pair = colors[role]!;
    colors[role] = {
      light: {...pair.light, h: palette.hue, c: Math.min(0.025, (1-pair.light.l)*0.35)},
      dark: {...pair.dark, h: palette.hue, c: 0.018},
    };
  }
}

// The reference's mint CTA and blue/violet navigation are independent treatments.
// Keep text endpoints unchanged so the whole palette still clears its contract.
paletteSets.helix!['selected-bg']={light:{l:0.94,c:0.035,h:175},dark:{l:0.25,c:0.025,h:175}};
paletteSets.helix!['bg-subtle']={light:{l:0.985,c:0.008,h:175},dark:semanticColors['bg-subtle'].dark};
