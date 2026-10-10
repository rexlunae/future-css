import {THEME_SCHEMA_VERSION,themeVersionPattern} from "./theme-schema.ts";
import {validateCustomTheme,type ThemeContract,type CustomTheme} from "./theme-picker.ts";
/** Each schema step is explicit; future versions must add a migration here. */
const migrations:Record<number,(theme:Record<string,unknown>)=>Record<string,unknown>>={
  0:theme=>({...theme,schemaVersion:1}),
};
export function migrateTheme(input:unknown,options:{themeVersion?:string;contract?:ThemeContract}={}):CustomTheme{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected a theme object');
  let theme=structuredClone(input) as Record<string,unknown>;
  const version=theme.schemaVersion??0;
  if(!Number.isInteger(version)||Number(version)<0||Number(version)>THEME_SCHEMA_VERSION)throw new Error('Unsupported schema version; no migration path');
  if(theme.version===undefined){if(!options.themeVersion||!themeVersionPattern.test(options.themeVersion))throw new Error('Unversioned themes require an explicit themeVersion');theme.version=options.themeVersion;}
  let schema=Number(version);
  while(schema<THEME_SCHEMA_VERSION){const migrate=migrations[schema];if(!migrate)throw new Error(`Missing migration for schema ${schema}`);theme=migrate(theme);schema++;}
  return validateCustomTheme(theme,options.contract);
}
