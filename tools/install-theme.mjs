#!/usr/bin/env node
import {installThemeFile} from './theme-files.mjs';
try{
  const args=process.argv.slice(2);const source=args.shift();let destination,upgrade=false;
  while(args.length){const flag=args.shift();if(flag==='--to'&&!destination)destination=args.shift();else if(flag==='--upgrade')upgrade=true;else throw new Error(`Unknown option ${flag}`);}
  if(!source||!destination)throw new Error('Usage: node tools/install-theme.mjs theme.toml --to installed/theme.toml [--upgrade]');
  const theme=await installThemeFile(source,destination,{upgrade});console.log(`Installed ${theme.name} ${theme.version} (schema ${theme.schemaVersion}) at ${destination}`);
}catch(error){console.error(error.message);process.exitCode=1;}
