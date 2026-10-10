import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { checkContrast, contrastPairs, semanticColors } from '../src/tokens/semantic/color.ts';
import { themeSets } from '../src/tokens/semantic/themes.ts';
import { oklchToHex } from '../src/tokens/color-utils.ts';
import { createAccelerator, JsAccelerator, CORE_ABI_VERSION } from '../src/js/accelerator.ts';
const read = (name: string) => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');

describe('named themes and generated outputs', () => {
  for (const [name, colors] of Object.entries(themeSets)) {
    it(`${name} preserves every semantic contrast minimum in both schemes`, () => {
      assert.deepEqual(Object.keys(colors).sort(), Object.keys(semanticColors).sort());
      assert.deepEqual(checkContrast(contrastPairs, colors), []);
      const broken = structuredClone(colors);
      broken['text-default'] = broken['bg-canvas']!;
      assert.ok(checkContrast(contrastPairs, broken).length > 0);
    });
  }
  it('declares contrast for all new state and depth colors', () => {
    for (const name of Object.keys(semanticColors).filter(n => /^(selected-|disabled-|surface-depth-|text-on-(success|warning|info)|.*-bg-(hover|active))/.test(n))) {
      assert.ok(contrastPairs.some(p => p.fg === name || p.bg === name), name);
    }
  });
  describe('generated artifacts', {skip: !existsSync(new URL('../dist/tokens.json',import.meta.url))}, () => {
  it('retains JSON token values and describes each one in the reference', () => {
    const json = JSON.parse(read('tokens.json'));
    const reference = readFileSync(new URL('../docs/TOKEN-REFERENCE.md', import.meta.url), 'utf8');
    for (const [name, value] of Object.entries(json).filter(([name]) => name.startsWith('--fc-'))) {
      assert.ok(json.$metadata.descriptions[name]?.length > 15, name);
      assert.ok(reference.includes('`' + name + '`'), name);
      if (name.startsWith('--fc-color-')) {
        const source = semanticColors[name.slice(11) as keyof typeof semanticColors];
        assert.deepEqual(value, {light: oklchToHex(source.light), dark: oklchToHex(source.dark)});
      }
    }
  });
  it('exports native string values without dropping either scheme', () => {
    const json = JSON.parse(read('tokens.json'));
    for (const file of ['FutureCssTokens.swift', 'FutureCssTokens.kt']) {
      const source = read(file);
      for (const [name, value] of Object.entries(json).filter(([name]) => name.startsWith('--fc-'))) {
        const identifier = name.slice(5).replaceAll('-', '_');
        if (typeof value === 'string') assert.ok(source.includes(`${identifier} = ${JSON.stringify(value)}`), name);
        else {
          const pair = value as {light:string; dark:string};
          assert.ok(source.includes(`${identifier}_light = ${JSON.stringify(pair.light)}`), name);
          assert.ok(source.includes(`${identifier}_dark = ${JSON.stringify(pair.dark)}`), name);
        }
      }
    }
  });
  it('exports Figma color channels from the same hex values', () => {
    const figma = JSON.parse(read('figma-variables.json'));
    const color = figma.variables.find((v: any) => v.name === 'color/accent/bg');
    assert.equal(color.resolvedType, 'COLOR');
    const expected = oklchToHex(semanticColors['accent-bg'].light);
    assert.equal(Math.round(color.valuesByMode.light.r * 255), parseInt(expected.slice(1,3),16));
    assert.equal(Math.round(color.valuesByMode.light.g * 255), parseInt(expected.slice(3,5),16));
    assert.equal(Math.round(color.valuesByMode.light.b * 255), parseInt(expected.slice(5,7),16));
    assert.ok(figma.variables.every((v: any) => v.description && v.valuesByMode.dark !== undefined));
  });
  it('emits authored gamut values behind feature and theme guards', () => {
    const css=read('wide-gamut.css');
    assert.match(css, /@supports \(color: oklch/);
    assert.match(css, /color-gamut: p3/);
    assert.match(css, /forced-colors: none/);
    for (const [name,p] of Object.entries(semanticColors)) {
      assert.ok(css.includes(`--fc-color-${name}: light-dark(oklch(${p.light.l} ${p.light.c} ${p.light.h}), oklch(${p.dark.l} ${p.dark.c} ${p.dark.h}))`),name);
    }
  });
  it('generates email colors without modern CSS constructs or theme assumptions', () => {
    const css = read('email.css');
    assert.doesNotMatch(css, /var\(|light-dark\(|@layer|oklch\(/);
    assert.ok(css.includes(oklchToHex(semanticColors['accent-text'].light)));
    assert.ok(css.includes(oklchToHex(semanticColors['text-default'].light)));
  });
  });
});

it('avoids the WASM download under reduced data while keeping identical results', async () => {
  let loads = 0;
  const loadWasm = async () => { loads++; return { default: async () => ({kind:'wasm',abiVersion:CORE_ABI_VERSION}) }; };
  const automatic = await createAccelerator('auto', { reducedData:true, documentSize:100_000, loadWasm });
  assert.equal(loads, 0);
  assert.equal(automatic.reason, 'reduced-data');
  assert.equal(automatic.accelerator.slice('a😀b',1,2), new JsAccelerator().slice('a😀b',1,2));
  assert.equal((await createAccelerator('wasm', { reducedData:true, loadWasm })).reason, 'explicit-wasm');
  assert.equal(loads,1);
});
