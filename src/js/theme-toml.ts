/** The theme schema needs only single-line strings and named color tables.
 * Rejecting unsupported TOML avoids silently misinterpreting author intent. */
export function parseThemeToml(source:string):unknown {
  if(new TextEncoder().encode(source).byteLength>65536)throw new Error('Theme TOML exceeds 64 KiB');
  const result:Record<string,unknown>={};const colors:Record<string,unknown>=Object.create(null);
  const tables=new Set<string>();let target=result;
  const fail=(line:number,message:string):never=>{throw new Error(`Theme TOML line ${line}: ${message}`);};
  const lines=source.replace(/^\uFEFF/,'').split(/\r?\n/);
  for(let index=0;index<lines.length;index++){
    const line=lines[index]!.trim();if(!line||line.startsWith('#'))continue;
    if(line.startsWith('[')){
      const table=/^\[(theme|colors\.([a-z][a-z0-9-]*|"[a-z][a-z0-9-]*"))\]\s*(?:#.*)?$/.exec(line);
      if(!table)fail(index+1,'expected [theme] or [colors.role-name]');
      const name=table![1]!;if(tables.has(name))fail(index+1,'duplicate table');tables.add(name);
      if(name==='theme')target=result;
      else{const role=table![2]!.replaceAll('"','');if(Object.hasOwn(colors,role))fail(index+1,'duplicate color table');target={};colors[role]=target;result.colors=colors;}
      continue;
    }
    const schema=/^schema-version\s*=\s*(0|[1-9][0-9]*)\s*(?:#.*)?$/.exec(line);
    if(schema){if(target!==result)fail(index+1,'schema-version belongs in the theme table');if(Object.hasOwn(result,'schemaVersion'))fail(index+1,'duplicate schema-version');result.schemaVersion=Number(schema[1]);continue;}
    const entry=/^([a-z][a-z0-9-]*)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
    if(!entry)fail(index+1,'expected key = "string"; arrays, dates and multiline strings are not theme settings');
    const key=entry![1]!,literal=entry![2]!;
    if(Object.hasOwn(target,key))fail(index+1,`duplicate key ${key}`);
    let value:string;
    if(literal.startsWith("'"))value=literal.slice(1,-1);
    else{
      if(/\\(?!["\\btnfruU])/.test(literal))fail(index+1,'unsupported string escape');
      const normalized=literal.replace(/\\U([0-9a-fA-F]{8})/g,(_,hex)=>{
        const point=parseInt(hex,16);if(point>0x10ffff||(point>=0xd800&&point<=0xdfff))fail(index+1,'invalid Unicode escape');return JSON.stringify(String.fromCodePoint(point)).slice(1,-1);
      });
      try{value=JSON.parse(normalized);}catch{fail(index+1,'invalid quoted string');}
    }
    Object.defineProperty(target,key,{value:value!,enumerable:true,writable:true,configurable:true});
  }
  return result;
}

/** Serialize only validated schema fields, never arbitrary TOML keys. */
export function serializeThemeToml(theme:Record<string,any>):string {
  const lines=[`schema-version = ${theme.schemaVersion}`];
  for(const key of ['version','id','name','description','base','shape','depth','surface','type','palette'])if(theme[key]!==undefined)lines.push(`${key} = ${JSON.stringify(theme[key])}`);
  for(const [role,pair] of Object.entries(theme.colors??{}).sort(([a],[b])=>a.localeCompare(b))){
    const colors=pair as {light:string;dark:string};lines.push('',`[colors.${JSON.stringify(role)}]`,`light = ${JSON.stringify(colors.light)}`,`dark = ${JSON.stringify(colors.dark)}`);
  }return lines.join('\n')+'\n';
}
