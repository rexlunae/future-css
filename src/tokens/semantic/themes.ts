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

export const forest: SchemeColors = Object.fromEntries(Object.entries(semanticColors).map(([name, pair]) => [name,
  /^(accent-|selected-|focus-ring$)/.test(name) ? {
    light: { ...pair.light, h: 150, c: pair.light.c * 0.45 },
    dark: { ...pair.dark, h: 150, c: pair.dark.c * 0.45 },
  } : pair,
]));

export const themeSets = { 'high-contrast': highContrast, forest } as const;
