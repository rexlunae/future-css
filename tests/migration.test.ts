import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { migrateNames } from '../tools/migrate-tokens.mjs';

it('renames complete public names once, preserving longer names and unrelated text', () => {
  const result = migrateNames('.fc-old { color:var(--fc-old); } .fc-old-extra {} data-fc-old fc-next', {'fc-old':'fc-next','fc-next':'fc-final','--fc-old':'--fc-new'});
  assert.equal(result.source,'.fc-next { color:var(--fc-new); } .fc-old-extra {} data-fc-old fc-final');
  assert.equal(result.count,3);
  assert.throws(()=>migrateNames('',{'fc-old':'--fc-token'}));
  assert.throws(()=>migrateNames('',{'arbitrary':'fc-next'}));
});

it('carries BEM element and modifier classes with a renamed component', () => {
  const result = migrateNames(
    '<li class="fc-old__item fc-old--active fc-old-extra fc-old__item--on"> .fc-old__icon {} var(--fc-old--x) var(--fc-old)',
    {'fc-old':'fc-new','fc-old__icon':'fc-new__glyph','fc-new':'fc-final','--fc-old':'--fc-new'});
  assert.equal(result.source,
    '<li class="fc-new__item fc-new--active fc-old-extra fc-new__item--on"> .fc-new__glyph {} var(--fc-old--x) var(--fc-new)');
  assert.equal(result.count,5);
});

it('keeps the CLI dry by default and preserves an exclusive backup before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(),'fc-migration-'));
  try {
    const file=join(dir,'sample.css'), map=join(dir,'renames.json');
    await writeFile(file,'.fc-old {}'); await writeFile(map,JSON.stringify({'fc-old':'fc-new'}));
    const tool=fileURLToPath(new URL('../tools/migrate-tokens.mjs',import.meta.url));
    execFileSync(process.execPath,[tool,'--map',map,file]);
    assert.equal(await readFile(file,'utf8'),'.fc-old {}');
    execFileSync(process.execPath,[tool,'--map',map,'--write',file]);
    assert.equal(await readFile(file,'utf8'),'.fc-new {}');
    assert.equal(await readFile(file+'.fc-migration.bak','utf8'),'.fc-old {}');
    await writeFile(file,'.fc-old {}');
    assert.throws(()=>execFileSync(process.execPath,[tool,'--map',map,'--write',file],{stdio:'pipe'}));
    assert.equal(await readFile(file,'utf8'),'.fc-old {}');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
