import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it} from 'node:test';
import {installThemeFile,migrateThemeFile,readThemeContract} from '../tools/theme-files.mjs';
import {parseThemeToml,serializeThemeToml} from '../src/js/theme-toml.ts';
import {migrateTheme} from '../src/js/theme-migrations.ts';
import {validateCustomTheme} from '../src/js/theme-picker.ts';
import {compareThemeVersions,createThemeSchema,THEME_SCHEMA_VERSION} from '../src/js/theme-schema.ts';
const theme={schemaVersion:1,version:'1.0.0',id:'installed-theme',name:'Installed',description:'A verified preset',base:'future',shape:'round'};
it('requires schema/version on installation and provides an explicit legacy migration',async()=>{
  const contract=await readThemeContract();const legacy={...theme};delete legacy.schemaVersion;delete legacy.version;
  assert.throws(()=>validateCustomTheme(legacy,contract),/Migrate/);
  assert.throws(()=>migrateTheme(legacy,{contract}),/explicit/);
  const migrated=migrateTheme(legacy,{themeVersion:'1.0.0',contract});assert.equal(migrated.schemaVersion,THEME_SCHEMA_VERSION);assert.equal(migrated.shape,legacy.shape);
  assert.deepEqual(migrateTheme(migrated,{contract}),migrated);
  assert.throws(()=>migrateTheme({...theme,schemaVersion:999},{contract}),/no migration/);
  assert.throws(()=>validateCustomTheme({...theme,version:'01.0.0'},contract),/SemVer/);
  assert.throws(()=>validateCustomTheme({...theme,colors:{'text-default':{light:'#0e0f13',dark:'#f9fafb',extra:'x'}}},contract),/Unknown color/);
  const schema=createThemeSchema(Object.keys(contract.colors));assert.equal(schema.properties.schemaVersion.const,1);assert.equal(schema.additionalProperties,false);
  assert.ok(schema.required.includes('version'));assert.equal(Object.keys(schema.properties.colors.properties).length,Object.keys(contract.colors).length);
  assert.deepEqual(parseThemeToml(serializeThemeToml(migrated)),migrated);
});
it('uses correct SemVer precedence for theme upgrades',()=>{
  const ordered=['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0','1.0.1','2.0.0'];
  for(let i=1;i<ordered.length;i++)assert.equal(compareThemeVersions(ordered[i-1],ordered[i]),-1);
  assert.equal(compareThemeVersions('1.0.0+one','1.0.0+two'),0);
});
it('installs only valid current themes and upgrades atomically with a backup',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fc-theme-install-'));try{
    const source=join(dir,'source.toml'),destination=join(dir,'installed','theme.toml');
    await writeFile(source,serializeThemeToml({...theme,schemaVersion:999}));
    await assert.rejects(installThemeFile(source,destination),/Migrate/);await assert.rejects(access(destination));
    await writeFile(source,serializeThemeToml({...theme,colors:{'text-default':{light:'#ffffff',dark:'#000000'}}}));
    await assert.rejects(installThemeFile(source,destination),/needs/);await assert.rejects(access(destination));
    await writeFile(source,serializeThemeToml(theme));await installThemeFile(source,destination);const before=await readFile(destination,'utf8');
    await assert.rejects(installThemeFile(source,destination),/already installed/);
    await assert.rejects(installThemeFile(source,destination,{upgrade:true}),/newer/);
    await writeFile(source,serializeThemeToml({...theme,id:'other-theme',version:'2.0.0'}));await assert.rejects(installThemeFile(source,destination,{upgrade:true}),/retain/);
    await writeFile(source,serializeThemeToml({...theme,version:'1.1.0',depth:'flat'}));await installThemeFile(source,destination,{upgrade:true});
    assert.equal(await readFile(destination+'.1.0.0.bak','utf8'),before);assert.equal(parseThemeToml(await readFile(destination,'utf8')).version,'1.1.0');
    await writeFile(source,serializeThemeToml(theme));await assert.rejects(installThemeFile(source,destination,{upgrade:true}),/newer/);
    const legacy=join(dir,'legacy.toml'),migrated=join(dir,'migrated.toml');await writeFile(legacy,'id="legacy"\nname="Legacy"\ndescription="Old design"\nbase="future"\n');
    const legacyBefore=await readFile(legacy,'utf8');const output=await migrateThemeFile(legacy,{themeVersion:'1.0.0'});assert.equal(parseThemeToml(output).schemaVersion,1);await assert.rejects(access(migrated));
    await migrateThemeFile(legacy,{themeVersion:'1.0.0',destination:migrated});assert.equal(await readFile(legacy,'utf8'),legacyBefore);await assert.rejects(migrateThemeFile(legacy,{themeVersion:'1.0.0',destination:migrated}),/EEXIST/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
