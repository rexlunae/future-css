import {readFile,writeFile,copyFile,rename,unlink,mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseThemeToml,serializeThemeToml} from '../src/js/theme-toml.ts';
import {validateCustomTheme} from '../src/js/theme-picker.ts';
import {compareThemeVersions} from '../src/js/theme-schema.ts';
import {migrateTheme} from '../src/js/theme-migrations.ts';
export async function readThemeContract(){return JSON.parse(await readFile(new URL('../dist/theme-contract.json',import.meta.url),'utf8'));}
/** Schema and palette validation precede even creation of the destination directory. */
export async function installThemeFile(source,destination,{upgrade=false}={}){
  const contract=await readThemeContract();
  const theme=validateCustomTheme(parseThemeToml(await readFile(source,'utf8')),contract);
  const output=serializeThemeToml(theme);const path=resolve(destination);let old;
  try{old=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(old!==undefined){
    if(!upgrade)throw new Error('Theme already installed; use --upgrade for a versioned upgrade');
    const installed=validateCustomTheme(parseThemeToml(old),contract);
    if(installed.id!==theme.id)throw new Error('Upgrade must retain the installed theme id');
    if(compareThemeVersions(theme.version,installed.version)<=0)throw new Error('Upgrade requires a newer theme version');
  }
  await mkdir(dirname(path),{recursive:true});
  if(old===undefined){await writeFile(path,output,{flag:'wx'});return theme;}
  const temporary=`${path}.fc-${randomUUID()}.tmp`;
  try{
    await writeFile(temporary,output,{flag:'wx'});
    if(await readFile(path,'utf8')!==old)throw new Error('Installed theme changed during upgrade');
    const previous=parseThemeToml(old);
    await copyFile(path,`${path}.${previous.version}.bak`,constants.COPYFILE_EXCL);
    await rename(temporary,path);
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return theme;
}
export async function migrateThemeFile(source,{destination,themeVersion}={}){
  const theme=migrateTheme(parseThemeToml(await readFile(source,'utf8')),{themeVersion,contract:await readThemeContract()});
  const output=serializeThemeToml(theme);
  if(destination){await mkdir(dirname(resolve(destination)),{recursive:true});await writeFile(destination,output,{flag:'wx'});}
  return output;
}
