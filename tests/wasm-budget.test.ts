import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {it} from 'node:test';
const report=new URL('../dist/wasm/size-report.json',import.meta.url);
it('gates unchanged WASM targets on the actual shipped binary and reports raw bytes separately', {skip:existsSync(report)?false:'run build:wasm first'},()=>{
  const expected:Record<string,number>={'fc-core':40000,'fc-model':45000,'fc-rich-text':50000,'fc-context-menu':45000,'fc-grid':45000,'fc-diff':35000,'fc-select':35000,'fc-git':50000,'fc-highlight':35000};
  const rows=JSON.parse(readFileSync(report,'utf8'));
  assert.equal(rows.length,Object.keys(expected).length);
  for(const row of rows){
    assert.equal(row.budget,expected[row.crate],row.crate);
    assert.equal(row.budgetBasis,'shipped');
    const binary=new URL(`../dist/wasm/${row.module}/web/${row.crate.replaceAll('-','_')}_bg.wasm`,import.meta.url);
    assert.equal(row.shippedBytes,statSync(binary).size);
    assert.equal(row.rawWithinBudget,row.bytes<=row.budget);
    assert.equal(row.withinBudget,row.shippedBytes>0 && row.shippedBytes<=row.budget);
    assert.ok(row.withinBudget,`${row.crate}: ${row.shippedBytes} exceeds ${row.budget}`);
  }
});
