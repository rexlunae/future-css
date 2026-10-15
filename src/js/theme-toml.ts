/** The theme schema needs only single-line strings and named color tables.
 * Rejecting unsupported TOML avoids silently misinterpreting author intent. */
export function parseThemeToml(source:string):unknown {
  // A decoded file is already well formed; a string handed in may not be, and
  // fc-theme receives a lone surrogate as U+FFFD, so this one does too.
  source=source.toWellFormed();
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
    else{const decoded=basicString(literal.slice(1,-1));if(decoded.error)fail(index+1,decoded.error);value=decoded.value!;}
    Object.defineProperty(target,key,{value:value!,enumerable:true,writable:true,configurable:true});
  }
  return result;
}

const ESCAPES:Record<string,string>={'"':'"','\\':'\\',b:'\b',t:'\t',n:'\n',f:'\f',r:'\r'};
/**
 * A basic string's value, read left to right so `\\x` is a backslash and an x
 * rather than an unsupported `\x`. TOML's escapes only, and `\u`/`\U` must name
 * a Unicode scalar value: a lone surrogate is not text. fc-theme's `basic_string`
 * is the same loop.
 */
function basicString(body:string):{value?:string;error?:string}{
  let value='';
  for(let i=0;i<body.length;){
    const c=body.codePointAt(i)!,ch=String.fromCodePoint(c);i+=ch.length;
    if(ch!=='\\'){if(c<0x20&&ch!=='\t')return {error:'invalid quoted string'};value+=ch;continue;}
    const e=body[i++];if(e===undefined)return {error:'invalid quoted string'};
    if(Object.hasOwn(ESCAPES,e)){value+=ESCAPES[e];continue;}
    if(e!=='u'&&e!=='U')return {error:'unsupported string escape'};
    const hex=body.slice(i,i+(e==='u'?4:8));
    if(hex.length!==(e==='u'?4:8)||!/^[0-9a-fA-F]+$/.test(hex))return {error:'invalid quoted string'};
    i+=hex.length;const point=parseInt(hex,16);
    if(point>0x10ffff||(point>=0xd800&&point<=0xdfff))return {error:'invalid Unicode escape'};
    value+=String.fromCodePoint(point);
  }
  return {value};
}

/** Serialize only validated schema fields, never arbitrary TOML keys. */
export function serializeThemeToml(theme:Record<string,any>):string {
  const lines=[`schema-version = ${theme.schemaVersion}`];
  for(const key of ['version','id','name','description','base','shape','depth','surface','type','palette'])if(theme[key]!==undefined)lines.push(`${key} = ${JSON.stringify(theme[key])}`);
  for(const [role,pair] of Object.entries(theme.colors??{}).sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const colors=pair as {light:string;dark:string};lines.push('',`[colors.${JSON.stringify(role)}]`,`light = ${JSON.stringify(colors.light)}`,`dark = ${JSON.stringify(colors.dark)}`);
  }return lines.join('\n')+'\n';
}
