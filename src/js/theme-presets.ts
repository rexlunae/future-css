/** Shared catalog: the compiler and picker use the same bounded design choices. */
export const themePresets = [
  {schemaVersion:1,version:'1.2.0',id:'future',name:'Future',description:'Balanced corners, quiet surfaces and soft elevation.',palette:'default',shape:'balanced',depth:'soft',surface:'neutral',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'clarity',name:'Clarity',description:'Crisp edges, flat surfaces and outlined actions.',palette:'default',shape:'crisp',depth:'flat',surface:'outline',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'helix',name:'Helix',description:'Charcoal chrome, mint actions and violet feature surfaces.',palette:'helix',shape:'crisp',depth:'soft',surface:'helix',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'forest',name:'Forest',description:'Organic curves, green accents and calm surfaces.',palette:'forest',shape:'organic',depth:'soft',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'editorial',name:'Editorial',description:'Serif reading, restrained corners and ink-like controls.',palette:'ink',shape:'crisp',depth:'flat',surface:'outline',type:'serif'},
  {schemaVersion:1,version:'1.2.0',id:'graphite',name:'Graphite',description:'Monochrome surfaces with distinct, structured edges.',palette:'ink',shape:'balanced',depth:'edge',surface:'neutral',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'ocean',name:'Ocean',description:'Cool teal, rounded panels and a tinted header.',palette:'teal',shape:'round',depth:'soft',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'ember',name:'Ember',description:'Warm accents, substantial elevation and squared panels.',palette:'ember',shape:'balanced',depth:'lifted',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'blueprint',name:'Blueprint',description:'Square geometry, blue accents and precise outlines.',palette:'blue',shape:'square',depth:'edge',surface:'outline',type:'system'},
  {schemaVersion:1,version:'1.2.0',id:'bloom',name:'Bloom',description:'Playful curves, rose accents and floating colored panels.',palette:'rose',shape:'organic',depth:'lifted',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.0.0',id:'aurora',name:'Aurora',description:'Violet ribbons, luminous curves and floating surfaces.',palette:'violet',shape:'round',depth:'lifted',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.0.1',id:'candy',name:'Candy',description:'Rose candy stripes, pillowy panels and playful elevation.',palette:'rose',shape:'organic',depth:'soft',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.0.0',id:'solar',name:'Solar',description:'Amber sunshine, square panels and decisive offset shadows.',palette:'amber',shape:'square',depth:'edge',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.0.0',id:'nocturne',name:'Nocturne',description:'Ink chrome, violet spotlights and elegant serif reading.',palette:'violet',shape:'crisp',depth:'lifted',surface:'helix',type:'serif'},
  {schemaVersion:1,version:'1.0.1',id:'arcade',name:'Arcade',description:'Green scanlines, square geometry and terminal-inspired type.',palette:'forest',shape:'square',depth:'edge',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.0.0',id:'parchment',name:'Parchment',description:'Warm ruled paper, serif type and quiet outlined controls.',palette:'amber',shape:'crisp',depth:'flat',surface:'outline',type:'serif'},
  {schemaVersion:1,version:'1.0.0',id:'bubble',name:'Bubble',description:'Teal bubbles, generous curves and buoyant layered shadows.',palette:'teal',shape:'organic',depth:'lifted',surface:'tinted',type:'system'},
  {schemaVersion:1,version:'1.0.0',id:'garnet',name:'Garnet',description:'Rose jewel facets, crisp serif panels and charcoal chrome.',palette:'rose',shape:'crisp',depth:'soft',surface:'helix',type:'serif'},
  {schemaVersion:1,version:'1.0.0',id:'origami',name:'Origami',description:'Blue folded ribbons, angular outlines and paper shadows.',palette:'blue',shape:'square',depth:'soft',surface:'outline',type:'system'},
  {schemaVersion:1,version:'1.0.0',id:'sundown',name:'Sundown',description:'Ember horizons, rounded reading panels and long soft shadows.',palette:'ember',shape:'round',depth:'lifted',surface:'tinted',type:'serif'},
  {schemaVersion:1,version:'1.0.0',id:'pride',name:'Pride',description:'Rainbow ribbons, joyful rounded panels and clear violet actions.',palette:'violet',shape:'round',depth:'soft',surface:'tinted',type:'system'},
] as const;
export const themePalettes = [
  {id:'default',name:'Future blue',hue:null},{id:'blue',name:'Blueprint blue',hue:255},
  {id:'violet',name:'Violet',hue:300},{id:'forest',name:'Forest',hue:150},
  {id:'ink',name:'Ink',hue:0},{id:'teal',name:'Ocean teal',hue:190},
  {id:'ember',name:'Ember',hue:45},{id:'rose',name:'Rose',hue:350},
  {id:'amber',name:'Amber',hue:85},{id:'helix',name:'Helix violet & mint',hue:280},
] as const;
export type ThemeId = typeof themePresets[number]['id'];
export type PaletteId = typeof themePalettes[number]['id'];

const corners = {
  balanced:['0.375rem','0.5rem','0.75rem','1rem','1.5rem'],
  crisp:['0.125rem','0.25rem','0.375rem','0.5rem','0.75rem'],
  round:['0.625rem','0.875rem','1.125rem','1.5rem','2rem'],
  organic:['0.75rem','1rem','1.5rem','2rem','2.5rem'],
  square:['0','0','0','0','0'],
} as const;
export function designOverrides(preset: typeof themePresets[number]): Record<string,string> {
  const values:Record<string,string>={'--fc-theme-canvas-image':'none','--fc-theme-feature-text-shadow':'none'};
  // Structured designs use an outline; softer designs let color and elevation
  // define their surfaces without imposing a heavy stroke on every component.
  const outlined=preset.depth==='edge'||preset.id==='clarity';
  values['--fc-border-width-control']=`var(--fc-border-width-${outlined?'thick':'thin'})`;
  values['--fc-border-width-surface']=`var(--fc-border-width-${outlined?'thick':'thin'})`;
  ['sm','md','lg','xl','2xl'].forEach((key,index)=>values[`--fc-radius-${key}`]=corners[preset.shape][index]!);
  const depths={flat:['none','none','none'],soft:['raised','overlay','modal'],lifted:['floating','modal','dialog'],edge:['edge','edge','edge']} as const;
  ['raised','overlay','modal'].forEach((key,index)=>{
    const value=depths[preset.depth][index]!;
    values[`--fc-shadow-${key}`]=value==='none'?'none':`var(--fc-elevation-${value})`;
  });
  values['--fc-font-family-sans']=preset.type==='serif'?'ui-serif, Georgia, "Noto Serif", serif':'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
  values['--fc-card-bg']=`var(--fc-color-${preset.surface==='tinted'?'selected-bg':'bg-surface'})`;
  values['--fc-masthead-bg']=`var(--fc-color-${preset.surface==='tinted'?'selected-bg':'bg-surface'})`;
  values['--fc-composer-bg']=`var(--fc-color-${preset.surface==='tinted'?'selected-bg':'bg-surface'})`;
  values['--fc-card-shadow']='var(--fc-shadow-raised)';
  Object.assign(values,{'--fc-masthead-fg':'var(--fc-color-text-default)','--fc-masthead-muted':'var(--fc-color-text-muted)','--fc-masthead-disabled-fg':'var(--fc-color-disabled-fg)','--fc-masthead-interaction-bg':'var(--fc-color-bg-subtle)','--fc-masthead-focus':'var(--fc-color-focus-ring)','--fc-nav-selected-bg':'var(--fc-color-accent-bg-subtle)','--fc-nav-selected-fg':'var(--fc-color-accent-text)'});
  for(const [slot,role] of Object.entries(preset.surface==='outline'?{'bg':'bg-surface','fg':'text-default','border':'border-interactive'}:{'bg':'accent-bg','fg':'text-on-accent','border':'accent-border'})) values[`--fc-btn-primary-${slot}`]=`var(--fc-color-${role})`;
  values['--fc-btn-primary-bg-hover']=`var(--fc-color-${preset.surface==='outline'?'bg-subtle':'accent-bg-hover'})`;
  values['--fc-btn-primary-bg-active']=`var(--fc-color-${preset.surface==='outline'?'bg-subtle':'accent-bg-active'})`;
  values['--fc-theme-feature-bg']='var(--fc-color-bg-surface)';
  values['--fc-theme-feature-fg']='var(--fc-color-text-default)';
  values['--fc-theme-feature-image']='none';
  values['--fc-card-border']=`var(--fc-color-border-${outlined?'interactive':'subtle'})`;
  values['--fc-card-border-style']=preset.id==='blueprint'?'dashed':'solid';
  if(preset.surface==='tinted') {
    values['--fc-theme-feature-bg']='var(--fc-color-accent-bg)';
    values['--fc-theme-feature-fg']='var(--fc-color-text-on-accent)';
    values['--fc-theme-feature-image']='linear-gradient(135deg in srgb-linear, var(--fc-color-accent-bg), var(--fc-color-accent-bg-active))';
  }
  if(preset.surface==='helix'){
    Object.assign(values,{
      '--fc-masthead-bg':'var(--fc-color-bg-inverse)',
      '--fc-masthead-fg':'var(--fc-color-text-inverse)',
      '--fc-masthead-muted':'var(--fc-color-text-inverse-muted)',
      '--fc-masthead-interaction-bg':'var(--fc-color-bg-inverse)',
      '--fc-masthead-focus':'var(--fc-color-text-inverse)',
      '--fc-masthead-disabled-fg':'var(--fc-color-text-inverse-muted)',
      '--fc-nav-selected-bg':'var(--fc-color-accent-bg)',
      '--fc-nav-selected-fg':'var(--fc-color-text-on-accent)',
      '--fc-btn-primary-bg':'var(--fc-color-selected-bg)',
      '--fc-btn-primary-bg-hover':'var(--fc-color-selected-bg)',
      '--fc-btn-primary-bg-active':'var(--fc-color-selected-bg)',
      '--fc-btn-primary-fg':'var(--fc-color-selected-fg)',
      '--fc-theme-feature-bg':'var(--fc-color-accent-bg)',
      '--fc-theme-feature-fg':'var(--fc-color-text-on-accent)',
      '--fc-theme-feature-image':'linear-gradient(135deg in srgb-linear, var(--fc-color-accent-bg), var(--fc-color-accent-bg-active))',
    });
  }
  // Patterns interpolate only between backgrounds with the same declared text
  // contracts; decoration never introduces an unchecked foreground pairing.
  const canvas='var(--fc-color-bg-canvas)', subtle='var(--fc-color-bg-subtle)';
  const accent='var(--fc-color-accent-bg)', active='var(--fc-color-accent-bg-active)';
  const quietAccent=`color-mix(in srgb-linear, ${accent} 82%, ${active})`;
  const halo=`0 1px 1px ${active}, 0 0 4px ${active}, 0 0 8px ${active}`;
  const rainbow=['red','orange','yellow','green','blue','violet'].map((name,index)=>`var(--fc-color-pride-${name}) ${index*100/6}% ${(index+1)*100/6}%`).join(', ');
  const recipes:Record<string,Record<string,string>>={
    aurora:{'--fc-theme-feature-image':`repeating-linear-gradient(125deg in srgb-linear, ${accent} 0 12%, ${active} 24%, ${accent} 36%)`},
    candy:{'--fc-theme-canvas-image':`repeating-linear-gradient(135deg in srgb-linear, ${canvas} 0 24px, color-mix(in srgb-linear, ${canvas} 85%, ${subtle}) 24px 48px)`, '--fc-theme-feature-image':`repeating-linear-gradient(135deg in srgb-linear, ${accent} 0 20px, ${quietAccent} 20px 40px)`, '--fc-theme-feature-text-shadow':halo},
    solar:{'--fc-shadow-raised':'6px 6px 0 var(--fc-color-border-interactive)', '--fc-shadow-overlay':'8px 8px 0 var(--fc-color-border-interactive)', '--fc-theme-feature-image':`radial-gradient(circle at 85% 20% in srgb-linear, ${active} 0 20%, ${accent} 21%)`},
    nocturne:{'--fc-theme-feature-image':`radial-gradient(ellipse at 20% 10% in srgb-linear, ${accent}, ${active})`, '--fc-card-bg':'var(--fc-color-bg-subtle)'},
    arcade:{'--fc-font-family-sans':'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace', '--fc-theme-feature-image':`repeating-linear-gradient(0deg in srgb-linear, ${accent} 0 5px, ${quietAccent} 5px 6px)`, '--fc-shadow-raised':'4px 4px 0 var(--fc-color-border-interactive)', '--fc-theme-feature-text-shadow':halo},
    parchment:{'--fc-theme-canvas-image':`repeating-linear-gradient(0deg in srgb-linear, ${canvas} 0 31px, ${subtle} 31px 32px)`, '--fc-card-bg':'var(--fc-color-bg-subtle)', '--fc-theme-feature-bg':'var(--fc-color-selected-bg)'},
    bubble:{'--fc-theme-canvas-image':`radial-gradient(circle at 10% 15% in srgb-linear, ${subtle} 0 15%, ${canvas} 45%)`, '--fc-theme-feature-image':`radial-gradient(circle at 80% 20% in srgb-linear, ${active} 0 15%, ${accent} 16% 35%, ${active} 36% 38%, ${accent} 39%)`},
    garnet:{'--fc-theme-feature-image':`conic-gradient(from 45deg at 70% 30% in srgb-linear, ${accent}, ${active}, ${accent}, ${active}, ${accent})`},
    origami:{'--fc-shadow-raised':'3px 5px 0 var(--fc-color-border-subtle)', '--fc-theme-feature-bg':accent, '--fc-theme-feature-fg':'var(--fc-color-text-on-accent)', '--fc-theme-feature-image':`linear-gradient(150deg in srgb-linear, ${accent} 0 65%, ${active} 65%)`},
    sundown:{'--fc-theme-feature-image':`linear-gradient(0deg in srgb-linear, ${active} 0 20%, ${accent} 20% 45%, ${active} 45% 48%, ${accent} 48%)`, '--fc-card-bg':'var(--fc-color-bg-surface)', '--fc-shadow-raised':'var(--fc-elevation-dialog)'},
  };
  recipes.pride={'--fc-theme-feature-image':`linear-gradient(120deg in srgb-linear, ${rainbow})`, '--fc-theme-feature-text-shadow':halo};
  const recipe={...recipes[preset.id]}, stock=themePresets.find(p=>p.id===preset.id);
  // Custom controls take precedence over the starting design's decoration.
  if(stock)for(const key of Object.keys(recipe)) {
    if((key.startsWith('--fc-shadow-')&&preset.depth!==stock.depth)||
       (key==='--fc-font-family-sans'&&preset.type!==stock.type)||
       (key.startsWith('--fc-theme-feature-')&&preset.surface!==stock.surface)||
       (key==='--fc-card-bg'&&preset.surface!==stock.surface))delete recipe[key];
  }
  Object.assign(values,recipe);
  return values;
}
