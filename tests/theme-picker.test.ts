import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {it} from 'node:test';
import {themePresets,themePalettes,designOverrides} from '../src/js/theme-presets.ts';
import {validateCustomTheme} from '../src/js/theme-picker.ts';
import {parseThemeToml} from '../src/js/theme-toml.ts';
import {paletteSets} from '../src/tokens/semantic/themes.ts';
import {contrastPairs,checkContrast} from '../src/tokens/semantic/color.ts';
const contract=JSON.parse(readFileSync(new URL('../dist/theme-contract.json',import.meta.url),'utf8'));
const theme={schemaVersion:1,version:'1.0.0',id:'custom-reading',name:'Reading',description:'Readable custom design',base:'editorial'};
it('ships twenty-one distinct complete design presets and independently checked palettes',()=>{
  assert.equal(themePresets.length,21);assert.equal(new Set(themePresets.map(p=>p.id)).size,21);
  const designs=themePresets.map(p=>JSON.stringify(designOverrides(p)));assert.equal(new Set(designs).size,21);
  assert.equal(themePalettes.length,10);
  for(const colors of Object.values(paletteSets))assert.deepEqual(checkContrast(contrastPairs,colors),[]);
  const css=readFileSync(new URL('../dist/themes.css',import.meta.url),'utf8');
  for(const p of themePresets)assert.ok(css.includes(`[data-fc-design="${p.id}"]`));
  for(const p of themePalettes)assert.ok(css.includes(`[data-fc-palette="${p.id}"]`));
  const core=readFileSync(new URL('../dist/tokens.css',import.meta.url),'utf8');
  for(const hue of ['red','orange','yellow','green','blue','violet']){assert.ok(css.includes('--fc-color-pride-'+hue+':'));assert.ok(!core.includes('--fc-color-pride-'+hue+':'));}
});
it('limits custom geometry and typography without allowing CSS or tiny controls',()=>{
  assert.equal(validateCustomTheme(theme).base,'editorial');
  for(const invalid of [{shape:'999rem'},{type:'url(https://fonts.example)'},{depth:'0 0 99px red'},{surface:'transparent'},{padding:'0'},{id:'future'},{base:'unknown'}])assert.throws(()=>validateCustomTheme({...theme,...invalid}));
  for(const p of themePresets){const overrides=designOverrides(p);assert.match(overrides['--fc-masthead-focus'], /^var\(--fc-color-(focus-ring|text-inverse)\)$/);assert.ok(!Object.keys(overrides).some(k=>/target|font-size|focus-ring-width|focus-ring-offset|duration/.test(k)));}
});
it('rejects inaccessible color imports without mutating the supplied definition',()=>{
  assert.throws(()=>validateCustomTheme({...theme,colors:{'text-default':{light:'#ffffff',dark:'#000000'}}},contract),/needs/);
  assert.throws(()=>validateCustomTheme({...theme,colors:{'bogus':{light:'#ffffff',dark:'#000000'}}},contract),/role/);
  assert.throws(()=>validateCustomTheme({...theme,colors:{'text-default':{light:'red',dark:'#ffffff'}}},contract),/sRGB/);
  assert.throws(()=>validateCustomTheme({...theme,colors:{} }),/contract/);
  const valid={...theme,palette:'forest',colors:{'text-default':contract.colors['text-default']}};
  const before=structuredClone(valid);const result=validateCustomTheme(valid,contract);assert.deepEqual(valid,before);
  assert.deepEqual(result.colors!['accent-bg'],contract.palettes.forest['accent-bg']);
  assert.equal(Object.keys(result.colors!).length,Object.keys(contract.colors).length);
});
it('parses actual TOML strings, comments, tables and Unicode without evaluating code',()=>{
  const parsed=parseThemeToml(`# heading\n[theme]\nschema-version = 1\nversion = "1.0.0"\nid = 'reading'\nname = "Reader \\U0001F4DA" # escaped\ndescription = 'No scripts # just text'\nbase = "editorial"\n[colors."text-default"]\nlight = "#0e0f13"\ndark = "#f9fafb"\n`);
  assert.equal((parsed as any).name,'Reader 📚');assert.equal((parsed as any).colors['text-default'].light,'#0e0f13');
  assert.equal(validateCustomTheme(parseThemeToml(readFileSync(new URL('../demo/themes/reading-room.toml',import.meta.url),'utf8'))).id,'reading-room');
  for(const source of ['id="x"\nid="y"','name=["x"]','name="bad\\q"','[unknown]\nid="x"','[colors.foo]\nlight="#ffffff"\n[colors.foo]\ndark="#000000"','name="""multiline"""','name="\\U00110000"'])assert.throws(()=>parseThemeToml(source));
  assert.throws(()=>parseThemeToml('#'.repeat(65537)),/64 KiB/);
});

it('gives the experimental designs distinct static treatments with safe semantic endpoints',()=>{
  const values=Object.fromEntries(themePresets.map(p=>[p.id,designOverrides(p)]));
  assert.match(values.candy['--fc-theme-canvas-image'],/repeating-linear-gradient/);
  for(const id of ['candy','arcade','pride'])assert.notEqual(values[id]['--fc-theme-feature-text-shadow'],'none');
  assert.match(values.arcade['--fc-theme-feature-image'],/82%/);
  for(const hue of ['red','orange','yellow','green','blue','violet'])assert.ok(values.pride['--fc-theme-feature-image'].includes('--fc-color-pride-'+hue));
  assert.match(values.parchment['--fc-theme-canvas-image'],/31px/);
  assert.match(values.arcade['--fc-font-family-sans'],/monospace/);
  assert.match(values.garnet['--fc-theme-feature-image'],/conic-gradient/);
  assert.match(values.bubble['--fc-theme-feature-image'],/radial-gradient/);
  assert.match(values.solar['--fc-shadow-raised'],/6px 6px 0/);
  const arcade=themePresets.find(p=>p.id==='arcade')!;
  const custom=designOverrides({...arcade,depth:'flat',type:'serif',surface:'neutral'} as typeof themePresets[number]);
  assert.equal(custom['--fc-shadow-raised'],'none');assert.match(custom['--fc-font-family-sans'],/ui-serif/);assert.equal(custom['--fc-theme-feature-image'],'none');
  for(const preset of themePresets){
    const image=values[preset.id]['--fc-theme-feature-image'];
    if(image!=='none')assert.ok(![...image.matchAll(/--fc-color-([a-z-]+)/g)].some(m=>!['accent-bg','accent-bg-active',...(preset.id==='pride'?['pride-red','pride-orange','pride-yellow','pride-green','pride-blue','pride-violet']:[])].includes(m[1])));
    const canvas=values[preset.id]['--fc-theme-canvas-image'];
    if(canvas!=='none')assert.ok(![...canvas.matchAll(/--fc-color-([a-z-]+)/g)].some(m=>!['bg-canvas','bg-subtle'].includes(m[1])));
  }
});
