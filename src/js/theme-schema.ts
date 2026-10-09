import {themePresets,themePalettes} from "./theme-presets.ts";
export const THEME_SCHEMA_VERSION=1;
export const themeChoices={shape:['balanced','crisp','round','organic','square'],depth:['flat','soft','lifted','edge'],surface:['neutral','outline','tinted','helix'],type:['system','serif']} as const;
export const THEME_VERSION_PATTERN='(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?';
export const themeVersionPattern=new RegExp(`^${THEME_VERSION_PATTERN}$`);
/** Exposed machine-readable schema and runtime validator share these choices. */
export function createThemeSchema(roles:readonly string[]){
  const hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
  const pair={type:'object',required:['light','dark'],additionalProperties:false,properties:{light:hex,dark:hex}};
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:future-css:theme:1',title:'Future CSS theme',type:'object',additionalProperties:false,required:['schemaVersion','version','id','name','description','base'],properties:{
    schemaVersion:{type:'integer',const:THEME_SCHEMA_VERSION},version:{type:'string',maxLength:64,pattern:`^${THEME_VERSION_PATTERN}$`},
    id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,47}$',not:{enum:themePresets.map(p=>p.id)}},
    name:{type:'string',minLength:1,maxLength:240,pattern:'\\S'},description:{type:'string',minLength:1,maxLength:240,pattern:'\\S'},
    base:{enum:themePresets.map(p=>p.id)},palette:{enum:themePalettes.map(p=>p.id)},
    ...Object.fromEntries(Object.entries(themeChoices).map(([key,values])=>[key,{enum:values}])),
    colors:{type:'object',additionalProperties:false,properties:Object.fromEntries(roles.map(role=>[role,pair]))},
  }};
}
/** SemVer precedence ignores build metadata and compares prerelease identifiers. */
export function compareThemeVersions(a:string,b:string):number{
  const left=themeVersionPattern.exec(a),right=themeVersionPattern.exec(b);if(!left||!right)throw new Error('Invalid theme version');
  for(let i=1;i<=3;i++){const x=BigInt(left[i]!),y=BigInt(right[i]!);if(x!==y)return x>y?1:-1;}
  if(left[4]===right[4])return 0;if(!left[4])return 1;if(!right[4])return -1;
  const l=left[4].split('.'),r=right[4].split('.');
  for(let i=0;i<Math.max(l.length,r.length);i++){
    if(l[i]===r[i])continue;if(l[i]===undefined)return -1;if(r[i]===undefined)return 1;
    const ln=/^\d+$/.test(l[i]!),rn=/^\d+$/.test(r[i]!);
    if(ln&&rn)return BigInt(l[i]!)>BigInt(r[i]!)?1:-1;if(ln!==rn)return ln?-1:1;
    return l[i]!>r[i]!?1:-1;
  }return 0;
}
