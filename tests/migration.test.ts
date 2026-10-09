import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { migrateNames } from '../tools/migrate-tokens.mjs';

it('renames complete public names once, preserving longer names and unrelated text', () => {
  const result = migrateNames('.fc-old { color:var(--fc-old); } .fc-old-extra {} data-fc-old fc-next', {'fc-old':'fc-next','fc-next':'fc-final','--fc-old':'--fc-new'});
  assert.equal(result.source,'.fc-next { color:var(--fc-new); } .fc-old-extra {} data-fc-old fc-final');
  assert.equal(result.count,3);
  assert.throws(()=>migrateNames('',{'fc-old':'--fc-token'}));
  assert.throws(()=>migrateNames('',{'arbitrary':'fc-next'}));
});

it('keeps the CLI dry by default and preserves an exclusive backup before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(),'fc-migration-'));
  try {
    const file=join(dir,'sample.css'), map=join(dir,'renames.json');
    await writeFile(file,'.fc-old {}'); await writeFile(map,JSON.stringify({'fc-old':'fc-new'}));
    const tool=new URL('../tools/migrate-tokens.mjs',import.meta.url).pathname;
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
