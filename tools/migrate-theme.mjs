#!/usr/bin/env node
import {migrateThemeFile} from './theme-files.mjs';
try{
  const args=process.argv.slice(2);const source=args.shift();let destination,themeVersion;
  while(args.length){const flag=args.shift();if(flag==='--to'&&!destination)destination=args.shift();else if(flag==='--theme-version'&&!themeVersion)themeVersion=args.shift();else throw new Error(`Unknown option ${flag}`);}
  if(!source)throw new Error('Usage: node tools/migrate-theme.mjs theme.toml [--to migrated.toml] [--theme-version 1.0.0]');
  const output=await migrateThemeFile(source,{destination,themeVersion});if(destination)console.log(`Migrated to ${destination}; original preserved`);else process.stdout.write(output);
}catch(error){console.error(error.message);process.exitCode=1;}
