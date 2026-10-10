import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {it} from 'node:test';
it('documents the six required contracts and links a real fixture for every CSS component',()=>{
  const root=new URL('../',import.meta.url);
  const contracts=readFileSync(new URL('docs/COMPONENT-CONTRACTS.md',root),'utf8');
  const fixtures=readFileSync(new URL('demo/fixtures.html',root),'utf8');
  for(const file of readdirSync(new URL('src/css/components/',root)).filter(f=>f.endsWith('.css'))){
    const name=file.slice(0,-4),section=contracts.split(`## ${name}\n`)[1]?.split('\n## ')[0];
    assert.ok(section,`Missing contract for ${name}`);
    for(const title of ['Anatomy','States','Accessibility','Internationalization','No-JS fallback','When not to use it']) assert.ok(section.includes(`### ${title}\n`),`${name}: ${title}`);
    const anchor=/fixtures\.html#([^)]*)/.exec(section)?.[1];
    assert.ok(anchor && fixtures.includes(`id="${anchor}"`),`${name}: fixture anchor`);
  }
});
