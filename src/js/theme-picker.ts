import { THEME_SCHEMA_VERSION, themeChoices as choices, themeVersionPattern, compareThemeVersions } from "./theme-schema.ts";
import { parseThemeToml, serializeThemeToml } from "./theme-toml.ts";
import { themePresets, themePalettes, designOverrides, type ThemeId, type PaletteId } from "./theme-presets.ts";
export { themePresets, themePalettes } from "./theme-presets.ts";
export interface ThemeState { design: string; palette: string; scheme: 'system'|'light'|'dark'; contrast: 'system'|'high'; }
export interface ThemeContract { palettes?: Record<string,Record<string,{light:string;dark:string}>>; pairs: readonly {fg:string;bg:string;min:number}[]; colors: Record<string,{light:string;dark:string}>; }
export interface CustomTheme {
  schemaVersion: number; version: string;
  id: string; name: string; description: string; base: ThemeId;
  shape?: typeof themePresets[number]['shape']; depth?: typeof themePresets[number]['depth'];
  surface?: typeof themePresets[number]['surface']; type?: typeof themePresets[number]['type'];
  palette?: PaletteId; colors?: Record<string,{light:string;dark:string}>;
}

function nextDraftVersion(version:string):string {
  const [major,minor,patch]=version.split(/[+-]/)[0]!.split('.');
  return `${major}.${minor}.${BigInt(patch!)+1n}`;
}

function luminance(hex:string):number {
  if(!/^#[\da-f]{6}$/i.test(hex)) throw new Error('Custom colors must be six-digit sRGB hex values');
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return rgb[0]!*0.2126+rgb[1]!*0.7152+rgb[2]!*0.0722;
}
/** A partial palette is checked as a complete resulting palette, never in isolation. */
export function validateCustomTheme(input:unknown,contract?:ThemeContract): CustomTheme {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Expected a theme object');
  const t=structuredClone(input) as CustomTheme;
  if(t.schemaVersion!==THEME_SCHEMA_VERSION)throw new Error(`Unsupported theme schema ${t.schemaVersion??"unversioned"}; expected ${THEME_SCHEMA_VERSION}. Migrate before installation.`);
  if(typeof t.version!=='string'||t.version.length>64||!themeVersionPattern.test(t.version))throw new Error('Theme version must be SemVer (for example 1.0.0)');
  if(!/^[a-z][a-z0-9-]{0,47}$/.test(t.id) || themePresets.some(p=>p.id===t.id)) throw new Error('Custom theme needs a unique id');
  for(const key of ['name','description'] as const) if(typeof t[key]!=='string' || !t[key].trim() || Array.from(t[key]).length>240) throw new Error(`Invalid ${key}`);
  if(!themePresets.some(p=>p.id===t.base)) throw new Error('Unknown base theme');
  for(const key of Object.keys(choices) as (keyof typeof choices)[]) if(t[key]!==undefined && !(choices[key] as readonly string[]).includes(t[key]!)) throw new Error(`Invalid ${key}`);
  if(t.palette!==undefined && !themePalettes.some(p=>p.id===t.palette)) throw new Error('Unknown palette');
  if(t.colors!==undefined){
    if(!contract || !contract.pairs.length) throw new Error('A library theme contract is required for custom colors');
    if(!t.colors || typeof t.colors!=='object' || Array.isArray(t.colors)) throw new Error('Invalid colors');
    const base=themePresets.find(p=>p.id===t.base)!;
    const merged={...(contract.palettes?.[t.palette??base.palette]??contract.colors)};
    for(const [role,pair] of Object.entries(t.colors)){
      if(!Object.hasOwn(contract.colors,role) || !pair || typeof pair!=='object' || Array.isArray(pair)) throw new Error(`Unknown or invalid color role: ${role}`);
      if(Object.keys(pair).some(key=>!['light','dark'].includes(key)))throw new Error('Unknown color setting');
      luminance(pair.light);luminance(pair.dark);merged[role]=pair;
    }
    for(const p of contract.pairs) for(const scheme of ['light','dark'] as const){
      const a=luminance(merged[p.fg]![scheme]), b=luminance(merged[p.bg]![scheme]);
      if((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)<p.min) throw new Error(`${scheme}: ${p.fg} on ${p.bg} needs ${p.min}:1`);
    }
    t.colors=merged;
  }
  const allowed=['schemaVersion','version','id','name','description','base','shape','depth','surface','type','palette','colors'];
  if(Object.keys(t).some(k=>!allowed.includes(k))) throw new Error('Unknown theme setting; arbitrary CSS is not supported');
  return structuredClone(t);
}
/** A page may set its scheme before script loads; the picker must start from it, not reset it. */
function schemeFromTheme(theme?:string):Partial<ThemeState> {
  const match=/^(high-contrast-)?(system|light|dark)$/.exec(theme??'');
  if(!match)return {};
  return {scheme:match[2] as ThemeState['scheme'],contrast:match[1]?'high':'system'};
}
export interface ThemePickerOptions {
  root: HTMLElement|string; target?: HTMLElement; initial?: Partial<ThemeState>;
  storageKey?: string; contract?: ThemeContract; customThemes?: readonly unknown[]; onChange?: (state:Readonly<ThemeState>)=>void;
}
export class FutureCssThemePicker {
  private root:HTMLElement; private target:HTMLElement; private state:ThemeState;
  private custom=new Map<string,CustomTheme>(); private abort=new AbortController(); private loadAbort?:AbortController;
  private sequence=0;
  private disposed=false; private media=matchMedia('(prefers-color-scheme: dark)');
  private preferences=[this.media,matchMedia('(prefers-contrast: more)'),matchMedia('(forced-colors: active)')];
  private ownedProperties:string[]=[];
  private snapshot:{design?:string;palette?:string;theme?:string;brand?:string};
  private initialProperties=new Map<string,{value:string;priority:string}>();
  private options:ThemePickerOptions;
  constructor(options:ThemePickerOptions){
    this.options=options;
    const root=typeof options.root==='string'?document.querySelector<HTMLElement>(options.root):options.root;
    if(!root) throw new Error('Theme picker root not found');this.root=root;this.root.dataset.fcKind='theme-picker';this.root.dataset.fcId=root.id||crypto.randomUUID();this.target=options.target??document.documentElement;
    this.snapshot={design:this.target.dataset.fcDesign,palette:this.target.dataset.fcPalette,theme:this.target.dataset.fcTheme,brand:this.target.dataset.fcBrand};
    this.state={design:this.target.dataset.fcDesign??'future',palette:this.target.dataset.fcPalette??'default',scheme:'system',contrast:'system',...schemeFromTheme(this.target.dataset.fcTheme),...options.initial};
    let storedCustom:unknown;
    if(options.storageKey) try { const saved=localStorage.getItem(options.storageKey);if(saved){const record=JSON.parse(saved);this.state={...this.state,...(record.state??record)};storedCustom=record.custom;} }catch{ /* Storage is optional in private/embedded contexts. */ }
    this.custom.set('custom', {schemaVersion:THEME_SCHEMA_VERSION,version:'1.0.0',id:'custom',name:'Custom',description:'Configure corners, elevation, surfaces, typography and palette.',base:'future',palette:'default'});
    if(storedCustom)try{this.custom.set('custom',validateCustomTheme(storedCustom,options.contract));}catch{}
    for(const input of options.customThemes??[]){const theme=validateCustomTheme(input,options.contract);this.custom.set(theme.id,theme);}
    this.normalize();this.render();this.apply(false);
    this.root.addEventListener('change',this.change,{signal:this.abort.signal});
    this.root.addEventListener('click',this.exportClick,{signal:this.abort.signal});
    for(const media of this.preferences)media.addEventListener('change',this.systemChange,{signal:this.abort.signal});
  }
  get value():Readonly<ThemeState>{return {...this.state};}
  private normalize(){
    if(!themePresets.some(p=>p.id===this.state.design)&&!this.custom.has(this.state.design))this.state.design='future';
    if(!themePalettes.some(p=>p.id===this.state.palette)&&!this.custom.get(this.state.palette)?.colors)this.state.palette='default';
    if(!['system','light','dark'].includes(this.state.scheme))this.state.scheme='system';
    if(!['system','high'].includes(this.state.contrast))this.state.contrast='system';
  }
  setState(next:Partial<ThemeState>){if(this.disposed)return;this.state={...this.state,...next};this.normalize();this.apply();}
  private systemChange=()=>this.apply(false);
  private change=(event:Event)=>{
    const control=event.target as HTMLInputElement|HTMLSelectElement;
    const field=control.dataset.fcThemeControl as keyof ThemeState;
    if(control.dataset.fcThemeImport!==undefined){this.importFile((control as HTMLInputElement).files?.[0]);return;}
    const parameter=control.dataset.fcThemeParameter;
    if(parameter){
      const current=this.custom.get('custom')!;
      const next={...current,[parameter]:control.value,version:nextDraftVersion(current.version)};
      if(parameter==='palette')delete next.colors;
      try {this.custom.set('custom',validateCustomTheme(next,this.options.contract));this.setState({design:'custom',palette:next.colors?'custom':next.palette??'default'});}catch(error){this.reportError(error);}
      return;
    }
    if(control.dataset.fcThemeColor==='role'){this.syncColorEditor();return;}
    if(!field)return;
    if(field==='design'){
      const preset=themePresets.find(p=>p.id===control.value);
      const custom=this.custom.get(control.value);
      this.setState({design:control.value,palette:custom?.colors?custom.id:custom?.palette??preset?.palette??'default'});
    }else this.setState({[field]:control.value});
  };
  /** The editor emits the same versioned TOML accepted by installation tools. */
  exportCustomTheme():string {return serializeThemeToml(this.custom.get('custom')!);}
  private exportClick=(event:Event)=>{
    if((event.target as HTMLElement).closest('[data-fc-theme-color-apply]')){
      const current=this.custom.get('custom')!,role=this.root.querySelector<HTMLSelectElement>('[data-fc-theme-color=role]')!.value;
      const light=this.root.querySelector<HTMLInputElement>('[data-fc-theme-color=light]')!.value,dark=this.root.querySelector<HTMLInputElement>('[data-fc-theme-color=dark]')!.value;
      try {const next=validateCustomTheme({...current,colors:{...current.colors,[role]:{light,dark}},version:nextDraftVersion(current.version)},this.options.contract);this.custom.set('custom',next);this.setState({design:'custom',palette:'custom'});}catch(error){this.reportError(error);}
      return;
    }
    if(!(event.target as HTMLElement).closest('[data-fc-theme-export]'))return;
    const blob=new Blob([this.exportCustomTheme()],{type:'application/toml'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='custom.toml';link.click();URL.revokeObjectURL(url);
  };
  private paletteItems():[string,string][]{
    return [...themePalettes.map(p=>[p.id,p.name] as [string,string]),...[...this.custom.values()].filter(t=>t.colors).map(t=>[t.id,t.name+' palette'] as [string,string])];
  }
  /** The first custom color creates a palette after render; without this the select cannot show or return to it. */
  private syncPaletteOptions(){
    const select=this.root.querySelector<HTMLSelectElement>('select[data-fc-theme-control=palette]');if(!select)return;
    const items=this.paletteItems();
    if(items.length!==select.options.length||items.some(([value],i)=>select.options[i]!.value!==value)){
      select.replaceChildren(...items.map(([value,name])=>{const option=document.createElement('option');option.value=value;option.textContent=name;return option;}));
    }
    select.value=this.state.palette;
  }
  private syncColorEditor(){
    const role=this.root.querySelector<HTMLSelectElement>('[data-fc-theme-color=role]')?.value;if(!role)return;
    const custom=this.custom.get('custom')!,base=themePresets.find(p=>p.id===custom.base)!;
    const pair=custom.colors?.[role]??this.options.contract?.palettes?.[custom.palette??base.palette]?.[role]??this.options.contract?.colors[role];
    if(pair)for(const scheme of ['light','dark'] as const)this.root.querySelector<HTMLInputElement>('[data-fc-theme-color='+scheme+']')!.value=pair[scheme];
  }
  private writeProperty(name:string,value:string){
    if(!this.initialProperties.has(name))this.initialProperties.set(name,{value:this.target.style.getPropertyValue(name),priority:this.target.style.getPropertyPriority(name)});
    this.target.style.setProperty(name,value);this.ownedProperties.push(name);
  }
  private restoreProperties(){
    for(const name of this.ownedProperties){const prior=this.initialProperties.get(name)!;if(prior.value)this.target.style.setProperty(name,prior.value,prior.priority);else this.target.style.removeProperty(name);}
    this.ownedProperties=[];
  }
  private apply(notify=true){
    this.restoreProperties();this.target.dataset.fcDesign=this.state.design;this.target.dataset.fcPalette=this.state.palette;
    // A prior brand override would otherwise silently defeat a palette selection.
    delete this.target.dataset.fcBrand;
    const scheme=this.state.scheme==='system'?(this.media.matches?'dark':'light'):this.state.scheme;
    if(this.state.contrast==='high')this.target.dataset.fcTheme=`high-contrast-${scheme}`;
    else if(this.state.scheme==='system')this.target.dataset.fcTheme='system';
    else this.target.dataset.fcTheme=scheme;
    const custom=this.custom.get(this.state.design);
    if(custom){
      const base=themePresets.find(p=>p.id===custom.base)!;
      const resolved={...base,...custom,id:base.id} as typeof themePresets[number];
      for(const [name,value] of Object.entries(designOverrides(resolved)))this.writeProperty(name,value);
    }
    const palette=this.custom.get(this.state.palette);
    const high=this.state.contrast==='high'||this.preferences[1]!.matches||this.preferences[2]!.matches;
    if(!high)for(const [role,pair] of Object.entries(palette?.colors??{}))this.writeProperty(`--fc-color-${role}`,`light-dark(${pair.light}, ${pair.dark})`);

    for(const control of this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-fc-theme-control]')){
      const key=control.dataset.fcThemeControl as keyof ThemeState;
      if(control.type==='radio') (control as HTMLInputElement).checked=control.value===this.state[key];else control.value=this.state[key];
    }
    for(const option of this.root.querySelectorAll<HTMLElement>('[data-fc-theme-option]')) {
      const id=option.dataset.fcThemeOption!,custom=this.custom.get(id);
      const base=themePresets.find(p=>p.id===(custom?.base??id))!;
      option.dataset.fcDesign=base.id;option.dataset.fcPalette=custom?.palette??base.palette;
      option.dataset.fcTheme=high?`high-contrast-${scheme}`:scheme;
      if(custom)for(const [name,value] of Object.entries(designOverrides({...base,...custom,id:base.id} as typeof base)))option.style.setProperty(name,value);
      for(const name of [...option.style])if(name.startsWith('--fc-color-'))option.style.removeProperty(name);
      if(custom?.colors&&!high)for(const [role,pair] of Object.entries(custom.colors))option.style.setProperty(`--fc-color-${role}`,`light-dark(${pair.light}, ${pair.dark})`);
    }
    const editor=this.root.querySelector<HTMLElement>('[data-fc-theme-editor]');if(editor)editor.hidden=this.state.design!=='custom';
    const draft=this.custom.get('custom')!,draftBase=themePresets.find(p=>p.id===draft.base)!;
    for(const parameter of this.root.querySelectorAll<HTMLSelectElement>('[data-fc-theme-parameter]')) {
      const key=parameter.dataset.fcThemeParameter as keyof CustomTheme;parameter.value=String(draft[key]??draftBase[key as keyof typeof draftBase]);
    }
    this.syncPaletteOptions();
    this.syncColorEditor();
    const design=this.custom.get(this.state.design)??themePresets.find(p=>p.id===this.state.design)!;
    const status=this.root.querySelector<HTMLElement>('[data-fc-theme-status]');if(status)status.textContent=`${design.name} · ${scheme}${this.preferences[2]!.matches?' · forced colors':high?' · high contrast':''}`;
    this.root.dataset.fcDesignSelection=this.state.design;
    this.root.dataset.fcPaletteSelection=this.state.palette;
    this.root.dataset.fcSchemeSelection=this.state.scheme;
    this.root.dataset.fcContrastSelection=this.state.contrast;
    this.root.dataset.fcThemeVersion=design.version;
    this.root.dataset.fcSchemaVersion=String(design.schemaVersion);
    this.recordState('complete');
    if(this.options.storageKey)try{localStorage.setItem(this.options.storageKey,JSON.stringify({state:this.state,custom:this.custom.get('custom')}));}catch{}
    if(notify)this.options.onChange?.(this.value);
  }
  /** Register bounded theme data; no fetched scripts/styles are executed. */
  registerTheme(input:unknown){
    if(this.disposed)throw new Error('Theme picker is destroyed');
    const theme=validateCustomTheme(input,this.options.contract),installed=this.custom.get(theme.id);
    if(installed){const precedence=compareThemeVersions(theme.version,installed.version);if(precedence<0)throw new Error('Cannot downgrade an installed theme');if(precedence===0){if(serializeThemeToml(theme)!==serializeThemeToml(installed))throw new Error('Changed theme content requires a new version');return theme.id;}}
    this.custom.set(theme.id,theme);this.render();this.apply(false);return theme.id;
  }
  private recordState(state:'pending'|'complete'|'error'){this.root.dataset.fcState=state;this.root.dataset.fcSeq=String(++this.sequence);this.root.dataset.fcTs=new Date().toISOString();}
  async loadTheme(url:string){
    if(this.disposed)throw new Error('Theme picker is destroyed');
    const resolved=new URL(url,document.baseURI);if(!['http:','https:'].includes(resolved.protocol))throw new Error('Theme URL must be HTTP(S)');
    this.loadAbort?.abort();const abort=new AbortController();this.loadAbort=abort;
    this.root.setAttribute('aria-busy','true');this.recordState('pending');const status=this.root.querySelector('[data-fc-theme-status]');if(status)status.textContent='Loading theme…';
    try {
    const response=await fetch(resolved,{signal:abort.signal,credentials:'same-origin'});if(!response.ok)throw new Error(`Theme request failed (${response.status})`);
    const reader=response.body?.getReader();if(!reader)throw new Error('Theme response is empty');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new Error('Theme TOML exceeds 64 KiB');}chunks.push(value);}
    if(this.disposed||abort.signal.aborted)throw new Error('Theme load cancelled');
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const id=this.registerTheme(parseThemeToml(new TextDecoder().decode(bytes)));this.recordState('complete');return id;
    }catch(error){if(!abort.signal.aborted&&!this.disposed)this.reportError(error);throw error;}
    finally{if(this.loadAbort===abort)this.root.removeAttribute('aria-busy');}
  }
  private reportError(error:unknown){this.recordState('error');const status=this.root.querySelector<HTMLElement>('[data-fc-theme-status]');if(status)status.textContent=`Theme was not applied: ${error instanceof Error?error.message:'Invalid theme'}`;}
  private async importFile(file?:File){
    if(!file)return;
    try{if(file.size>65536)throw new Error('Theme TOML exceeds 64 KiB');const input=parseThemeToml(await file.text());if(this.disposed)return;const id=this.registerTheme(input);this.setState({design:id,palette:this.custom.get(id)?.colors?id:this.custom.get(id)?.palette??themePresets.find(p=>p.id===this.custom.get(id)?.base)!.palette});this.recordState('complete');}catch(error){this.reportError(error);}
  }
  private render(){
    const active=document.activeElement as HTMLInputElement;const preserve=this.root.contains(active)?{field:active.dataset.fcThemeControl,value:active.value,import:active.dataset.fcThemeImport!==undefined}:null;
    const fieldset=document.createElement('fieldset');fieldset.className='fc-theme-picker__themes';
    const legend=document.createElement('legend');legend.className='fc-theme-picker__legend';legend.textContent='Design theme';fieldset.append(legend);
    const group=`fc-theme-${crypto.randomUUID()}`;
    for(const theme of [...themePresets,...this.custom.values()]){
      const label=document.createElement('label');label.className='fc-theme-picker__option';label.dataset.fcThemeOption=theme.id;
      const radio=document.createElement('input');radio.type='radio';radio.name=group;radio.value=theme.id;radio.className='fc-check__input';radio.dataset.fcThemeControl='design';
      const text=document.createElement('span');const name=document.createElement('strong');name.className='fc-theme-picker__name';name.textContent=theme.name;
      const desc=document.createElement('span');desc.className='fc-theme-picker__description';desc.textContent=theme.description;
      const preview=document.createElement('span');preview.className='fc-theme-picker__preview';preview.setAttribute('aria-hidden','true');
      const custom=this.custom.get(theme.id);const base=themePresets.find(p=>p.id===(custom?.base??theme.id))!;
      const window=document.createElement('span');window.className='fc-theme-picker__window';
      const chrome=document.createElement('span');chrome.className='fc-theme-picker__window-bar';chrome.textContent='Workspace';
      const body=document.createElement('span');body.className='fc-theme-picker__window-body';
      const rail=document.createElement('span');rail.className='fc-theme-picker__window-nav';
      for(const word of ['Home','Projects']){const item=document.createElement('span');item.textContent=word;rail.append(item);}
      const content=document.createElement('span');content.className='fc-theme-picker__window-content';
      const feature=document.createElement('span');feature.className='fc-theme-picker__window-feature';feature.textContent='Your next idea';
      const card=document.createElement('span');card.className='fc-theme-picker__preview-card';card.textContent='Ready to create';
      const action=document.createElement('span');action.className='fc-theme-picker__preview-action';action.textContent='Continue';
      content.append(feature,card,action);body.append(rail,content);window.append(chrome,body);preview.append(window);
      text.append(preview,name,desc);label.append(radio,text);fieldset.append(label);
    }
    const controls=document.createElement('div');controls.className='fc-theme-picker__controls';
    for(const [key,title,items] of [
      ['palette','Color palette',this.paletteItems()],
      ['scheme','Color scheme',[['system','Follow system'],['light','Light'],['dark','Dark']]],
      ['contrast','Contrast',[['system','Follow system'],['high','High contrast']]],
    ] as const){
      const label=document.createElement('label');label.className='fc-theme-picker__field';label.append(title);
      const select=document.createElement('select');select.className='fc-input';select.dataset.fcThemeControl=key;
      for(const [value,name] of items){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);}label.append(select);controls.append(label);
    }
    const importLabel=document.createElement('label');importLabel.className='fc-theme-picker__field';importLabel.append('Import custom theme (TOML)');
    const file=document.createElement('input');file.type='file';file.accept='.toml,application/toml,text/plain';file.className='fc-input';file.dataset.fcThemeImport='';importLabel.append(file);controls.append(importLabel);
    const editor=document.createElement('fieldset');editor.className='fc-theme-picker__editor';editor.dataset.fcThemeEditor='';
    const editorLegend=document.createElement('legend');editorLegend.textContent='Custom parameters';editor.append(editorLegend);
    for(const [key,title,items] of [
      ['base','Starting theme',themePresets.map(p=>[p.id,p.name])],
      ...Object.entries(choices).map(([key,items])=>[key,{shape:'Corner shape',depth:'Drop shadows',surface:'Color placement',type:'Typography'}[key],items.map(value=>[value,value])]),
      ['palette','Custom palette',themePalettes.map(p=>[p.id,p.name])],
    ] as [string,string,string[][]][]){
      const label=document.createElement('label');label.className='fc-theme-picker__field';label.append(title);
      const select=document.createElement('select');select.className='fc-input';select.dataset.fcThemeParameter=key;
      for(const [value,name] of items){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);}label.append(select);editor.append(label);
    }
    if(this.options.contract){
      const roleLabel=document.createElement('label');roleLabel.className='fc-theme-picker__field';roleLabel.append('Semantic color');
      const roleSelect=document.createElement('select');roleSelect.className='fc-input';roleSelect.dataset.fcThemeColor='role';
      for(const role of Object.keys(this.options.contract.colors)){const option=document.createElement('option');option.value=role;option.textContent=role;roleSelect.append(option);}roleLabel.append(roleSelect);editor.append(roleLabel);
      for(const scheme of ['light','dark']){const label=document.createElement('label');label.className='fc-theme-picker__field';label.append(scheme==='light'?'Light color':'Dark color');const color=document.createElement('input');color.type='color';color.className='fc-input';color.dataset.fcThemeColor=scheme;label.append(color);editor.append(label);}
      const colorApply=document.createElement('button');colorApply.type='button';colorApply.className='fc-btn fc-btn--secondary';colorApply.dataset.fcThemeColorApply='';colorApply.textContent='Validate and apply color';editor.append(colorApply);
    }
    const exportButton=document.createElement('button');exportButton.type='button';exportButton.className='fc-btn fc-btn--secondary';exportButton.dataset.fcThemeExport='';exportButton.textContent='Export Custom TOML';editor.append(exportButton);
    const status=document.createElement('p');status.className='fc-theme-picker__status';status.dataset.fcThemeStatus='';status.setAttribute('role','status');
    this.root.replaceChildren(fieldset,controls,editor,status);
    if(preserve){const control=preserve.import?file:[...this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-fc-theme-control]')].find(c=>c.dataset.fcThemeControl===preserve.field&&(c.type!=='radio'||c.value===preserve.value));control?.focus();}
  }
  destroy(){this.disposed=true;this.root.removeAttribute('aria-busy');for(const control of this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select'))control.disabled=true;this.abort.abort();this.loadAbort?.abort();this.restoreProperties();
    for(const [key,value] of Object.entries(this.snapshot)){const attr=`data-fc-${key}`;if(value===undefined)this.target.removeAttribute(attr);else this.target.setAttribute(attr,value);}
  }
}
