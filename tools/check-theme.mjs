/** Validate a loadable theme against the same contract shipped to the picker. */
import {readFile} from 'node:fs/promises';
import {parseThemeToml} from '../src/js/theme-toml.ts';
import {validateCustomTheme} from '../src/js/theme-picker.ts';
const files=process.argv.slice(2);
if(!files.length){console.error('Usage: node tools/check-theme.mjs theme.toml ... (run build:css first)');process.exitCode=1;}
else try{
  const contract=JSON.parse(await readFile(new URL('../dist/theme-contract.json',import.meta.url),'utf8'));
  for(const file of files){const theme=validateCustomTheme(parseThemeToml(await readFile(file,'utf8')),contract);console.log(`${file}: ${theme.name} passes the theme schema and both-scheme contrast contract`);}
}catch(error){console.error(error.message);process.exitCode=1;}
